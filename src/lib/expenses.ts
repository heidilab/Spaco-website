// Finance Phase 2 — per-branch expense ledger (支出管理).
//
// Three kinds of expense feed the monthly P&L:
//   1. RECURRING fixed costs (rent, mgmt fee, …) — defined once per
//      branch in `expense_templates`, seeded into each month's ledger,
//      then editable per month without touching the template.
//   2. MANUAL one-offs (repairs, Taobao supplies, …) — plain rows.
//   3. AUTO items — broker commissions + estimated KPay fees. These are
//      DERIVED LIVE from bookings via bookingMoney (commissionForBooking
//      / estimatedKpayFee) and never stored; per-booking overrides live
//      on the booking itself (commissionOverride). Storing them would
//      mean syncing them — live derivation can't drift.
//
// All client-side (staff-gated Firestore rules).

import {
  collection, doc, addDoc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, where, serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import type { ExpenseRecord, ExpenseTemplate, CommissionRule } from '@/types';

// ── Finance config (system/finance_config, admin-write per rules) ──────

export interface FinanceConfig {
  /** Channel id → commission rule. Channels absent here earn no commission. */
  commissionRules: Record<string, CommissionRule>;
  /** Estimated KPay gateway fee % applied to kpay payments until the
   *  monthly statement reconciliation replaces estimates with actuals. */
  kpayFeePct: number;
}

export const DEFAULT_FINANCE_CONFIG: FinanceConfig = {
  commissionRules: {
    // Heidi's rules (2026-09): 行家 10% on RENT ONLY (F&B exempt);
    // Reubird 10% on the full consumption subtotal.
    agent:      { pct: 10, base: 'rent' },
    reubird:    { pct: 10, base: 'total' },
    // Common Room platform bookings pay 10% too (Heidi 2026-09-06).
    commonroom: { pct: 10, base: 'total' },
  },
  kpayFeePct: 1.5,
};

export async function getFinanceConfig(): Promise<FinanceConfig> {
  try {
    const snap = await getDoc(doc(db, 'system', 'finance_config'));
    if (!snap.exists()) return DEFAULT_FINANCE_CONFIG;
    const d = snap.data() as Partial<FinanceConfig>;
    return {
      commissionRules: d.commissionRules && Object.keys(d.commissionRules).length > 0
        ? d.commissionRules
        : DEFAULT_FINANCE_CONFIG.commissionRules,
      kpayFeePct: typeof d.kpayFeePct === 'number' ? d.kpayFeePct : DEFAULT_FINANCE_CONFIG.kpayFeePct,
    };
  } catch {
    return DEFAULT_FINANCE_CONFIG;
  }
}

export async function saveFinanceConfig(cfg: FinanceConfig): Promise<void> {
  await setDoc(doc(db, 'system', 'finance_config'), {
    ...cfg,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

// ── Expense rows ───────────────────────────────────────────────────────

export async function listExpenses(branchKey: string, month: string): Promise<ExpenseRecord[]> {
  const snap = await getDocs(query(
    collection(db, 'expenses'),
    where('branchKey', '==', branchKey),
    where('month', '==', month),
  ));
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ExpenseRecord));
  // Recurring first (template order preserved via seeded order), then by date.
  return rows.sort((a, b) =>
    a.source === b.source ? (a.date || '').localeCompare(b.date || '') : a.source === 'recurring' ? -1 : 1);
}

export async function addExpense(
  data: Omit<ExpenseRecord, 'id' | 'createdAt'>,
): Promise<string> {
  const ref = await addDoc(collection(db, 'expenses'), {
    ...data,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateExpense(id: string, patch: Partial<Pick<ExpenseRecord, 'item' | 'amount' | 'date' | 'note'>>): Promise<void> {
  await updateDoc(doc(db, 'expenses', id), patch);
}

export async function deleteExpense(id: string): Promise<void> {
  await deleteDoc(doc(db, 'expenses', id));
}

// ── Recurring templates ────────────────────────────────────────────────

export async function listTemplates(branchKey: string): Promise<ExpenseTemplate[]> {
  const snap = await getDocs(query(
    collection(db, 'expense_templates'),
    where('branchKey', '==', branchKey),
  ));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as ExpenseTemplate))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export async function addTemplate(t: Omit<ExpenseTemplate, 'id'>): Promise<string> {
  const ref = await addDoc(collection(db, 'expense_templates'), t);
  return ref.id;
}

export async function updateTemplate(id: string, patch: Partial<Omit<ExpenseTemplate, 'id'>>): Promise<void> {
  await updateDoc(doc(db, 'expense_templates', id), patch);
}

export async function deleteTemplate(id: string): Promise<void> {
  await deleteDoc(doc(db, 'expense_templates', id));
}

/**
 * Seed this month's ledger from the branch's active templates —
 * IDEMPOTENT: a template already seeded into the month (matched by
 * templateId) is never seeded twice, so per-month amount edits survive
 * reloads. Returns how many rows were created.
 */
export async function seedRecurring(
  branchKey: string,
  month: string,
  templates: ExpenseTemplate[],
  existing: ExpenseRecord[],
  uid: string,
): Promise<number> {
  const seeded = new Set(existing.filter((e) => e.templateId).map((e) => e.templateId));
  let created = 0;
  for (const t of templates) {
    if (!t.active || seeded.has(t.id)) continue;
    await addExpense({
      branchKey,
      month,
      date: `${month}-01`,
      item: t.name,
      amount: t.amount,
      source: 'recurring',
      templateId: t.id,
      createdBy: uid,
    });
    created++;
  }
  return created;
}
