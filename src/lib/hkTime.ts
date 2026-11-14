// Hong Kong calendar dates — PURE. Promo-code windows, the post-event
// sweep and the lock sweep all mean "today in Hong Kong", never UTC
// (site review 2026-11-13 #22: between 00:00 and 08:00 HKT a code that
// expired yesterday still worked and one starting today did not).

const HK_OFFSET_MS = 8 * 60 * 60 * 1000;

/** YYYY-MM-DD of an instant, in Hong Kong time. */
export function ymdInHkt(ms: number): string {
  return new Date(ms + HK_OFFSET_MS).toISOString().slice(0, 10);
}

/** Today's date in Hong Kong. */
export function hkTodayYmd(now: number = Date.now()): string {
  return ymdInHkt(now);
}

/** The date `days` days before/after a Hong Kong date (YYYY-MM-DD). */
export function shiftYmd(ymd: string, days: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}
