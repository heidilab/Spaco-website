// Finance aggregation — turns a list of BookingRecord into revenue
// breakdowns by month / branch / add-on / marketing channel. Pure
// functions: caller fetches the data, this file does the math.

import type { BookingRecord, MarketingChannel } from '@/types';
import { addOns as ADDON_CATALOG, bbqStandardPriceByVenue, calcShishaPrice, calcCateringTotal, earlySetupPriceByVenue } from './pricing';
import { venues } from './venues';

export interface FinanceFilter {
  /** Inclusive YYYY-MM-DD start. Bookings with date < from excluded. */
  from?: string;
  /** Inclusive YYYY-MM-DD end. Bookings with date > to excluded. */
  to?: string;
  /** Restrict to a branch. 'all' = all venues. 'sw' = all Sheung Wan
   *  variants (sw-a, sw-b, sw-ab) since they share the same physical
   *  flagship. Otherwise a venue id (cwb / wanchai / tst). */
  branch?: string;
  /** Restrict to a marketing channel. 'all' or omitted = all. */
  channel?: MarketingChannel | 'loyalty_member' | 'all';
}

/** Roll a venueId up to its branch group key used by the finance UI. */
export function branchKey(venueId: string): string {
  if (venueId.startsWith('sw-')) return 'sw';
  return venueId;
}

/** Display name for a branch group key. */
export function branchGroupName(key: string): { zh: string; en: string } {
  if (key === 'sw') return { zh: '上環海景旗艦店', en: 'Sheung Wan Flagship' };
  if (key === 'cwb') return { zh: '銅鑼灣店', en: 'Causeway Bay' };
  if (key === 'wanchai') return { zh: '灣仔店', en: 'Wan Chai' };
  if (key === 'tst') return { zh: '尖沙咀店', en: 'Tsim Sha Tsui' };
  // Fall back to the venue catalog name if available.
  const v = venues.find((vn) => vn.id === key);
  return v?.name || { zh: key, en: key };
}

export interface AddOnRevenue {
  id: string;
  name: { zh: string; en: string };
  bookings: number;
  revenue: number;
}

export interface MonthlyRevenue {
  month: string;        // 'YYYY-MM'
  revenue: number;
  bookings: number;
}

export interface BranchRevenue {
  branchId: string;
  branchName: { zh: string; en: string };
  revenue: number;
  bookings: number;
}

export interface ChannelStats {
  channel: MarketingChannel | 'loyalty_member' | 'unknown';
  bookings: number;
  revenue: number;
}

export interface AggregateResult {
  bookingCount: number;
  /** Total revenue (subtotal sums) — what customers paid for rental + add-ons. */
  totalRevenue: number;
  /** Rental subtotal sum (pricing.baseCharge). */
  rentalRevenue: number;
  /** Sum across all add-ons. */
  addOnRevenue: number;
  /** Forfeited security deposit (sum of depositRefund.deductions). */
  depositDeductionsRevenue: number;
  /** Future bookings (date > today) — same shape as totals so admin can
   *  see "how much is locked in for next month / next quarter". */
  futureRevenue: number;
  futureBookingCount: number;
  monthly: MonthlyRevenue[];
  byBranch: BranchRevenue[];
  byAddOn: AddOnRevenue[];
  byChannel: ChannelStats[];
}

/** Resolve the per-booking cost of a single add-on entry. Mirrors the
 *  rules in calculatePricing so the breakdown stays consistent. Children
 *  count as 0.5 adult-equivalent for per-pax items. */
export function addOnRevenueForBooking(
  booking: BookingRecord,
  addOnId: string,
): number {
  const entry = booking.addOns?.find((a) => a.id === addOnId);
  if (!entry) return 0;
  const adults = booking.adultCount ?? booking.guestCount;
  const kids = booking.childCount ?? 0;
  const equiv = adults + 0.5 * kids;

  // Custom items (admin free-form rows, id `custom-<ts>-<idx>`): the price
  // lives on the entry itself. Without this branch the finance page showed
  // HK$0 for every custom item.
  if (addOnId.startsWith('custom-')) {
    return Math.max(0, Math.floor(entry.options?.customPrice ?? 0));
  }
  // Catering: derived from tier + dishes + delivery + cutlery, same calc
  // as checkout. Was falling through to the default 0.
  if (addOnId === 'catering') {
    return calcCateringTotal({
      tierId: entry.options?.tierId,
      dishCodes: entry.options?.dishCodes,
      deliveryZoneId: entry.options?.deliveryZoneId,
      doorstepDelivery: entry.options?.doorstepDelivery,
      noCutlery: entry.options?.noCutlery,
      extraCutlerySets: entry.options?.extraCutlerySets,
      extraFoodTongs: entry.options?.extraFoodTongs,
    });
  }
  if (addOnId === 'early-setup') {
    const perHour = earlySetupPriceByVenue[booking.venueId] ?? 500;
    return perHour * (entry.quantity || 1);
  }

  switch (addOnId) {
    case 'bbq-standard': {
      const price = bbqStandardPriceByVenue[booking.venueId] || 158;
      return Math.round(price * equiv);
    }
    case 'bbq-premium':
      return Math.round(328 * equiv);
    case 'bbq-grill': {
      // Grill is waived if a BBQ package is also booked.
      const hasPkg = booking.addOns?.some((a) => a.id === 'bbq-standard' || a.id === 'bbq-premium');
      return hasPkg ? 0 : 500 * entry.quantity;
    }
    case 'hotpot-standard':
      return Math.round(168 * equiv);
    case 'hotpot-seafood':
      return Math.round(348 * equiv);
    case 'hotpot-extra-soup':
      return 108 * entry.quantity;
    case 'drinks':
      return Math.round(25 * equiv);
    case 'shisha': {
      const heads = entry.quantity;
      const pipes = entry.options?.pipes ?? Math.min(2, heads);
      const setup = !!entry.options?.staffSetup;
      return calcShishaPrice(pipes, heads, setup);
    }
    default:
      return 0;
  }
}

/** Sum the depositRefund deductions on a booking (what the venue kept). */
function deductionsTotal(booking: BookingRecord): number {
  const refund = booking.depositRefund as { deductions?: { amount: number }[] } | undefined;
  if (!refund?.deductions) return 0;
  return refund.deductions.reduce((s, d) => s + (d.amount || 0), 0);
}

function isFutureDate(dateStr: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(dateStr).getTime() > today.getTime();
}

/** Filter, then aggregate. Cancelled bookings are excluded from revenue
 *  but kept in count if needed (currently we drop them entirely). */
/**
 * Should this booking count toward finance totals at all?
 *
 * Excludes, in order of the incidents that motivated each rule:
 *   • cancelled / legacy pending / payment_not_completed — never money
 *   • admin-flagged TEST bookings (isTest) — real KPay test charges were
 *     inflating the Aug-2026 CWB sales record by ~$18k
 *   • GHOST bookings: no real payment logged AND no paid status. These
 *     are abandoned checkout attempts (old default paymentMethod
 *     'stripe') that the export used to count as revenue — CWB Aug-2026
 *     showed $114,037 vs the true $106,166 largely because of these.
 *
 * ONE predicate shared by the aggregator, the Excel export and (later)
 * the monthly close, so the numbers can never disagree again.
 */
export function countsForFinance(b: BookingRecord): boolean {
  if (b.status === 'cancelled' || b.status === 'pending' || b.status === 'payment_not_completed') return false;
  if (b.isTest) return false;
  const paid = (b.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
  const paidStatus = b.status === 'confirmed' || b.status === 'completed' || !!b.paymentVerifiedAt;
  if (paid <= 0 && !paidStatus) return false;
  return true;
}

export function aggregateBookings(
  bookings: BookingRecord[],
  filter: FinanceFilter = {},
): AggregateResult {
  // Filter pass.
  const filtered = bookings.filter((b) => {
    if (!countsForFinance(b)) return false;
    if (filter.from && b.date < filter.from) return false;
    if (filter.to && b.date > filter.to) return false;
    if (filter.branch && filter.branch !== 'all') {
      // Branch filter rolls SW variants together.
      if (branchKey(b.venueId) !== filter.branch) return false;
    }
    if (filter.channel && filter.channel !== 'all') {
      const ch = b.marketingChannel || 'unknown';
      if (ch !== filter.channel) return false;
    }
    return true;
  });

  const monthlyMap = new Map<string, { revenue: number; bookings: number }>();
  const branchMap = new Map<string, { revenue: number; bookings: number }>();
  const addOnMap = new Map<string, { bookings: number; revenue: number }>();
  const channelMap = new Map<string, { bookings: number; revenue: number }>();

  let totalRevenue = 0;
  let rentalRevenue = 0;
  let addOnRevenueTotal = 0;
  let depositDeductionsRevenue = 0;
  let futureRevenue = 0;
  let futureBookingCount = 0;

  for (const b of filtered) {
    const subtotal = b.pricing?.subtotal || 0;
    const baseCharge = b.pricing?.baseCharge || 0;
    const addOnTotal = b.pricing?.addOnTotal || 0;
    const dedTotal = deductionsTotal(b);

    // Promo / point discounts reduce what the customer actually paid.
    // For revenue accounting we use subtotal − discounts (= cash that
    // came in). That keeps free-drinks promos honest too.
    const discount = (b.promoDiscount || 0) + (b.pointsDiscount || 0);
    const netRevenue = Math.max(0, subtotal - discount);
    const totalForBooking = netRevenue + dedTotal;

    totalRevenue += totalForBooking;
    rentalRevenue += baseCharge;
    addOnRevenueTotal += addOnTotal;
    depositDeductionsRevenue += dedTotal;

    if (isFutureDate(b.date)) {
      futureRevenue += totalForBooking;
      futureBookingCount += 1;
    }

    // Monthly bucket.
    const month = b.date.slice(0, 7);
    const m = monthlyMap.get(month) || { revenue: 0, bookings: 0 };
    m.revenue += totalForBooking;
    m.bookings += 1;
    monthlyMap.set(month, m);

    // Branch bucket — SW Room A / B / A+B all roll up to one group.
    const bKey = branchKey(b.venueId);
    const branchBucket = branchMap.get(bKey) || { revenue: 0, bookings: 0 };
    branchBucket.revenue += totalForBooking;
    branchBucket.bookings += 1;
    branchMap.set(bKey, branchBucket);

    // Add-on bucket.
    for (const a of (b.addOns || [])) {
      const cost = addOnRevenueForBooking(b, a.id);
      // All custom-<ts>-<idx> entries roll up to one 自訂項目 row — the raw
      // ids are per-entry unique and meaningless in a report.
      const key = a.id.startsWith('custom-') ? 'custom' : a.id;
      const bucket = addOnMap.get(key) || { bookings: 0, revenue: 0 };
      bucket.bookings += 1;
      bucket.revenue += cost;
      addOnMap.set(key, bucket);
    }

    // Channel bucket.
    const ch = b.marketingChannel || 'unknown';
    const cBucket = channelMap.get(ch) || { bookings: 0, revenue: 0 };
    cBucket.bookings += 1;
    cBucket.revenue += totalForBooking;
    channelMap.set(ch, cBucket);
  }

  const monthly: MonthlyRevenue[] = Array.from(monthlyMap.entries())
    .map(([month, v]) => ({ month, ...v }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const byBranch: BranchRevenue[] = Array.from(branchMap.entries())
    .map(([id, v]) => ({
      branchId: id,
      branchName: branchGroupName(id),
      ...v,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const byAddOn: AddOnRevenue[] = Array.from(addOnMap.entries())
    .map(([id, v]) => {
      const meta = ADDON_CATALOG.find((a) => a.id === id);
      const fallback = id === 'custom'
        ? { zh: '自訂項目', en: 'Custom items' }
        : { zh: id, en: id };
      return {
        id,
        name: meta?.name || fallback,
        ...v,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  const byChannel: ChannelStats[] = Array.from(channelMap.entries())
    .map(([ch, v]) => ({ channel: ch as ChannelStats['channel'], ...v }))
    .sort((a, b) => b.bookings - a.bookings);

  return {
    bookingCount: filtered.length,
    totalRevenue,
    rentalRevenue,
    addOnRevenue: addOnRevenueTotal,
    depositDeductionsRevenue,
    futureRevenue,
    futureBookingCount,
    monthly,
    byBranch,
    byAddOn,
    byChannel,
  };
}
