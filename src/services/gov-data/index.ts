import { z } from "zod";
import type { ServiceModule } from "../types.js";
import { buildUrl, requestJson } from "../../lib/http.js";
import { ok, run } from "../../lib/result.js";

/**
 * data.gov.il — Israeli government open-data portal (CKAN).
 * Public, no authentication. Docs: https://docs.ckan.org/en/latest/api/
 */
const BASE = "https://data.gov.il/api/3/action";

interface CkanResponse<T> {
  success: boolean;
  result: T;
  error?: { message?: string };
}

async function ckan<T>(action: string, params: Record<string, string | number | undefined>, timeoutMs: number): Promise<T> {
  const res = await requestJson<CkanResponse<T>>(buildUrl(`${BASE}/${action}`, params), { timeoutMs });
  if (!res.success) throw new Error(`CKAN ${action} failed: ${res.error?.message ?? "unknown error"}`);
  return res.result;
}

export const govData: ServiceModule = {
  id: "gov",
  name: "data.gov.il",
  disabledReason: () => null,

  register(server, config) {
    const t = config.httpTimeoutMs;

    server.registerTool(
      "gov_search_datasets",
      {
        title: "Search Israeli government datasets",
        description:
          "Full-text search over data.gov.il datasets (Hebrew or English). Returns dataset ids, titles, " +
          "publishing organization, and their resources. Use a resource id with gov_query_resource to read rows. " +
          "Tip: Hebrew queries usually match better (e.g. 'רכב' rather than 'vehicles').",
        inputSchema: {
          query: z.string().min(1).describe("Search text, Hebrew or English"),
          limit: z.number().int().min(1).max(50).default(10),
          offset: z.number().int().min(0).default(0),
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      async ({ query, limit, offset }) =>
        run(async () => {
          const r = await ckan<{ count: number; results: any[] }>(
            "package_search",
            { q: query, rows: limit, start: offset },
            t,
          );
          return ok({
            total: r.count,
            datasets: r.results.map((d) => ({
              id: d.name,
              title: d.title,
              organization: d.organization?.title,
              notes: typeof d.notes === "string" ? d.notes.slice(0, 300) : undefined,
              resources: (d.resources ?? []).map((res: any) => ({
                id: res.id,
                name: res.name,
                format: res.format,
                queryable: res.datastore_active === true,
              })),
            })),
          });
        }),
    );

    server.registerTool(
      "gov_query_resource",
      {
        title: "Query rows from a data.gov.il resource",
        description:
          "Read rows from a data.gov.il resource via the CKAN datastore. Only resources with queryable=true " +
          "(from gov_search_datasets) support this. Supports free-text search and exact-match filters on fields. " +
          "The response includes the field list, so call once with a small limit to discover the schema.",
        inputSchema: {
          resourceId: z.string().min(1).describe("Resource UUID from gov_search_datasets"),
          query: z.string().optional().describe("Free-text search across all fields"),
          filters: z
            .record(z.string(), z.union([z.string(), z.number()]))
            .optional()
            .describe('Exact-match filters, e.g. {"city": "תל אביב - יפו"}'),
          limit: z.number().int().min(1).max(500).default(20),
          offset: z.number().int().min(0).default(0),
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      async ({ resourceId, query, filters, limit, offset }) =>
        run(async () => {
          const r = await ckan<{ total: number; fields: any[]; records: any[] }>(
            "datastore_search",
            {
              resource_id: resourceId,
              q: query,
              filters: filters ? JSON.stringify(filters) : undefined,
              limit,
              offset,
            },
            t,
          );
          return ok({
            total: r.total,
            fields: r.fields.filter((f) => f.id !== "_id").map((f) => ({ name: f.id, type: f.type })),
            records: r.records,
          });
        }),
    );
  },
};
