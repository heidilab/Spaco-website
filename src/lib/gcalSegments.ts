// How a Google Calendar event maps onto blocked_slots — PURE (site
// review 2026-11-13 #17). An event that crosses midnight blocks both
// days; a multi-day all-day event blocks every day it covers. Before this
// a cross-midnight event stopped at 23:59 of its first day and an all-day
// event covered its first day only.

export interface EventSegment { date: string; startTime: string; endTime: string }

const HK = 'Asia/Hong_Kong';
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: HK, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const hhmm = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: HK, hour: '2-digit', minute: '2-digit', hour12: false }).format(d).replace('24:', '00:');
const nextDay = (s: string) => new Date(Date.parse(`${s}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

const MAX_DAYS = 31;

/** Timed event (start / end as ISO date-times). */
export function timedEventSegments(startIso: string, endIso: string): EventSegment[] {
  const s = new Date(startIso);
  const e = new Date(endIso);
  if (!(e.getTime() > s.getTime())) return [];
  const startDate = ymd(s);
  const endDate = ymd(e);
  const endTime = hhmm(e);
  if (startDate === endDate) return [{ date: startDate, startTime: hhmm(s), endTime }];
  const out: EventSegment[] = [{ date: startDate, startTime: hhmm(s), endTime: '23:59' }];
  let d = nextDay(startDate);
  let n = 0;
  while (d < endDate && n++ < MAX_DAYS) { out.push({ date: d, startTime: '00:00', endTime: '23:59' }); d = nextDay(d); }
  // An event ending exactly at midnight occupies nothing of the end day.
  if (endTime !== '00:00') out.push({ date: endDate, startTime: '00:00', endTime });
  return out;
}

/** All-day event: Google gives the end date EXCLUSIVE (a one-day event
 *  has end = start + 1 day). */
export function allDayEventSegments(startDate: string, endDateExclusive: string): EventSegment[] {
  const out: EventSegment[] = [];
  let d = startDate;
  let n = 0;
  while (d < endDateExclusive && n++ < MAX_DAYS) { out.push({ date: d, startTime: '00:00', endTime: '23:59' }); d = nextDay(d); }
  if (out.length === 0) out.push({ date: startDate, startTime: '00:00', endTime: '23:59' });
  return out;
}
