/**
 * SINGLE SOURCE OF TRUTH for every booking money rule.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * These formulas used to be re-typed inline in each page. The canonical
 * ones lived in finalizeBooking.ts, which imports firebase-admin, so
 * client pages physically could not import them and re-implemented them
 * by hand instead. Every copy then drifted independently, which is the
 * direct cause of a long run of production incidents:
 *
 *   #WIiQYL2I  duplicate/overstated payments
 *   #jMW2skDl  promo not rescaled when pax changed
 *   #hlJJh9K5  paidSoFar derived from stale balance, compounding errors
 *   #AZAyNn7d1r  completed booking with a balance and no pay button
 *   #2qzYQOU4  no way to record an offline payment (card keyed on balanceDue)
 *   #2p8F1WEp  per_pax promo frozen at the old pax count
 *   #LSi5Z31A  settlement overflow hidden (card keyed on unpaidTotal)
 *
 * RULES FOR CHANGING THIS FILE
 *   1. This module must stay PURE — no firebase, no network, no Date.now
 *      dependence in the exported math. That is what keeps it importable
 *      from both client components and server routes, and testable.
 *   2. Every exported function has regression tests in bookingMoney.test.ts
 *      named after the incident it prevents. `npm test` runs in the build.
 *      If you change a rule, a test must change with it — deliberately.
 *   3. Never re-implement any of these formulas inline somewhere else.
 *      Import from here instead.
 */

/** 100 loyalty points = HK$1. */
export const POINTS_PER_HKD = 100;

/**
 * Convert a loyalty-point balance to its HK$ redemption value.
 * FLOORED — redemption is in whole dollars, so 1,550 pts redeems $15,
 * not $15.50. Do not "fix" this to round: the confirm page caps the
 * redemption slider with it, and rounding up would let a customer redeem
 * more than they hold.
 */
export function pointsToHkd(points: number): number {
  return Math.floor((points || 0) / POINTS_PER_HKD);
}

/** Convert HK$ to the number of points required. */
export function hkdToPoints(hkd: number): number {
  return Math.max(0, Math.floor(hkd || 0) * POINTS_PER_HKD);
}

// ── Shapes ─────────────────────────────────────────────────────────────
// Structural (not the full BookingRecord) so these work on partial data
// such as a checkout draft or an admin preview.

export interface MoneyPricing {
  baseCharge?: number;
  addOnTotal?: number;
  /** GROSS, pre-promo. Stored convention since the 2026-07 unification. */
  subtotal?: number;
  securityDeposit?: number;
  deposit?: number;
}

export interface MoneyBooking {
  pricing?: MoneyPricing;
  promoDiscount?: number;
  pointsDiscount?: number;
  balanceDue?: number;
  payments?: Array<{ amount?: number; cardSurcharge?: number }>;
  depositRefund?: unknown;
}

// ── Core totals ────────────────────────────────────────────────────────

/**
 * GROSS consumption subtotal, pre-promo: venue rental + add-ons.
 * Invariant: `pricing.subtotal === grossSubtotal(pricing)`.
 */
export function grossSubtotal(pricing?: MoneyPricing): number {
  return (pricing?.baseCharge || 0) + (pricing?.addOnTotal || 0);
}

/**
 * CANONICAL grand total — what the customer owes in money terms, with
 * BOTH promo and points already deducted, plus the refundable deposit.
 *
 * Use for balance math (what is still owed / has been paid). For the
 * customer-facing 總計 line use `displayBillTotal`, which deliberately
 * excludes points so they can be shown as a separate redemption row.
 */
export function computeGrandTotal(booking: MoneyBooking): number {
  return netConsumption(booking) + (booking.pricing?.securityDeposit || 0);
}

/**
 * Consumption net of both discounts, EXCLUDING the refundable deposit.
 *
 * This is the loyalty-earning basis: points are credited on what the
 * customer actually spent on the venue and add-ons, plus separately any
 * deposit that was forfeited as a deduction. Keep it distinct from
 * computeGrandTotal — mixing the two would credit points for a deposit
 * that gets refunded.
 */
export function netConsumption(booking: MoneyBooking): number {
  return Math.max(
    0,
    grossSubtotal(booking.pricing)
      - (booking.promoDiscount || 0)
      - (booking.pointsDiscount || 0),
  );
}

/**
 * 小計 as displayed to people: AFTER the promo discount. Heidi's spec
 * (#nbWTrtyG): a 小計 line that sits below a −優惠碼 line must already
 * reflect the deduction — 場租 + 加購 − 優惠 = 小計. Takes the raw
 * numbers (not a booking) because email templates receive flat params.
 */
export function discountedSubtotal(grossSubtotal: number, promoDiscount?: number): number {
  return Math.max(0, (grossSubtotal || 0) - (promoDiscount || 0));
}

/**
 * Customer-facing 總計 — the full bill BEFORE points, matching the
 * payment page. Points are a redemption shown on their own line next to
 * cash paid, NOT folded into the total.
 *
 * Folding points in here made my-bookings read 總計 $1,900 / 已付 $3,400
 * on a points-redeemed booking, so the two looked swapped.
 */
export function displayBillTotal(booking: MoneyBooking): number {
  return (
    Math.max(0, grossSubtotal(booking.pricing) - (booking.promoDiscount || 0))
    + (booking.pricing?.securityDeposit || 0)
  );
}

// ── Payments ───────────────────────────────────────────────────────────

/**
 * Sum CREDITED to the booking. Excludes the card surcharge, which is a
 * pass-through of KPay's fee and never counts against the bill.
 * payments[] is the single source of truth for what has been paid — never
 * derive "paid" from (grandTotal − balanceDue), which compounds old
 * errors into new saves (#hlJJh9K5).
 */
export function paidBase(booking: MoneyBooking): number {
  return (booking.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
}

/** Total 1.5% card surcharge the customer paid on top of the bill. */
export function surchargePaid(booking: MoneyBooking): number {
  return (booking.payments || []).reduce((s, p) => s + (p.cardSurcharge || 0), 0);
}

/**
 * What the KPay / FPS gateway actually took from the customer — base plus
 * card surcharge. This is the figure that reconciles against their card
 * statement, so it is what 已付 must show them.
 */
export function paidGateway(booking: MoneyBooking): number {
  return Math.round((paidBase(booking) + surchargePaid(booking)) * 100) / 100;
}

/** Canonical balance still owed on the bill: grand total − credited payments. */
export function computeBalanceDue(booking: MoneyBooking): number {
  return Math.max(0, computeGrandTotal(booking) - paidBase(booking));
}

// ── What admin must chase ──────────────────────────────────────────────

/**
 * The amount admin should collect, and the gate for showing the
 * outstanding-balance card (with its record-payment button and pay link).
 *
 * A booking can owe money in TWO INDEPENDENT ways, and the card must
 * appear for either:
 *
 *   1. The bill is not fully paid — a new or partially-paid booking.
 *      Captured by computeBalanceDue. An unpaid FPS booking has
 *      `balanceDue === 0` stored (that field is the balance AFTER the
 *      deposit, and nothing was recorded yet), so keying on the stored
 *      field alone hid the card entirely — #2qzYQOU4.
 *
 *   2. A charge was raised AFTER the bill was fully paid — deposit
 *      settlement overflow, or an admin add-on top-up. Settlement writes
 *      the excess to `balanceDue` while the original bill is settled, so
 *      computeBalanceDue is 0 and keying on it alone hid the card —
 *      #LSi5Z31A ($650 owed, nowhere to record it).
 *
 * Taking the max covers both. Do not narrow this to one term again.
 */
export function amountOwed(booking: MoneyBooking): number {
  return Math.max(computeBalanceDue(booking), booking.balanceDue ?? 0);
}

/** True when the outstanding-balance card should be shown. */
export function hasOutstanding(booking: MoneyBooking): boolean {
  return amountOwed(booking) > 0;
}

/**
 * True when the money owed came from settling the deposit (deductions
 * exceeded it) rather than from an unpaid bill — the card explains the
 * charge differently in that case.
 */
export function isSettlementOverflow(booking: MoneyBooking): boolean {
  return (
    computeBalanceDue(booking) <= 0
    && (booking.balanceDue ?? 0) > 0
    && !!booking.depositRefund
  );
}
