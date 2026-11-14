// When a door passcode is valid (site review 2026-11-13, lock #5): early
// set-up hours open it; it runs to the end of an overnight booking.

import { describe, it, expect, vi } from 'vitest';

vi.mock('./firebaseAdmin', () => ({ adminDb: {} }));
vi.mock('./venueRegistryServer', () => ({ resolveVenueServer: async () => undefined, loadAllVenuesServer: async () => [] }));
vi.mock('./content', () => ({ getSiteContent: async () => null }));
vi.mock('./emailAutomations', () => ({ sendAutomatedEmail: async () => ({ sent: true }) }));
vi.mock('./ttlock', () => ({ addKeyboardPasscode: async () => ({}), deleteKeyboardPasscode: async () => {}, isTTLockConfigured: () => false }));
vi.mock('./email', () => ({ buildLockPasscodeEmail: () => ({ subject: '', html: '' }), buildBalanceDueReminderEmail: () => ({ subject: '', html: '' }) }));

import { passcodeWindow } from './lockPasscode';

const hk = (date: string, time: string) => Date.parse(`${date}T${time}:00+08:00`);

describe('passcodeWindow', () => {
  it('opens 60 minutes before the start and closes at the end', () => {
    const w = passcodeWindow({ date: '2026-11-20', startTime: '19:00', endTime: '23:00' });
    expect(w.validFrom).toBe(hk('2026-11-20', '18:00'));
    expect(w.validTo).toBe(hk('2026-11-20', '23:00'));
  });
  it('opens at the start of a paid early set-up window when that is earlier', () => {
    const w = passcodeWindow({ date: '2026-11-20', startTime: '19:00', endTime: '23:00', earlySetupHours: 2 });
    expect(w.validFrom).toBe(hk('2026-11-20', '17:00'));
    // Half an hour of set-up is still covered by the 60-minute grace.
    expect(passcodeWindow({ date: '2026-11-20', startTime: '19:00', endTime: '23:00', earlySetupHours: 0.5 }).validFrom).toBe(hk('2026-11-20', '18:00'));
  });
  it('an overnight booking stays valid until day 2 ends', () => {
    const w = passcodeWindow({ date: '2026-11-20', startTime: '21:00', endTime: '02:00', endDate: '2026-11-21' });
    expect(w.validTo).toBe(hk('2026-11-21', '02:00'));
    expect(w.validTo).toBeGreaterThan(w.validFrom);
  });
});
