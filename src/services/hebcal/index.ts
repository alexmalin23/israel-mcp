import { z } from "zod";
import type { ServiceModule } from "../types.js";
import { buildUrl, requestJson } from "../../lib/http.js";
import { ok, run } from "../../lib/result.js";
import { addBusinessDays, addDays, countBusinessDays, parseDate } from "./calendar.js";
import { pickShabbatTimes, todayInIsrael, upcomingSaturday } from "./shabbat.js";

/**
 * Hebcal — Jewish calendar, Israeli holidays, Shabbat times, Hebrew date conversion.
 * Public, no authentication. Docs: https://www.hebcal.com/home/developer-apis
 * Data is CC BY 4.0 — attribution to Hebcal.com is included in every response.
 */
const ATTRIBUTION = "Data from Hebcal.com (CC BY 4.0)";
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

interface HebcalItem {
  title: string;
  date: string;
  category: string;
  subcat?: string;
  hebrew?: string;
  memo?: string;
  yomtov?: boolean;
}

/** Israeli public-holiday rest days that are not flagged yomtov by Hebcal. */
const EXTRA_REST_DAYS = [/^Yom HaAtzma'ut$/i];

async function fetchHolidays(start: string, end: string, includeMinor: boolean, timeoutMs: number): Promise<HebcalItem[]> {
  const url = buildUrl("https://www.hebcal.com/hebcal", {
    v: 1,
    cfg: "json",
    i: "on", // Israel holiday schedule
    maj: "on",
    min: includeMinor ? "on" : "off",
    mod: "on",
    nx: includeMinor ? "on" : "off",
    ss: "off",
    mf: "off",
    c: "off",
    start,
    end,
  });
  const res = await requestJson<{ items?: HebcalItem[] }>(url, { timeoutMs });
  return res.items ?? [];
}

/** Dates (YYYY-MM-DD) that are official rest days in Israel. */
export function restDays(items: HebcalItem[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const it of items) {
    const date = it.date.slice(0, 10);
    if (it.yomtov === true || EXTRA_REST_DAYS.some((re) => re.test(it.title))) {
      map.set(date, it.title);
    }
  }
  return map;
}

export const hebcal: ServiceModule = {
  id: "hebcal",
  name: "Hebcal",
  disabledReason: () => null,

  register(server, config) {
    const t = config.httpTimeoutMs;

    server.registerTool(
      "hebcal_holidays",
      {
        title: "Israeli / Jewish holidays in a date range",
        description:
          "List Jewish and Israeli holidays between two dates using the Israel schedule (one-day Yom Tov). " +
          "Each item has isRestDay=true when it is an official day off (Yom Tov, Yom HaAtzma'ut).",
        inputSchema: {
          start: DATE,
          end: DATE,
          includeMinor: z.boolean().default(false).describe("Include minor holidays, fasts, Rosh Chodesh"),
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      async ({ start, end, includeMinor }) =>
        run(async () => {
          const items = await fetchHolidays(start, end, includeMinor, t);
          const rest = restDays(items);
          return ok({
            attribution: ATTRIBUTION,
            holidays: items
              .filter((i) => i.category === "holiday" || i.category === "roshchodesh")
              .map((i) => ({
                date: i.date.slice(0, 10),
                title: i.title,
                hebrew: i.hebrew,
                isRestDay: rest.has(i.date.slice(0, 10)),
              })),
          });
        }),
    );

    server.registerTool(
      "hebcal_shabbat_times",
      {
        title: "Shabbat candle-lighting and havdalah times",
        description:
          "Candle-lighting, havdalah and weekly Torah portion for a city's Shabbat (not Yom Tov times). " +
          "Defaults to the upcoming Shabbat (Israel time) " +
          "and the configured default city. Cities are GeoNames IDs (Jerusalem 281184, Tel Aviv 293397, " +
          "Haifa 294801, Be'er Sheva 295530).",
        inputSchema: {
          geonameId: z.number().int().optional().describe("GeoNames city ID"),
          date: DATE.optional().describe("Returns the Shabbat on or after this date; defaults to today in Israel"),
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      async ({ geonameId, date }) =>
        run(async () => {
          // Always send an explicit date so Hebcal's week and our Saturday anchor can't disagree.
          const base = date ?? todayInIsrael();
          const d = parseDate(base);
          const url = buildUrl("https://www.hebcal.com/shabbat", {
            cfg: "json",
            geonameid: geonameId ?? config.hebcal.defaultGeonameId,
            M: "on",
            gy: d.getUTCFullYear(),
            gm: d.getUTCMonth() + 1,
            gd: d.getUTCDate(),
          });
          const res = await requestJson<{ location?: { title?: string }; items?: HebcalItem[] }>(url, { timeoutMs: t });
          return ok({
            attribution: ATTRIBUTION,
            location: res.location?.title,
            ...pickShabbatTimes(res.items ?? [], upcomingSaturday(base)),
          });
        }),
    );

    server.registerTool(
      "hebcal_convert_date",
      {
        title: "Convert Gregorian date to Hebrew date",
        description: "Convert a Gregorian date to its Hebrew calendar date (e.g. כ״ט באלול תשפ״ו), with any holidays on that day.",
        inputSchema: { date: DATE },
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      async ({ date }) =>
        run(async () => {
          const d = parseDate(date);
          const url = buildUrl("https://www.hebcal.com/converter", {
            cfg: "json",
            g2h: 1,
            gy: d.getUTCFullYear(),
            gm: d.getUTCMonth() + 1,
            gd: d.getUTCDate(),
          });
          const r = await requestJson<any>(url, { timeoutMs: t });
          return ok({
            attribution: ATTRIBUTION,
            gregorian: date,
            hebrew: r.hebrew,
            hebrewDate: { year: r.hy, month: r.hm, day: r.hd },
            events: r.events ?? [],
          });
        }),
    );

    server.registerTool(
      "il_business_days_between",
      {
        title: "Count Israeli business days between dates",
        description:
          "Count business days in an inclusive date range, excluding Friday, Saturday and Israeli rest-day holidays. " +
          "Use for payment terms, SLAs and delivery estimates. Does not account for erev-chag half days or election days.",
        inputSchema: { from: DATE, to: DATE },
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      async ({ from, to }) =>
        run(async () => {
          const rest = restDays(await fetchHolidays(from, to, false, t));
          return ok({
            attribution: ATTRIBUTION,
            from,
            to,
            businessDays: countBusinessDays(from, to, new Set(rest.keys())),
            holidaysExcluded: [...rest].map(([date, title]) => ({ date, title })),
          });
        }),
    );

    server.registerTool(
      "il_add_business_days",
      {
        title: "Add Israeli business days to a date",
        description:
          "Return the date that is N Israeli business days after (or before, if negative) a start date, " +
          "skipping Fri/Sat and rest-day holidays. The start date itself is not counted. Example: 'שוטף + 30' needs " +
          "calendar math, but 'within 5 business days' needs this tool.",
        inputSchema: {
          start: DATE,
          days: z.number().int().min(-365).max(365),
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      async ({ start, days }) =>
        run(async () => {
          // Fetch a window wide enough to cover weekends + holiday clusters (Tishrei can eat ~2 weeks).
          const span = Math.abs(days) * 2 + 30;
          const [a, b] = days < 0 ? [addDays(start, -span), start] : [start, addDays(start, span)];
          const rest = restDays(await fetchHolidays(a, b, false, t));
          const result = addBusinessDays(start, days, new Set(rest.keys()));
          const lo = result < start ? result : start;
          const hi = result < start ? start : result;
          return ok({
            attribution: ATTRIBUTION,
            start,
            days,
            result,
            holidaysSkipped: [...rest]
              .filter(([date]) => date >= lo && date <= hi)
              .map(([date, title]) => ({ date, title })),
          });
        }),
    );
  },
};
