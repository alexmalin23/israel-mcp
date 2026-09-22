#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

// stdout is the MCP channel — all logging goes to stderr.
const log = (msg: string) => process.stderr.write(`[${SERVER_NAME}] ${msg}\n`);

async function main() {
  const config = loadConfig();
  const { server, status } = createServer(config);

  for (const s of status) log(`${s.enabled ? "✓" : "✗"} ${s.name}${s.reason ? ` — ${s.reason}` : ""}`);
  if (config.greenInvoice.apiId) {
    log(`Green Invoice env: ${config.greenInvoice.env}, write tools: ${config.greenInvoice.allowWrite ? "ON" : "off"}`);
  }

  await server.connect(new StdioServerTransport());
  log(`v${SERVER_VERSION} running on stdio`);
}

main().catch((e) => {
  log(`fatal: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
