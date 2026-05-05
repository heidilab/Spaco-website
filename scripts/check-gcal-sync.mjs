// Diagnostic — print every blocked_slot with reason='gcal' grouped by date,
// so we can see what direction-B sync actually wrote to Firestore.
//
// Run with: node scripts/check-gcal-sync.mjs

import { getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (!getApps().length) {
  initializeApp({
    credential: applicationDefault(),
    projectId: 'spaco-website',
  });
}

const db = getFirestore();

const snap = await db.collection('blocked_slots').where('reason', '==', 'gcal').get();
console.log(`Total gcal slots in DB: ${snap.size}\n`);

const byDate = new Map();
snap.docs.forEach((d) => {
  const data = d.data();
  const list = byDate.get(data.date) || [];
  list.push({
    venueId: data.venueId,
    time: `${data.startTime}-${data.endTime}`,
    eventId: data.googleEventId?.slice(0, 12) + '…',
    calendar: data.googleCalendarKey,
    title: data.googleEventTitle || '(no title)',
    desc: data.googleEventDescription ? data.googleEventDescription.slice(0, 50) : '',
  });
  byDate.set(data.date, list);
});

const dates = [...byDate.keys()].sort();
for (const date of dates) {
  console.log(`\n=== ${date} ===`);
  byDate.get(date).forEach((s) => {
    console.log(`  [${s.calendar}] ${s.venueId.padEnd(8)} ${s.time}  ${s.title}`);
    if (s.desc) console.log(`      ↳ ${s.desc}`);
  });
}

// Also check the sync metadata
const meta = await db.doc('system/calendar_sync').get();
if (meta.exists) {
  console.log('\n\n=== Last sync meta ===');
  const m = meta.data();
  console.log(`  syncedAt: ${m.lastSyncedAt?.toDate?.()?.toISOString() || '?'}`);
  console.log(`  scanned:  ${m.scanned}`);
  console.log(`  added:    ${m.added}`);
  console.log(`  updated:  ${m.updated}`);
  console.log(`  removed:  ${m.removed}`);
  if (m.errors?.length) {
    console.log(`  errors:`);
    m.errors.forEach((e) => console.log(`    - ${e}`));
  }
}
process.exit(0);
