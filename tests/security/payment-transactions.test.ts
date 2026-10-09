import { beforeAll, afterAll, beforeEach, it, expect, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
vi.mock('../../src/lib/firebaseAdmin', async()=>{
  if(process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8180') throw new Error('Local emulator required');
  const app=initializeApp({projectId:'demo-spaco-security'},'settlement-tests');
  return { adminDb:getFirestore(app) };
});
const effect = vi.hoisted(()=>vi.fn());
vi.mock('../../src/lib/finalizeBooking',()=>({finalizeConfirmedBooking:effect}));
import { runPaymentFinalization } from '../../src/lib/paymentFinalization';
import { adminDb } from '../../src/lib/firebaseAdmin';
import { settleKpayPayment } from '../../src/lib/settleKpayPayment';
import { getApps } from 'firebase-admin/app';
beforeAll(()=>{if(process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8180') throw new Error('Local emulator required');});
afterAll(async()=>{for(const app of getApps()) await deleteApp(app);});
beforeEach(async()=>{
  for(const collection of await adminDb.listCollections()) await adminDb.recursiveDelete(collection);
  await adminDb.doc('users/alice').set({loyaltyPoints:1000});
});
const seed=async(id:string,extra={})=>adminDb.doc(`bookings/${id}`).set({userId:'alice',status:'awaiting_payment',pricing:{baseCharge:100,addOnTotal:0,securityDeposit:0},payments:[],...extra});
const pay=(id:string,tx:string)=>settleKpayPayment(id,`B${id}_P1`,{transactionNo:tx,orderNo:tx,payAmount:90},false);
it('concurrent duplicate callbacks credit once and deduct points once',async()=>{
  await seed('one',{pointsUsed:1000,pointsDiscount:10});
  await Promise.all([pay('one','tx1'),pay('one','tx1')]);
  const b=(await adminDb.doc('bookings/one').get()).data()!;
  expect(b.payments).toHaveLength(1);expect(b.status).toBe('confirmed');
  expect((await adminDb.doc('users/alice').get()).data()!.loyaltyPoints).toBe(0);
  expect((await adminDb.doc('_payment_finalizations/tx1').get()).exists).toBe(true);
});
it('two bookings cannot spend the same points',async()=>{
  await seed('one',{pointsUsed:1000,pointsDiscount:10});await seed('two',{pointsUsed:1000,pointsDiscount:10});
  const results=await Promise.all([pay('one','tx1'),pay('two','tx2')]);
  expect(results.filter(r=>r.review==='insufficient_points')).toHaveLength(1);
  expect((await adminDb.doc('users/alice').get()).data()!.loyaltyPoints).toBe(0);
});
it('concurrent final promo uses confirm only one booking',async()=>{
  await adminDb.doc('promo_codes/p').set({totalUsageCount:0,totalUsageLimit:1});
  await seed('one',{promoCodeId:'p',promoDiscount:10});await seed('two',{promoCodeId:'p',promoDiscount:10});
  const results=await Promise.all([pay('one','tx1'),pay('two','tx2')]);
  expect(results.filter(r=>r.review==='promo_limit')).toHaveLength(1);
  expect((await adminDb.doc('promo_codes/p').get()).data()!.totalUsageCount).toBe(1);
});
it('cancelled payment records cash but creates no finalization job',async()=>{
  await seed('one',{status:'cancelled'});await pay('one','tx1');
  expect((await adminDb.doc('bookings/one').get()).data()).toMatchObject({status:'cancelled',paymentReviewRequired:true});
  expect((await adminDb.doc('_payment_finalizations/tx1').get()).exists).toBe(false);
});
it('failed settlement leaves neither marker nor payment',async()=>{
  await seed('one',{kpaySurcharges:{Bone_P1:100}});
  await expect(pay('one','tx1')).rejects.toThrow('INVALID_CREDIT');
  expect((await adminDb.doc('_kpay_webhook_events/tx1').get()).exists).toBe(false);
  expect((await adminDb.doc('bookings/one').get()).data()!.payments).toHaveLength(0);
});

it('distinct payments racing on one booking do not overwrite the balance',async()=>{
  await seed('one');await Promise.all([pay('one','tx1'),pay('one','tx2')]);
  const b=(await adminDb.doc('bookings/one').get()).data()!;
  expect(b.payments).toHaveLength(2);expect(b.balanceDue).toBe(0);
});
it('per-user promo limit serializes across two bookings',async()=>{
  await adminDb.doc('promo_codes/p').set({totalUsageCount:0,totalUsageLimit:100,perUserLimit:1});
  await seed('one',{promoCodeId:'p',promoDiscount:10});await seed('two',{promoCodeId:'p',promoDiscount:10});
  const results=await Promise.all([pay('one','tx1'),pay('two','tx2')]);
  expect(results.filter(r=>r.review==='promo_limit')).toHaveLength(1);
});
it('mismatched mapped order is credited for review without confirmation',async()=>{
  await seed('one');await adminDb.doc('_kpay_orders/Bone_P1').set({bookingId:'one',amount:100,surcharge:0});
  expect((await pay('one','tx1')).review).toBe('payment_amount_mismatch');
  expect((await adminDb.doc('bookings/one').get()).data()!.status).toBe('awaiting_review');
});
it('failed side effects remain retryable without another financial write',async()=>{
  await seed('one');await pay('one','tx1');effect.mockRejectedValueOnce(new Error('network'));
  await expect(runPaymentFinalization('tx1','https://example.test')).rejects.toThrow();
  expect((await adminDb.doc('_payment_finalizations/tx1').get()).data()!.status).toBe('pending');
  effect.mockResolvedValue(undefined);
  await Promise.all([runPaymentFinalization('tx1','https://example.test'),runPaymentFinalization('tx1','https://example.test')]);
  expect((await adminDb.doc('_payment_finalizations/tx1').get()).data()!.status).toBe('done');
  expect((await adminDb.doc('bookings/one').get()).data()!.payments).toHaveLength(1);
});
