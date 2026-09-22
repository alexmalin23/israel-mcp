/**
 * Pure logic for the ICA (Registrar of Companies) service: number validation,
 * row normalization (Hebrew CKAN keys → compact English shape) and name ranking.
 * No I/O here — everything is unit-tested in test/ica.normalize.test.ts.
 */

// ---------- corporate numbers ----------

export interface NumberCheck {
  /** 9 digits, left-padded; empty string when the input is not numeric. */
  normalized: string;
  valid: boolean;
  reason?: string;
}

/**
 * Validates an Israeli corporate number (ח.פ / שותפות / עמותה).
 * Same check-digit algorithm as ת.ז: weights 1,2,1,2,… over 9 digits, products > 9 lose 9, sum % 10 === 0.
 */
export function validateCorporateNumber(input: string | number): NumberCheck {
  const raw = String(input).replace(/[\s\-–.]/g, "");
  if (!/^\d+$/.test(raw)) return { normalized: "", valid: false, reason: "must contain digits only" };
  if (raw.length > 9) return { normalized: "", valid: false, reason: "longer than 9 digits" };
  const normalized = raw.padStart(9, "0");
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const p = Number(normalized[i]) * (i % 2 === 0 ? 1 : 2);
    sum += p > 9 ? p - 9 : p;
  }
  return sum % 10 === 0 ? { normalized, valid: true } : { normalized, valid: false, reason: "check digit mismatch" };
}

export type CorporateKind = "company" | "partnership" | "other";

/** Routing hint from the number prefix. Lookups must still fall back to the other registry. */
export function corporateKind(normalized: string): CorporateKind {
  const prefix = normalized.slice(0, 2);
  if (prefix === "51" || prefix === "52") return "company";
  if (prefix === "53" || prefix === "55") return "partnership";
  return "other";
}

// ---------- field helpers ----------

/** The registry encodes gershayim (") as "~": 'בע~מ' → 'בע"מ'. */
export function fixGershayim(s: string): string {
  return s.replace(/~/g, '"');
}

/** "13/02/1944" → "1944-02-13"; null for empty or malformed input. */
export function parseIlDate(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const [, d, mo, y] = m;
  const dd = Number(d), mm = Number(mo);
  if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return null;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function text(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = fixGershayim(String(v)).trim();
  return s === "" ? undefined : s;
}

function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Recursively drop undefined values and empty objects so agents don't see blank fields. */
export function compact<T>(value: T): T {
  if (Array.isArray(value)) return value.map(compact) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const c = compact(v);
      if (c === undefined || c === null) continue;
      if (typeof c === "object" && !Array.isArray(c) && Object.keys(c).length === 0) continue;
      out[k] = c;
    }
    return out as T;
  }
  return value;
}

// ---------- entities ----------

export interface CorporateEntity {
  number: string;
  kind: "company" | "partnership";
  nameHe?: string;
  nameEn?: string;
  type?: string;
  status?: string;
  subStatus?: string;
  isActive: boolean;
  incorporatedOn?: string;
  isGovernment?: boolean;
  isViolator?: boolean;
  limitation?: string;
  lastAnnualReportYear?: number;
  purpose?: string;
  description?: string;
  address?: {
    street?: string;
    houseNumber?: string;
    city?: string;
    zip?: string;
    poBox?: string;
    country?: string;
    careOf?: string;
  };
}

const ACTIVE = new Set(["פעילה", "פעילה זמנית"]);

export function isActiveStatus(status: string | undefined): boolean {
  return status !== undefined && ACTIVE.has(status.trim());
}

type Row = Record<string, unknown>;

export function normalizeCompany(row: Row): CorporateEntity {
  const status = text(row["סטטוס חברה"]);
  const gov = text(row["חברה ממשלתית"]);
  return compact({
    number: String(row["מספר חברה"] ?? "").padStart(9, "0"),
    kind: "company" as const,
    nameHe: text(row["שם חברה"]),
    nameEn: text(row["שם באנגלית"]),
    type: text(row["סוג תאגיד"]),
    status,
    subStatus: text(row["תת סטטוס"]),
    isActive: isActiveStatus(status),
    incorporatedOn: parseIlDate(row["תאריך התאגדות"]) ?? undefined,
    isGovernment: gov === undefined ? undefined : gov === "כן",
    isViolator: text(row["מפרה"]) !== undefined,
    limitation: text(row["מגבלות"]),
    lastAnnualReportYear: num(row["שנה אחרונה של דוח שנתי (שהוגש)"]),
    purpose: text(row["מטרת החברה"]),
    description: text(row["תאור חברה"]),
    address: {
      street: text(row["שם רחוב"]),
      houseNumber: text(row["מספר בית"]),
      city: text(row["שם עיר"]),
      zip: text(row["מיקוד"]),
      poBox: text(row["ת.ד."]),
      country: text(row["מדינה"]),
      careOf: text(row["אצל"]),
    },
  });
}

export function normalizePartnership(row: Row): CorporateEntity {
  const status = text(row["סטטוס תאגיד"]);
  return compact({
    number: String(row["מספר שותפות"] ?? "").padStart(9, "0"),
    kind: "partnership" as const,
    nameHe: text(row["שם שותפות"]),
    nameEn: text(row["שם באנגלית"]),
    type: text(row["סוג תאגיד"]),
    status,
    isActive: isActiveStatus(status),
    incorporatedOn: parseIlDate(row["תאריך התאגדות"]) ?? undefined,
    address: {
      street: text(row["רחוב"]),
      houseNumber: text(row["מספר בית"]),
      city: text(row["ישוב"]),
      zip: text(row["מיקוד"]),
      poBox: text(row["ת.ד"]),
      country: text(row["מדינה"]),
      careOf: text(row["אצל"]),
    },
  });
}

export interface RegistryChange {
  date?: string;
  type?: string;
  lienId?: number;
}

/** Newest first; rows without a parseable date go last. */
export function normalizeChanges(rows: Row[]): RegistryChange[] {
  return rows
    .map((r) =>
      compact({
        date: parseIlDate(r["תאריך עדכון סטטוס"]) ?? undefined,
        type: text(r["סוג בקשה"]),
        lienId: num(r["מזהה השיעבוד"]),
      }),
    )
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

// ---------- name search ----------

const SUFFIX = /(^|\s)(בע["~״']?מ|ltd\.?|limited|inc\.?)(?=\s|$)/giu;

/** Strip legal suffixes and quote marks: 'טבע בע"מ' → 'טבע', 'Teva Ltd.' → 'Teva'. */
export function cleanNameQuery(q: string): string {
  return q
    .replace(SUFFIX, " ")
    .replace(/["'~״׳`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Comparable form of a name: suffixes/quotes removed, lower-cased. */
export function nameKey(s: string | undefined): string {
  return s ? cleanNameQuery(s).toLowerCase() : "";
}

/**
 * Re-ranks CKAN full-text hits by how well the *name* matches.
 * Tiers: 0 exact · 1 starts-with · 2 contains the whole query · 3 contains every token ·
 * 4 contains the first token (usually the distinctive one) · 5 contains only later tokens (often generic words like תעשיות).
 * Rows whose names match no token at all (matched only via "אצל" / purpose / address) are dropped.
 * Ties keep CKAN's rank order (input order is assumed to be CKAN rank, best first).
 */
export function rankByName<T extends { nameHe?: string; nameEn?: string }>(items: T[], query: string): T[] {
  const q = nameKey(query);
  if (!q) return items;
  const tokens = q.split(" ").filter(Boolean);
  const tierOf = (name: string): number => {
    if (!name) return 99;
    if (name === q) return 0;
    if (name.startsWith(q)) return 1;
    if (name.includes(q)) return 2;
    const hits = tokens.filter((t) => name.includes(t)).length;
    if (hits === tokens.length) return 3;
    if (name.includes(tokens[0])) return 4;
    if (hits > 0) return 5;
    return 99;
  };
  return items
    .map((item, idx) => ({ item, idx, tier: Math.min(tierOf(nameKey(item.nameHe)), tierOf(nameKey(item.nameEn))) }))
    .filter((r) => r.tier < 99)
    .sort((a, b) => a.tier - b.tier || a.idx - b.idx)
    .map((r) => r.item);
}
