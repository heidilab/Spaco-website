// Finance Phase 3 — month-close records (月結).
//
// One doc per branch per month at `month_closes/{branchKey}_{month}`:
// the month's profit-split snapshot (editable until closed), the actual
// KPay fee from the uploaded statement, and the closed/draft status.
// All derived numbers (sales, expenses, profit) stay LIVE — the doc only
// stores what can't be derived: this month's split tweaks, the
// reconciled fee, and the close itself.

import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import type { MonthCloseRecord } from '@/types';

export function monthCloseId(branchKey: string, month: string): string {
  return `${branchKey}_${month}`;
}

export async function getMonthClose(branchKey: string, month: string): Promise<MonthCloseRecord | null> {
  const snap = await getDoc(doc(db, 'month_closes', monthCloseId(branchKey, month)));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as MonthCloseRecord;
}

/** Merge-write the month-close doc (creates it on first touch). */
export async function saveMonthClose(
  branchKey: string,
  month: string,
  patch: Partial<Omit<MonthCloseRecord, 'id' | 'branchKey' | 'month'>>,
): Promise<void> {
  await setDoc(doc(db, 'month_closes', monthCloseId(branchKey, month)), {
    branchKey,
    month,
    status: 'draft',
    ...patch,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}
