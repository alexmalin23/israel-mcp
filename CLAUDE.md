# israel-mcp

MCP server (TypeScript, @modelcontextprotocol/sdk v1) exposing Israeli services as task-level tools.
Read README.md first, then docs/services/<service>.md for the service you touch.

## Commands
- `npm install` — run first in a fresh environment
- `npm run typecheck` / `npm run build`
- `npm test` — node:test via tsx; must pass before every commit
- `npm run dev` — run the stdio server from source
- `npm run start:http` — run the built Streamable HTTP server (`PORT`, default 3000)

## Conventions
- One folder per service under src/services/, exporting a ServiceModule (see docs/adding-a-service.md).
- Tool names: `<prefix>_<verb>_<noun>`. Every tool has title, description (when to use it), `.describe()` on inputs, and annotations.
- Tool bodies are wrapped in `run()` and return `ok({...})`; never throw out of a handler.
- Pure logic lives in its own module with unit tests (e.g. services/hebcal/calendar.ts).
- stdout is the MCP channel: log to stderr only.
- Anything that creates money/legal records: env opt-in flag + dryRun default + "needs user confirmation" in the description,
  plus a preview-bound single-use confirmation token and no blind retries on writes (see services/green-invoice/safety.ts).
- Keep docs/services/*.md in sync with tool changes in the same commit.

## Status
v0.1: unit + protocol tests pass. Verified live: data.gov.il, Bank of Israel, all Hebcal tools (holidays, Shabbat times, date conversion, business days).
Green Invoice has never been called live — verify with the curl snippets in docs/services/green-invoice.md before trusting its response shapes.
