import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeRates } from "../src/services/boi/index.js";

test("normalizes rates and divides by unit", () => {
  const rates = normalizeRates({
    exchangeRates: [
      { key: "USD", currentExchangeRate: 3.6, currentChange: -0.2, unit: 1, lastUpdate: "2026-09-21T12:00:00Z" },
      { key: "JPY", currentExchangeRate: 2.4, currentChange: 0.1, unit: 100, lastUpdate: "2026-09-21T12:00:00Z" },
    ],
  });
  assert.equal(rates.length, 2);
  assert.equal(rates[0].ilsPerUnit, 3.6);
  assert.equal(rates[1].ilsPerUnit, 0.024);
});

test("tolerates PascalCase and drops invalid rows", () => {
  const rates = normalizeRates({ ExchangeRates: [{ Key: "eur", CurrentExchangeRate: 4.2, Unit: 1 }, { Key: "XXX" }] });
  assert.equal(rates.length, 1);
  assert.equal(rates[0].currency, "EUR");
  assert.equal(rates[0].changePercent, null);
});
