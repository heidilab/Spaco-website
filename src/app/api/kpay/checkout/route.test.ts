import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(()=>({ verify: vi.fn(), transaction: vi.fn(), create: vi.fn(), update: vi.fn(), set: vi.fn(), gateway: vi.fn(), query: vi.fn(), sign: vi.fn(), lock: undefined as Record<string,unknown> | undefined, data: {} as Record<string,unknown> }));
vi.mock('@/lib/adminAuth',()=>({adminVerifyIdToken:mocks.verify}));
vi.mock('@/lib/firebaseAdmin',()=>({adminDb:{ collection:(name:string)=>({doc:(id:string)=>({name,id,update:mocks.update,get:async()=>name==='bookings'?{exists:true,data:()=>mocks.data}:{exists:!!mocks.lock,data:()=>mocks.lock}})}),runTransaction:mocks.transaction }}));
vi.mock('@/lib/kpay',()=>({isKpayConfigured:()=>true,createManagedOrder:mocks.gateway,queryManagedOrder:mocks.query,buildCashierRedirectUrl:mocks.sign,getPublicOrigin:()=> 'https://spaco.test'}));
import { POST } from './route';
const request = (body:unknown, token='valid') => new NextRequest('https://spaco.test/api/kpay/checkout',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
beforeEach(()=>{
  vi.clearAllMocks();
  mocks.lock = undefined;
  mocks.query.mockImplementation(async()=>({ok:true,data:{managedOrderState:1,managedOrderNo:mocks.lock?.managedOrderNo,managedOutTradeNo:mocks.lock?.managedOutTradeNo,payAmount:mocks.lock?.chargeTotal,payCurrency:'HKD'}}));
  mocks.sign.mockReturnValue('https://cashier.test/fresh');
  mocks.verify.mockResolvedValue({uid:'alice'});
  mocks.data={userId:'alice',status:'awaiting_payment',pricing:{deposit:5000},pointsDiscount:0,payments:[]};
  mocks.transaction.mockImplementation(async fn=>fn({get:async(ref:{name:string})=>ref.name==='bookings'?{exists:true,data:()=>mocks.data}:{exists:!!mocks.lock,data:()=>mocks.lock},create:mocks.create,set:mocks.set}));
  mocks.gateway.mockResolvedValue({ok:true,managedOrderNo:'managed'});
});
describe('KPay authenticated, authoritative checkout',()=>{
  it('rejects missing or invalid tokens before creating an order',async()=>{
    expect((await POST(request({},''))).status).toBe(401);
    mocks.verify.mockRejectedValue(new Error('bad'));
    expect((await POST(request({}))).status).toBe(401);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('rejects another customer booking',async()=>{
    mocks.data.userId='bob';
    expect((await POST(request({bookingId:'one',amount:5000,methodGroup:'wallet'}))).status).toBe(403);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('rejects tampered amount instead of charging it',async()=>{
    const res=await POST(request({bookingId:'one',amount:1,methodGroup:'card'}));
    expect(res.status).toBe(409);expect((await res.json()).error).toBe('PRICE_CHANGED');
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('requires an explicit supported method group',async()=>{
    expect((await POST(request({bookingId:'one',amount:5000}))).status).toBe(400);
  });
  it('creates the correct card charge and persists the order',async()=>{
    const res=await POST(request({bookingId:'one',amount:5000,methodGroup:'card'}));
    expect(res.status).toBe(200);expect((await res.json()).chargeTotal).toBe(5075);
    expect(mocks.gateway).toHaveBeenCalledWith(expect.objectContaining({payAmount:5075}));
    expect(mocks.set).toHaveBeenCalled();
  });
});

describe('cashier link retries', () => {
  it('re-signs the same balance order on every retry without creating another charge', async () => {
    mocks.data = { userId: 'alice', status: 'confirmed', balanceDue: 2000,
      pricing: { subtotal: 3000, securityDeposit: 1000, deposit: 2000 }, payments: [{ amount: 2000 }] };
    mocks.lock = { paidBase: 2000, amount: 2000, methodGroup: 'card', managedOrderNo: 'same-order',
      managedOutTradeNo: 'same-trade', sessionUrl: 'https://cashier.test/expired', baseAmount: 2000, surcharge: 30, chargeTotal: 2030 };
    const body = { bookingId: 'one', amount: 2000, methodGroup: 'card', isBalancePayment: true };
    for (const suffix of ['first', 'second']) {
      mocks.sign.mockReturnValueOnce(`https://cashier.test/${suffix}`);
      const response = await POST(request(body));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ sessionUrl: `https://cashier.test/${suffix}`, managedOrderNo: 'same-order', managedOutTradeNo: 'same-trade', baseAmount: 2000, surcharge: 30, chargeTotal: 2030 });
    }
    expect(mocks.sign).toHaveBeenCalledTimes(2);
    expect(mocks.sign).toHaveBeenCalledWith({ managedOrderNo: 'same-order' });
    expect(mocks.gateway).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('keeps an unresolved creation locked instead of creating another charge', async () => {
    mocks.lock = { paidBase: 0, amount: 5000, methodGroup: 'card', status: 'creating' };
    const response = await POST(request({ bookingId: 'one', amount: 5000, methodGroup: 'card' }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe('PAYMENT_PROCESSING');
    expect(mocks.gateway).not.toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();
  });
});

describe('closed balance order recovery', () => {
  const body = { bookingId: 'one', amount: 2000, methodGroup: 'card', isBalancePayment: true };
  beforeEach(() => {
    mocks.data = { userId: 'alice', status: 'confirmed', balanceDue: 2000, pricing: { subtotal: 3000, securityDeposit: 1000, deposit: 2000 }, payments: [{ amount: 2000 }] };
    mocks.lock = { paidBase: 2000, amount: 2000, methodGroup: 'card', managedOrderNo: 'old-order', managedOutTradeNo: 'old-trade', surcharge: 30, chargeTotal: 2030 };
    mocks.query.mockResolvedValue({ok:true,data:{managedOrderNo:'old-order',managedOutTradeNo:'old-trade',managedOrderState:3,payAmount:2030,payCurrency:'HKD',paymentOrderList:[]}});
  });
  it('replaces a verified expired unpaid order and keeps its mapping for late callbacks', async () => {
    const res = await POST(request(body));
    expect(res.status).toBe(200);
    expect(mocks.gateway).toHaveBeenCalledOnce();
    expect(mocks.gateway).toHaveBeenCalledWith(expect.objectContaining({payAmount:2030}));
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({name:'_kpay_orders',id:'old-trade'}),expect.objectContaining({replacedBy:expect.any(String)}),{merge:true});
  });
  it.each([2,4,99])('blocks replacement for paid/refunded/unknown state %s', async state => {
    mocks.query.mockResolvedValue({ok:true,data:{managedOrderState:state}});
    expect((await POST(request(body))).status).toBe(409);
    expect(mocks.gateway).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it('fails closed when gateway status is unavailable', async () => {
    mocks.query.mockRejectedValue(new Error('timeout'));
    const res = await POST(request(body));
    expect((await res.json()).error).toBe('PAYMENT_STATUS_UNAVAILABLE');
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('does not replace a lock another checkout has already reserved', async () => {
    mocks.query.mockImplementation(async () => {
      mocks.lock = {...mocks.lock, managedOrderNo:undefined,managedOutTradeNo:'new-trade',status:'creating'};
      return {ok:true,data:{managedOrderNo:'old-order',managedOutTradeNo:'old-trade',managedOrderState:3,payAmount:2030,payCurrency:'HKD',paymentOrderList:[]}};
    });
    expect((await POST(request(body))).status).toBe(409);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('replaces an expired order whose only attempt failed at orderState 2 (production r0qUQ2io case)', async () => {
    mocks.query.mockResolvedValue({ok:true,data:{managedOrderNo:'old-order',managedOutTradeNo:'old-trade',managedOrderState:3,payAmount:2030,payCurrency:'HKD',paymentOrderList:[{outTradeNo:'x',orderNo:'y',result:3,orderState:2}]}});
    const res = await POST(request(body));
    expect(res.status).toBe(200);
    expect(mocks.gateway).toHaveBeenCalledOnce();
  });
  it('replaces when the gateway answers 30004 訂單已過期 instead of a result body', async () => {
    mocks.query.mockResolvedValue({ ok: false, code: 30004, message: '訂單已過期' });
    const res = await POST(request(body));
    expect(res.status).toBe(200);
    expect(mocks.gateway).toHaveBeenCalledOnce();
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ name: '_kpay_orders', id: 'old-trade' }), expect.objectContaining({ replacedBy: expect.any(String) }), { merge: true });
  });
  it('still blocks on 30002 訂單不存在 (wrong credentials or unknown order)', async () => {
    mocks.query.mockResolvedValue({ ok: false, code: 30002, message: '訂單不存在' });
    const res = await POST(request(body));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('PAYMENT_STATUS_UNAVAILABLE');
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('lets the customer switch card → wallet once the old card order is dead', async () => {
    const res = await POST(request({ ...body, methodGroup: 'wallet' }));
    expect(res.status).toBe(200);
    expect(mocks.gateway).toHaveBeenCalledWith(expect.objectContaining({ payAmount: 2000 }));
  });
  it('derives the expected gateway charge for a legacy lock without chargeTotal', async () => {
    mocks.lock = { paidBase: 2000, amount: 2000, methodGroup: 'card', managedOrderNo: 'old-order', managedOutTradeNo: 'old-trade' };
    const res = await POST(request(body));
    expect(res.status).toBe(200);
    expect(mocks.gateway).toHaveBeenCalledOnce();
  });
});

describe('closed deposit order recovery', () => {
  const body = { bookingId: 'one', amount: 5000, methodGroup: 'card' };
  beforeEach(() => {
    mocks.lock = { paidBase: 0, amount: 5000, methodGroup: 'card', managedOrderNo: 'old-order', managedOutTradeNo: 'old-trade', surcharge: 75, chargeTotal: 5075 };
  });
  it('re-signs the deposit order while KPay still reports it awaiting payment', async () => {
    mocks.query.mockResolvedValue({ ok: true, data: { managedOrderNo: 'old-order', managedOutTradeNo: 'old-trade', managedOrderState: 1, payAmount: 5075, payCurrency: 'HKD' } });
    const res = await POST(request(body));
    expect(res.status).toBe(200);
    expect((await res.json()).managedOrderNo).toBe('old-order');
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('replaces an expired unpaid deposit order within the booking hold', async () => {
    mocks.query.mockResolvedValue({ ok: true, data: { managedOrderNo: 'old-order', managedOutTradeNo: 'old-trade', managedOrderState: 3, payAmount: 5075, payCurrency: 'HKD', paymentOrderList: [] } });
    const res = await POST(request(body));
    expect(res.status).toBe(200);
    expect(mocks.gateway).toHaveBeenCalledWith(expect.objectContaining({ payAmount: 5075 }));
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ name: '_kpay_orders', id: 'old-trade' }), expect.objectContaining({ replacedBy: expect.any(String) }), { merge: true });
  });
  it('blocks a second deposit charge when KPay reports the old order paid', async () => {
    mocks.query.mockResolvedValue({ ok: true, data: { managedOrderNo: 'old-order', managedOutTradeNo: 'old-trade', managedOrderState: 2, payAmount: 5075, payCurrency: 'HKD' } });
    const res = await POST(request(body));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('PAYMENT_STATUS_UNAVAILABLE');
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
});
