import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import { initializeTestEnvironment, assertFails, assertSucceeds, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { doc, setDoc, getDoc, getDocs, collection, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getBytes } from 'firebase/storage';

// Fail closed: this suite must never connect to the actual SPACO project.
const projectId = 'demo-spaco-security';
let env: RulesTestEnvironment;
beforeAll(async () => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8180') throw new Error('Run npm run test:rules (local emulator only)');
  env = await initializeTestEnvironment({ projectId,
    firestore: { host: '127.0.0.1', port: 8180, rules: readFileSync('firestore.rules', 'utf8') },
    storage: { host: '127.0.0.1', port: 9299, rules: readFileSync('storage.rules', 'utf8') },
  });
}, 30000);
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const role of ['admin','cs','cleaner','marketing']) await setDoc(doc(db, 'admin_users', role), {role});
    await setDoc(doc(db, 'users', 'alice'), { displayName: 'Alice', loyaltyPoints: 1000 });
    await setDoc(doc(db, 'bookings', 'one'), { userId: 'alice', status: 'awaiting_payment',
      pricing: { baseCharge: 5000, addOnTotal: 0, subtotal: 5000, deposit: 6000, securityDeposit: 1000 },
      balanceDue: 0, payments: [], receiptUrl: null, paymentMethod: null });
    await setDoc(doc(db, 'booking_drafts', 'draft'), { status: 'pending', claimedBy: null });
  });
});
const db = (uid: string) => env.authenticatedContext(uid).firestore();
describe('Customer authority boundaries', () => {
  it('denies fabricated confirmed bookings and arbitrary slots', async () => {
    await assertFails(setDoc(doc(db('alice'), 'bookings', 'fake'), {userId:'alice',status:'confirmed',balanceDue:0}));
    await assertFails(setDoc(doc(db('alice'), 'blocked_slots', 'fake'), {venueId:'cwb'}));
  });
  it('denies changing money, status, dates and ownership', async () => {
    for (const patch of [{status:'confirmed'},{balanceDue:0, pricing:{}},{pointsDiscount:1000},{date:'2027-01-01'}, {userId:'bob'}]) {
      await assertFails(updateDoc(doc(db('alice'), 'bookings', 'one'), patch));
    }
  });
  it('permits refund details, method selection, and receipt submission', async () => {
    const booking = doc(db('alice'), 'bookings', 'one');
    await assertSucceeds(updateDoc(booking, { refundDetails: { method:'fps', accountNumber:'test' } }));
    await assertSucceeds(updateDoc(booking, { paymentMethod:'fps', status:'awaiting_payment' }));
    await assertSucceeds(updateDoc(booking, { receiptUrl:'https://example.test/receipt', status:'awaiting_review' }));
    await assertFails(updateDoc(doc(db('bob'), 'bookings', 'one'), {receiptUrl:'x'}));
  });
  it('freezes points for customers and client-side staff; permits profile changes', async () => {
    await assertSucceeds(updateDoc(doc(db('alice'), 'users', 'alice'), {phone:'+85200000000'}));
    for (const uid of ['alice','bob','cs','admin']) await assertFails(updateDoc(doc(db(uid), 'users', 'alice'), {loyaltyPoints:99999}));
    await assertSucceeds(setDoc(doc(db('new'), 'users', 'new'), {displayName:'New',loyaltyPoints:0}));
    await assertFails(setDoc(doc(db('fake'), 'users', 'fake'), {loyaltyPoints:1000}));
  });
  it('denies draft enumeration and client claims, preserves CS access', async () => {
    await assertFails(getDocs(collection(db('alice'), 'booking_drafts')));
    await assertFails(updateDoc(doc(db('alice'), 'booking_drafts', 'draft'), {claimedBy:'alice',status:'claimed'}));
    await assertSucceeds(getDocs(collection(db('cs'), 'booking_drafts')));
  });
});
describe('Staff roles', () => {
  it('denies cleaner/marketing access to customers, bookings, financials and draft quotes', async () => {
    for (const uid of ['cleaner','marketing']) {
      for (const name of ['users','bookings','booking_drafts','expenses','month_closes']) {
        await assertFails(getDocs(collection(db(uid), name)));
        await assertFails(setDoc(doc(db(uid), name, 'attack'), {value:1}));
      }
    }
  });
  it('allows CS operations, admin financials, marketing articles, calendar reads', async () => {
    await assertSucceeds(updateDoc(doc(db('cs'), 'bookings','one'), {status:'confirmed'}));
    await assertFails(setDoc(doc(db('cs'),'expenses','e'), {amount:10}));
    await assertSucceeds(setDoc(doc(db('admin'),'expenses','e'), {amount:10}));
    await assertSucceeds(setDoc(doc(db('marketing'),'articles','a'), {status:'draft'}));
    await assertFails(setDoc(doc(db('marketing'),'site_content','settings'), {ttlock:'x'}));
    await assertSucceeds(getDocs(collection(db('cleaner'),'calendar_events')));
  });
});
describe('Receipt privacy and upload constraints', () => {
  it('allows owner upload/read, denies other customers, and permits CS review', async () => {
    const object = 'receipts/one/test.png';
    await assertSucceeds(uploadBytes(ref(env.authenticatedContext('alice').storage(),object), new Uint8Array([1,2,3]), {contentType:'image/png'}));
    await assertSucceeds(getBytes(ref(env.authenticatedContext('alice').storage(),object)));
    await assertSucceeds(getBytes(ref(env.authenticatedContext('cs').storage(),object)));
    await assertFails(getBytes(ref(env.authenticatedContext('bob').storage(),object)));
    await assertFails(getBytes(ref(env.authenticatedContext('cleaner').storage(),object)));
  });
  it('denies other-owner uploads, html files and oversized receipts', async () => {
    await assertFails(uploadBytes(ref(env.authenticatedContext('bob').storage(),'receipts/one/x.png'),new Uint8Array([1]),{contentType:'image/png'}));
    await assertFails(uploadBytes(ref(env.authenticatedContext('alice').storage(),'receipts/one/x.html'),new Uint8Array([1]),{contentType:'text/html'}));
    await assertFails(uploadBytes(ref(env.authenticatedContext('alice').storage(),'receipts/one/large.png'),new Uint8Array(10*1024*1024+1),{contentType:'image/png'}));
  });
});
