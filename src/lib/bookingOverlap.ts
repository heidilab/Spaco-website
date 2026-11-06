/**
 * Second line of defence against double booking (2026-10-23).
 *
 * Availability is normally derived from `blocked_slots`. Those rows can go
 * missing or be hidden (stamped `isTest` by the hygiene cron while a real
 * booking was briefly flagged as a test, a crashed write, an old race with
 * the expiry cron). When that happens the site shows the day as free even
 * though a paid booking exists — CWB 2026-10-31 was sold twice this way.
 *
 * So every server-side creation ALSO checks the bookings themselves. This
 * module is pure; the routes feed it the booking rows they read inside
 * their transaction.
 */

export interface OverlapWindow { date: string; startTime: string; endTime: string }

export interface OverlapBooking {
  id?: string;
  venueId?: string;
  date: string;
  endDate?: string | null;
  startTime: string;
  endTime: string;
  status?: string;
  isTest?: boolean;
  earlySetupHours?: number;
}

const ACTIVE = new Set(['confirmed', 'awaiting_payment', 'awaiting_review', 'completed']);
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };

/** The day-by-day windows a booking occupies, plus its 60-minute cleaning
 *  buffer after the end (matching the blocked_slots the booking creates). */
export function bookingWindows(b: OverlapBooking): OverlapWindow[] {
  const overnight = !!b.endDate && b.endDate !== b.date;
  const endDate = overnight ? (b.endDate as string) : b.date;
  const endMin = toMin(b.endTime);
  const bufferEnd = endMin + 60 >= 24 * 60 ? '23:59' : `${String(Math.floor((endMin + 60) / 60)).padStart(2, '0')}:${String((endMin + 60) % 60).padStart(2, '0')}`;
  const windows: OverlapWindow[] = [];
  if (overnight) {
    windows.push({ date: b.date, startTime: b.startTime, endTime: '23:59' });
    windows.push({ date: endDate, startTime: '00:00', endTime: b.endTime });
  } else {
    windows.push({ date: b.date, startTime: b.startTime, endTime: b.endTime });
  }
  windows.push({ date: endDate, startTime: b.endTime, endTime: bufferEnd });
  return windows;
}

/** True when two half-open windows on the same date overlap. */
export function windowsOverlap(a: OverlapWindow, b: OverlapWindow): boolean {
  if (a.date !== b.date) return false;
  return toMin(a.startTime) < toMin(b.endTime) && toMin(b.startTime) < toMin(a.endTime);
}

/**
 * Bookings among `candidates` that would clash with `requested` windows.
 * Cancelled / expired bookings never clash; on production, test bookings
 * are ignored (they never occupy real time). The requesting booking's own
 * id is skipped so a modify can re-check itself.
 */
export function overlappingBookings(
  requested: OverlapWindow[],
  candidates: OverlapBooking[],
  opts: { production: boolean; excludeId?: string } = { production: true },
): OverlapBooking[] {
  return candidates.filter((b) => {
    if (opts.excludeId && b.id === opts.excludeId) return false;
    if (!ACTIVE.has(b.status || '')) return false;
    if (b.isTest && opts.production) return false;
    const occupied = bookingWindows(b);
    return requested.some((w) => occupied.some((o) => windowsOverlap(w, o)));
  });
}

/**
 * True when an edit keeps the booking inside the time it already holds:
 * same venue, and the new window (including any 提早入場佈置 hours before
 * the start) begins no earlier and ends no later than the current one.
 * Such an edit cannot create a clash that the existing reservation did not
 * already have, so the slot conflict check is skipped for it. Without this
 * a Google Calendar mirror slot sitting on the same evening refused every
 * re-save of a paid booking — including a pure repricing with the time
 * unchanged (HART Room B, 2026-11-06, 6h → 5h then 儲存 to reprice).
 * Anything that widens or moves the window, or changes venue, is still
 * checked in full.
 */
export function editStaysWithinReservation(
  current: Pick<OverlapBooking, 'venueId' | 'date' | 'endDate' | 'startTime' | 'endTime' | 'earlySetupHours'>,
  next: { venueId?: string; date: string; endDate?: string | null; startTime: string; endTime: string; earlySetupHours?: number },
): boolean {
  if (next.venueId !== undefined && next.venueId !== current.venueId) return false;
  const ms = (date: string, time: string) => Date.parse(`${date}T${time}:00+08:00`);
  const setup = (h?: number) => Math.max(0, Math.floor(h || 0)) * 3600000;
  const curEndDate = current.endDate && current.endDate !== current.date ? current.endDate : current.date;
  const nextEndDate = next.endDate && next.endDate !== next.date ? next.endDate : next.date;
  const curStart = ms(current.date, current.startTime) - setup(current.earlySetupHours);
  const curEnd = ms(curEndDate, current.endTime);
  const nextStart = ms(next.date, next.startTime) - setup(next.earlySetupHours);
  const nextEnd = ms(nextEndDate, next.endTime);
  if (![curStart, curEnd, nextStart, nextEnd].every(Number.isFinite)) return false;
  return nextStart >= curStart && nextEnd <= curEnd;
}
