# israel-mcp

An MCP server that gives AI agents access to Israeli services through task-level tools.

| Service | Prefix | Auth | Tools |
|---|---|---|---|
| [data.gov.il](docs/services/gov-data.md): government open data | `gov_` | none | `gov_search_datasets`, `gov_query_resource` |
| [Registrar of Companies](docs/services/ica.md): company & partnership lookup (via data.gov.il) | `ica_` | none | `ica_lookup_company`, `ica_search_companies` |
| [Bank of Israel](docs/services/boi.md): representative exchange rates | `boi_` | none | `boi_exchange_rates`, `boi_convert` |
| [Hebcal](docs/services/hebcal.md): holidays, Shabbat, business days | `hebcal_`, `il_` | none | `hebcal_holidays`, `hebcal_shabbat_times`, `hebcal_convert_date`, `il_business_days_between`, `il_add_business_days` |
| [Green Invoice / Morning](docs/services/green-invoice.md): invoicing | `gi_` | API key | `gi_business_info`, `gi_search_documents`, `gi_get_document`, `gi_search_clients`, `gi_create_document`* |

\* Write tool, registered only with `GREENINVOICE_ALLOW_WRITE=true`. Two steps: a `dryRun` preview returns a single-use `confirmationToken` bound to the exact payload, and issuing requires it. See [safety model](#safety-model-for-writes).

Services without credentials are skipped at startup, so the server runs out of the box with the four public services.

## What you can ask

Once connected, an agent can answer things like:

- "Is ח.פ 520013954 an active company? Any liens registered this year?" → `ica_lookup_company`
- "Find the company number for טבע מדיקל" → `ica_search_companies`
- "How much is 1,200 USD in shekels at today's representative rate?" → `boi_convert`
- "Payment terms are 30 business days from today. What's the due date?" → `il_add_business_days`
- "When does Shabbat start in Haifa this week?" → `hebcal_shabbat_times`
- "Which government datasets cover vehicle registrations?" → `gov_search_datasets`
- "List my unpaid invoices from last month" → `gi_search_documents`
- "Issue a tax invoice to ACME for 2 hours of consulting at ₪500" → `gi_create_document` (preview, your confirmation, then issue)

## Quick start

```bash
npm install
npm run build
npm test
```

### Claude Code

```bash
claude mcp add israel -- node /absolute/path/to/israel-mcp/dist/index.js

# with Green Invoice (sandbox, read-only)
claude mcp add israel \
  -e GREENINVOICE_API_ID=... -e GREENINVOICE_API_SECRET=... -e GREENINVOICE_ENV=sandbox \
  -- node /absolute/path/to/israel-mcp/dist/index.js
```

### Claude Desktop / Cursor / any MCP client

```json
{
  "mcpServers": {
    "israel": {
      "command": "node",
      "args": ["/absolute/path/to/israel-mcp/dist/index.js"],
      "env": {
        "GREENINVOICE_API_ID": "",
        "GREENINVOICE_API_SECRET": "",
        "GREENINVOICE_ENV": "sandbox"
      }
    }
  }
}
```

Restart the client after `npm run build` to pick up new tools.

### Inspect interactively

```bash
npm run inspect   # opens MCP Inspector against src/index.ts
```

### Streamable HTTP

For remote or multi-client setups, run the stateless Streamable HTTP entrypoint (one server + transport per request, no sessions):

```bash
npm run build
PORT=3000 npm run start:http   # MCP at http://127.0.0.1:3000/mcp, health check at GET /health
claude mcp add --transport http israel http://127.0.0.1:3000/mcp
```

It binds to `127.0.0.1` with Host-header (DNS-rebinding) checks. The endpoint has **no authentication**. If you set `HOST=0.0.0.0` (e.g. in a container), put it behind your own auth, and don't enable `GREENINVOICE_ALLOW_WRITE` there.

## Configuration

All configuration is via environment variables. See [`.env.example`](.env.example).

| Variable | Default | Purpose |
|---|---|---|
| `GREENINVOICE_API_ID` / `GREENINVOICE_API_SECRET` | none | Enables Green Invoice tools |
| `GREENINVOICE_ENV` | `sandbox` | `sandbox` or `production` (separate tenancies, separate keys) |
| `GREENINVOICE_ALLOW_WRITE` | `false` | Registers `gi_create_document` |
| `GREENINVOICE_MAX_TOTAL` | `20000` | Refuse documents whose lines or payments exceed this (document currency; `0` disables) |
| `HEBCAL_DEFAULT_GEONAMEID` | `281184` (Jerusalem) | Default city for Shabbat times |
| `HTTP_TIMEOUT_MS` | `15000` | Timeout for all outbound requests |
| `PORT` | `3000` | HTTP entrypoint port (`start:http` only) |
| `HOST` | `127.0.0.1` | HTTP entrypoint bind address (`start:http` only). Host-header checks apply only on loopback |

## Safety model for writes

Issued invoices and receipts are legally binding and can't be deleted, only cancelled with a credit invoice. So `gi_create_document` is built so that an agent can't issue something the user didn't approve, or issue it twice:

1. **Opt-in.** The tool exists only with `GREENINVOICE_ALLOW_WRITE=true`.
2. **Preview first.** `dryRun=true` is the default. It validates through the API's preview endpoint, lists same-day documents for the same client as `possibleDuplicates`, and returns a `confirmationToken`.
3. **Bound confirmation.** Issuing (`dryRun=false`) requires that token. It is an HMAC of the exact payload: if any argument changes after the user confirmed (amount, client, lines, type, date), issuing is refused. Tokens are single-use and expire after 10 minutes.
4. **No blind retries.** If issuing times out or gets a 5xx, the tool reports *outcome unknown* and tells the agent to check `gi_search_documents` before anything else. The token is already spent, so the same request can't go out twice.
5. **Local guards.** An amount cap (`GREENINVOICE_MAX_TOTAL`), no future payment dates on receipts, and a required payment array for receipt types. All of these are checked before any API call.
6. **Audit trail.** Every preview, issue and refusal writes one JSON line to stderr, with no keys, emails or tax ids.

Details: [docs/services/green-invoice.md](docs/services/green-invoice.md).

## Design principles

- **Task-level tools, not endpoint mirrors.** `il_add_business_days` instead of "list holidays" + math in the model. Fewer, well-described tools make agents more reliable.
- **Safe by default.** Anything that creates legally binding records is opt-in, previews before it writes, and needs a confirmation bound to what the user saw (see above).
- **Errors are results.** Tools return `isError` with a readable message (status + trimmed body) so the model can recover, instead of crashing the call.
- **Compact, normalized output.** Hebrew source fields are mapped to stable English keys, empty fields are dropped, and quirks like the registry's `~`-for-gershayim are fixed. Agents don't get raw 30-field payloads.
- **Structured + text output.** Every tool returns `structuredContent` and a JSON text block.
- **Transport-agnostic core.** `createServer()` in `src/server.ts` has no transport. `src/index.ts` wires stdio and `src/http.ts` wires stateless Streamable HTTP.

## Project layout

```
src/
  index.ts              stdio entrypoint (logs to stderr only)
  http.ts               Streamable HTTP entrypoint (stateless, POST /mcp, GET /health)
  server.ts             createServer(config): registers enabled services
  config.ts             env → typed Config
  lib/http.ts           fetch wrapper: timeout, JSON, HttpError
  lib/result.ts         ok() / fail() / run() tool-result helpers
  services/
    types.ts            ServiceModule interface
    index.ts            service registry
    gov-data/           data.gov.il (CKAN); ckan.ts is the shared datastore client
    ica/                Registrar of Companies (normalize.ts = pure logic, resources.ts = dataset ids)
    boi/                Bank of Israel
    hebcal/             Hebcal + pure business-day math (calendar.ts, shabbat.ts)
    green-invoice/      client.ts (auth, throttle, retries), safety.ts (confirmation tokens, guards, audit), index.ts (tools)
test/                   node:test: unit, mocked-fetch and in-memory MCP client tests
docs/
  services/*.md         per-service reference
  adding-a-service.md   how to add a new integration
  roadmap.md            next services and platform work
```

## Status

v0.1. Unit and protocol tests pass.

| Service | Live verification |
|---|---|
| data.gov.il | ✅ verified |
| Bank of Israel | ✅ verified |
| Hebcal (all tools) | ✅ verified |
| Registrar of Companies | ⚠️ dataset fields and sample rows verified live; the `ica_*` tools themselves still need a live run |
| Green Invoice | ❌ not yet called live. Check it against the sandbox (see [its Verification section](docs/services/green-invoice.md#verification-sandbox)) before production use |

What's next: [docs/roadmap.md](docs/roadmap.md). To add a service: [docs/adding-a-service.md](docs/adding-a-service.md).

## Disclaimer

Unofficial. Not affiliated with Green Invoice (Optimax Ltd), the Israeli Corporations Authority, the Bank of Israel, the Government of Israel, or Hebcal. Registrar data is an open-data snapshot, not a certified registry extract. Hebcal data is CC BY 4.0.
