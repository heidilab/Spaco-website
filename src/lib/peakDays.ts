// 特別日子/旺季 (peak days) — per-date holiday surcharge + raised
// minimums, admin-configured on a calendar (Heidi 2026-09-08).
//
// Storage: peak_days/{YYYY-MM-DD} (public read — the customer booking UI
// must badge these dates; admin write). Each doc carries an `all` rule
// plus optional per-branch overrides. Resolution is PURE so every
// surface (customer/package/admin/server) resolves identically.

import { doc, getDoc, setDoc, deleteDoc, getDocs, collection, query, where, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import type { PeakDayConfig } from '@/types';

export { peakBranchKey, resolvePeakRule, effectiveMinGuests, effectiveMinHours, swSplitBlocked } from './peakDayRules';

// ── Firestore accessors (client SDK) ──────────────────────────────────

export async function getPeakDay(date: string): Promise<PeakDayConfig | null> {
  try {
    const snap = await getDoc(doc(db, 'peak_days', date));
    return snap.exists() ? ({ ...(snap.data() as PeakDayConfig), date }) : null;
  } catch {
    return null;
  }
}

/** All peak days in [from, to] (inclusive, YYYY-MM-DD). */
export async function listPeakDays(from: string, to: string): Promise<Record<string, PeakDayConfig>> {
  try {
    const snap = await getDocs(query(
      collection(db, 'peak_days'),
      where('date', '>=', from),
      where('date', '<=', to),
    ));
    return Object.fromEntries(snap.docs.map((d) => [d.id, { ...(d.data() as PeakDayConfig), date: d.id }]));
  } catch {
    return {};
  }
}

export async function savePeakDay(date: string, cfg: Omit<PeakDayConfig, 'date' | 'updatedAt'>): Promise<void> {
  await setDoc(doc(db, 'peak_days', date), {
    ...cfg,
    date,
    updatedAt: serverTimestamp(),
  });
}

export async function deletePeakDay(date: string): Promise<void> {
  await deleteDoc(doc(db, 'peak_days', date));
}
