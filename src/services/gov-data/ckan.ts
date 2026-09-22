import { buildUrl, requestJson } from "../../lib/http.js";

/**
 * data.gov.il — Israeli government open-data portal (CKAN).
 * Public, no authentication. Docs: https://docs.ckan.org/en/latest/api/
 * Shared by every service that reads data.gov.il (gov_, ica_, ...).
 */
export const CKAN_BASE = "https://data.gov.il/api/3/action";

interface CkanResponse<T> {
  success: boolean;
  result: T;
  error?: { message?: string };
}

export async function ckan<T>(
  action: string,
  params: Record<string, string | number | undefined>,
  timeoutMs: number,
): Promise<T> {
  const res = await requestJson<CkanResponse<T>>(buildUrl(`${CKAN_BASE}/${action}`, params), { timeoutMs });
  if (!res.success) throw new Error(`CKAN ${action} failed: ${res.error?.message ?? "unknown error"}`);
  return res.result;
}

export interface DatastoreResult {
  total: number;
  fields: { id: string; type: string }[];
  records: Record<string, unknown>[];
}

export interface DatastoreQuery {
  resourceId: string;
  q?: string;
  filters?: Record<string, string | number>;
  limit?: number;
  offset?: number;
}

/** Raw CKAN datastore_search (records still carry `_id`, and `rank` when `q` is set). */
export function datastoreSearch(query: DatastoreQuery, timeoutMs: number): Promise<DatastoreResult> {
  const { resourceId, q, filters, limit, offset } = query;
  return ckan<DatastoreResult>(
    "datastore_search",
    {
      resource_id: resourceId,
      q,
      filters: filters && Object.keys(filters).length > 0 ? JSON.stringify(filters) : undefined,
      limit,
      offset,
    },
    timeoutMs,
  );
}

/** Drop CKAN's internal row id ("_id") from both the field list and the records. */
export function shapeDatastore(r: DatastoreResult) {
  return {
    total: r.total,
    fields: r.fields.filter((f) => f.id !== "_id").map((f) => ({ name: f.id, type: f.type })),
    records: r.records.map(({ _id, ...rest }) => rest),
  };
}
