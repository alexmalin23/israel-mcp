import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadConfig } from "../src/config.js";
import { createHttpApp } from "../src/http.js";

async function listen(allowedHosts?: string[]) {
  const app = createHttpApp(loadConfig({}), allowedHosts);
  await new Promise<void>((r) => app.listen(0, "127.0.0.1", r));
  return { app, base: `http://127.0.0.1:${(app.address() as AddressInfo).port}` };
}

test("initialize + tools/list over Streamable HTTP, plus /health", async () => {
  const { app, base } = await listen();
  try {
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, "ok");

    // Two separate clients: each request is handled by a fresh stateless server.
    for (let i = 0; i < 2; i++) {
      const client = new Client({ name: "test", version: "0" });
      await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
      assert.equal(client.getServerVersion()?.name, "israel-mcp");
      const { tools } = await client.listTools();
      assert.ok(tools.some((t) => t.name === "il_add_business_days"));
      await client.close();
    }

    assert.equal((await fetch(`${base}/mcp`)).status, 405);
  } finally {
    app.close();
  }
});

test("rejects a foreign Host header when allowedHosts is set", async () => {
  const { app, base } = await listen(["localhost:1"]);
  try {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(res.status, 403);
  } finally {
    app.close();
  }
});
