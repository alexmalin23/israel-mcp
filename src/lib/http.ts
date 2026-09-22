/**
 * Minimal fetch wrapper: timeout, JSON parsing, and errors that are
 * readable by a model (status + trimmed body), never raw stack traces.
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly body: string,
  ) {
    super(`HTTP ${status} from ${new URL(url).host}: ${body.slice(0, 500)}`);
    this.name = "HttpError";
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

export async function requestJson<T = unknown>(url: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", headers = {}, body, timeoutMs = 15_000 } = opts;

  const res = await fetch(url, {
    method,
    headers: {
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, url, text);
  if (!text) return undefined as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(res.status, url, `Expected JSON, got: ${text.slice(0, 200)}`);
  }
}

export function buildUrl(base: string, params: Record<string, string | number | boolean | undefined>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }
  return url.toString();
}
