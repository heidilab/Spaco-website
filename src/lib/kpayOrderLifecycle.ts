/** KPay managed-order states: 1 awaiting payment, 2 paid, 3 expired,
 * 4 refunded, 5 closed. Payment results: 1 pending, 2 success, 3 failed,
 * 4 refunded, 5 cancelled, 6 closed; order states: 1 processing, 2 placed, 3 closed.
 * Never infer non-payment from age, a missing webhook, or a failed query.
 */
export function canReplaceKpayOrder(
  result: { ok: boolean; data?: Record<string, unknown> },
  expected: { managedOrderNo: string; managedOutTradeNo: string; chargeTotal: number },
): boolean {
  const d = result.data;
  if (!result.ok || !d || d.managedOrderNo !== expected.managedOrderNo
    || d.managedOutTradeNo !== expected.managedOutTradeNo || d.payCurrency !== 'HKD'
    || typeof d.payAmount !== 'number' || Math.abs(d.payAmount - expected.chargeTotal) > 0.005
    || ![3, 5].includes(d.managedOrderState as number)) return false;
  // An explicit terminal managed order is required. Any attempt that may
  // have moved money blocks replacement: pending (1), success (2),
  // refunded (4) or an unfamiliar result. A failed (3), cancelled (5) or
  // closed (6) attempt took nothing, whatever its orderState: KPay keeps
  // a declined card attempt at orderState 2 下單成功, and requiring
  // orderState 3 stranded booking r0qUQ2io on 2026-10-15 (state 3,
  // one failed attempt, decision blocked).
  if (d.transactionNo) return false;
  if (d.paymentOrderList === undefined) return true;
  if (!Array.isArray(d.paymentOrderList)) return false;
  return d.paymentOrderList.every(p => p && typeof p === 'object'
    && [3, 5, 6].includes(p.result));
}

/** Compact "result/orderState" list for operational logs (no account data). */
export function describeKpayAttempts(data?: Record<string, unknown>): string[] | undefined {
  const list = data?.paymentOrderList;
  if (!Array.isArray(list)) return undefined;
  return list.map(p => p && typeof p === 'object' ? `${p.result}/${p.orderState}` : String(p));
}

/** KPay application code returned by the result query when the managed
 *  order has lapsed (status_code.md: 30004 訂單已過期). The gateway can
 *  no longer collect on it, so a replacement cannot double-charge. */
export const KPAY_CODE_ORDER_EXPIRED = 30004;

export type KpayOrderReuseDecision = 'reuse' | 'replace' | 'blocked';

/**
 * What checkout may do with a previously created managed order whose
 * cashier the customer is reopening.
 *
 *   reuse    — still awaiting payment (state 1): re-sign the same order.
 *   replace  — gateway says the order is dead and nothing was collected:
 *              create a new order; keep the old mapping for late callbacks.
 *   blocked  — paid, refunded, unknown, mismatched or unreadable: never
 *              open another charge; staff must reconcile.
 *
 * A managed order is NOT payable forever (the cashier runs an expiry
 * countdown), so 'reuse' alone strands every customer who comes back
 * later with the gateway's 「該訂單已完結」 page — the 2026-10-15 balance
 * incident. The replacement decision must come from the gateway, never
 * from the age of our own lock.
 */
export function decideKpayOrderReuse(
  result: { ok: boolean; code?: number; data?: Record<string, unknown> },
  expected: { managedOrderNo: string; managedOutTradeNo: string; chargeTotal: number },
): KpayOrderReuseDecision {
  if (!result.ok) return result.code === KPAY_CODE_ORDER_EXPIRED ? 'replace' : 'blocked';
  const d = result.data;
  if (!d || d.managedOrderNo !== expected.managedOrderNo
    || d.managedOutTradeNo !== expected.managedOutTradeNo || d.payCurrency !== 'HKD'
    || typeof d.payAmount !== 'number' || Math.abs(d.payAmount - expected.chargeTotal) > 0.005) return 'blocked';
  if (d.managedOrderState === 1) return 'reuse';
  return canReplaceKpayOrder(result, expected) ? 'replace' : 'blocked';
}
