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

// ── 套餐管理: packages as data (site review 2026-11-13, phase 4c) ──
import { afterEach } from 'vitest';
import {
  sanitizePackage, sanitizePackages, setPackageRegistry, allPackages, activePackages, getPackageBySlug, CORPORATE_TST_PACKAGE,
} from './packages';

afterEach(() => setPackageRegistry(null));

describe('package registry', () => {
  it('reads the coded list until something is saved, then the saved list', () => {
    expect(allPackages().map((p) => p.slug)).toEqual(ALL_PACKAGES.map((p) => p.slug));
    const saved = sanitizePackages([
      { ...CORPORATE_TST_PACKAGE, slug: 'corporate-hart', venueId: 'hart-ab', price: 5200, sortOrder: 1 },
      { ...BIRTHDAY_CWB_PACKAGE, active: false, sortOrder: 2 },
    ])!;
    setPackageRegistry(saved);
    expect(allPackages().map((p) => p.slug)).toEqual(['corporate-hart', 'birthday-cwb']);
    // 停售: hidden from lists, still resolvable for old bookings.
    expect(activePackages().map((p) => p.slug)).toEqual(['corporate-hart']);
    expect(getPackagesByCategory('birthday')).toEqual([]);
    expect(getPackageBySlug('birthday-cwb')?.active).toBe(false);
    expect(getPackageBySlug('birthday-hart')).toBeUndefined();
    // The server prices the saved package on its branch.
    const base = { packageSlug: 'corporate-hart', date: future, startTime: '10:00', endTime: '15:00', guestCount: 20, addOns: [] };
    // corporate: Mon–Thu only — pick the next Monday.
    const d = new Date(Date.parse(future)); while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
    const monday = d.toISOString().slice(0, 10);
    expect(pricePackage({ ...base, date: monday, venueId: 'hart-ab' }).subtotal).toBe(5200);
    expect(() => pricePackage({ ...base, date: monday, venueId: 'tst' })).toThrow(/INVALID_PACKAGE/);
  });

  it('sanitises what staff type and drops a package missing the essentials', () => {
    expect(sanitizePackage({ slug: 'Bad Slug', name: { zh: 'x' }, venueId: 'cwb', price: 1, deposit: 1, durationHours: 3, earliestStart: '08:00' })).toBeNull();
    expect(sanitizePackage({ slug: 'ok', name: { zh: '' }, venueId: 'cwb', price: 1, deposit: 1, durationHours: 3, earliestStart: '08:00' })).toBeNull();
    expect(sanitizePackage({ slug: 'ok', name: { zh: 'x' }, venueId: 'cwb', price: '1', deposit: 1, durationHours: 3.1, earliestStart: '08:00' })).toBeNull();
    const p = sanitizePackage({
      slug: 'Mahjong-TST', category: 'mahjong', venueId: 'tst', name: { zh: '麻雀' }, price: '1200', deposit: '1000', durationHours: '8',
      allowedDaysOfWeek: [4, 0, 0, 9, 'x'], earliestStart: '00:00', latestEnd: 'late', minAdvanceDays: '2', basePax: '4', extraPaxPrice: '300',
      includes: { zh: ['a', '', 'b'], en: ['A'] },
      addOns: [{ id: 'BBQ', label: { zh: 'BBQ' }, pricePerPerson: '138' }, { id: 'bbq', label: { zh: 'dupe' }, pricePerPerson: 1 }, { id: 'x', label: {} }],
      active: false, sortOrder: 3,
    })!;
    expect(p).toMatchObject({
      slug: 'mahjong-tst', category: 'mahjong', venueId: 'tst', name: { zh: '麻雀', en: '麻雀' }, price: 1200, deposit: 1000, durationHours: 8,
      allowedDaysOfWeek: [0, 4], earliestStart: '00:00', minAdvanceDays: 2, basePax: 4, extraPaxPrice: 300,
      includes: { zh: ['a', 'b'], en: ['A'] }, active: false, sortOrder: 3,
    });
    expect(p.latestEnd).toBeUndefined();
    expect(p.addOns).toEqual([{ id: 'bbq', label: { zh: 'BBQ', en: 'BBQ' }, pricePerPerson: 138 }]);
    // An unknown category falls back to birthday; a duplicate slug is dropped.
    expect(sanitizePackages([{ ...p, category: 'wedding' }, p])!.map((x) => [x.slug, x.category])).toEqual([['mahjong-tst', 'birthday']]);
    expect(sanitizePackages([])).toBeNull();
  });
});
