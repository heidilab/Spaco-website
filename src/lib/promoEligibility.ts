import type { PromoCode } from '@/types';

export type PromoRestrictions = Pick<PromoCode, 'venueIds' | 'excludedDateRanges' | 'packageScope' | 'packageSlugs' | 'appliesToStandardBookings'>;
export interface PromoBookingContext {
  venueId?: string;
  date?: string;
  endDate?: string;
  packageSlug?: string | null;
}
export const EMPTY_PROMO_RESTRICTIONS: PromoRestrictions = {
  venueIds: [], excludedDateRanges: [], packageScope: 'all', packageSlugs: [], appliesToStandardBookings: true,
};
export function validPromoDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function promoRestrictionError(code: PromoRestrictions): string | null {
  if (code.excludedDateRanges?.some(r => !validPromoDate(r.start) || !validPromoDate(r.end) || r.start > r.end)) return 'invalid_dates';
  if (code.packageScope === 'include' && !code.packageSlugs?.length) return 'select_packages';
  if (code.packageScope === 'none' && code.appliesToStandardBookings === false) return 'no_booking_type';
  return null;
}
/** Dates describe the booked event, not the day the customer redeems the code.
 * Missing context fails closed for restricted codes. Absent fields keep legacy eligibility.
 */
export function promoEligibilityReason(code: PromoRestrictions, ctx: PromoBookingContext): 'wrong_venue' | 'excluded_date' | 'wrong_package' | 'missing_booking_context' | null {
  if (code.venueIds?.length && (!ctx.venueId || !code.venueIds.includes(ctx.venueId))) return 'wrong_venue';
  if (code.excludedDateRanges?.length) {
    if (!validPromoDate(ctx.date) || (ctx.endDate && !validPromoDate(ctx.endDate))) return 'missing_booking_context';
    const end = ctx.endDate || ctx.date;
    if (end < ctx.date) return 'missing_booking_context';
    if (code.excludedDateRanges.some(r => ctx.date! <= r.end && end >= r.start)) return 'excluded_date';
  }
  if (!ctx.packageSlug) return code.appliesToStandardBookings === false ? 'wrong_package' : null;
  const selected = code.packageSlugs?.includes(ctx.packageSlug) || false;
  if (code.packageScope === 'none' || (code.packageScope === 'include' && !selected) || (code.packageScope === 'exclude' && selected)) return 'wrong_package';
  return null;
}
