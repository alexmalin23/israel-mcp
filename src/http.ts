#!/usr/bin/env node
import { createServer as createHttpServer, type Server, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadConfig, type Config } from "./config.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

const log = (msg: string) => process.stderr.write(`[${SERVER_NAME}] ${msg}\n`);

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers }).end(JSON.stringify(body));
}

const rpcError = (message: string) => ({ jsonrpc: "2.0", error: { code: -32000, message }, id: null });

/**
 * Stateless Streamable HTTP: every POST /mcp gets a fresh McpServer + transport, so no session state is kept.
 * `allowedHosts` (exact Host header values, with port) turns on DNS-rebinding protection.
 */
export function createHttpApp(config: Config, allowedHosts?: string[]): Server {
  return createHttpServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path === "/health" && req.method === "GET") {
      return json(res, 200, { status: "ok", name: SERVER_NAME, version: SERVER_VERSION });
    }
    if (path !== "/mcp") return json(res, 404, { error: "Not found" });
    // ponytail: stateless means no server-initiated SSE stream (GET) or session to end (DELETE).
    if (req.method !== "POST") return json(res, 405, rpcError("Method not allowed"), { allow: "POST" });

    const { server } = createServer(config);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      ...(allowedHosts && { enableDnsRebindingProtection: true, allowedHosts }),
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (e) {
      log(`request failed: ${e instanceof Error ? e.message : String(e)}`);
      if (!res.headersSent) json(res, 500, rpcError("Internal server error"));
    }
  });
}

function main() {
  const config = loadConfig();
  const port = Number.parseInt(process.env.PORT ?? "", 10) || 3000;
  // Loopback by default: the endpoint has no auth. Set HOST=0.0.0.0 (e.g. in a container) only behind your own auth.
  const host = process.env.HOST || "127.0.0.1";
  const loopback = host === "127.0.0.1" || host === "localhost";
  const allowedHosts = loopback ? [`127.0.0.1:${port}`, `localhost:${port}`] : undefined;

  for (const s of createServer(config).status) log(`${s.enabled ? "✓" : "✗"} ${s.name}${s.reason ? ` — ${s.reason}` : ""}`);
  if (!loopback) log(`WARNING: listening on ${host} without authentication or Host-header checks`);

  createHttpApp(config, allowedHosts).listen(port, host, () => {
    log(`v${SERVER_VERSION} listening on http://${host}:${port}/mcp (health: /health)`);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
