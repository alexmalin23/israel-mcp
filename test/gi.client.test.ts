import { test } from "node:test";
import assert from "node:assert/strict";
import { GreenInvoiceClient, retryAfterMs, WriteOutcomeUnknownError } from "../src/services/green-invoice/client.js";

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

/** Fake fetch: /account/token always succeeds unless overridden; everything else goes to `api`. */
function fakeFetch(api: Handler, token: Handler = () => Response.json({ token: "T" })) {
  const calls: { url: string; method: string; auth?: string }[] = [];
  const impl = (async (input: any, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method ?? "GET", auth: (init.headers as any)?.Authorization });
    return url.endsWith("/account/token") ? token(url, init) : api(url, init);
  }) as typeof fetch;
  return { impl, calls, apiCalls: () => calls.filter((c) => !c.url.endsWith("/account/token")) };
}

const mk = (f: typeof fetch) =>
  new GreenInvoiceClient("id", "secret", "sandbox", { fetchImpl: f, sleep: async () => {}, minIntervalMs: 0 });

test("safe request retries 503 then succeeds", async () => {
  let n = 0;
  const f = fakeFetch(() => (++n < 3 ? new Response("busy", { status: 503 }) : Response.json({ items: [1] })));
  const r = await mk(f.impl).query("/documents/search", {});
  assert.deepEqual(r, { items: [1] });
  assert.equal(f.apiCalls().length, 3);
});

test("safe request gives up after 2 retries with a readable error", async () => {
  const f = fakeFetch(() => new Response("busy", { status: 503 }));
  await assert.rejects(mk(f.impl).get("/businesses/me"), /HTTP 503/);
  assert.equal(f.apiCalls().length, 3);
});

test("safe request retries network errors", async () => {
  let n = 0;
  const f = fakeFetch(() => {
    if (++n === 1) throw new TypeError("fetch failed");
    return Response.json({ ok: 1 });
  });
  assert.deepEqual(await mk(f.impl).get("/businesses/me"), { ok: 1 });
});

test("write: timeout → WriteOutcomeUnknownError, sent exactly once", async () => {
  const f = fakeFetch(() => {
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  });
  await assert.rejects(mk(f.impl).create("/documents", {}), (e: unknown) => {
    assert.ok(e instanceof WriteOutcomeUnknownError);
    assert.match((e as Error).message, /timed out.*MAY have been issued/s);
    return true;
  });
  assert.equal(f.apiCalls().length, 1);
});

test("write: 502/504 → outcome unknown, not retried", async () => {
  for (const status of [500, 502, 504]) {
    const f = fakeFetch(() => new Response("gateway", { status }));
    await assert.rejects(mk(f.impl).create("/documents", {}), WriteOutcomeUnknownError);
    assert.equal(f.apiCalls().length, 1, `status ${status}`);
  }
});

test("write: 429 is retried (rejected before processing)", async () => {
  let n = 0;
  const f = fakeFetch(() => (++n === 1 ? new Response("slow down", { status: 429, headers: { "Retry-After": "1" } }) : Response.json({ id: "d1" })));
  assert.deepEqual(await mk(f.impl).create("/documents", {}), { id: "d1" });
  assert.equal(f.apiCalls().length, 2);
});

test("write: 4xx is a definite failure (HttpError, not unknown)", async () => {
  const f = fakeFetch(() => new Response('{"errorMessage":"bad"}', { status: 400 }));
  await assert.rejects(mk(f.impl).create("/documents", {}), (e: unknown) => {
    assert.ok(!(e instanceof WriteOutcomeUnknownError));
    assert.match((e as Error).message, /HTTP 400/);
    return true;
  });
});

test("401 refreshes the token once and resends", async () => {
  let tokens = 0;
  let n = 0;
  const f = fakeFetch(
    () => (++n === 1 ? new Response("expired", { status: 401 }) : Response.json({ ok: 1 })),
    () => Response.json({ token: `T${++tokens}` }),
  );
  assert.deepEqual(await mk(f.impl).create("/documents", {}), { ok: 1 });
  const api = f.apiCalls();
  assert.deepEqual(api.map((c) => c.auth), ["Bearer T1", "Bearer T2"]);
});

test("persistent 401 surfaces as HttpError after one refresh", async () => {
  const f = fakeFetch(() => new Response("nope", { status: 401 }));
  await assert.rejects(mk(f.impl).get("/businesses/me"), /HTTP 401/);
  assert.equal(f.apiCalls().length, 2);
});

test("concurrent calls share a single token request", async () => {
  let tokenCalls = 0;
  const f = fakeFetch(
    () => Response.json({ ok: 1 }),
    async () => {
      tokenCalls++;
      await new Promise((r) => setTimeout(r, 5));
      return Response.json({ token: "T" });
    },
  );
  const c = mk(f.impl);
  await Promise.all([c.get("/a"), c.get("/b"), c.get("/c")]);
  assert.equal(tokenCalls, 1);
});

test("throttle spaces concurrent requests", async () => {
  const waits: number[] = [];
  const f = fakeFetch(() => Response.json({}));
  const c = new GreenInvoiceClient("id", "s", "sandbox", {
    fetchImpl: f.impl,
    minIntervalMs: 1_000,
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  await Promise.all([c.get("/a"), c.get("/b"), c.get("/c")]);
  // token + 3 calls = 4 slots; every slot after the first must wait (sleep is a no-op, so clock barely moves).
  assert.ok(waits.length >= 3, `expected ≥3 waits, got ${waits.length}`);
});

test("non-JSON success body → readable HttpError", async () => {
  const f = fakeFetch(() => new Response("<html>maintenance</html>", { status: 200 }));
  await assert.rejects(mk(f.impl).get("/businesses/me"), /Expected JSON, got: <html>/);
});

test("token auth 401 carries the sandbox/production hint", async () => {
  const f = fakeFetch(() => Response.json({}), () => new Response("bad", { status: 401 }));
  await assert.rejects(mk(f.impl).get("/x"), /separate tenancies/);
});

test("retryAfterMs: seconds, date, fallback, cap", () => {
  assert.equal(retryAfterMs("2", 0), 2_000);
  assert.equal(retryAfterMs("999", 0), 5_000);
  assert.equal(retryAfterMs(null, 0), 500);
  assert.equal(retryAfterMs(null, 1), 1_000);
  assert.equal(retryAfterMs(null, 10), 5_000);
  const at = retryAfterMs(new Date(Date.now() + 1_500).toUTCString(), 0);
  assert.ok(at >= 0 && at <= 1_500);
});
