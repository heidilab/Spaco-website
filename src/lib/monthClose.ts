// Finance Phase 3 — month-close records (月結).
//
// One doc per branch per month at `month_closes/{branchKey}_{month}`:
// the month's profit-split snapshot (editable until closed) and the
// closed/draft status. All derived numbers (sales, expenses, profit,
// KPay fees) stay LIVE — the doc only stores what can't be derived: this
// month's split tweaks and the close itself. Uploaded KPay statements are
// stored alongside, once per statement month (see the end of this file).

import {
  collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where,
} from 'firebase/firestore';
import { db } from './firebase';
import type { MonthCloseRecord } from '@/types';
import type { StoredKpayStatement } from './kpayStatement';

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

// ── KPay statements (per-booking fee reconciliation) ──
//
// The ONLINE merchant account is shared by every branch, so a statement
// is stored ONCE per statement month — not per branch — with its
// per-transaction rows. lib/kpayReconcile then gives each booking the fee
// of its own payments, whichever month they were paid in.
//
// The docs live in `month_closes` under a reserved pseudo-branch key
// (`kpay-statement_2026-09`): admin-only like the rest of the month-close
// data, and already covered by the deployed Firestore rules.

export const KPAY_STATEMENT_KEY = 'kpay-statement';

export async function listKpayStatements(): Promise<StoredKpayStatement[]> {
  const snap = await getDocs(query(collection(db, 'month_closes'), where('branchKey', '==', KPAY_STATEMENT_KEY)));
  return snap.docs
    .map((d) => d.data() as StoredKpayStatement)
    .filter((s) => typeof s.month === 'string' && Array.isArray(s.transactions))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/** Store (or replace) the statement of one month. */
export async function saveKpayStatement(
  statement: Omit<StoredKpayStatement, 'uploadedAt'>,
): Promise<void> {
  await setDoc(doc(db, 'month_closes', monthCloseId(KPAY_STATEMENT_KEY, statement.month)), {
    ...statement,
    branchKey: KPAY_STATEMENT_KEY,
    uploadedAt: serverTimestamp(),
  });
}

export async function deleteKpayStatement(month: string): Promise<void> {
  await deleteDoc(doc(db, 'month_closes', monthCloseId(KPAY_STATEMENT_KEY, month)));
}
