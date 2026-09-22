# israel-mcp

An MCP server that gives AI agents access to Israeli services through task-level tools.

| Service | Prefix | Auth | Tools |
|---|---|---|---|
| [data.gov.il](docs/services/gov-data.md) — government open data | `gov_` | none | `gov_search_datasets`, `gov_query_resource` |
| [Registrar of Companies](docs/services/ica.md) — company & partnership lookup (via data.gov.il) | `ica_` | none | `ica_lookup_company`, `ica_search_companies` |
| [Bank of Israel](docs/services/boi.md) — representative exchange rates | `boi_` | none | `boi_exchange_rates`, `boi_convert` |
| [Hebcal](docs/services/hebcal.md) — holidays, Shabbat, business days | `hebcal_`, `il_` | none | `hebcal_holidays`, `hebcal_shabbat_times`, `hebcal_convert_date`, `il_business_days_between`, `il_add_business_days` |
| [Green Invoice / Morning](docs/services/green-invoice.md) — invoicing | `gi_` | API key | `gi_business_info`, `gi_search_documents`, `gi_get_document`, `gi_search_clients`, `gi_create_document`* |

\* Write tool, registered only with `GREENINVOICE_ALLOW_WRITE=true`. Two-step: a `dryRun` preview returns a single-use `confirmationToken` bound to the exact payload; issuing requires it.

Services without credentials are skipped at startup, so the server runs out of the box with the four public services.

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

All configuration is via environment variables — see [`.env.example`](.env.example).

| Variable | Default | Purpose |
|---|---|---|
| `GREENINVOICE_API_ID` / `GREENINVOICE_API_SECRET` | — | Enables Green Invoice tools |
| `GREENINVOICE_ENV` | `sandbox` | `sandbox` or `production` (separate tenancies, separate keys) |
| `GREENINVOICE_ALLOW_WRITE` | `false` | Registers `gi_create_document` |
| `GREENINVOICE_MAX_TOTAL` | `20000` | Refuse documents whose lines or payments exceed this (document currency; `0` disables) |
| `HEBCAL_DEFAULT_GEONAMEID` | `281184` (Jerusalem) | Default city for Shabbat times |
| `HTTP_TIMEOUT_MS` | `15000` | Timeout for all outbound requests |
| `PORT` | `3000` | HTTP entrypoint port (`start:http` only) |
| `HOST` | `127.0.0.1` | HTTP entrypoint bind address (`start:http` only). Host-header checks apply only on loopback |

## Design principles

- **Task-level tools, not endpoint mirrors.** `il_add_business_days` instead of "list holidays" + math in the model. Fewer, well-described tools make agents more reliable.
- **Safe by default.** Anything that creates legally binding records is opt-in, defaults to a dry run, and says in its description that it needs user confirmation.
- **Errors are results.** Tools return `isError` with a readable message (status + trimmed body) so the model can recover, instead of crashing the call.
- **Structured + text output.** Every tool returns `structuredContent` and a JSON text block.
- **Transport-agnostic core.** `createServer()` in `src/server.ts` has no transport; `src/index.ts` wires stdio and `src/http.ts` wires stateless Streamable HTTP.

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
    ica/                Registrar of Companies (normalize.ts = pure logic)
    boi/                Bank of Israel
    hebcal/             Hebcal + pure business-day math (calendar.ts)
    green-invoice/      Green Invoice client + tools
test/                   node:test — unit + in-memory MCP client tests
docs/
  services/*.md         per-service reference
  adding-a-service.md   how to add a new integration
```

## Status

v0.1 — unit and protocol tests pass. data.gov.il, Bank of Israel and all Hebcal tools are verified against the live APIs. Green Invoice is not yet verified live; check it against the sandbox (see [its Verification section](docs/services/green-invoice.md)) before production use.

## Disclaimer

Unofficial. Not affiliated with Green Invoice (Optimax Ltd), the Bank of Israel, the Government of Israel, or Hebcal. Hebcal data is CC BY 4.0.
