import { test } from "node:test";
import assert from "node:assert/strict";
import { pickShabbatTimes, todayInIsrael, upcomingSaturday, type ShabbatSourceItem } from "../src/services/hebcal/shabbat.js";

test("upcomingSaturday maps any weekday to that week's Saturday", () => {
  assert.equal(upcomingSaturday("2026-09-20"), "2026-09-26"); // Sun
  assert.equal(upcomingSaturday("2026-09-22"), "2026-09-26"); // Tue
  assert.equal(upcomingSaturday("2026-09-25"), "2026-09-26"); // Fri
  assert.equal(upcomingSaturday("2026-09-26"), "2026-09-26"); // Sat
});

test("todayInIsrael uses Israel time, not UTC", () => {
  // 22:30 UTC on Sep 22 is already Sep 23 in Israel (UTC+3).
  assert.equal(todayInIsrael(new Date("2026-09-22T22:30:00Z")), "2026-09-23");
  assert.equal(todayInIsrael(new Date("2026-09-22T12:00:00Z")), "2026-09-22");
});

test("regular week: picks Friday candles, Saturday havdalah and the parasha", () => {
  const items: ShabbatSourceItem[] = [
    { title: "Candle lighting: 18:30", date: "2026-08-28T18:30:00+03:00", category: "candles" },
    { title: "Parashat Ki Teitzei", hebrew: "פרשת כי תצא", date: "2026-08-29", category: "parashat" },
    { title: "Havdalah: 19:32", date: "2026-08-29T19:32:00+03:00", category: "havdalah" },
  ];
  assert.deepEqual(pickShabbatTimes(items, "2026-08-29"), {
    shabbatDate: "2026-08-29",
    candleLighting: "2026-08-28T18:30:00+03:00",
    havdalah: "2026-08-29T19:32:00+03:00",
    parasha: { title: "Parashat Ki Teitzei", hebrew: "פרשת כי תצא" },
  });
});

test("Yom Kippur + Sukkot week: ignores motzei Yom Kippur havdalah (regression)", () => {
  // Shape observed live for Tel Aviv, week of 2026-09-22.
  const items: ShabbatSourceItem[] = [
    { title: "Candle lighting: 18:20", date: "2026-09-20T18:20:00+03:00", category: "candles" },
    { title: "Havdalah: 19:15", date: "2026-09-21T19:15:00+03:00", category: "havdalah" },
    { title: "Candle lighting: 18:13", date: "2026-09-25T18:13:00+03:00", category: "candles" },
    { title: "Sukkot I", date: "2026-09-26", category: "holiday" },
    { title: "Havdalah: 19:09", date: "2026-09-26T19:09:00+03:00", category: "havdalah" },
  ];
  const r = pickShabbatTimes(items, "2026-09-26");
  assert.equal(r.candleLighting, "2026-09-25T18:13:00+03:00");
  assert.equal(r.havdalah, "2026-09-26T19:09:00+03:00");
  assert.equal(r.parasha, null);
});

test("havdalah is never earlier than candle lighting", () => {
  const items: ShabbatSourceItem[] = [
    { title: "Havdalah", date: "2026-09-21T19:15:00+03:00", category: "havdalah" },
    { title: "Candle lighting", date: "2026-09-25T18:13:00+03:00", category: "candles" },
  ];
  const r = pickShabbatTimes(items, "2026-09-26");
  assert.equal(r.candleLighting, "2026-09-25T18:13:00+03:00");
  assert.equal(r.havdalah, null);
});

test("Yom Tov on Friday: candles come from Friday (Shabbat), not Thursday (chag)", () => {
  const items: ShabbatSourceItem[] = [
    { title: "Candle lighting", date: "2027-04-22T19:00:00+03:00", category: "candles" }, // Thu, erev chag
    { title: "Candle lighting", date: "2027-04-23T19:01:00+03:00", category: "candles" }, // Fri, from existing flame
    { title: "Havdalah", date: "2027-04-24T20:05:00+03:00", category: "havdalah" },
  ];
  const r = pickShabbatTimes(items, "2027-04-24");
  assert.equal(r.candleLighting, "2027-04-23T19:01:00+03:00");
  assert.equal(r.havdalah, "2027-04-24T20:05:00+03:00");
});

test("Yom Tov right after Shabbat: havdalah moves to Sunday night", () => {
  const items: ShabbatSourceItem[] = [
    { title: "Candle lighting", date: "2027-06-11T19:30:00+03:00", category: "candles" }, // Fri
    { title: "Candle lighting", date: "2027-06-12T20:38:00+03:00", category: "candles" }, // Sat night, for chag
    { title: "Havdalah", date: "2027-06-13T20:39:00+03:00", category: "havdalah" }, // Sun night
  ];
  const r = pickShabbatTimes(items, "2027-06-12");
  assert.equal(r.candleLighting, "2027-06-11T19:30:00+03:00");
  assert.equal(r.havdalah, "2027-06-13T20:39:00+03:00");
});
