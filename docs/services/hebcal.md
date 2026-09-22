# Hebcal — Jewish calendar and Israeli business days

Public, no authentication. Data is **CC BY 4.0**; every response carries an `attribution` field.

- Docs: https://www.hebcal.com/home/developer-apis
- All requests use the **Israel schedule** (`i=on`): one-day Yom Tov, Israeli dates for modern holidays.

## Tools

### `hebcal_holidays`
Holidays in `[start, end]`. `includeMinor` adds minor holidays, fasts and Rosh Chodesh. Each item has `isRestDay`.

### `hebcal_shabbat_times`
Candle lighting, havdalah and parasha for the Shabbat on or after `date` (default: today in Israel). `geonameId` defaults to `HEBCAL_DEFAULT_GEONAMEID`.

Returns `shabbatDate`, `candleLighting`, `havdalah`, `parasha` (null on a Yom Tov Shabbat). Times are ISO datetimes with the
Israel offset. In chag weeks Hebcal returns several `candles`/`havdalah` items; selection is anchored on the Saturday
(Friday's candles, else the latest earlier that week; havdalah on Saturday, or Sunday when Yom Tov follows Shabbat).
Pure logic in `src/services/hebcal/shabbat.ts`, covered by `test/shabbat.test.ts`.

| City | GeoNames ID |
|---|---|
| Jerusalem | 281184 |
| Tel Aviv | 293397 |
| Haifa | 294801 |
| Be'er Sheva | 295530 |

### `hebcal_convert_date`
Gregorian → Hebrew date, with events on that day.

### `il_business_days_between`
Business days in `[from, to]` inclusive.

### `il_add_business_days`
Date N business days after/before `start` (start not counted; `0` rolls forward to the next business day).

## Business-day rules
A day is **not** a business day if it is:
- Friday or Saturday
- A Hebcal item with `yomtov: true` (Rosh Hashana, Yom Kippur, Sukkot I, Shmini Atzeret, Pesach I & VII, Shavuot)
- Yom HaAtzma'ut

Not handled (by design, documented in tool descriptions): erev-chag half days, Chol HaMoed (many businesses close), election days, Tisha B'Av, business-specific Friday work. The pure logic is in `src/services/hebcal/calendar.ts` and covered by `test/calendar.test.ts`.

## Verification
```bash
curl "https://www.hebcal.com/hebcal?v=1&cfg=json&i=on&maj=on&start=2026-09-01&end=2026-10-31"
curl "https://www.hebcal.com/shabbat?cfg=json&geonameid=281184&M=on"
curl "https://www.hebcal.com/converter?cfg=json&g2h=1&gy=2026&gm=9&gd=22"
```
