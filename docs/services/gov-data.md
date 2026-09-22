# data.gov.il

Israeli government open-data portal, built on CKAN. Public, no authentication.

- API: `https://data.gov.il/api/3/action/<action>`
- CKAN reference: https://docs.ckan.org/en/latest/api/

## Tools

### `gov_search_datasets`
Full-text search over datasets (`package_search`).

| Param | Type | Default | Notes |
|---|---|---|---|
| `query` | string | — | Hebrew usually matches better |
| `limit` | int 1–50 | 10 | |
| `offset` | int | 0 | |

Returns `total` and `datasets[]` with `id`, `title`, `organization`, `notes` (first 300 chars) and `resources[]` (`id`, `name`, `format`, `queryable`).

### `gov_query_resource`
Reads rows from a resource (`datastore_search`). Only resources with `queryable: true`.

| Param | Type | Default | Notes |
|---|---|---|---|
| `resourceId` | string | — | From `gov_search_datasets` |
| `query` | string | — | Free text across all fields |
| `filters` | object | — | Exact match, e.g. `{"city": "חיפה"}` |
| `limit` | int 1–500 | 20 | |
| `offset` | int | 0 | |

Returns `total`, `fields[]` (`name`, `type`) and `records[]`.

## Typical flow
1. `gov_search_datasets { query: "רכב" }`
2. Pick a resource with `queryable: true`
3. `gov_query_resource { resourceId, limit: 3 }` to learn the fields
4. Query again with `filters`

## Verification
```bash
curl "https://data.gov.il/api/3/action/package_search?q=%D7%A8%D7%9B%D7%91&rows=1"
```
