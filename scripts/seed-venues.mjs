// One-off: seed the Firestore `venues` collection from src/lib/venues.ts
// plus per-venue flags (drinks/BBQ/early-setup/room groups).
// Run: node scripts/seed-venues.mjs   (needs gcloud ADC login)
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
if (!getApps().length) initializeApp({ projectId: 'spaco-website' });
const db = getFirestore();

const seeds = [
  { id: 'cwb', sortOrder: 1, conflictsWith: [], bbqAvailable: true, drinksIncluded: false, earlySetupPricePerHour: 1000, bbqStandardPrice: 158 },
  { id: 'wanchai', sortOrder: 2, conflictsWith: [], bbqAvailable: false, drinksIncluded: false, earlySetupPricePerHour: 500 },
  { id: 'tst', sortOrder: 3, conflictsWith: [], bbqAvailable: true, drinksIncluded: true, earlySetupPricePerHour: 800, bbqStandardPrice: 138 },
  { id: 'sw-a', sortOrder: 4, spaceGroup: 'sw-physical', conflictsWith: ['sw-ab'], bbqAvailable: true, drinksIncluded: false, earlySetupPricePerHour: 800, bbqStandardPrice: 158 },
  { id: 'sw-b', sortOrder: 5, spaceGroup: 'sw-physical', conflictsWith: ['sw-ab'], bbqAvailable: true, drinksIncluded: false, earlySetupPricePerHour: 1200, bbqStandardPrice: 158 },
  { id: 'sw-ab', sortOrder: 6, spaceGroup: 'sw-physical', conflictsWith: ['sw-a', 'sw-b'], bbqAvailable: true, drinksIncluded: false, earlySetupPricePerHour: 2000, bbqStandardPrice: 158 },
];

const src = readFileSync(new URL('../src/lib/venues.ts', import.meta.url), 'utf8');
const m = src.match(/export const venues: Venue\[\] = (\[[\s\S]*?\n\]);/);
if (!m) { console.error('cannot parse venues.ts'); process.exit(1); }
const venuesArr = eval(m[1]);

for (const base of venuesArr) {
  const extra = seeds.find((s) => s.id === base.id);
  if (!extra) { console.log('skip:', base.id); continue; }
  const { id: _id, ...doc } = { ...base, ...extra, active: true };
  await db.collection('venues').doc(base.id).set({
    ...doc,
    updatedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  console.log('seeded', base.id);
}
console.log('done —', (await db.collection('venues').get()).size, 'venue docs');
