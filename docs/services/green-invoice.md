# Green Invoice (Morning)

Israeli invoicing and bookkeeping. Requires API keys.

- Reference: https://greeninvoice.docs.apiary.io
- Production: `https://api.greeninvoice.co.il/api/v1`
- Sandbox: `https://sandbox.d.greeninvoice.co.il/api/v1`

## Setup
1. Green Invoice → My Account → Developer Tools → API Keys → add key.
2. For testing, create a **separate sandbox account** (`https://lp.sandbox.d.greeninvoice.co.il/join`) and generate keys there. Production keys return 401 on the sandbox (and vice versa) with the same error as a wrong key.
3. Set `GREENINVOICE_API_ID`, `GREENINVOICE_API_SECRET`, `GREENINVOICE_ENV`.

## Auth, limits and retries (`client.ts`)
- `POST /account/token {id, secret}` → JWT (~30 min). Cached 25 min, single-flight (concurrent calls share one token request), refreshed once on 401.
- Throttled client-side to ~3 req/s. The throttle is a serialized queue, so parallel tool calls are spaced too.
- One client per (env, keys) per process — the stateless HTTP entrypoint builds a server per request but reuses the token and throttle.
- **Safe requests** (`GET`, `/documents/search`, `/clients/search`, `/documents/preview`): retried up to 2× on 429/502/503/504 and network errors, exponential backoff (500 ms, 1 s), `Retry-After` honored, capped at 5 s.
- **Writes** (`POST /documents`): never retried on ambiguous failures. Timeout, network error or any 5xx → `WriteOutcomeUnknownError` ("the document MAY have been issued — check `gi_search_documents` before anything else"). 401 (token refresh) and 429 are rejected before processing, so those are resent once.
- Non-JSON success bodies (e.g. maintenance HTML) → readable `HttpError` instead of a raw `SyntaxError`.

## Tools

| Tool | Endpoint | Notes |
|---|---|---|
| `gi_business_info` | `GET /businesses/me` | Business type decides allowed document types |
| `gi_search_documents` | `POST /documents/search` | `fromDate`, `toDate`, `types[]`, `statuses[]`, `clientName`, `number`, paging |
| `gi_get_document` | `GET /documents/{id}` (+ `/download/links`) | PDF links in he/en/origin |
| `gi_search_clients` | `POST /clients/search` | `name`, `email`, `taxId`, `active`, paging |
| `gi_create_document` | `POST /documents/preview` → `POST /documents` | Opt-in, `dryRun` by default |

### `gi_create_document` safety model (`safety.ts`)
1. Registered only when `GREENINVOICE_ALLOW_WRITE=true`.
2. **Step 1 — `dryRun: true` (default):** local validation → `/documents/preview` → same-day search for the same client + type (`possibleDuplicates`) → returns `wouldIssue` (lines, `linesTotal`, payments, recipient emails), a production warning when relevant, and a `confirmationToken`.
3. **Step 2 — `dryRun: false`:** requires `confirmationToken`. The token is `id.expiry.HMAC(id, expiry, sha256(canonical request body))` with a per-process secret:
   - any change to the arguments after the preview (amount, client, lines, type, date, …) → refused ("differ from the previewed ones");
   - single-use: consumed *before* sending, so a retry after an ambiguous failure can't issue twice;
   - expires after 10 minutes; a server restart invalidates all tokens.
4. **Local validation (both steps, before any API call):** types 320/400/405 require `payment`; payment dates can't be after today (Israel time) for those types; `sendEmail` requires `client.emails`; Σ lines and Σ payments must be ≤ `GREENINVOICE_MAX_TOTAL` (default 20,000 in the document currency, `0` disables).
5. **Outcome unknown:** timeout / 5xx on issue → `isError` telling the agent to check `gi_search_documents`; the token is already burned, so the only way forward is a new preview, which will list the document under `possibleDuplicates` if it was created.
6. **Audit log:** every preview/issue/refusal writes one JSON line to stderr (`[israel-mcp] audit {...}`: env, action, outcome, type, client name, total, currency, document id/number, reason). No keys, emails or tax ids.

| Input | Notes |
|---|---|
| `type`, `client`, `income`, `payment`, `date`, `dueDate`, `lang`, `currency`, `description`, `remarks`, `sendEmail` | As before |
| `dryRun` | default `true` |
| `confirmationToken` | Required when `dryRun=false`; from the preview of the *same* arguments |

Issued production documents are legally binding and cannot be deleted — only cancelled with a credit invoice (330).

## Codes

**Document types:** 10 quote · 100 order · 200 delivery note · 210 return · 300 transaction account · 305 tax invoice · 320 tax invoice-receipt · 330 credit invoice · 400 receipt · 405 donation receipt · 500 purchase order · 600 deposit · 610 deposit withdrawal

**Statuses:** 0 open · 1 closed · 2 manually closed · 3 canceling · 4 canceled

**Payment types:** -1 unpaid · 0 deduction at source · 1 cash · 2 check · 3 credit card · 4 bank transfer · 5 PayPal · 10 payment app · 11 other

**VAT (income row):** 0 before VAT · 1 VAT included · 2 exempt

**Business rules:** עוסק פטור cannot issue 305 — use 320 or 400. Receipt payment dates cannot be in the future.

## Field-name gotchas
`income` (not items), `payment` (not payments), `remarks` (not notes), `lang` (not language), `emails` is an array.

## Verification (sandbox)
```bash
TOKEN=$(curl -s -X POST https://sandbox.d.greeninvoice.co.il/api/v1/account/token \
  -H 'Content-Type: application/json' -d '{"id":"...","secret":"..."}' | jq -r .token)
curl -s -X POST https://sandbox.d.greeninvoice.co.il/api/v1/documents/search \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"page":1,"pageSize":5}'
```
