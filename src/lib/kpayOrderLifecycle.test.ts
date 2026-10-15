import { describe, expect, it } from 'vitest';
import { canReplaceKpayOrder, decideKpayOrderReuse, describeKpayAttempts, KPAY_CODE_ORDER_EXPIRED } from './kpayOrderLifecycle';
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
  it('allows a failed/cancelled/closed attempt whatever its orderState (r0qUQ2io 2026-10-15)', () => {
    for (const p of [{result:3,orderState:2},{result:5,orderState:2},{result:6,orderState:1},{result:3,orderState:1}]) {
      expect(canReplaceKpayOrder({ok:true,data:{...data,paymentOrderList:[p]}},expected)).toBe(true);
    }
  });
  it('still blocks a successful, refunded or unknown attempt even at orderState 3', () => {
    for (const p of [{result:2,orderState:3},{result:4,orderState:3},{result:undefined,orderState:3},{result:'1',orderState:3}]) {
      expect(canReplaceKpayOrder({ok:true,data:{...data,paymentOrderList:[p]}},expected)).toBe(false);
    }
  });
  it('allows a pending attempt only once KPay has closed its transaction order (r0qUQ2io 1/3)', () => {
    expect(canReplaceKpayOrder({ok:true,data:{...data,paymentOrderList:[{result:1,orderState:3}]}},expected)).toBe(true);
    for (const p of [{result:1,orderState:1},{result:1,orderState:2},{result:1,orderState:undefined},{result:1,orderState:'3'}]) {
      expect(canReplaceKpayOrder({ok:true,data:{...data,paymentOrderList:[p]}},expected)).toBe(false);
    }
    expect(decideKpayOrderReuse({ok:true,data:{...data,paymentOrderList:[{result:1,orderState:3}]}},expected)).toBe('replace');
    expect(decideKpayOrderReuse({ok:true,data:{...data,paymentOrderList:[{result:1,orderState:2}]}},expected)).toBe('blocked');
  });
  it('describes attempts for logs without account data', () => {
    expect(describeKpayAttempts({paymentOrderList:[{result:3,orderState:2,transactionAccount:'secret'}]})).toEqual(['3/2']);
    expect(describeKpayAttempts({})).toBeUndefined();
  });
});

describe('KPay prior-order reuse decision (2026-10-15 「該訂單已完結」)', () => {
  it('re-signs an order the gateway still reports awaiting payment', () => {
    expect(decideKpayOrderReuse({ok:true,data:{...data,managedOrderState:1,paymentOrderList:undefined}},expected)).toBe('reuse');
  });
  it.each([3,5])('replaces a verified dead unpaid order in state %s', state => {
    expect(decideKpayOrderReuse({ok:true,data:{...data,managedOrderState:state}},expected)).toBe('replace');
  });
  it('replaces when the gateway itself answers 30004 訂單已過期', () => {
    expect(decideKpayOrderReuse({ok:false,code:KPAY_CODE_ORDER_EXPIRED},expected)).toBe('replace');
  });
  it.each([30002,30003,40002,undefined])('blocks on any other failed lookup (%s)', code => {
    expect(decideKpayOrderReuse({ok:false,code},expected)).toBe('blocked');
  });
  it.each([2,4,0,99,'1',undefined])('blocks paid, refunded and unknown state %s', state => {
    expect(decideKpayOrderReuse({ok:true,data:{...data,managedOrderState:state}},expected)).toBe('blocked');
  });
  it('blocks when identity or amount does not match our lock, even if awaiting payment', () => {
    for (const patch of [{managedOrderNo:'other'},{managedOutTradeNo:'other'},{payAmount:2000},{payCurrency:'USD'}]) {
      expect(decideKpayOrderReuse({ok:true,data:{...data,...patch,managedOrderState:1}},expected)).toBe('blocked');
    }
    expect(decideKpayOrderReuse({ok:true},expected)).toBe('blocked');
  });
  it('never replaces an expired order that carries a successful or pending attempt', () => {
    for (const p of [{result:2,orderState:2},{result:1,orderState:1}]) {
      expect(decideKpayOrderReuse({ok:true,data:{...data,paymentOrderList:[p]}},expected)).toBe('blocked');
    }
  });
});
