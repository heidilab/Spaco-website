// Finance aggregation — turns a list of BookingRecord into revenue
// breakdowns by month / branch / add-on / marketing channel. Pure
// functions: caller fetches the data, this file does the math.

import type { BookingRecord, MarketingChannel, Venue } from '@/types';
import { addOns as ADDON_CATALOG, addOnEntryTotal, addOnEntryUnitPrice, addOnPartialPax } from './pricing';

import { venues } from './venues';
import { salesBranchKey, salesBranches } from './bonusBranches';

/** The 分店管理 registry fields the branch roll-up reads. Callers load the
 *  registry (loadAllVenues on the client, loadAllVenuesServer on the
 *  server) and pass it in — this file stays pure. */
export type BranchVenue = Pick<Venue, 'id' | 'name' | 'active' | 'sortOrder' | 'branchKey' | 'branchName'>;

export interface FinanceFilter {
  /** Inclusive YYYY-MM-DD start. Bookings with date < from excluded. */
  from?: string;
  /** Inclusive YYYY-MM-DD end. Bookings with date > to excluded. */
  to?: string;
  /** Restrict to a branch group key (see branchKey). 'all' = all venues.
   *  'sw' = all Sheung Wan variants (sw-a, sw-b, sw-ab) since they share
   *  the same physical flagship; cwb / wanchai / tst are single venues; a
   *  branch added in 分店管理 uses its branchKey (e.g. 'tsthart'). */
  branch?: string;
  /** Preview-host testing only: count 🧪 test bookings too. */
  includeTest?: boolean;
  /** Restrict to a marketing channel. 'all' or omitted = all. */
  channel?: MarketingChannel | 'loyalty_member' | 'all';
}

/**
 * Roll a venueId up to its branch group key used by the finance UI.
 *
 * Same rule as the CS 獎金 page (lib/bonusBranches): the original four keep
 * their keys (cwb / sw / tst / wanchai) so existing month-close records,
 * expenses and saved settings keep matching, and every other venue rolls
 * up to its 分店管理 branchKey — the rooms of a multi-room branch (尖沙咀
 * HART: hart-a / hart-b / hart-ab → 'tsthart') count as ONE branch. It
 * used to know only the `sw-` prefix, which made each HART room its own
 * "branch". A venue the registry does not know keeps its own id.
 */
export function branchKey(venueId: string, registry: readonly BranchVenue[]): string {
  return salesBranchKey(venueId, registry);
}

const LEGACY_GROUP_NAMES: Record<string, { zh: string; en: string }> = {
  sw: { zh: '上環海景旗艦店', en: 'Sheung Wan Flagship' },
  cwb: { zh: '銅鑼灣店', en: 'Causeway Bay' },
  wanchai: { zh: '灣仔店', en: 'Wan Chai' },
  tst: { zh: '尖沙咀店', en: 'Tsim Sha Tsui' },
};

/** Display name for a branch group key: the original four keep their
 *  long-standing finance names, a branch added in 分店管理 shows its
 *  branch name from the registry. */
export function branchGroupName(key: string, registry: readonly BranchVenue[] = []): { zh: string; en: string } {
  if (LEGACY_GROUP_NAMES[key]) return LEGACY_GROUP_NAMES[key];
  if (registry.some((v) => salesBranchKey(v.id, registry) === key)) {
    const hit = salesBranches(registry, [key]).find((b) => b.key === key);
    if (hit) return hit.name;
  }
  // Fall back to the venue catalog name if available.
  const v = venues.find((vn) => vn.id === key);
  return v?.name || { zh: key, en: key };
}

export interface BranchGroup {
  key: string;
  name: { zh: string; en: string };
}

/**
 * The branch groups a finance page lists, in order: the original four,
 * then every branch in 分店管理 with an active (上架) space. `extraKeys`
 * keeps a branch listed although it is offline or gone from the registry
 * — pass the keys that already have data (bookings in range, saved
 * settings) so nothing recorded is ever hidden.
 */
export function financeBranches(registry: readonly BranchVenue[], extraKeys: readonly string[] = []): BranchGroup[] {
  return salesBranches(registry, extraKeys).map((b) => ({ key: b.key, name: branchGroupName(b.key, registry) }));
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
  // Per-person packages staff set for only part of the group (options.pax)
  // are priced on that number — so the money lands in its own column.
  const equiv = addOnPartialPax(entry) ?? (adults + 0.5 * kids);

  // Custom items (admin free-form rows, id `custom-<ts>-<idx>`): the price
  // lives on the entry itself. Without this branch the finance page showed
  // HK$0 for every custom item.
  if (addOnId.startsWith('custom-')) {
    return Math.max(0, Math.floor(entry.options?.customPrice ?? 0));
  }
  // Catering: derived from tier + dishes + delivery + cutlery, same calc
  // as checkout. Was falling through to the default 0.
  // 到會 / 水煙: the total the selection was sold at, else today's prices
  // (pricing.addOnEntryTotal) — a later price change in 附加服務管理 must
  // not move an old booking's money.
  if (addOnId === 'catering') return addOnEntryTotal(entry);
  if (addOnId === 'early-setup') {
    // The per-hour price stamped when it was sold, else the built-in map.
    const perHour = addOnEntryUnitPrice(entry, { id: booking.venueId });
    return perHour * (entry.quantity || 1);
  }

  switch (addOnId) {
    // Unit prices: the one stamped on the entry when it was sold, else
    // today's (pricing.addOnEntryUnitPrice) — a later price change in
    // 附加服務管理 must not move an old booking between columns.
    case 'bbq-standard':
    case 'bbq-premium':
    case 'hotpot-standard':
    case 'hotpot-seafood':
    case 'drinks':
      return Math.round(addOnEntryUnitPrice(entry, { id: booking.venueId }) * equiv);
    case 'bbq-grill': {
      // Grill is waived if a BBQ package is also booked.
      const hasPkg = booking.addOns?.some((a) => a.id === 'bbq-standard' || a.id === 'bbq-premium');
      return hasPkg ? 0 : addOnEntryUnitPrice(entry, { id: booking.venueId }) * entry.quantity;
    }
    case 'hotpot-extra-soup':
      return addOnEntryUnitPrice(entry, { id: booking.venueId }) * entry.quantity;
    case 'shisha':
      return addOnEntryTotal(entry);
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
/**
 * Sales-category breakdown per booking — the columns of Heidi's Sales
 * Record sheet (Rent / BBQ·Hotpot / Shisha / 到會 / Drinks / 加時·罰款).
 * 「BBQ/ Hotpot」 is ONE combined column; 「到會」 is catering only —
 * her Financial Master's exact semantics. Shared by the finance export
 * and the Phase 3 month-close page so the two can never disagree.
 */
export function salesCategoryBreakdown(b: BookingRecord) {
  const rent = b.pricing.baseCharge || 0;
  const shisha = addOnRevenueForBooking(b, 'shisha');
  const bbqHotpot = addOnRevenueForBooking(b, 'bbq-standard')
    + addOnRevenueForBooking(b, 'bbq-premium')
    + addOnRevenueForBooking(b, 'bbq-grill')
    + addOnRevenueForBooking(b, 'hotpot-standard')
    + addOnRevenueForBooking(b, 'hotpot-seafood')
    + addOnRevenueForBooking(b, 'hotpot-extra-soup');
  const cater = addOnRevenueForBooking(b, 'catering');
  const drinks = addOnRevenueForBooking(b, 'drinks');
  // 加時/罰款 = admin-recorded rental top-ups (post-confirmation
  // extensions) + forfeited security deposit (penalties). New payment
  // entries split rentalAmount + addOnAmount; legacy entries lumped both
  // into rentalAmount so addOnAmount may be undefined — sum both.
  const topUpRental = (b.payments || [])
    .reduce((s, p) => s + (p.rentalAmount || 0) + (p.addOnAmount || 0), 0);
  const initialRental = rent + shisha + bbqHotpot + cater + drinks;
  const extensions = Math.max(0, topUpRental - initialRental);
  const refund = b.depositRefund as { deductions?: { amount: number }[] } | undefined;
  const penalty = (refund?.deductions || []).reduce((s, d) => s + (d.amount || 0), 0);
  return { rent, shisha, bbqHotpot, cater, drinks, extPenalty: extensions + penalty };
}

/** One booking's row on the month-close sheet — the Sales columns of
 *  Heidi's Financial Master monthly tab, which always add up to Total. */
export interface MonthCloseSales {
  rent: number;
  bbqHotpot: number;
  shisha: number;
  cater: number;
  drinks: number;
  /** 會員積分 / 優惠碼 — points redeemed and promo-code discount taken
   *  off the bill, together, as a NEGATIVE (Heidi 2026-11-13: one column
   *  for both). A free-drinks promo is NOT here: the drinks it gave away
   *  are simply left out of Drinks, as she books them by hand. */
  pointsPromo: number;
  /** 信用卡手續費 — the card surcharge the customer paid on top. Income:
   *  the gateway's full fee on those payments is an expense (KPay 對帳). */
  cardSurcharge: number;
  /** 加時/罰款 — deposit deductions kept, plus anything on the bill that
   *  is not one of the five columns above (custom items, early set-up). */
  extPenalty: number;
  /** = the sum of the eight columns. */
  total: number;
}

/**
 * Month-close sales of one booking, in her Financial Master's terms
 * (Heidi 2026-11-13: her OCT-2026 CWB sheet reads $66,142.37 where 月結
 * showed $62,999 — the $2,900 of 加時/罰款 and the $243.37 of 信用卡手續費
 * were listed beside the total but never added into it).
 *
 *   Total = bill (pricing.subtotal) + deposit deductions kept
 *           + card surcharge received − points redeemed − promo-code discount
 *
 * `excludedFromEventMonth` is settlement debt not received by month end
 * (settlementDebt.settlementCashTiming): it comes off 加時/罰款 first,
 * where deductions sit, then off rent.
 */
export function monthCloseSales(b: BookingRecord, excludedFromEventMonth = 0): MonthCloseSales {
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const c = salesCategoryBreakdown(b);
  const five = c.rent + c.bbqHotpot + c.shisha + c.cater + c.drinks;
  const refund = b.depositRefund as { deductions?: { amount: number }[] } | undefined;
  const penalty = (refund?.deductions || []).reduce((s, d) => s + (d.amount || 0), 0);
  // The stored bill is the truth; whatever of it the five columns do not
  // explain rides in 加時/罰款 so the row still adds up.
  const other = (b.pricing.subtotal || 0) - five;
  const excluded = Math.max(0, excludedFromEventMonth);
  const fromPenalty = Math.min(penalty, excluded);
  const rentCut = Math.min(c.rent, excluded - fromPenalty);
  const rent = c.rent - rentCut;
  const extPenalty = other + penalty - fromPenalty;
  // Free-drinks promo (marked by promoFreeDrinksCost): she does not enter
  // the drinks at all rather than booking them and discounting them back.
  // Whatever the code discounts beyond the drinks (a combined % + free
  // drinks code) still goes to the promo column.
  const promo = b.promoDiscount || 0;
  const freeDrinks = (b.promoFreeDrinksCost || 0) > 0 ? Math.min(c.drinks, promo) : 0;
  const drinks = c.drinks - freeDrinks;
  const pointsPromo = 0 - ((b.pointsDiscount || 0) + promo - freeDrinks); // 0 − x, never −0
  const cardSurcharge = (b.payments || []).reduce((s, p) => s + (p.cardSurcharge || 0), 0);
  const out = {
    rent: r2(rent), bbqHotpot: r2(c.bbqHotpot), shisha: r2(c.shisha), cater: r2(c.cater), drinks: r2(drinks),
    pointsPromo: r2(pointsPromo), cardSurcharge: r2(cardSurcharge), extPenalty: r2(extPenalty),
  };
  return {
    ...out,
    total: r2(out.rent + out.bbqHotpot + out.shisha + out.cater + out.drinks + out.pointsPromo + out.cardSurcharge + out.extPenalty),
  };
}

export function countsForFinance(b: BookingRecord, opts?: { includeTest?: boolean }): boolean {
  if (b.status === 'cancelled' || b.status === 'pending' || b.status === 'payment_not_completed') return false;
  // Preview deployments auto-stamp every booking isTest, so the TEST
  // SITE's finance pages opt in to seeing them (with a banner) —
  // otherwise nothing Heidi creates while testing would ever appear
  // (#percQzxr: broker booking showed no commission). Production never
  // passes includeTest.
  if (b.isTest && !opts?.includeTest) return false;
  const paid = (b.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
  const paidStatus = b.status === 'confirmed' || b.status === 'completed' || !!b.paymentVerifiedAt;
  if (paid <= 0 && !paidStatus) return false;
  return true;
}

export function aggregateBookings(
  bookings: BookingRecord[],
  filter: FinanceFilter,
  /** Venue registry (分店管理) — decides which branch each booking rolls up to. */
  registry: readonly BranchVenue[],
): AggregateResult {
  // Filter pass.
  const filtered = bookings.filter((b) => {
    if (!countsForFinance(b, { includeTest: filter.includeTest })) return false;
    if (filter.from && b.date < filter.from) return false;
    if (filter.to && b.date > filter.to) return false;
    if (filter.branch && filter.branch !== 'all') {
      // Branch filter rolls the rooms of one branch together.
      if (branchKey(b.venueId, registry) !== filter.branch) return false;
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

    // Branch bucket — the rooms of one branch (上環 Room A / B / A+B,
    // HART Room A / B / A+B) all roll up to one group.
    const bKey = branchKey(b.venueId, registry);
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
      branchName: branchGroupName(id, registry),
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
