import { z } from "zod";
import type { ServiceModule } from "../types.js";
import { ok, run } from "../../lib/result.js";
import { datastoreSearch } from "../gov-data/ckan.js";
import { CHANGES, COMPANIES, PARTNERSHIPS, SOURCE } from "./resources.js";
import {
  cleanNameQuery,
  corporateKind,
  normalizeChanges,
  normalizeCompany,
  normalizePartnership,
  rankByName,
  validateCorporateNumber,
  type CorporateEntity,
} from "./normalize.js";

/**
 * Israeli Corporations Authority (רשות התאגידים / רשם החברות) via data.gov.il open data.
 * Public, no authentication. Data is a periodic snapshot published by the Ministry of Justice.
 */

const NOTE = "Open-data snapshot, refreshed periodically — not a certified registry extract (נסח חברה).";

export const ica: ServiceModule = {
  id: "ica",
  name: "Israeli Corporations Authority",
  disabledReason: () => null,

  register(server, config) {
    const t = config.httpTimeoutMs;

    async function findCompany(n: number): Promise<CorporateEntity | null> {
      const r = await datastoreSearch({ resourceId: COMPANIES, filters: { "מספר חברה": n }, limit: 1 }, t);
      return r.records[0] ? normalizeCompany(r.records[0]) : null;
    }

    async function findPartnership(n: number): Promise<CorporateEntity | null> {
      const r = await datastoreSearch({ resourceId: PARTNERSHIPS, filters: { "מספר שותפות": n }, limit: 1 }, t);
      return r.records[0] ? normalizePartnership(r.records[0]) : null;
    }

    server.registerTool(
      "ica_lookup_company",
      {
        title: "Look up an Israeli company or partnership by registration number",
        description:
          "Use when you have an Israeli company number (ח.פ) or partnership number and need to verify the entity: " +
          "whether it exists and is active, its official Hebrew/English name, corporate type, incorporation date, " +
          "registered address, last annual report year, and whether the registrar flags it as a violator (מפרה — " +
          "usually unpaid annual fees / missing reports). Good for supplier or client due diligence and for filling " +
          "invoice details. Set includeChanges to also get registry changes from the last 12 months (e.g. liens " +
          "registered or removed). Not for sole proprietors (עוסק מורשה/פטור) — their number is a personal ID and is not in this registry. " +
          "If you only have a name, call ica_search_companies first.",
        inputSchema: {
          number: z
            .string()
            .min(1)
            .describe("9-digit registration number, e.g. 520013954; dashes/spaces allowed"),
          includeChanges: z
            .boolean()
            .default(false)
            .describe("Also return registry changes from the last 12 months (liens registered/removed, etc.)"),
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      async ({ number, includeChanges }) =>
        run(async () => {
          const check = validateCorporateNumber(number);
          if (!check.normalized) throw new Error(`Invalid registration number "${number}": ${check.reason}`);
          const n = Number(check.normalized);
          const warning = check.valid ? undefined : "Check digit is invalid — the number is probably mistyped.";

          const order =
            corporateKind(check.normalized) === "partnership"
              ? [findPartnership, findCompany]
              : [findCompany, findPartnership];
          let entity: CorporateEntity | null = null;
          for (const find of order) {
            entity = await find(n);
            if (entity) break;
          }

          if (!entity) {
            return ok({
              found: false,
              number: check.normalized,
              checksumValid: check.valid,
              warning,
              hint: "Not found in the companies or partnerships registries. Amutot (58…) and sole proprietors are not covered.",
              source: SOURCE,
            });
          }

          let changes;
          if (includeChanges) {
            const r = await datastoreSearch({ resourceId: CHANGES, filters: { "מספר תאגיד": n }, limit: 50 }, t);
            changes = normalizeChanges(r.records);
          }

          return ok({
            found: true,
            checksumValid: check.valid,
            warning,
            entity,
            changes,
            source: SOURCE,
            note: NOTE,
          });
        }),
    );

    server.registerTool(
      "ica_search_companies",
      {
        title: "Search Israeli companies by name",
        description:
          "Use when you have an Israeli company name (Hebrew or English) but not its registration number. " +
          "Returns candidates with number, names, status, city and violator flag; then call ica_lookup_company " +
          "for full details. Results are full-text matches re-ranked by name similarity, not an exact match — " +
          "confirm with the user when several candidates look plausible.",
        inputSchema: {
          name: z.string().min(2).describe('Company name, Hebrew or English. Suffixes like בע"מ / Ltd are ignored.'),
          activeOnly: z.boolean().default(true).describe("Only entities with status פעילה"),
          city: z
            .string()
            .optional()
            .describe('Exact registered city name as the registry writes it, e.g. "תל אביב - יפו", "חיפה"'),
          includePartnerships: z.boolean().default(false).describe("Also search the partnerships registry"),
          limit: z.number().int().min(1).max(25).default(10),
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      async ({ name, activeOnly, city, includePartnerships, limit }) =>
        run(async () => {
          const q = cleanNameQuery(name);
          if (q.length < 2) throw new Error(`Name "${name}" is too short after removing legal suffixes`);
          const fetchN = Math.min(limit * 3, 75);

          const companyFilters: Record<string, string> = {};
          if (activeOnly) companyFilters["סטטוס חברה"] = "פעילה";
          if (city) companyFilters["שם עיר"] = city;

          const companiesP = datastoreSearch({ resourceId: COMPANIES, q, filters: companyFilters, limit: fetchN }, t);

          let partnershipsP: ReturnType<typeof datastoreSearch> | undefined;
          if (includePartnerships) {
            const pf: Record<string, string> = {};
            if (activeOnly) pf["סטטוס תאגיד"] = "פעילה";
            if (city) pf["ישוב"] = city;
            partnershipsP = datastoreSearch({ resourceId: PARTNERSHIPS, q, filters: pf, limit: fetchN }, t);
          }

          const [companies, partnerships] = await Promise.all([companiesP, partnershipsP]);
          const entities = [
            ...companies.records.map(normalizeCompany),
            ...(partnerships?.records.map(normalizePartnership) ?? []),
          ];

          const results = rankByName(entities, q)
            .slice(0, limit)
            .map((e) => ({
              number: e.number,
              kind: e.kind,
              nameHe: e.nameHe,
              nameEn: e.nameEn,
              status: e.status,
              isActive: e.isActive,
              isViolator: e.isViolator,
              city: e.address?.city,
              type: e.type,
            }));

          return ok({
            query: q,
            totalMatches: companies.total + (partnerships?.total ?? 0),
            results,
            source: SOURCE,
          });
        }),
    );
  },
};
