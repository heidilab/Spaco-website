// What an OFFLINE order entered by staff (直接落單) overlaps, and which of
// those overlaps should stop it. PURE — no firebase.
//
// Offline orders are recorded after the fact: a broker or Airbnb booking
// that a part-timer has often already marked straight into Google
// Calendar. That calendar entry is mirrored into `blocked_slots`
// (reason 'gcal') and used to refuse the very order it stands for — and it
// kept refusing after the entry was deleted, until the next sync caught up
// (Heidi 2026-11-13). So:
//
//   Google Calendar entry   never stops an offline order; staff are told
//                           what it overlapped so they can tidy the calendar.
//   another booking, its    stops it ONCE: the form lists the clash and
//   cleaning / set-up       staff may add the order anyway. A real double
//   buffer, or a block      booking should be a decision, not an accident
//   staff put on the site   (CWB 2026-10-31).
//
// Customer bookings and CS payment links are NOT affected — they keep the
// full conflict check.

export interface ClashWindow {
  date: string;
  /** Minutes from midnight. */
  start: number;
  end: number;
}

export interface ClashSlot {
  date: string;
  startTime: string;
  endTime: string;
  reason?: string;
  bookingId?: string | null;
  googleEventId?: string;
  googleEventTitle?: string;
  isTest?: boolean;
}

export interface DirectBookingClash {
  /** calendar = a Google Calendar entry; booking = another booking (or
   *  its cleaning / set-up buffer); block = a block staff set on the site. */
  kind: 'calendar' | 'booking' | 'block';
  date: string;
  startTime: string;
  endTime: string;
  /** Event title, or what the buffer is. */
  label: string;
  bookingId?: string;
  /** For a calendar clash: the Google event, so the API can name it. */
  googleEventId?: string;
}

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** Every blocked slot the requested windows overlap, one entry per
 *  Google event / booking / block. */
export function slotClashes(
  windows: ClashWindow[],
  slots: ClashSlot[],
  opts: { production: boolean },
): DirectBookingClash[] {
  const out: DirectBookingClash[] = [];
  const seen = new Set<string>();
  for (const slot of slots) {
    // Test bookings never occupy real timeslots on production.
    if (slot.isTest && opts.production) continue;
    const hit = windows.some((w) =>
      w.date === slot.date && w.start < toMin(slot.endTime) && toMin(slot.startTime) < w.end);
    if (!hit) continue;
    const base = { date: slot.date, startTime: slot.startTime, endTime: slot.endTime };
    if (slot.reason === 'gcal') {
      const key = `cal:${slot.googleEventId || `${slot.date}${slot.startTime}${slot.endTime}`}`;
      if (seen.has(key)) continue; // one event mirrors onto every room of a shared space
      seen.add(key);
      out.push({ kind: 'calendar', ...base, label: slot.googleEventTitle || 'Google Calendar', googleEventId: slot.googleEventId });
    } else if (slot.reason === 'admin_block') {
      const key = `block:${slot.date}${slot.startTime}${slot.endTime}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind: 'block', ...base, label: '人手封鎖' });
    } else {
      // 'booking' | 'cleaning' | 'setup' — all belong to a booking.
      const key = `booking:${slot.bookingId || ''}:${slot.reason}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const what = slot.reason === 'cleaning' ? '清潔時間' : slot.reason === 'setup' ? '佈置時間' : '預訂';
      out.push({ kind: 'booking', ...base, label: what, ...(slot.bookingId ? { bookingId: slot.bookingId } : {}) });
    }
  }
  return out;
}

/** The clashes that need staff to say "add it anyway". A Google Calendar
 *  entry never does. */
export function clashesNeedingConfirmation(clashes: DirectBookingClash[]): DirectBookingClash[] {
  return clashes.filter((c) => c.kind !== 'calendar');
}
