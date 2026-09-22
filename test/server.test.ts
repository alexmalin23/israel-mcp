import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadConfig } from "../src/config.js";
import { createServer } from "../src/server.js";

async function listTools(env: NodeJS.ProcessEnv) {
  const { server, status } = createServer(loadConfig(env));
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  const { tools } = await client.listTools();
  await client.close();
  return { names: tools.map((t) => t.name).sort(), tools, status };
}

test("public services register without credentials; Green Invoice is disabled", async () => {
  const { names, status } = await listTools({});
  assert.ok(names.includes("gov_search_datasets"));
  assert.ok(names.includes("ica_lookup_company"));
  assert.ok(names.includes("ica_search_companies"));
  assert.ok(names.includes("boi_convert"));
  assert.ok(names.includes("il_add_business_days"));
  assert.ok(!names.some((n) => n.startsWith("gi_")));
  assert.equal(status.find((s) => s.id === "gi")?.enabled, false);
});

test("Green Invoice read tools register with credentials; write tool is opt-in", async () => {
  const creds = { GREENINVOICE_API_ID: "x", GREENINVOICE_API_SECRET: "y" };
  const readOnly = await listTools(creds);
  assert.ok(readOnly.names.includes("gi_search_documents"));
  assert.ok(!readOnly.names.includes("gi_create_document"));

  const withWrite = await listTools({ ...creds, GREENINVOICE_ALLOW_WRITE: "true" });
  assert.ok(withWrite.names.includes("gi_create_document"));
});

test("every tool has a title, description and annotations", async () => {
  const { tools } = await listTools({ GREENINVOICE_API_ID: "x", GREENINVOICE_API_SECRET: "y", GREENINVOICE_ALLOW_WRITE: "true" });
  for (const t of tools) {
    assert.ok(t.title, `${t.name} missing title`);
    assert.ok(t.description && t.description.length > 30, `${t.name} missing description`);
    assert.ok(t.annotations, `${t.name} missing annotations`);
  }
});

test("input validation rejects bad dates before any network call", async () => {
  const { server } = createServer(loadConfig({}));
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  const res: any = await client.callTool({ name: "il_business_days_between", arguments: { from: "22/09/2026", to: "2026-10-01" } });
  assert.equal(res.isError, true);
  await client.close();
});
