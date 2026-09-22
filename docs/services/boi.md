# Bank of Israel — representative exchange rates

Official representative rates (שער יציג), published every business day. This is the rate used for Israeli invoicing, VAT and accounting. Public, no authentication.

- Endpoint: `https://boi.org.il/PublicApi/GetExchangeRates` (JSON; `?asXml=true` for XML)
- Rates are ILS per `unit` units of the currency. Some currencies (e.g. JPY) are quoted per 100 units; the server normalizes to `ilsPerUnit`.

## Tools

### `boi_exchange_rates`
| Param | Type | Notes |
|---|---|---|
| `currencies` | string[] | Optional ISO codes filter |

Returns `rates[]`: `currency`, `rate` (raw), `unit`, `ilsPerUnit`, `changePercent`, `lastUpdate`.

### `boi_convert`
| Param | Type | Default |
|---|---|---|
| `amount` | number | — |
| `from` | ISO code | — |
| `to` | ISO code | `ILS` |

Cross rates are computed through ILS. Returns `rate`, `result` (rounded to agorot) and `rateDate`.

## Limitations
- Latest rates only. Historical rates live in the BOI SDMX service (`edge.boi.org.il/FusionEdgeServer/sdmx/v2/...`) — planned.
- Only currencies the BOI publishes (~14).

## Verification
```bash
curl https://boi.org.il/PublicApi/GetExchangeRates
```
Expected shape: `{ "exchangeRates": [ { "key": "USD", "currentExchangeRate": 3.x, "currentChange": ..., "unit": 1, "lastUpdate": "..." } ] }`. The normalizer also accepts PascalCase keys.
