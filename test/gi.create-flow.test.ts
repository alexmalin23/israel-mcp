import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadConfig } from "../src/config.js";
import { createServer } from "../src/server.js";

/**
 * End-to-end gi_create_document flow over the MCP protocol with a stubbed global fetch.
 * Each test uses a unique API id so the module-level client cache doesn't leak state between tests.
 */

let issued: unknown[] = [];
let documentsStatus = 200;
let searchItems: unknown[] = [];
const realFetch = globalThis.fetch;
const stderrWrite = process.stderr.write.bind(process.stderr);
let auditLines: string[] = [];

beforeEach(() => {
  issued = [];
  documentsStatus = 200;
  searchItems = [];
  auditLines = [];
  globalThis.fetch = (async (input: any, init: RequestInit = {}) => {
    const url = String(input);
    if (url.endsWith("/account/token")) return Response.json({ token: "T" });
    if (url.endsWith("/documents/preview")) return Response.json({ file: "AAAA" });
    if (url.endsWith("/documents/search")) return Response.json({ total: searchItems.length, items: searchItems });
    if (url.endsWith("/documents")) {
      issued.push(JSON.parse(String(init.body)));
      return documentsStatus === 200
        ? Response.json({ id: "doc-1", number: 1001 })
        : new Response("upstream timeout", { status: documentsStatus });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  (process.stderr as any).write = (s: string) => {
    if (String(s).includes(" audit ")) auditLines.push(String(s));
    return true;
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  (process.stderr as any).write = stderrWrite;
});

let seq = 0;
async function connect(extraEnv: Record<string, string> = {}) {
  const { server } = createServer(
    loadConfig({
      GREENINVOICE_API_ID: `id-${++seq}`,
      GREENINVOICE_API_SECRET: "s",
      GREENINVOICE_ALLOW_WRITE: "true",
      ...extraEnv,
    }),
  );
  const [c, s] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await Promise.all([server.connect(s), client.connect(c)]);
  return client;
}

const ARGS = {
  type: 305,
  client: { name: "ACME", taxId: "520013954" },
  income: [{ description: "Consulting", quantity: 2, price: 500 }],
};

const call = (client: Client, args: Record<string, unknown>) =>
  client.callTool({ name: "gi_create_document", arguments: args }) as Promise<any>;

test("preview returns a token; issue with it works exactly once", async () => {
  const client = await connect();
  const preview = await call(client, ARGS);
  assert.equal(preview.isError, undefined, preview.content?.[0]?.text);
  const p = preview.structuredContent;
  assert.equal(p.dryRun, true);
  assert.equal(p.wouldIssue.linesTotal, 1000);
  assert.deepEqual(p.possibleDuplicates, []);
  assert.equal(issued.length, 0);

  const done = await call(client, { ...ARGS, dryRun: false, confirmationToken: p.confirmationToken });
  assert.equal(done.isError, undefined, done.content?.[0]?.text);
  assert.equal(done.structuredContent.created.id, "doc-1");
  assert.equal(issued.length, 1);

  const again = await call(client, { ...ARGS, dryRun: false, confirmationToken: p.confirmationToken });
  assert.equal(again.isError, true);
  assert.match(again.content[0].text, /already used/);
  assert.equal(issued.length, 1);
  assert.ok(auditLines.some((l) => l.includes('"outcome":"ok"') && l.includes('"action":"issue"')));
  await client.close();
});

test("issuing without a token, or with changed arguments, is refused", async () => {
  const client = await connect();
  const noToken = await call(client, { ...ARGS, dryRun: false });
  assert.equal(noToken.isError, true);
  assert.match(noToken.content[0].text, /Run a dryRun preview first/);

  const p = (await call(client, ARGS)).structuredContent;
  const changed = await call(client, {
    ...ARGS,
    income: [{ description: "Consulting", quantity: 2, price: 5000 }],
    dryRun: false,
    confirmationToken: p.confirmationToken,
  });
  assert.equal(changed.isError, true);
  assert.match(changed.content[0].text, /differ from the previewed/);
  assert.equal(issued.length, 0);
  await client.close();
});

test("token survives a fresh server in the same process (stateless HTTP mode)", async () => {
  const a = await connect({ GREENINVOICE_API_ID: "shared" });
  const p = (await call(a, ARGS)).structuredContent;
  await a.close();
  const { server } = createServer(
    loadConfig({ GREENINVOICE_API_ID: "shared", GREENINVOICE_API_SECRET: "s", GREENINVOICE_ALLOW_WRITE: "true" }),
  );
  const [c, s] = InMemoryTransport.createLinkedPair();
  const b = new Client({ name: "t", version: "0" });
  await Promise.all([server.connect(s), b.connect(c)]);
  const done = await call(b, { ...ARGS, dryRun: false, confirmationToken: p.confirmationToken });
  assert.equal(done.isError, undefined, done.content?.[0]?.text);
  await b.close();
});

test("504 on issue → outcome unknown, sent once, token burned", async () => {
  const client = await connect();
  const p = (await call(client, ARGS)).structuredContent;
  documentsStatus = 504;
  const r = await call(client, { ...ARGS, dryRun: false, confirmationToken: p.confirmationToken });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /Outcome unknown.*gi_search_documents/s);
  assert.equal(issued.length, 1);
  assert.ok(auditLines.some((l) => l.includes('"outcome":"unknown"')));

  documentsStatus = 200;
  const retry = await call(client, { ...ARGS, dryRun: false, confirmationToken: p.confirmationToken });
  assert.match(retry.content[0].text, /already used/);
  assert.equal(issued.length, 1);
  await client.close();
});

test("amount cap and future receipt dates are refused before any API call", async () => {
  const client = await connect({ GREENINVOICE_MAX_TOTAL: "500" });
  const big = await call(client, ARGS);
  assert.equal(big.isError, true);
  assert.match(big.content[0].text, /GREENINVOICE_MAX_TOTAL/);

  const client2 = await connect();
  const future = await call(client2, {
    ...ARGS,
    type: 320,
    payment: [{ type: 4, date: "2999-01-01", price: 1180 }],
  });
  assert.equal(future.isError, true);
  assert.match(future.content[0].text, /cannot be in the future/);
  assert.equal(issued.length, 0);
  await client.close();
  await client2.close();
});

test("preview surfaces same-day documents for the same client as possible duplicates", async () => {
  const client = await connect();
  searchItems = [{ id: "old", number: 999, type: 305, status: 0, client: { name: "ACME" }, amount: 1180 }];
  const p = (await call(client, ARGS)).structuredContent;
  assert.equal(p.possibleDuplicates.length, 1);
  assert.equal(p.possibleDuplicates[0].number, 999);
  await client.close();
});

test("production preview carries a legally-binding warning", async () => {
  const client = await connect({ GREENINVOICE_ENV: "production" });
  const p = (await call(client, ARGS)).structuredContent;
  assert.match(p.warning, /PRODUCTION/);
  await client.close();
});
