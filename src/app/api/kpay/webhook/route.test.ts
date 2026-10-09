import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const m=vi.hoisted(()=>({verify:vi.fn(),db:vi.fn(),settle:vi.fn(),worker:vi.fn()}));
vi.mock('@/lib/firebaseAdmin',()=>({adminDb:{collection:m.db}}));
vi.mock('@/lib/kpay',()=>({verifyNotifyMulti:m.verify,isTransactionSuccess:(s:number)=>s===2,getMid:()=> 'merchant'}));
vi.mock('@/lib/settleKpayPayment',()=>({settleKpayPayment:m.settle}));
vi.mock('@/lib/paymentFinalization',()=>({runPaymentFinalization:m.worker}));
vi.mock('@vercel/functions',()=>({waitUntil:vi.fn()}));
import { POST } from './route';
const request=(body:unknown,headers=true)=>new NextRequest('https://spaco.test/api/kpay/webhook',{method:'POST',headers:headers?{'K-Signature':'sig','K-Timestamp':'1','K-Nonce-Str':'nonce','K-Merchant-Code':'merchant'}:{},body:JSON.stringify(body)});
const sale={eventType:'SALES',merchantCode:'merchant',transactionNo:'tx',orderNo:'order',outTradeNo:'Bone_P1',payAmount:100,payCurrency:'HKD',transactionState:2};
beforeEach(()=>{vi.clearAllMocks();m.verify.mockReturnValue({ok:true});});
it('rejects unsigned callbacks without database writes',async()=>{expect((await POST(request(sale,false))).status).toBe(400);expect(m.db).not.toHaveBeenCalled();});
it('rejects invalid signatures without persisting attacker body',async()=>{m.verify.mockReturnValue({ok:false});expect((await POST(request(sale))).status).toBe(401);expect(m.db).not.toHaveBeenCalled();});
it.each([{merchantCode:'other'},{payCurrency:'USD'},{transactionNo:'../../other'},{payAmount:'100'}])('rejects invalid merchant/currency/identifier/amount: %o',async patch=>{
  expect((await POST(request({...sale,...patch}))).status).toBe(400);expect(m.db).not.toHaveBeenCalled();
});
it('ignores unsuccessful sale without changing bookings',async()=>{expect((await POST(request({...sale,transactionState:3}))).status).toBe(200);expect(m.settle).not.toHaveBeenCalled();});
