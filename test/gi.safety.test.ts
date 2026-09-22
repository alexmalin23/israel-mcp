import { test } from "node:test";
import assert from "node:assert/strict";
import {
  audit,
  canonicalJson,
  checkAmountCap,
  ConfirmationTokens,
  futurePaymentDates,
  linesTotal,
  payloadHash,
  paymentsTotal,
} from "../src/services/green-invoice/safety.js";

const BODY = {
  type: 320,
  client: { name: "ACME", add: false },
  income: [{ description: "Consulting", quantity: 2, price: 500, currency: "ILS", vatType: 0 }],
  payment: [{ type: 4, date: "2026-09-20", price: 1180, currency: "ILS" }],
  date: undefined,
};

test("canonicalJson: key order and undefined don't matter", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: undefined, e: [3, { z: 1, y: 2 }] } }), '{"a":{"d":2,"e":[3,{"y":2,"z":1}]},"b":1}');
  assert.equal(payloadHash({ a: 1, b: 2 }), payloadHash({ b: 2, a: 1, c: undefined }));
  assert.notEqual(payloadHash({ a: 1 }), payloadHash({ a: 2 }));
});

test("confirmation token: valid once for the same payload", () => {
  const t = new ConfirmationTokens(Buffer.alloc(32, 1));
  const { token } = t.issue(BODY, 1_000);
  const v = t.verify(token, structuredClone(BODY), 2_000);
  assert.equal(v.ok, true);
  t.consume((v as { id: string }).id, 2_000);
  assert.deepEqual(t.verify(token, BODY, 3_000), { ok: false, reason: "already_used" });
});

test("confirmation token: any change to the payload is rejected", () => {
  const t = new ConfirmationTokens(Buffer.alloc(32, 1));
  const { token } = t.issue(BODY, 0);
  const changedPrice = structuredClone(BODY);
  changedPrice.income[0].price = 5000;
  assert.deepEqual(t.verify(token, changedPrice, 1), { ok: false, reason: "payload_changed" });
  const changedClient = { ...BODY, client: { name: "Other", add: false } };
  assert.deepEqual(t.verify(token, changedClient, 1), { ok: false, reason: "payload_changed" });
});

test("confirmation token: expiry, tampering, malformed, other secret", () => {
  const t = new ConfirmationTokens(Buffer.alloc(32, 1), 1_000);
  const { token } = t.issue(BODY, 0);
  assert.deepEqual(t.verify(token, BODY, 1_001), { ok: false, reason: "expired" });

  const [id, , sig] = token.split(".");
  assert.deepEqual(t.verify(`${id}.999999999999999.${sig}`, BODY, 0), { ok: false, reason: "payload_changed" });
  assert.deepEqual(t.verify(undefined, BODY), { ok: false, reason: "malformed" });
  assert.deepEqual(t.verify("abc", BODY), { ok: false, reason: "malformed" });

  const other = new ConfirmationTokens(Buffer.alloc(32, 2), 1_000);
  assert.deepEqual(other.verify(token, BODY, 0), { ok: false, reason: "payload_changed" });
});

test("consume prunes expired ids", () => {
  const t = new ConfirmationTokens(Buffer.alloc(32, 1), 100);
  t.consume("old", 0);
  t.consume("new", 1_000);
  assert.equal((t as any).used.has("old"), false);
  assert.equal((t as any).used.has("new"), true);
});

test("totals and amount cap", () => {
  const income = [{ quantity: 3, price: 33.33 }, { quantity: 1, price: 0.1 }];
  assert.equal(linesTotal(income), 100.09);
  assert.equal(paymentsTotal([{ date: "2026-01-01", price: 10.005 }, { date: "2026-01-01", price: 5 }]), 15.01);
  assert.equal(paymentsTotal(undefined), 0);

  assert.equal(checkAmountCap([{ quantity: 1, price: 20_000 }], undefined, 20_000), null);
  assert.match(checkAmountCap([{ quantity: 2, price: 10_001 }], undefined, 20_000) ?? "", /exceeds GREENINVOICE_MAX_TOTAL/);
  assert.match(checkAmountCap([{ quantity: 1, price: 1 }], [{ date: "2026-01-01", price: 50_000 }], 20_000) ?? "", /50000/);
  assert.match(checkAmountCap([{ quantity: 1, price: -30_000 }], undefined, 20_000) ?? "", /30000/);
  assert.equal(checkAmountCap([{ quantity: 1, price: 1e9 }], undefined, 0), null);
});

test("futurePaymentDates compares against Israel today", () => {
  const p = [{ date: "2026-09-22", price: 1 }, { date: "2026-09-23", price: 1 }];
  assert.deepEqual(futurePaymentDates(p, "2026-09-22"), ["2026-09-23"]);
  assert.deepEqual(futurePaymentDates(undefined, "2026-09-22"), []);
});

test("audit writes one JSON line without secrets", () => {
  let out = "";
  audit({ env: "sandbox", action: "issue", outcome: "ok", type: 320, client: "ACME", total: 1000, currency: "ILS", documentId: "d1" }, (s) => (out += s));
  assert.ok(out.endsWith("\n"));
  assert.equal(out.split("\n").length, 2);
  const parsed = JSON.parse(out.replace("[israel-mcp] audit ", ""));
  assert.equal(parsed.tool, "gi_create_document");
  assert.equal(parsed.documentId, "d1");
});
