/**
 * Post-event settlement debt (結算後欠款) — Heidi 2026-10-18.
 *
 * When deposit settlement deductions exceed what the customer has on
 * credit, settlement writes the shortfall to `balanceDue` and leaves the
 * booking 'confirmed'. Until it is paid:
 *   - the customer sees a warning on login and cannot place new bookings;
 *   - reminder emails go out 14 and 30 days after settlement (then stop);
 *   - month close counts only money actually received by the end of the
 *     event month; anything received later is income of the month it
 *     arrives, tagged with the original booking.
 * There is NO permanent ban: paying online, or staff recording the payment,
 * lifts the block automatically because every check below is derived live
 * from the booking, never from a stored flag.
 *
 * PURE module (no firebase) so client pages, server routes and the cron
 * share one definition.
 */
import { amountOwed, type MoneyBooking } from './bookingMoney';

const DAY_MS = 24 * 60 * 60 * 1000;
const HKT_OFFSET_MS = 8 * 60 * 60 * 1000;

export interface DebtBooking extends MoneyBooking {
  id: string;
  status?: string;
  date: string;
  venueId?: string;
  branchSlug?: string;
  userId?: string | null;
  isTest?: boolean;
  depositRefund?: unknown;
  payments?: Array<{ amount?: number; cardSurcharge?: number; recordedAt?: unknown }>;
  settlementDebtReminder14SentAt?: unknown;
  settlementDebtReminder30SentAt?: unknown;
}

/** Milliseconds from a Firestore Timestamp (admin or client), a serialised
 *  {seconds}/{_seconds}, an ISO string or a number. */
export function toMillis(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') { const ms = Date.parse(value); return Number.isFinite(ms) ? ms : null; }
  const v = value as { toMillis?: () => number; seconds?: number; _seconds?: number };
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  if (typeof v._seconds === 'number') return v._seconds * 1000;
  return null;
}

/** `YYYY-MM` of an instant in Hong Kong time. */
export function hktMonth(ms: number): string {
  return new Date(ms + HKT_OFFSET_MS).toISOString().slice(0, 7);
}

/** When the deposit settlement was recorded, or null if not settled. */
export function settledAtMs(b: Pick<DebtBooking, 'depositRefund'>): number | null {
  const r = b.depositRefund as { refundedAt?: unknown } | null | undefined;
  return r ? toMillis(r.refundedAt) : null;
}

/** Test bookings count only when `includeTest` (preview site); production
 *  ignores them so a preview test can never block a real account. */
export interface DebtOptions { includeTest?: boolean }

/** Amount still owed AFTER settlement (0 when none). Cancelled bookings
 *  never count. */
export function settlementDebt(b: DebtBooking, opts: DebtOptions = {}): number {
  if (!b.depositRefund || (b.isTest && !opts.includeTest)) return 0;
  if (b.status !== 'confirmed' && b.status !== 'completed') return 0;
  const owed = amountOwed(b);
  return owed > 0.004 ? Math.round(owed * 100) / 100 : 0;
}

export interface OutstandingDebt {
  bookingId: string;
  date: string;
  venueId?: string;
  branchSlug?: string;
  amount: number;
  settledAt: number | null;
}

/** Every unpaid settlement debt among a customer's bookings. Any entry
 *  blocks new bookings. */
export function outstandingDebts(bookings: DebtBooking[], opts: DebtOptions = {}): OutstandingDebt[] {
  return bookings
    .map((b) => ({ b, amount: settlementDebt(b, opts) }))
    .filter(({ amount }) => amount > 0)
    .map(({ b, amount }) => ({
      bookingId: b.id, date: b.date, venueId: b.venueId, branchSlug: b.branchSlug,
      amount, settledAt: settledAtMs(b),
    }));
}

/** Which reminder email is due now: 14, 30 or null. Each goes out once; a
 *  debt first seen after day 30 gets only the day-30 email. */
export function debtReminderStage(b: DebtBooking, nowMs: number, opts: DebtOptions = {}): 14 | 30 | null {
  if (settlementDebt(b, opts) <= 0) return null;
  const settled = settledAtMs(b);
  if (settled == null) return null;
  const days = Math.floor((nowMs - settled) / DAY_MS);
  if (days >= 30 && !b.settlementDebtReminder30SentAt) return 30;
  if (days >= 14 && !b.settlementDebtReminder14SentAt && !b.settlementDebtReminder30SentAt) return 14;
  return null;
}

export interface SettlementCashTiming {
  /** Amount NOT recognised in the event month: still owed now, plus
   *  post-settlement payments received after the event month ended. */
  excludedFromEventMonth: number;
  /** Post-settlement payments received in a later month, by month. */
  late: Array<{ month: string; amount: number }>;
}

/**
 * Month-close timing (收到先計). Payments recorded after settlement but
 * still inside the event month are ordinary event-month revenue; later
 * ones belong to the month they arrived. Admin-recorded offline payments
 * carry the actual paid date in `recordedAt`.
 */
export function settlementCashTiming(b: DebtBooking, opts: DebtOptions = {}): SettlementCashTiming {
  const settled = settledAtMs(b);
  if (settled == null || (b.isTest && !opts.includeTest)) return { excludedFromEventMonth: 0, late: [] };
  const eventMonth = b.date.slice(0, 7);
  const byMonth = new Map<string, number>();
  for (const p of b.payments || []) {
    const amount = p.amount || 0;
    if (amount <= 0) continue;
    const ms = toMillis(p.recordedAt);
    if (ms == null || ms < settled) continue;
    const month = hktMonth(ms);
    if (month > eventMonth) byMonth.set(month, (byMonth.get(month) || 0) + amount);
  }
  const late = Array.from(byMonth.entries()).sort(([a], [b2]) => a.localeCompare(b2)).map(([month, amount]) => ({ month, amount }));
  const lateSum = late.reduce((s, l) => s + l.amount, 0);
  return { excludedFromEventMonth: Math.round((settlementDebt(b, opts) + lateSum) * 100) / 100, late };
}
