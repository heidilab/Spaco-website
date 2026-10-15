import { describe, expect, it } from 'vitest';
import { canReplaceKpayOrder } from './kpayOrderLifecycle';
const expected = {managedOrderNo:'one',managedOutTradeNo:'trade',chargeTotal:2030};
const data = {...expected, payAmount:2030,payCurrency:'HKD',managedOrderState:3,paymentOrderList:[]};
describe('KPay terminal unpaid order proof', () => {
  it.each([3,5])('permits explicit terminal state %s', state => expect(canReplaceKpayOrder({ok:true,data:{...data,managedOrderState:state}},expected)).toBe(true));
  it.each([1,2,4,0,99,'3',undefined])('rejects other state %s', state => expect(canReplaceKpayOrder({ok:true,data:{...data,managedOrderState:state}},expected)).toBe(false));
  it('requires matching identity, amount, currency and a successful lookup', () => {
    for (const patch of [{managedOrderNo:'other'},{managedOutTradeNo:'other'},{payAmount:1},{payCurrency:'USD'},{transactionNo:'paid'},{paymentOrderList:{}}]) expect(canReplaceKpayOrder({ok:true,data:{...data,...patch}},expected)).toBe(false);
    expect(canReplaceKpayOrder({ok:false,data},expected)).toBe(false);
  });
  it('rejects success, pending, refunded and unknown attempts even on a closed order', () => {
    for(const p of [{result:2,orderState:2},{result:1,orderState:1},{result:4,orderState:3},{result:99,orderState:3}]) expect(canReplaceKpayOrder({ok:true,data:{...data,paymentOrderList:[p]}},expected)).toBe(false);
  });
  it('allows only terminal failed/cancelled attempts', () => {
    expect(canReplaceKpayOrder({ok:true,data:{...data,paymentOrderList:[{result:3,orderState:3},{result:5,orderState:3}]}},expected)).toBe(true);
  });
});
