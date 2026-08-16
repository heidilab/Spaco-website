import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
if (!getApps().length) initializeApp({ projectId: 'spaco-website' });
const db = getFirestore();

const [slotsSnap, bookingsSnap] = await Promise.all([
  db.collection('blocked_slots').get(),
  db.collection('bookings').get(),
]);
const bookings = new Map(bookingsSnap.docs.map(d => [d.id, d.data()]));
const today = '2026-08-16';

const orphanNoBooking = [];
const deadStatus = [];
const stalePending = [];
const noBookingId = {};

for (const doc of slotsSnap.docs) {
  const s = doc.data();
  if (!s.bookingId) {
    noBookingId[s.reason || 'unknown'] = (noBookingId[s.reason || 'unknown'] || 0) + 1;
    continue;
  }
  const b = bookings.get(s.bookingId);
  if (!b) {
    orphanNoBooking.push({ slotId: doc.id, date: s.date, startTime: s.startTime, endTime: s.endTime, venueId: s.venueId, reason: s.reason, bookingId: s.bookingId });
  } else if (b.status === 'cancelled' || b.status === 'payment_not_completed') {
    deadStatus.push({ slotId: doc.id, date: s.date, time: `${s.startTime}-${s.endTime}`, venueId: s.venueId, reason: s.reason, bookingId: s.bookingId.slice(0,8), status: b.status });
  } else if (b.status === 'awaiting_payment' && b.pendingExpiresAt && b.pendingExpiresAt < Date.now()) {
    stalePending.push({ slotId: doc.id, date: s.date, time: `${s.startTime}-${s.endTime}`, venueId: s.venueId, bookingId: s.bookingId.slice(0,8), expiredAt: new Date(b.pendingExpiresAt).toISOString().slice(0,16) });
  }
}

const fmt = (arr) => arr.sort((a,b) => (a.date||'').localeCompare(b.date||''));
console.log('=== 1. Slots pointing to DELETED bookings:', orphanNoBooking.length, '===');
for (const s of fmt(orphanNoBooking)) console.log(` ${s.date} ${s.startTime}-${s.endTime} ${s.venueId} (${s.reason}) booking:${s.bookingId.slice(0,8)}`);
console.log('\n=== 2. Slots of CANCELLED / payment_not_completed bookings:', deadStatus.length, '===');
for (const s of fmt(deadStatus)) console.log(` ${s.date} ${s.time} ${s.venueId} (${s.reason}) booking:${s.bookingId} [${s.status}]`);
console.log('\n=== 3. Slots of EXPIRED awaiting_payment bookings:', stalePending.length, '===');
for (const s of fmt(stalePending)) console.log(` ${s.date} ${s.time} ${s.venueId} booking:${s.bookingId} expired:${s.expiredAt}`);
console.log('\n=== 4. Slots without bookingId (gcal/admin_block by design) ===');
console.log(JSON.stringify(noBookingId));
console.log('\nTotal slots:', slotsSnap.size, '/ bookings:', bookingsSnap.size);
const future = [...fmt(orphanNoBooking), ...fmt(deadStatus), ...fmt(stalePending)].filter(s => (s.date||'') >= today);
console.log('FUTURE (>= today) problem slots:', future.length);
