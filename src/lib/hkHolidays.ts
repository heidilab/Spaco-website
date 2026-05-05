/**
 * Hong Kong public holidays + traditional festivals (bilingual).
 *
 * Sources:
 *  - Hong Kong Government Gazette (https://www.gov.hk/en/about/abouthk/holiday/)
 *  - Lunar / festival dates from Hong Kong Observatory.
 *
 * Maintenance note: lunar dates change each year — extend the table when a
 * new year's calendar is published. Admin can add custom marks here too.
 */

export type HolidayType = 'public' | 'festival';

export interface Holiday {
  date: string;                 // ISO 'YYYY-MM-DD'
  name: { zh: string; en: string };
  type: HolidayType;
}

export const HK_HOLIDAYS: Holiday[] = [
  // ───────── 2025 ─────────
  { date: '2025-01-01', type: 'public',   name: { zh: '元旦',          en: "New Year's Day" } },
  { date: '2025-01-29', type: 'public',   name: { zh: '農曆年初一',    en: 'Lunar New Year Day 1' } },
  { date: '2025-01-30', type: 'public',   name: { zh: '農曆年初二',    en: 'Lunar New Year Day 2' } },
  { date: '2025-01-31', type: 'public',   name: { zh: '農曆年初三',    en: 'Lunar New Year Day 3' } },
  { date: '2025-04-04', type: 'public',   name: { zh: '清明節',        en: 'Ching Ming Festival' } },
  { date: '2025-04-18', type: 'public',   name: { zh: '耶穌受難節',    en: 'Good Friday' } },
  { date: '2025-04-19', type: 'public',   name: { zh: '耶穌受難節翌日', en: 'Day after Good Friday' } },
  { date: '2025-04-21', type: 'public',   name: { zh: '復活節星期一',  en: 'Easter Monday' } },
  { date: '2025-05-01', type: 'public',   name: { zh: '勞動節',        en: 'Labour Day' } },
  { date: '2025-05-05', type: 'public',   name: { zh: '佛誕',          en: "Buddha's Birthday" } },
  { date: '2025-05-31', type: 'public',   name: { zh: '端午節',        en: 'Tuen Ng Festival' } },
  { date: '2025-07-01', type: 'public',   name: { zh: '香港特別行政區成立紀念日', en: 'HKSAR Establishment Day' } },
  { date: '2025-10-01', type: 'public',   name: { zh: '國慶日',        en: 'National Day' } },
  { date: '2025-10-07', type: 'public',   name: { zh: '中秋節翌日',    en: 'Day after Mid-Autumn Festival' } },
  { date: '2025-10-29', type: 'public',   name: { zh: '重陽節',        en: 'Chung Yeung Festival' } },
  { date: '2025-12-25', type: 'public',   name: { zh: '聖誕節',        en: 'Christmas Day' } },
  { date: '2025-12-26', type: 'public',   name: { zh: '聖誕節後翌日',  en: 'Boxing Day' } },
  // Festivals (not public holidays)
  { date: '2025-02-14', type: 'festival', name: { zh: '情人節',        en: "Valentine's Day" } },
  { date: '2025-10-06', type: 'festival', name: { zh: '中秋節',        en: 'Mid-Autumn Festival' } },
  { date: '2025-10-31', type: 'festival', name: { zh: '萬聖節',        en: 'Halloween' } },
  { date: '2025-12-22', type: 'festival', name: { zh: '冬至',          en: 'Winter Solstice' } },
  { date: '2025-12-24', type: 'festival', name: { zh: '平安夜',        en: 'Christmas Eve' } },
  { date: '2025-12-31', type: 'festival', name: { zh: '除夕',          en: "New Year's Eve" } },

  // ───────── 2026 ─────────
  { date: '2026-01-01', type: 'public',   name: { zh: '元旦',          en: "New Year's Day" } },
  { date: '2026-02-17', type: 'public',   name: { zh: '農曆年初一',    en: 'Lunar New Year Day 1' } },
  { date: '2026-02-18', type: 'public',   name: { zh: '農曆年初二',    en: 'Lunar New Year Day 2' } },
  { date: '2026-02-19', type: 'public',   name: { zh: '農曆年初三',    en: 'Lunar New Year Day 3' } },
  { date: '2026-04-03', type: 'public',   name: { zh: '耶穌受難節',    en: 'Good Friday' } },
  { date: '2026-04-04', type: 'public',   name: { zh: '耶穌受難節翌日', en: 'Day after Good Friday' } },
  { date: '2026-04-06', type: 'public',   name: { zh: '復活節星期一',  en: 'Easter Monday' } },
  { date: '2026-04-05', type: 'public',   name: { zh: '清明節',        en: 'Ching Ming Festival' } },
  { date: '2026-05-01', type: 'public',   name: { zh: '勞動節',        en: 'Labour Day' } },
  { date: '2026-05-25', type: 'public',   name: { zh: '佛誕翌日',      en: "Day after Buddha's Birthday" } },
  { date: '2026-06-19', type: 'public',   name: { zh: '端午節',        en: 'Tuen Ng Festival' } },
  { date: '2026-07-01', type: 'public',   name: { zh: '香港特別行政區成立紀念日', en: 'HKSAR Establishment Day' } },
  { date: '2026-09-26', type: 'public',   name: { zh: '中秋節翌日',    en: 'Day after Mid-Autumn Festival' } },
  { date: '2026-10-01', type: 'public',   name: { zh: '國慶日',        en: 'National Day' } },
  { date: '2026-10-19', type: 'public',   name: { zh: '重陽節',        en: 'Chung Yeung Festival' } },
  { date: '2026-12-25', type: 'public',   name: { zh: '聖誕節',        en: 'Christmas Day' } },
  // Festivals
  { date: '2026-02-14', type: 'festival', name: { zh: '情人節',        en: "Valentine's Day" } },
  { date: '2026-05-24', type: 'festival', name: { zh: '佛誕',          en: "Buddha's Birthday" } },
  { date: '2026-09-25', type: 'festival', name: { zh: '中秋節',        en: 'Mid-Autumn Festival' } },
  { date: '2026-10-31', type: 'festival', name: { zh: '萬聖節',        en: 'Halloween' } },
  { date: '2026-12-22', type: 'festival', name: { zh: '冬至',          en: 'Winter Solstice' } },
  { date: '2026-12-24', type: 'festival', name: { zh: '平安夜',        en: 'Christmas Eve' } },
  { date: '2026-12-31', type: 'festival', name: { zh: '除夕',          en: "New Year's Eve" } },

  // ───────── 2027 (key dates only — extend as published) ─────────
  { date: '2027-01-01', type: 'public',   name: { zh: '元旦',          en: "New Year's Day" } },
  { date: '2027-02-06', type: 'public',   name: { zh: '農曆年初一',    en: 'Lunar New Year Day 1' } },
  { date: '2027-02-07', type: 'public',   name: { zh: '農曆年初二',    en: 'Lunar New Year Day 2' } },
  { date: '2027-02-08', type: 'public',   name: { zh: '農曆年初三',    en: 'Lunar New Year Day 3' } },
];

const map = new Map<string, Holiday>();
HK_HOLIDAYS.forEach((h) => map.set(h.date, h));

/** Look up a holiday for a given ISO date string (YYYY-MM-DD). */
export function getHoliday(date: string): Holiday | null {
  return map.get(date) ?? null;
}

/** Returns all holidays in a given month, keyed by date. */
export function getHolidaysForMonth(yearMonth: string): Map<string, Holiday> {
  const result = new Map<string, Holiday>();
  for (const h of HK_HOLIDAYS) {
    if (h.date.startsWith(yearMonth)) result.set(h.date, h);
  }
  return result;
}
