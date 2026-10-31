import { getPackageBySlug } from './packages';
import { addOns as catalog } from './pricing';
import { amountOwed, paidBase } from './bookingMoney';
import type { BookingRecord, AddOnOptions } from '@/types';

export class BookingInputError extends Error {}
export function finiteNumber(value: unknown, min = 0, max = 10000000): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new BookingInputError('INVALID_NUMBER');
  }
  return value;
}
export function bookingInterval(date: string, start: string, end: string, endDate?: string) {
  const validDate = (d: string) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
    && Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d;
  const validTime = (t: string) => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
  if (!validDate(date) || !validDate(endDate || date) || !validTime(start) || !validTime(end)) {
    throw new BookingInputError('INVALID_DATE_TIME');
  }
  const startMs = Date.parse(`${date}T${start}:00+08:00`);
  const endMs = Date.parse(`${endDate || date}T${end}:00+08:00`);
  const hours = (endMs - startMs) / 3600000;
  if (hours <= 0 || hours > 24 || (endMs - startMs) % 900000 !== 0) throw new BookingInputError('INVALID_DURATION');
  return { startMs, endMs, hours };
}
export function validateAddOns(value: unknown, packageSlug?: string): BookingRecord['addOns'] {
  if (!Array.isArray(value) || value.length > 30) throw new BookingInputError('INVALID_ADDONS');
  const pkg = packageSlug ? getPackageBySlug(packageSlug) : undefined;
  const seen = new Set<string>();
  return value.map((a) => {
    if (!a || typeof a.id !== 'string' || seen.has(a.id)) throw new BookingInputError('INVALID_ADDONS');
    seen.add(a.id);
    const definition = packageSlug ? pkg?.addOns?.find(x => x.id === a.id) : catalog.find(x => x.id === a.id);
    if (!definition) throw new BookingInputError('INVALID_ADDON');
    const maximum = 'maxQuantity' in definition ? definition.maxQuantity ?? 500 : 500;
    const quantity = finiteNumber(a.quantity, 0, maximum);
    if (!Number.isInteger(quantity)) throw new BookingInputError('INVALID_QUANTITY');
    // Options carry quantities too (cutlery, chefs, etc.); never accept negative or non-finite values.
    const validateOptions = (v: unknown, depth = 0): void => {
      if (depth > 4) throw new BookingInputError('INVALID_OPTIONS');
      if (typeof v === 'number') finiteNumber(v, 0, 10000);
      else if (typeof v === 'string' && v.length > 1000) throw new BookingInputError('INVALID_OPTIONS');
      else if (Array.isArray(v)) { if (v.length > 200) throw new BookingInputError('INVALID_OPTIONS'); v.forEach(x => validateOptions(x, depth + 1)); }
      else if (v && typeof v === 'object') Object.values(v).forEach(x => validateOptions(x, depth + 1));
    };
    validateOptions(a.options);
    return { id: a.id, quantity, ...(a.options ? { options: a.options as AddOnOptions } : {}) };
  });
}
export function pricePackage(input: {
  packageSlug: string; venueId: string; date: string; startTime: string; endTime: string;
  endDate?: string; guestCount: number; addOns: BookingRecord['addOns'];
}, surchargePerHead = 0, now = Date.now()) {
  const pkg = getPackageBySlug(input.packageSlug);
  if (!pkg || pkg.venueId !== input.venueId) throw new BookingInputError('INVALID_PACKAGE');
  const interval = bookingInterval(input.date, input.startTime, input.endTime, input.endDate);
  const day = new Date(`${input.date}T12:00:00+08:00`).getUTCDay();
  const todayHk = new Date(now + 8 * 3600000).toISOString().slice(0, 10);
  const advanceDays = (Date.parse(input.date) - Date.parse(todayHk)) / 86400000;
  if (interval.hours !== pkg.durationHours || input.startTime < pkg.earliestStart
    || (pkg.latestEnd && (input.endTime > pkg.latestEnd || (input.endDate && input.endDate !== input.date)))
    || (pkg.allowedDaysOfWeek.length && !pkg.allowedDaysOfWeek.includes(day))
    || advanceDays < (pkg.minAdvanceDays || 0)) throw new BookingInputError('PACKAGE_UNAVAILABLE');
  const guests = finiteNumber(input.guestCount, pkg.basePax || 1, 500);
  const addOns = validateAddOns(input.addOns, pkg.slug);
  const addOnTotal = addOns.reduce((sum, a) => sum + a.quantity * pkg.addOns!.find(x => x.id === a.id)!.pricePerPerson, 0);
  const baseCharge = pkg.price + Math.max(0, guests - (pkg.basePax || guests)) * (pkg.extraPaxPrice || 0)
    + Math.round(surchargePerHead * guests);
  return { baseCharge, addOnTotal, subtotal: baseCharge + addOnTotal, securityDeposit: pkg.deposit, deposit: 0 };
}
/**
 * Staff-granted per-booking discount (折扣優惠) as stored on a draft or a
 * booking. Accepts the exact `BookingRecord['adminDiscount']` shape and
 * nothing else; null/undefined means "no discount". Three CS use cases
 * map onto it: 現金扣減 = cash/all, 場租折扣 = percent/rent, 全單折扣 =
 * percent/all. The amount itself always comes from adminDiscountAmount()
 * so the deposit, balance and receipts agree.
 */
export function sanitizeAdminDiscount(value: unknown): NonNullable<BookingRecord['adminDiscount']> | null {
  if (value == null) return null;
  if (typeof value !== 'object') throw new BookingInputError('INVALID_DISCOUNT');
  const d = value as { type?: unknown; value?: unknown; scope?: unknown; note?: unknown };
  if (d.type !== 'percent' && d.type !== 'cash') throw new BookingInputError('INVALID_DISCOUNT');
  if (d.scope !== 'all' && d.scope !== 'rent') throw new BookingInputError('INVALID_DISCOUNT');
  const amount = finiteNumber(d.value, 0, d.type === 'percent' ? 100 : 10000000);
  if (amount <= 0) return null;
  if (d.note !== undefined && (typeof d.note !== 'string' || d.note.length > 200)) throw new BookingInputError('INVALID_DISCOUNT');
  const note = typeof d.note === 'string' ? d.note.trim() : '';
  return { type: d.type, value: amount, scope: d.scope, ...(note ? { note } : {}) };
}
export function checkoutAmount(booking: BookingRecord, balance: boolean, now = Date.now()): number {
  if (!['awaiting_payment', 'awaiting_review', 'confirmed'].includes(booking.status)) throw new BookingInputError('BOOKING_NOT_PAYABLE');
  // The 30-minute slot hold only guards the FIRST payment. Once money has
  // been credited the booking is held by that payment, yet FPS approval
  // and offline recording never cleared `pendingExpiresAt`, so every
  // later KPay balance link (admin added pax, settlement overflow) was
  // refused as BOOKING_EXPIRED (TST 2026-10-31: 9 extra guests, customer
  // could not pay from the link or 會員中心). Mirrors settlementDecision.
  if (!paidBase(booking) && booking.pendingExpiresAt && booking.pendingExpiresAt <= now) throw new BookingInputError('BOOKING_EXPIRED');
  if (!balance && paidBase(booking) > 0) throw new BookingInputError('DEPOSIT_ALREADY_PAID');
  if (balance && paidBase(booking) <= 0) throw new BookingInputError('DEPOSIT_REQUIRED');
  const amount = balance ? amountOwed(booking) : (booking.pricing.deposit - (booking.pointsDiscount || 0));
  return Math.round(finiteNumber(amount, 1) * 100) / 100;
}
