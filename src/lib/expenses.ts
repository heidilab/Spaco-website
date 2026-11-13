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
import type { ExpenseRecord, ExpenseTemplate, CommissionRule, ProfitSplitParty } from '@/types';

// ── Finance config (system/finance_config, admin-write per rules) ──────

export interface FinanceConfig {
  /** Channel id → commission rule. Channels absent here earn no commission. */
  commissionRules: Record<string, CommissionRule>;
  /** Estimated KPay gateway fee % applied to kpay payments until the
   *  monthly statement reconciliation replaces estimates with actuals. */
  kpayFeePct: number;
  /** Branch key → default profit split. Each month snapshots this into
   *  its month_close doc, where it stays editable (monthly tweaks). */
  profitSplits: Record<string, ProfitSplitParty[]>;
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
  // Defaults transcribed from her 2026-2027 Financial Master AUG sheets.
  profitSplits: {
    cwb:     [{ name: 'Kenneth', pct: 50 }, { name: 'Heidi', pct: 25 }, { name: 'In Account', pct: 25 }],
    sw:      [{ name: 'Kenneth', pct: 50 }, { name: 'Heidi', pct: 20 }, { name: 'Account', pct: 30 }],
    tst:     [{ name: 'Kenneth', pct: 30 }, { name: 'Iver', pct: 30 }, { name: 'SPACO', pct: 40 }],
    wanchai: [{ name: 'Heidi', pct: 50 }, { name: 'Kenneth', pct: 25 }, { name: 'In Account', pct: 25 }],
  },
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
      profitSplits: {
        ...DEFAULT_FINANCE_CONFIG.profitSplits,
        ...(d.profitSplits || {}),
      },
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

/** Same item name, ignoring case and spaces — 「HGC寬頻」 twice is one item. */
export function sameExpenseItem(a: string, b: string): boolean {
  const norm = (s: string) => (s || '').replace(/\s+/g, '').toLowerCase();
  return norm(a) === norm(b) && norm(a) !== '';
}

/** The recurring rows a deleted template takes with it: its own rows in
 *  `fromMonth` and every later month. Earlier months are closed books
 *  and keep theirs. */
export function rowsRemovedWithTemplate<T extends Pick<ExpenseRecord, 'templateId' | 'month' | 'source'>>(
  rows: T[], templateId: string, fromMonth: string,
): T[] {
  return rows.filter((r) => r.source === 'recurring' && r.templateId === templateId && r.month >= fromMonth);
}

/** Templates still to seed into a month: skips one already seeded (by
 *  id) AND one whose name is already on the month's recurring rows — a
 *  template deleted and added again used to seed a second 「寬頻」 row
 *  (Heidi 2026-11-13). */
export function templatesToSeed(templates: ExpenseTemplate[], existing: Array<Pick<ExpenseRecord, 'templateId' | 'item' | 'source'>>): ExpenseTemplate[] {
  const seeded = new Set(existing.filter((e) => e.templateId).map((e) => e.templateId));
  const names = existing.filter((e) => e.source === 'recurring').map((e) => e.item);
  return templates.filter((t) => t.active && !seeded.has(t.id) && !names.some((n) => sameExpenseItem(n, t.name)));
}

/**
 * Delete a template. With `fromMonth`, its rows already seeded into that
 * month and later months go too (she deleted 「寬頻」 and the month still
 * showed it); earlier months are left as they were.
 */
export async function deleteTemplate(id: string, fromMonth?: string): Promise<number> {
  let removed = 0;
  if (fromMonth) {
    const snap = await getDocs(query(collection(db, 'expenses'), where('templateId', '==', id)));
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ExpenseRecord));
    for (const r of rowsRemovedWithTemplate(rows, id, fromMonth)) {
      await deleteDoc(doc(db, 'expenses', r.id));
      removed++;
    }
  }
  await deleteDoc(doc(db, 'expense_templates', id));
  return removed;
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
  let created = 0;
  for (const t of templatesToSeed(templates, existing)) {
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
