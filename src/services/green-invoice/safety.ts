import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * Write-safety primitives for gi_create_document. Pure / in-process, unit-tested in test/gi.safety.test.ts.
 *
 * The confirmation token binds "what the user saw in the preview" to "what gets issued":
 *   dryRun=true  → preview succeeds → token = HMAC(id, expiry, sha256(canonical body))
 *   dryRun=false → body is rebuilt from the args, re-hashed, and must match the token; the token is single-use.
 * If the agent changes any field (amount, client, type, lines...) after the user confirmed, issuing is refused.
 * Tokens are stateless except for the used-id set, so they survive the per-request servers of the HTTP entrypoint
 * (same process). A restart invalidates all tokens (new secret) — that's intended.
 */

/** JSON with object keys sorted recursively and undefined dropped, so equal payloads hash equally. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = sortKeys(x);
    }
    return out;
  }
  return v;
}

export function payloadHash(body: unknown): string {
  return createHash("sha256").update(canonicalJson(body)).digest("hex");
}

export type VerifyResult =
  | { ok: true; id: string }
  | { ok: false; reason: "malformed" | "payload_changed" | "expired" | "already_used" };

export const VERIFY_MESSAGES: Record<Exclude<VerifyResult, { ok: true }>["reason"], string> = {
  malformed: "confirmationToken is missing or malformed. Run a dryRun preview first and use its confirmationToken.",
  payload_changed:
    "The document details differ from the previewed ones (or the token belongs to another preview). " +
    "Run a new dryRun preview, show it to the user, and get confirmation again.",
  expired: "confirmationToken expired. Run a new dryRun preview and confirm with the user again.",
  already_used:
    "confirmationToken was already used — a document may already have been issued from it. " +
    "Check gi_search_documents before previewing again.",
};

export class ConfirmationTokens {
  private readonly used = new Map<string, number>(); // id → expiry (ms)

  constructor(
    private readonly secret: Buffer = randomBytes(32),
    readonly ttlMs = 10 * 60 * 1000,
  ) {}

  private sign(id: string, exp: number, hash: string): string {
    return createHmac("sha256", this.secret).update(`${id}.${exp}.${hash}`).digest("base64url");
  }

  issue(body: unknown, now = Date.now()): { token: string; expiresAt: string } {
    const id = randomUUID();
    const exp = now + this.ttlMs;
    return { token: `${id}.${exp}.${this.sign(id, exp, payloadHash(body))}`, expiresAt: new Date(exp).toISOString() };
  }

  verify(token: string | undefined, body: unknown, now = Date.now()): VerifyResult {
    const parts = (token ?? "").split(".");
    if (parts.length !== 3) return { ok: false, reason: "malformed" };
    const [id, expStr, sig] = parts;
    const exp = Number(expStr);
    if (!id || !Number.isFinite(exp) || !sig) return { ok: false, reason: "malformed" };

    const expected = Buffer.from(this.sign(id, exp, payloadHash(body)));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "payload_changed" };
    if (now > exp) return { ok: false, reason: "expired" };
    if (this.used.has(id)) return { ok: false, reason: "already_used" };
    return { ok: true, id };
  }

  /** Mark used BEFORE sending the write, so an ambiguous failure can't be replayed with the same token. */
  consume(id: string, now = Date.now()): void {
    for (const [k, exp] of this.used) if (exp < now) this.used.delete(k);
    this.used.set(id, now + this.ttlMs);
  }
}

/** Process-wide instance used by the tool. */
export const confirmationTokens = new ConfirmationTokens();

// ---------- amount / date checks ----------

export interface IncomeLine {
  quantity: number;
  price: number;
}
export interface PaymentLine {
  date: string;
  price: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Σ quantity × price as entered (VAT handling depends on each line's vatType; this is a sanity figure). */
export function linesTotal(income: IncomeLine[]): number {
  return round2(income.reduce((s, l) => s + l.quantity * l.price, 0));
}

export function paymentsTotal(payment: PaymentLine[] | undefined): number {
  return round2((payment ?? []).reduce((s, p) => s + p.price, 0));
}

/** Returns an error message when the document exceeds the configured cap, else null. maxTotal <= 0 disables the cap. */
export function checkAmountCap(income: IncomeLine[], payment: PaymentLine[] | undefined, maxTotal: number): string | null {
  if (!(maxTotal > 0)) return null;
  const biggest = Math.max(Math.abs(linesTotal(income)), Math.abs(paymentsTotal(payment)));
  return biggest > maxTotal
    ? `Document total ${biggest} exceeds GREENINVOICE_MAX_TOTAL (${maxTotal}). Raise the limit in the server config if this is intended.`
    : null;
}

/** Payment dates after today (Israel time) — the API rejects them for receipt types. */
export function futurePaymentDates(payment: PaymentLine[] | undefined, todayIL: string): string[] {
  return (payment ?? []).map((p) => p.date).filter((d) => d > todayIL);
}

// ---------- audit ----------

export interface AuditEntry {
  env: string;
  action: "preview" | "issue";
  outcome: "ok" | "refused" | "error" | "unknown";
  type: number;
  client: string;
  total: number;
  currency: string;
  documentId?: string;
  documentNumber?: string | number;
  reason?: string;
}

/** One JSON line on stderr (stdout is the MCP channel). No secrets, no emails, no tax ids. */
export function audit(entry: AuditEntry, write: (s: string) => void = (s) => process.stderr.write(s)): void {
  write(`[israel-mcp] audit ${JSON.stringify({ at: new Date().toISOString(), tool: "gi_create_document", ...entry })}\n`);
}
