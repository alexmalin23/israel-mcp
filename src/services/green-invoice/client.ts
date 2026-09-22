import { HttpError } from "../../lib/http.js";

/**
 * Green Invoice (Morning) REST client.
 * - JWT from POST /account/token {id, secret}, cached ~25 min (tokens live ~30 min), single-flight, refreshed once on 401.
 * - Client-side throttle to ~3 req/s, serialized so concurrent tool calls can't burst past it.
 * - Safe requests (reads, search, preview) retry on 429/502/503/504 and network errors with backoff (Retry-After honored).
 * - Unsafe requests (issuing documents) are never retried: a timeout, network error or 5xx becomes
 *   WriteOutcomeUnknownError, because the document may already exist.
 * Clients are cached per (env, apiId) at module level so the stateless HTTP entrypoint, which builds a
 * fresh McpServer per request, still reuses tokens and shares one throttle.
 * Reference: https://greeninvoice.docs.apiary.io
 */
export const BASE_URLS = {
  production: "https://api.greeninvoice.co.il/api/v1",
  sandbox: "https://sandbox.d.greeninvoice.co.il/api/v1",
} as const;

export type GreenInvoiceEnv = keyof typeof BASE_URLS;

const TOKEN_TTL_MS = 25 * 60 * 1000;
const MIN_INTERVAL_MS = 350;
const RETRY_STATUSES = new Set([429, 502, 503, 504]);
const MAX_RETRIES = 2;
const MAX_BACKOFF_MS = 5_000;

/** Thrown when a write may or may not have been applied. Never retry blindly after this. */
export class WriteOutcomeUnknownError extends Error {
  constructor(
    public readonly path: string,
    cause: string,
  ) {
    super(
      `Outcome unknown for ${path} (${cause}). The document MAY have been issued. ` +
        "Do not retry: check with gi_search_documents (same client, type and date) first, " +
        "and run a new dryRun preview only if nothing was issued.",
    );
    this.name = "WriteOutcomeUnknownError";
  }
}

export interface ClientOptions {
  timeoutMs?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  minIntervalMs?: number;
}

export interface RequestOptions {
  /** true = the request has no side effects and may be retried (GET, search, preview). */
  safe: boolean;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function describeNetworkError(e: unknown): string {
  if (e instanceof Error) {
    if (e.name === "TimeoutError" || e.name === "AbortError") return "request timed out";
    return e.message || e.name;
  }
  return String(e);
}

/** Seconds or HTTP-date → ms, capped. */
export function retryAfterMs(header: string | null, attempt: number): number {
  const fallback = Math.min(500 * 2 ** attempt, MAX_BACKOFF_MS);
  if (!header) return fallback;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.min(Math.max(secs * 1000, 0), MAX_BACKOFF_MS);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.min(Math.max(at - Date.now(), 0), MAX_BACKOFF_MS) : fallback;
}

export class GreenInvoiceClient {
  private token: { value: string; at: number } | null = null;
  private tokenInFlight: Promise<string> | null = null;
  private lastRequest = 0;
  private gate: Promise<void> = Promise.resolve();
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly minIntervalMs: number;
  readonly baseUrl: string;

  constructor(
    private readonly apiId: string,
    private readonly apiSecret: string,
    readonly env: GreenInvoiceEnv,
    opts: ClientOptions = {},
  ) {
    this.baseUrl = BASE_URLS[env];
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.fetchImpl = opts.fetchImpl ?? ((...a) => fetch(...a));
    this.sleep = opts.sleep ?? defaultSleep;
    this.minIntervalMs = opts.minIntervalMs ?? MIN_INTERVAL_MS;
  }

  /** Serialized: each caller waits for the previous slot, so parallel calls are spaced out too. */
  private throttle(): Promise<void> {
    const slot = this.gate.then(async () => {
      const wait = this.minIntervalMs - (Date.now() - this.lastRequest);
      if (wait > 0) await this.sleep(wait);
      this.lastRequest = Date.now();
    });
    this.gate = slot.catch(() => {});
    return slot;
  }

  private async fetchToken(): Promise<string> {
    const url = `${this.baseUrl}/account/token`;
    for (let attempt = 0; ; attempt++) {
      await this.throttle();
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: this.apiId, secret: this.apiSecret }),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (e) {
        if (attempt < MAX_RETRIES) {
          await this.sleep(retryAfterMs(null, attempt));
          continue;
        }
        throw new Error(`Green Invoice auth failed: ${describeNetworkError(e)}`);
      }
      if (RETRY_STATUSES.has(res.status) && attempt < MAX_RETRIES) {
        await this.sleep(retryAfterMs(res.headers.get("Retry-After"), attempt));
        continue;
      }
      const text = await res.text();
      if (!res.ok) {
        const hint =
          res.status === 401
            ? ` (check keys; sandbox and production are separate tenancies with separate keys — current env: ${this.env})`
            : "";
        throw new HttpError(res.status, url, text + hint);
      }
      let token: string | null = null;
      try {
        token = JSON.parse(text).token ?? null;
      } catch {
        /* fall through to header */
      }
      token ??= res.headers.get("X-Authorization-Bearer");
      if (!token) throw new Error("Green Invoice auth succeeded but returned no token");
      this.token = { value: token, at: Date.now() };
      return token;
    }
  }

  /** Single-flight: concurrent callers share one token request. */
  private getToken(): Promise<string> {
    if (this.token && Date.now() - this.token.at < TOKEN_TTL_MS) return Promise.resolve(this.token.value);
    this.tokenInFlight ??= this.fetchToken().finally(() => {
      this.tokenInFlight = null;
    });
    return this.tokenInFlight;
  }

  async request<T = any>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body: unknown,
    { safe }: RequestOptions,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const send = async (token: string) => {
      await this.throttle();
      return this.fetchImpl(url, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    };

    let refreshed = false;
    for (let attempt = 0; ; ) {
      let res: Response;
      try {
        res = await send(await this.getToken());
      } catch (e) {
        if (!safe) throw new WriteOutcomeUnknownError(path, describeNetworkError(e));
        if (attempt < MAX_RETRIES) {
          await this.sleep(retryAfterMs(null, attempt++));
          continue;
        }
        throw new Error(`Green Invoice ${method} ${path} failed: ${describeNetworkError(e)}`);
      }

      // 401 is rejected before processing, so resending (even a write) once with a fresh token is safe.
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        this.token = null;
        continue;
      }
      // 429 is also rejected before processing; 5xx on a write may have been applied.
      if (RETRY_STATUSES.has(res.status) && attempt < MAX_RETRIES && (safe || res.status === 429)) {
        await this.sleep(retryAfterMs(res.headers.get("Retry-After"), attempt++));
        continue;
      }

      const text = await res.text();
      if (!safe && res.status >= 500) throw new WriteOutcomeUnknownError(path, `HTTP ${res.status}`);
      if (!res.ok) throw new HttpError(res.status, url, text);
      if (!text) return undefined as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new HttpError(res.status, url, `Expected JSON, got: ${text.slice(0, 200)}`);
      }
    }
  }

  get = <T = any>(path: string) => this.request<T>("GET", path, undefined, { safe: true });
  /** Read-only POST endpoints (search, preview). */
  query = <T = any>(path: string, body: unknown) => this.request<T>("POST", path, body, { safe: true });
  /** Side-effecting POST (issuing documents). Never retried on ambiguous failures. */
  create = <T = any>(path: string, body: unknown) => this.request<T>("POST", path, body, { safe: false });
}

const clients = new Map<string, GreenInvoiceClient>();

/** Process-wide client per (env, apiId, secret): shares token cache and throttle across per-request servers. */
export function getGreenInvoiceClient(
  apiId: string,
  apiSecret: string,
  env: GreenInvoiceEnv,
  timeoutMs: number,
): GreenInvoiceClient {
  const key = `${env}\u0000${apiId}\u0000${apiSecret}\u0000${timeoutMs}`;
  let c = clients.get(key);
  if (!c) {
    c = new GreenInvoiceClient(apiId, apiSecret, env, { timeoutMs });
    clients.set(key, c);
  }
  return c;
}
