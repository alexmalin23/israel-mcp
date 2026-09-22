/**
 * Pure helpers for picking the right Shabbat times out of a Hebcal /shabbat response.
 * No I/O — unit tested in test/shabbat.test.ts.
 *
 * Why this exists: in weeks with a Yom Tov, Hebcal returns several `candles` and `havdalah`
 * items (e.g. Erev Yom Kippur + Friday, or motzei Yom Kippur + motzei Shabbat). Taking the
 * first item of each category mixes up the chag and Shabbat, so we anchor on the week's Saturday.
 */
import { addDays, parseDate } from "./calendar.js";

export interface ShabbatSourceItem {
  title: string;
  date: string; // "YYYY-MM-DD" or ISO datetime with offset, e.g. "2026-09-25T18:13:00+03:00"
  category: string;
  hebrew?: string;
}

export interface ShabbatTimes {
  shabbatDate: string;
  candleLighting: string | null;
  havdalah: string | null;
  parasha: { title: string; hebrew?: string } | null;
}

/** Today's date (YYYY-MM-DD) in Israel, independent of the server's timezone. */
export function todayInIsrael(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The Saturday on or after `iso` (a Saturday maps to itself). */
export function upcomingSaturday(iso: string): string {
  const dow = parseDate(iso).getUTCDay();
  return addDays(iso, (6 - dow + 7) % 7);
}

const localDay = (item: ShabbatSourceItem) => item.date.slice(0, 10);

/**
 * Pick candle-lighting, havdalah and parasha for the Shabbat on `saturday`.
 * - candles: Friday's item; otherwise the latest one earlier in that week (never a later chag).
 * - havdalah: the first one on Saturday, or on Sunday when Yom Tov follows Shabbat directly.
 * - parasha: only the portion read on that Saturday (none on a Yom Tov Shabbat).
 */
export function pickShabbatTimes(items: ShabbatSourceItem[], saturday: string): ShabbatTimes {
  const friday = addDays(saturday, -1);
  const weekStart = addDays(saturday, -6);
  const sunday = addDays(saturday, 1);
  const byDate = (a: ShabbatSourceItem, b: ShabbatSourceItem) => a.date.localeCompare(b.date);

  const candles = items
    .filter((i) => i.category === "candles" && localDay(i) >= weekStart && localDay(i) <= friday)
    .sort(byDate);
  const candle = candles.find((i) => localDay(i) === friday) ?? candles.at(-1);

  const havdalah = items
    .filter((i) => i.category === "havdalah" && localDay(i) >= saturday && localDay(i) <= sunday)
    .sort(byDate)[0];

  const parasha = items.find((i) => i.category === "parashat" && localDay(i) === saturday);

  return {
    shabbatDate: saturday,
    candleLighting: candle?.date ?? null,
    havdalah: havdalah?.date ?? null,
    parasha: parasha ? { title: parasha.title, hebrew: parasha.hebrew } : null,
  };
}
