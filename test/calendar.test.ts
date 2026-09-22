import { test } from "node:test";
import assert from "node:assert/strict";
import { addBusinessDays, countBusinessDays, isWeekend } from "../src/services/hebcal/calendar.js";
import { restDays } from "../src/services/hebcal/index.js";

const none = new Set<string>();

test("Friday and Saturday are the weekend", () => {
  assert.equal(isWeekend("2026-09-25"), true); // Fri
  assert.equal(isWeekend("2026-09-26"), true); // Sat
  assert.equal(isWeekend("2026-09-27"), false); // Sun
});

test("counts Sun–Thu, inclusive", () => {
  assert.equal(countBusinessDays("2026-09-27", "2026-10-03", none), 5);
});

test("holidays are excluded", () => {
  assert.equal(countBusinessDays("2026-09-27", "2026-10-03", new Set(["2026-09-29"])), 4);
});

test("adding business days skips weekend and holidays", () => {
  // Thu + 1 → Sun
  assert.equal(addBusinessDays("2026-09-24", 1, none), "2026-09-27");
  // Thu + 1 with Sunday a holiday → Mon
  assert.equal(addBusinessDays("2026-09-24", 1, new Set(["2026-09-27"])), "2026-09-28");
});

test("negative days move backwards", () => {
  assert.equal(addBusinessDays("2026-09-27", -1, none), "2026-09-24");
});

test("0 days rolls forward to the next business day", () => {
  assert.equal(addBusinessDays("2026-09-25", 0, none), "2026-09-27");
});

test("restDays picks yomtov items and Yom HaAtzma'ut only", () => {
  const map = restDays([
    { title: "Sukkot I", date: "2026-09-26", category: "holiday", yomtov: true },
    { title: "Sukkot III (CH''M)", date: "2026-09-28", category: "holiday" },
    { title: "Yom HaAtzma'ut", date: "2026-04-22", category: "holiday" },
  ]);
  assert.deepEqual([...map.keys()].sort(), ["2026-04-22", "2026-09-26"]);
});
