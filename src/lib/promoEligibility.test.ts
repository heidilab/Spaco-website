import { describe, it, expect, vi } from 'vitest';
vi.mock('./firebase', () => ({db:{}}));
import { promoEligibilityReason as reason, promoRestrictionError, validPromoDate } from './promoEligibility';
import { calcPromoDiscount } from './promoCodes';
import type { PromoCode } from '@/types';
const ctx = {venueId:'cwb',date:'2026-12-24',endDate:'2026-12-25',packageSlug:'birthday-cwb'};
describe('promo booking restrictions', () => {
  it('keeps legacy codes eligible without new fields', () => expect(reason({},ctx)).toBeNull());
  it('allows all venues or only selected spaces', () => {
    expect(reason({venueIds:[]},ctx)).toBeNull();
    expect(reason({venueIds:['cwb']},ctx)).toBeNull();
    expect(reason({venueIds:['wc']},ctx)).toBe('wrong_venue');
    expect(reason({venueIds:['cwb']},{})).toBe('wrong_venue');
  });
  it('excludes event days inclusively, including an overnight overlap', () => {
    const r={excludedDateRanges:[{start:'2026-12-25',end:'2026-12-26'}]};
    expect(reason(r,ctx)).toBe('excluded_date');
    expect(reason(r,{date:'2026-12-26'})).toBe('excluded_date');
    expect(reason(r,{date:'2026-12-27'})).toBeNull();
    expect(reason(r,{date:'2026-12-24'})).toBeNull();
    expect(reason(r,{})).toBe('missing_booking_context');
    expect(reason(r,{date:'2026-12-26',endDate:'2026-12-24'})).toBe('missing_booking_context');
  });
  it('supports multiple excluded ranges', () => {
    expect(reason({excludedDateRanges:[{start:'2026-10-01',end:'2026-10-01'},{start:'2026-12-24',end:'2026-12-24'}]},ctx)).toBe('excluded_date');
  });
  it('supports include/exclude/no packages independently of standard bookings', () => {
    expect(reason({packageScope:'include',packageSlugs:['birthday-cwb']},ctx)).toBeNull();
    expect(reason({packageScope:'include',packageSlugs:['other']},ctx)).toBe('wrong_package');
    expect(reason({packageScope:'exclude',packageSlugs:['birthday-cwb']},ctx)).toBe('wrong_package');
    expect(reason({packageScope:'exclude',packageSlugs:['other']},ctx)).toBeNull();
    expect(reason({packageScope:'none'},ctx)).toBe('wrong_package');
    expect(reason({packageScope:'none'},{date:ctx.date})).toBeNull();
    expect(reason({appliesToStandardBookings:false},{date:ctx.date})).toBe('wrong_package');
    expect(reason({appliesToStandardBookings:false},ctx)).toBeNull();
  });
  it('validates real calendar dates and incomplete restrictions', () => {
    expect(validPromoDate('2026-02-30')).toBe(false);
    expect(validPromoDate('2028-02-29')).toBe(true);
    expect(validPromoDate('2026-2-1')).toBe(false);
    expect(promoRestrictionError({excludedDateRanges:[{start:'2026-12-26',end:'2026-12-25'}]})).toBe('invalid_dates');
    expect(promoRestrictionError({packageScope:'include',packageSlugs:[]})).toBe('select_packages');
    expect(promoRestrictionError({packageScope:'none',appliesToStandardBookings:false})).toBe('no_booking_type');
  });
  it('discount calculation actually enforces restrictions while retaining package price', () => {
    const code={id:'test',code:'TEST',enabled:true,type:'percent',percent:10,packageScope:'include',packageSlugs:['birthday-cwb']} as PromoCode;
    const money={...ctx,subtotal:6800,baseCharge:6800,adultEquiv:15,drinksCost:0};
    expect(calcPromoDiscount(code,money)?.amount).toBe(680);
    expect(calcPromoDiscount({...code,packageScope:'none'},money)).toBeNull();
    expect(calcPromoDiscount({...code,excludedDateRanges:[{start:'2026-12-24',end:'2026-12-24'}]},money)).toBeNull();
    expect(calcPromoDiscount({...code,venueIds:['wc']},money)).toBeNull();
  });
});
