import { z } from "zod";
import type { ServiceModule } from "../types.js";
import { requestJson } from "../../lib/http.js";
import { ok, run } from "../../lib/result.js";

/**
 * Bank of Israel — representative exchange rates (שערים יציגים).
 * Public, no authentication. Endpoint: https://boi.org.il/PublicApi/GetExchangeRates
 * Rates are ILS per `unit` units of the foreign currency, published every business day.
 */
const URL_RATES = "https://boi.org.il/PublicApi/GetExchangeRates";

export interface BoiRate {
  currency: string;
  /** ILS per 1 unit of the currency (already divided by `unit`). */
  ilsPerUnit: number;
  /** Raw published rate, ILS per `unit` units. */
  rate: number;
  unit: number;
  changePercent: number | null;
  lastUpdate: string | null;
}

/** Normalizes the BOI payload. Field names are handled defensively (camel/Pascal case). */
export function normalizeRates(payload: any): BoiRate[] {
  const list: any[] = payload?.exchangeRates ?? payload?.ExchangeRates ?? [];
  return list
    .map((r) => {
      const rate = Number(r.currentExchangeRate ?? r.CurrentExchangeRate);
      const unit = Number(r.unit ?? r.Unit ?? 1) || 1;
      const change = r.currentChange ?? r.CurrentChange;
      return {
        currency: String(r.key ?? r.Key ?? "").toUpperCase(),
        rate,
        unit,
        ilsPerUnit: rate / unit,
        changePercent: change === undefined || change === null ? null : Number(change),
        lastUpdate: r.lastUpdate ?? r.LastUpdate ?? null,
      };
    })
    .filter((r) => r.currency && Number.isFinite(r.rate));
}

async function fetchRates(timeoutMs: number): Promise<BoiRate[]> {
  const rates = normalizeRates(await requestJson(URL_RATES, { timeoutMs }));
  if (rates.length === 0) throw new Error("Bank of Israel returned no exchange rates");
  return rates;
}

function ilsPer(rates: BoiRate[], code: string): number {
  if (code === "ILS") return 1;
  const r = rates.find((x) => x.currency === code);
  if (!r) throw new Error(`Currency ${code} is not published by Bank of Israel. Available: ILS, ${rates.map((x) => x.currency).join(", ")}`);
  return r.ilsPerUnit;
}

export const boi: ServiceModule = {
  id: "boi",
  name: "Bank of Israel",
  disabledReason: () => null,

  register(server, config) {
    const t = config.httpTimeoutMs;

    server.registerTool(
      "boi_exchange_rates",
      {
        title: "Bank of Israel representative exchange rates",
        description:
          "Latest official representative exchange rates (שער יציג) from the Bank of Israel, in ILS. " +
          "This is the rate used for Israeli invoicing, tax and accounting. Optionally filter by currency codes.",
        inputSchema: {
          currencies: z
            .array(z.string().length(3))
            .optional()
            .describe('ISO codes to return, e.g. ["USD","EUR"]. Omit for all.'),
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      async ({ currencies }) =>
        run(async () => {
          const all = await fetchRates(t);
          const wanted = currencies?.map((c) => c.toUpperCase());
          return ok({
            source: "Bank of Israel representative rates",
            rates: wanted ? all.filter((r) => wanted.includes(r.currency)) : all,
          });
        }),
    );

    server.registerTool(
      "boi_convert",
      {
        title: "Convert currency at the Bank of Israel rate",
        description:
          "Convert an amount between currencies using the latest Bank of Israel representative rates " +
          "(cross rates go through ILS). Use for invoicing/accounting math instead of commercial FX rates.",
        inputSchema: {
          amount: z.number(),
          from: z.string().length(3).describe("ISO code, e.g. USD"),
          to: z.string().length(3).default("ILS").describe("ISO code, default ILS"),
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      async ({ amount, from, to }) =>
        run(async () => {
          const rates = await fetchRates(t);
          const f = from.toUpperCase();
          const tt = to.toUpperCase();
          const rate = ilsPer(rates, f) / ilsPer(rates, tt);
          const lastUpdate = rates.find((r) => r.currency === (f === "ILS" ? tt : f))?.lastUpdate ?? null;
          return ok({
            amount,
            from: f,
            to: tt,
            rate,
            result: Math.round(amount * rate * 100) / 100,
            rateDate: lastUpdate,
          });
        }),
    );
  },
};
