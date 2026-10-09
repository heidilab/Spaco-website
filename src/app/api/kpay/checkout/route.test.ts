import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(()=>({ verify: vi.fn(), transaction: vi.fn(), create: vi.fn(), update: vi.fn(), set: vi.fn(), gateway: vi.fn(), data: {} as Record<string,unknown> }));
vi.mock('@/lib/adminAuth',()=>({adminVerifyIdToken:mocks.verify}));
vi.mock('@/lib/firebaseAdmin',()=>({adminDb:{ collection:(name:string)=>({doc:(id:string)=>({name,id,update:mocks.update})}),runTransaction:mocks.transaction }}));
vi.mock('@/lib/kpay',()=>({isKpayConfigured:()=>true,createManagedOrder:mocks.gateway,buildCashierRedirectUrl:()=> 'https://cashier.test/order',getPublicOrigin:()=> 'https://spaco.test'}));
import { POST } from './route';
const request = (body:unknown, token='valid') => new NextRequest('https://spaco.test/api/kpay/checkout',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
beforeEach(()=>{
  vi.clearAllMocks();
  mocks.verify.mockResolvedValue({uid:'alice'});
  mocks.data={userId:'alice',status:'awaiting_payment',pricing:{deposit:5000},pointsDiscount:0,payments:[]};
  mocks.transaction.mockImplementation(async fn=>fn({get:async(ref:{name:string})=>ref.name==='bookings'?{exists:true,data:()=>mocks.data}:{exists:false,data:()=>undefined},create:mocks.create,set:mocks.set}));
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
