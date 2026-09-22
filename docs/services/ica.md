# Israeli Corporations Authority (רשות התאגידים / רשם החברות)

Company and partnership registry, read from the Ministry of Justice open-data datasets on data.gov.il (CKAN datastore).
Public, no authentication. Prefix: `ica_`.

## Datasets

| Dataset | Resource id | Contents |
|---|---|---|
| `ica_companies` | `f004176c-b85f-4542-8901-7b3176f9a054` | Every registered company, all statuses (~700k rows) |
| `ica_partnerships` | `139aa193-fabb-4f6b-a71b-0bb40fd73eb2` | Every registered partnership (~29k rows) |
| `ica-changes` | `28780ab5-3ef1-44c7-8377-da82c0aa6781` | Registry changes in the last 12 months (liens registered/removed, …), updated daily |

Resource ids live in `src/services/ica/resources.ts`. HTTP goes through the shared `src/services/gov-data/ckan.ts`.

## Tools

### `ica_lookup_company`
Verify an entity by registration number (ח.פ / partnership number).

| Param | Type | Default | Notes |
|---|---|---|---|
| `number` | string | — | 9 digits; dashes/spaces allowed, left-padded |
| `includeChanges` | boolean | `false` | Adds `changes[]` from `ica-changes` (up to 50, newest first) |

Flow: validate the check digit (ת.ז algorithm) → route by prefix (51/52 → companies first, 53/55 → partnerships first)
→ fall back to the other registry. An invalid check digit is a `warning`, not an error (the lookup still runs).
Not found → `{ found: false, ... }`, not `isError`.

Returns `{ found, checksumValid, warning?, entity, changes?, source, note }` where `entity` is:

```jsonc
{
  "number": "520013954",
  "kind": "company",               // or "partnership"
  "nameHe": "טבע תעשיות פרמצבטיות בע\"מ",
  "nameEn": "TEVA PHARMACEUTICAL INDUSTRIES LIMITED",
  "type": "ישראלית חברה ציבורית",
  "status": "פעילה",
  "isActive": true,                // status is פעילה or פעילה זמנית
  "incorporatedOn": "1944-02-13",
  "isGovernment": false,
  "isViolator": false,             // מפרה
  "limitation": "מוגבלת",
  "lastAnnualReportYear": 2006,
  "purpose": "לעסוק בסוגי עיסוק שפורטו בתקנון",
  "address": { "street": "דבורה הנביאה", "houseNumber": "124", "city": "תל אביב - יפו", "zip": "6944020", "country": "ישראל", "careOf": "…" }
}
```

Empty fields are omitted. `changes[]` items: `{ date, type, lienId }`.

### `ica_search_companies`
Find candidates by name when the number is unknown.

| Param | Type | Default | Notes |
|---|---|---|---|
| `name` | string ≥2 | — | Hebrew or English; `בע"מ` / `Ltd` / `Limited` / `Inc` and quotes are stripped |
| `activeOnly` | boolean | `true` | Exact filter on status `פעילה` |
| `city` | string | — | Exact registry spelling, e.g. `תל אביב - יפו` |
| `includePartnerships` | boolean | `false` | Also search partnerships |
| `limit` | int 1–25 | 10 | |

Fetches `limit × 3` (max 75) CKAN full-text hits, then re-ranks by name (`rankByName` in `normalize.ts`):
exact → starts-with → contains query → contains all tokens → contains first token → contains only later tokens.
Rows whose names match no token (CKAN matched them via `אצל`, purpose or address) are dropped.

Returns `{ query, totalMatches, results: [{ number, kind, nameHe, nameEn, status, isActive, isViolator, city, type }], source }`.

## Field mapping

| Companies (Hebrew key) | Partnerships (Hebrew key) | Output |
|---|---|---|
| מספר חברה | מספר שותפות | `number` (9-digit string) |
| שם חברה | שם שותפות | `nameHe` |
| שם באנגלית | שם באנגלית | `nameEn` |
| סוג תאגיד | סוג תאגיד | `type` |
| סטטוס חברה | סטטוס תאגיד | `status`, `isActive` |
| תת סטטוס | — | `subStatus` |
| תאריך התאגדות (DD/MM/YYYY) | תאריך התאגדות | `incorporatedOn` (ISO) |
| חברה ממשלתית (כן/לא) | — | `isGovernment` |
| מפרה (`מפרה` / empty) | — | `isViolator` |
| מגבלות | — | `limitation` |
| שנה אחרונה של דוח שנתי (שהוגש) | — | `lastAnnualReportYear` |
| מטרת החברה / תאור חברה | — | `purpose` / `description` |
| שם רחוב, מספר בית, שם עיר, מיקוד, ת.ד., מדינה, אצל | רחוב, מספר בית, ישוב, מיקוד, ת.ד, מדינה, אצל | `address.*` |

All `קוד …` columns, `_id` and `rank` are dropped.

## Quirks
- **Gershayim are stored as `~`**: `טבע בע~מ` → shown as `טבע בע"מ`. Applied to every text field. Some old names have no mark at all (`בעמ`).
- **Free-text search also hits `אצל`** (care-of): searching "טבע" returns unrelated companies whose mail goes to Teva. Hence the re-ranking.
- **מפרה** (violator) typically means unpaid annual fees / missing annual reports. ~194k companies carry it — a real due-diligence signal.
- Companies and partnerships use different column names (`שם עיר` vs `ישוב`, `ת.ד.` vs `ת.ד`).
- Status values include פעילה, פעילה זמנית, מחוסלת מרצון, מחוקה, בפרוק מרצון, בפרוק ע"י בימ"ש, נגרעה מהמרשם, and `פעילה/בפירוק - …` variants (these count as inactive).

## Limitations
- Periodic open-data snapshot, not a certified registry extract (נסח חברה).
- No shareholders, directors or financial statements in the open data.
- Sole proprietors (עוסק מורשה/פטור) are not in this registry — their number is a personal ID. Amutot (58…) are a separate registry, not covered yet.

## Verification
```bash
# Teva by number (filters={"מספר חברה":520013954})
curl "https://data.gov.il/api/3/action/datastore_search?resource_id=f004176c-b85f-4542-8901-7b3176f9a054&filters=%7B%22%D7%9E%D7%A1%D7%A4%D7%A8%20%D7%97%D7%91%D7%A8%D7%94%22%3A520013954%7D"
# Name search
curl "https://data.gov.il/api/3/action/datastore_search?resource_id=f004176c-b85f-4542-8901-7b3176f9a054&limit=3&q=%D7%98%D7%91%D7%A2"
```
Field names and sample rows were checked live on 2026-09-22 through `gov_query_resource`.
