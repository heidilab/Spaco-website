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
  // An explicit terminal managed order is required. Any contradictory or
  // unfamiliar payment attempt blocks replacement, including pending payments.
  if (d.transactionNo) return false;
  if (d.paymentOrderList === undefined) return true;
  if (!Array.isArray(d.paymentOrderList)) return false;
  return d.paymentOrderList.every(p => p && typeof p === 'object'
    && [3, 5, 6].includes(p.result) && p.orderState === 3);
}
