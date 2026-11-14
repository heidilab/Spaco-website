/**
 * Cancel a booking from the browser — one server call
 * (/api/admin/booking-cancel; lib/bookingLifecycle.cancelBookingServer).
 *
 * Every admin cancel surface (receipts reject, bookings-list cancel,
 * booking-detail status dropdown) goes through this. The server does the
 * status flip, the blocked_slots, the points / promo refund in ONE
 * transaction, then the Calendar event, the passcode and the customer
 * email, recording each result on the booking (site review 2026-11-13,
 * phase 5 — the browser used to do these one by one, and a closed tab
 * left half of them undone).
 */

import { adminApiFetch } from './adminApiFetch';

export interface CancelActor {
  uid?: string;
  email?: string;
  displayName?: string;
}

export interface CancelOutcome {
  alreadyCancelled: boolean;
  slotsDeleted: number;
  pointsRefunded: number;
  promoRestored: boolean;
  effects: Record<string, 'done' | 'skipped' | 'failed'>;
  errors: Record<string, string>;
}

export async function cancelBooking(bookingId: string, actor?: CancelActor): Promise<CancelOutcome> {
  const res = await adminApiFetch('/api/admin/booking-cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookingId, actorEmail: actor?.email, actorName: actor?.displayName }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || 'CANCEL_FAILED');
  return data as CancelOutcome;
}

/** Change a booking's status by hand — one server call (/api/admin/booking-status). */
export async function setBookingStatus(
  bookingId: string,
  status: string,
  actor?: CancelActor,
  opts: { customerEmail?: boolean } = {},
): Promise<{ status?: string; slots?: string; effects: Record<string, string>; errors: Record<string, string> }> {
  const res = await adminApiFetch('/api/admin/booking-status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookingId, status, customerEmail: !!opts.customerEmail, actorEmail: actor?.email, actorName: actor?.displayName }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || 'STATUS_FAILED');
  return data;
}

/** Words for the effects summary a staff member sees after an action. */
export function effectsSummary(effects: Record<string, string>, errors: Record<string, string>, zh: boolean): string {
  const failed = Object.entries(effects).filter(([, v]) => v === 'failed').map(([k]) => k);
  if (failed.length === 0) return '';
  const names: Record<string, { zh: string; en: string }> = {
    gcal: { zh: 'Google 日曆', en: 'Google Calendar' },
    lock: { zh: '門鎖密碼', en: 'door passcode' },
    email: { zh: '客人電郵', en: 'customer email' },
    slots: { zh: '時段', en: 'time slots' },
    rewards: { zh: '積分／優惠碼', en: 'points / promo' },
    finalize: { zh: '確認後續', en: 'confirmation follow-up' },
  };
  const list = failed.map((k) => `${names[k.split('.')[0]]?.[zh ? 'zh' : 'en'] || k}${errors[k] ? `（${errors[k]}）` : ''}`).join('、');
  return zh ? `⚠️ 未完成：${list}。再做一次會重試。` : `⚠️ Not completed: ${list}. Repeat the action to retry.`;
}
