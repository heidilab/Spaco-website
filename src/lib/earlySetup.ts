// 提早入場佈置 (early set-up) — PURE, safe for client and server.
//
// Rule (Heidi 2026-11-26): a booking that bought N set-up hours holds the
// room from N hours BEFORE its start time. Every surface that reserves or
// shows the booking's time — blocked_slots, the overlap guard, the staff
// calendar, the Google Calendar event, the door passcode window — starts
// at the set-up start, and the note says which part is set-up, e.g.
// 「14:00-15:00 提早入場佈置」 for a 15:00 booking with one hour.

export const MAX_EARLY_SETUP_HOURS = 3;

/** Whole set-up hours a booking carries: the stored `earlySetupHours`,
 *  else the quantity of its `early-setup` add-on, clamped to 0–3. */
export function earlySetupHoursOf(
  b: { earlySetupHours?: number; addOns?: Array<{ id: string; quantity: number }> | null } | null | undefined,
): number {
  if (!b) return 0;
  const raw = typeof b.earlySetupHours === 'number'
    ? b.earlySetupHours
    : (b.addOns || []).find((a) => a.id === 'early-setup')?.quantity || 0;
  return Math.max(0, Math.min(MAX_EARLY_SETUP_HOURS, Math.floor(raw || 0)));
}

/** "HH:MM" minus N hours, or null when that would be before 00:00 (a
 *  set-up window cannot cross into the previous day). */
export function setupWindowStart(startTime: string, hours: number): string | null {
  const [h, m] = startTime.split(':').map(Number);
  const start = h * 60 + (m || 0) - Math.round(hours * 60);
  if (!Number.isFinite(start) || start < 0) return null;
  return `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`;
}

/** When the booking starts holding the room: the set-up start when the
 *  customer bought set-up hours, otherwise the booking start. */
export function bookingHoldStart(
  b: { startTime: string; earlySetupHours?: number; addOns?: Array<{ id: string; quantity: number }> | null },
): string {
  const hours = earlySetupHoursOf(b);
  return (hours > 0 && setupWindowStart(b.startTime, hours)) || b.startTime;
}

/** The staff-facing note for the set-up part of the held window, or ''. */
export function earlySetupNote(
  b: { startTime: string; earlySetupHours?: number; addOns?: Array<{ id: string; quantity: number }> | null },
  locale: 'zh' | 'en' = 'zh',
): string {
  const hours = earlySetupHoursOf(b);
  const start = hours > 0 ? setupWindowStart(b.startTime, hours) : null;
  if (!start) return '';
  return `${start}-${b.startTime} ${locale === 'zh' ? '提早入場佈置' : 'early set-up'}`;
}
