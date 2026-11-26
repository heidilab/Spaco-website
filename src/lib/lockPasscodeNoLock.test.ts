// 不使用電子門鎖 (分店管理, 2026-11-26): a venue without an electronic lock
// never reaches TTLock and is never reported as a failed passcode; a
// balance is still chased, without the passcode promise.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  booking: {} as Record<string, unknown>,
  venue: { id: 'nolock-venue', name: { zh: '無鎖場地', en: 'No-lock venue' }, noElectronicLock: true } as Record<string, unknown>,
  updates: [] as unknown[],
  ttlockCalls: [] as unknown[],
  reminders: [] as Array<Record<string, unknown>>,
  sent: [] as unknown[],
}));

vi.mock('./firebaseAdmin', () => ({
  adminDb: {
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => name === 'bookings'
          ? { exists: true, id, data: () => state.booking }
          : { exists: true, id, data: () => ({ email: 'customer@example.com', displayName: 'Customer' }) },
        update: async (patch: unknown) => { state.updates.push(patch); },
      }),
    }),
  },
}));
vi.mock('./venueRegistryServer', () => ({
  resolveVenueServer: async () => state.venue,
  loadAllVenuesServer: async () => [{ ...state.venue, ttlockLockId: '123456' }],
}));
vi.mock('./content', () => ({ getSiteContent: async () => null }));
vi.mock('./emailAutomations', () => ({ sendAutomatedEmail: async (m: unknown) => { state.sent.push(m); return { sent: true }; } }));
vi.mock('./ttlock', () => ({
  addKeyboardPasscode: async (a: unknown) => { state.ttlockCalls.push(a); return { passcode: '111111', keyboardPwdId: 1 }; },
  deleteKeyboardPasscode: async () => {},
  isTTLockConfigured: () => true,
}));
vi.mock('./email', () => ({
  buildLockPasscodeEmail: () => ({ subject: 'p', html: '' }),
  buildBalanceDueReminderEmail: (p: Record<string, unknown>) => { state.reminders.push(p); return { subject: 'r', html: '' }; },
}));

import { processBookingForLockAccess } from './lockPasscode';

/** Tomorrow (HKT) at 23:30 — inside the 48-hour window, not yet started. */
function tomorrowHkt(): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000 + 8 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

beforeEach(() => {
  state.updates.length = 0; state.ttlockCalls.length = 0; state.reminders.length = 0; state.sent.length = 0;
  state.venue = { id: 'nolock-venue', name: { zh: '無鎖場地', en: 'No-lock venue' }, noElectronicLock: true };
  state.booking = {
    userId: 'u1', venueId: 'nolock-venue', branchSlug: 'nolock', status: 'confirmed',
    date: tomorrowHkt(), startTime: '23:30', endTime: '23:59', balanceDue: 0,
  };
});

describe('processBookingForLockAccess on a 不使用電子門鎖 venue', () => {
  it('skips (not an error) and never calls TTLock when the balance is paid', async () => {
    const r = await processBookingForLockAccess('b1');
    expect(r).toEqual({ bookingId: 'b1', action: 'skipped', reason: 'no-electronic-lock' });
    expect(state.ttlockCalls).toEqual([]);
    expect(state.updates).toEqual([]);
    expect(state.sent).toEqual([]);
  });
  it('still chases an unpaid balance, without promising a passcode', async () => {
    state.booking.balanceDue = 500;
    const r = await processBookingForLockAccess('b2');
    expect(r.action).toBe('reminded');
    expect(state.reminders).toHaveLength(1);
    expect(state.reminders[0].noElectronicLock).toBe(true);
    expect(state.ttlockCalls).toEqual([]);
  });
  it('a venue with a lock id still generates as before', async () => {
    state.venue = { id: 'nolock-venue', name: { zh: 'X', en: 'X' } };
    const r = await processBookingForLockAccess('b3');
    expect(r.action).toBe('generated');
    expect(state.ttlockCalls).toHaveLength(1);
    expect(state.reminders[0]?.noElectronicLock ?? false).toBe(false);
  });
});
