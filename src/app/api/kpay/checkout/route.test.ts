import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(()=>({ verify: vi.fn(), transaction: vi.fn(), create: vi.fn(), update: vi.fn(), set: vi.fn(), gateway: vi.fn(), sign: vi.fn(), lock: undefined as Record<string,unknown> | undefined, data: {} as Record<string,unknown> }));
vi.mock('@/lib/adminAuth',()=>({adminVerifyIdToken:mocks.verify}));
vi.mock('@/lib/firebaseAdmin',()=>({adminDb:{ collection:(name:string)=>({doc:(id:string)=>({name,id,update:mocks.update})}),runTransaction:mocks.transaction }}));
vi.mock('@/lib/kpay',()=>({isKpayConfigured:()=>true,createManagedOrder:mocks.gateway,buildCashierRedirectUrl:mocks.sign,getPublicOrigin:()=> 'https://spaco.test'}));
import { POST } from './route';
const request = (body:unknown, token='valid') => new NextRequest('https://spaco.test/api/kpay/checkout',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
beforeEach(()=>{
  vi.clearAllMocks();
  mocks.lock = undefined;
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
