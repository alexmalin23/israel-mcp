import { z } from "zod";
import type { ServiceModule } from "../types.js";
import { ok, run } from "../../lib/result.js";
import { ckan, datastoreSearch, shapeDatastore } from "./ckan.js";

/**
 * data.gov.il — Israeli government open-data portal (CKAN).
 * Public, no authentication. HTTP helpers live in ./ckan.ts.
 */
export { shapeDatastore } from "./ckan.js";

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
          "The response includes the field list, so call once with a small limit to discover the schema. " +
          "For Israeli company/partnership lookups use the ica_* tools instead.",
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
        run(async () => ok(shapeDatastore(await datastoreSearch({ resourceId, q: query, filters, limit, offset }, t)))),
    );
  },
};
