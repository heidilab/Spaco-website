import { describe, expect, it } from 'vitest';
import { ALL_PACKAGES, BIRTHDAY_CWB_PACKAGE, BIRTHDAY_HART_PACKAGE, getPackagesByCategory, getPackagesByVenueId } from './packages';
import { pricePackage } from './bookingSecurity';

const future = (() => { const d = new Date(Date.now() + 10 * 86400000); return d.toISOString().slice(0, 10); })();

describe('TST HART birthday package (Heidi 2026-10-24)', () => {
  it('is the same $6,800 / $2,000 / 3h offer as Causeway Bay, sold on Hart Room A+B', () => {
    expect(BIRTHDAY_HART_PACKAGE.venueId).toBe('hart-ab');
    expect(BIRTHDAY_HART_PACKAGE.price).toBe(BIRTHDAY_CWB_PACKAGE.price);
    expect(BIRTHDAY_HART_PACKAGE.deposit).toBe(BIRTHDAY_CWB_PACKAGE.deposit);
    expect(BIRTHDAY_HART_PACKAGE.durationHours).toBe(BIRTHDAY_CWB_PACKAGE.durationHours);
    expect(ALL_PACKAGES.map((p) => p.slug)).toContain('birthday-hart');
    expect(new Set(ALL_PACKAGES.map((p) => p.slug)).size).toBe(ALL_PACKAGES.length);
  });
  it('lets the package page offer both branches and the HART page show the card', () => {
    expect(getPackagesByCategory('birthday').map((p) => p.slug)).toEqual(['birthday-cwb', 'birthday-hart']);
    expect(getPackagesByVenueId('hart-ab').map((p) => p.slug)).toEqual(['birthday-hart']);
    expect(getPackagesByVenueId('hart-a')).toEqual([]);
    expect(BIRTHDAY_HART_PACKAGE.branchLabel?.zh).toBe('尖沙咀 HART');
  });
  it('prices on the server for hart-ab and rejects the slug on any other venue', () => {
    const base = { packageSlug: 'birthday-hart', date: future, startTime: '10:00', endTime: '13:00', guestCount: 40, addOns: [] };
    const priced = pricePackage({ ...base, venueId: 'hart-ab' });
    expect(priced.subtotal).toBe(6800);
    expect(priced.securityDeposit).toBe(2000);
    expect(() => pricePackage({ ...base, venueId: 'cwb' })).toThrow(/INVALID_PACKAGE/);
    expect(() => pricePackage({ ...base, venueId: 'hart-a' })).toThrow(/INVALID_PACKAGE/);
  });
});
