/**
 * Pure date helpers for Israeli business-day math. No I/O — unit tested in test/calendar.test.ts.
 * Dates are ISO "YYYY-MM-DD" strings, handled in UTC to avoid timezone drift.
 */

export function parseDate(iso: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error(`Invalid date "${iso}", expected YYYY-MM-DD`);
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date "${iso}"`);
  return d;
}

export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = parseDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDate(d);
}

/** Israeli weekend: Friday (5) and Saturday (6). */
export function isWeekend(iso: string): boolean {
  const day = parseDate(iso).getUTCDay();
  return day === 5 || day === 6;
}

export function isBusinessDay(iso: string, holidays: ReadonlySet<string>): boolean {
  return !isWeekend(iso) && !holidays.has(iso);
}

/** Business days in [from, to], inclusive on both ends. */
export function countBusinessDays(from: string, to: string, holidays: ReadonlySet<string>): number {
  if (parseDate(from) > parseDate(to)) throw new Error(`"from" (${from}) is after "to" (${to})`);
  let count = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (isBusinessDay(d, holidays)) count++;
  }
  return count;
}

/**
 * Move `days` business days from `start` (start itself is not counted).
 * Negative values move backwards. days = 0 returns start if it is a business day, else the next one.
 */
export function addBusinessDays(start: string, days: number, holidays: ReadonlySet<string>): string {
  const step = days < 0 ? -1 : 1;
  let remaining = Math.abs(days);
  let d = start;
  if (remaining === 0) {
    while (!isBusinessDay(d, holidays)) d = addDays(d, 1);
    return d;
  }
  while (remaining > 0) {
    d = addDays(d, step);
    if (isBusinessDay(d, holidays)) remaining--;
  }
  return d;
}
