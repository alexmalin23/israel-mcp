import { HttpError } from "../../lib/http.js";

/**
 * Green Invoice (Morning) REST client.
 * - JWT from POST /account/token {id, secret}, cached ~25 min (tokens live ~30 min), refreshed once on 401.
 * - Client-side throttle to ~3 req/s to match the API rate limit.
 * Reference: https://greeninvoice.docs.apiary.io
 */
export const BASE_URLS = {
  production: "https://api.greeninvoice.co.il/api/v1",
  sandbox: "https://sandbox.d.greeninvoice.co.il/api/v1",
} as const;

const TOKEN_TTL_MS = 25 * 60 * 1000;
const MIN_INTERVAL_MS = 350;

export class GreenInvoiceClient {
  private token: { value: string; at: number } | null = null;
  private lastRequest = 0;
  readonly baseUrl: string;

  constructor(
    private readonly apiId: string,
    private readonly apiSecret: string,
    readonly env: keyof typeof BASE_URLS,
    private readonly timeoutMs = 15_000,
  ) {
    this.baseUrl = BASE_URLS[env];
  }

  private async throttle(): Promise<void> {
    const wait = MIN_INTERVAL_MS - (Date.now() - this.lastRequest);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastRequest = Date.now();
  }

  private async getToken(): Promise<string> {
    if (this.token && Date.now() - this.token.at < TOKEN_TTL_MS) return this.token.value;
    await this.throttle();
    const url = `${this.baseUrl}/account/token`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: this.apiId, secret: this.apiSecret }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
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

  async request<T = any>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
    const send = async (token: string) => {
      await this.throttle();
      return fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    };

    let res = await send(await this.getToken());
    if (res.status === 401) {
      this.token = null;
      res = await send(await this.getToken());
    }
    const text = await res.text();
    if (!res.ok) throw new HttpError(res.status, `${this.baseUrl}${path}`, text);
    return (text ? JSON.parse(text) : undefined) as T;
  }

  get = <T = any>(path: string) => this.request<T>("GET", path);
  post = <T = any>(path: string, body: unknown) => this.request<T>("POST", path, body);
}
