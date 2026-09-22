# Green Invoice (Morning)

Israeli invoicing and bookkeeping. Requires API keys.

- Reference: https://greeninvoice.docs.apiary.io
- Production: `https://api.greeninvoice.co.il/api/v1`
- Sandbox: `https://sandbox.d.greeninvoice.co.il/api/v1`

## Setup
1. Green Invoice → My Account → Developer Tools → API Keys → add key.
2. For testing, create a **separate sandbox account** (`https://lp.sandbox.d.greeninvoice.co.il/join`) and generate keys there. Production keys return 401 on the sandbox (and vice versa) with the same error as a wrong key.
3. Set `GREENINVOICE_API_ID`, `GREENINVOICE_API_SECRET`, `GREENINVOICE_ENV`.

## Auth and limits
- `POST /account/token {id, secret}` → JWT (~30 min). Cached 25 min, refreshed once on 401.
- Throttled client-side to ~3 req/s.

## Tools

| Tool | Endpoint | Notes |
|---|---|---|
| `gi_business_info` | `GET /businesses/me` | Business type decides allowed document types |
| `gi_search_documents` | `POST /documents/search` | `fromDate`, `toDate`, `types[]`, `statuses[]`, `clientName`, `number`, paging |
| `gi_get_document` | `GET /documents/{id}` (+ `/download/links`) | PDF links in he/en/origin |
| `gi_search_clients` | `POST /clients/search` | `name`, `email`, `taxId`, `active`, paging |
| `gi_create_document` | `POST /documents/preview` → `POST /documents` | Opt-in, `dryRun` by default |

### `gi_create_document` safety model
1. Registered only when `GREENINVOICE_ALLOW_WRITE=true`.
2. `dryRun: true` by default → validates through `/documents/preview`, issues nothing.
3. Tool description and server instructions tell the agent to get explicit user confirmation before `dryRun: false`.
4. Local validation before any call: types 320/400/405 require `payment`; `sendEmail` requires `client.emails`.

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
