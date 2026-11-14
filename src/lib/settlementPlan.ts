// 按金結算 — the PURE arithmetic of settling a booking's refundable deposit
// (site review 2026-11-13, phase 5). The server route
// /api/admin/booking-settle-deposit applies a plan in one transaction;
// this module only decides the numbers, so they can be tested.
//
// Points (review #21): the money SPACO actually keeps earns points — net
// consumption plus the part of the deposit consumed by deductions. The
// OVERFLOW (deductions beyond the deposit) is owed, not paid: its points
// wait in `pointsPendingOverflow` and are credited when the overflow is
// paid (settle-balance / record-offline-payment).

import { depositSettlementAmounts, netConsumption, type MoneyBooking } from './bookingMoney';
import { pointsEarnedFor } from './bookingRules';

export interface Deduction { label: string; amount: number }

export interface SettlementBooking extends MoneyBooking {
  userId?: string;
  pointsCreditedAt?: unknown;
  pointsActuallyCredited?: number;
  pointsOverflowCreditedAt?: unknown;
}

export interface SettlementPlan {
  deductions: Deduction[];
  total: number;
  refund: number;
  /** Deductions beyond the deposit — the customer still owes this. */
  owed: number;
  /** The deposit actually kept. */
  consumedDeposit: number;
  status: 'confirmed' | 'completed';
  /** Points the booking should have credited by now (overflow included
   *  only once it has been paid). */
  expectedPoints: number;
  /** Points to credit when the overflow is paid. */
  pointsPendingOverflow: number;
  /** The change to apply to the customer's balance now: positive = credit,
   *  negative = take back (an amendment that lowered the deductions). */
  pointsDelta: number;
}

/** Clean the deductions staff sent: labelled, positive, rounded. */
export function cleanDeductions(raw: unknown): Deduction[] {
  if (!Array.isArray(raw)) return [];
  const out: Deduction[] = [];
  for (const d of raw as Array<Record<string, unknown>>) {
    if (!d || typeof d !== 'object' || out.length >= 40) continue;
    const label = typeof d.label === 'string' ? d.label.trim().slice(0, 120) : '';
    const amount = typeof d.amount === 'number' ? d.amount : Number(d.amount);
    if (!label || !Number.isFinite(amount) || amount <= 0) continue;
    out.push({ label, amount: Math.round(amount * 100) / 100 });
  }
  return out;
}

export function settlementPlan(booking: SettlementBooking, deductionsRaw: unknown): SettlementPlan {
  const deductions = cleanDeductions(deductionsRaw);
  const total = Math.round(deductions.reduce((s, d) => s + d.amount, 0) * 100) / 100;
  const { available, refund, owed } = depositSettlementAmounts(booking, total);
  const consumedDeposit = Math.min(total, available);
  const overflowPaid = !!booking.pointsOverflowCreditedAt;
  const expectedPoints = pointsEarnedFor(netConsumption(booking) + consumedDeposit + (overflowPaid ? owed : 0));
  const pointsPendingOverflow = overflowPaid ? 0 : pointsEarnedFor(owed);
  const credited = booking.pointsCreditedAt ? (booking.pointsActuallyCredited || 0) : 0;
  const pointsDelta = booking.userId ? expectedPoints - credited : 0;
  return {
    deductions, total, refund, owed, consumedDeposit,
    status: owed > 0 ? 'confirmed' : 'completed',
    expectedPoints, pointsPendingOverflow, pointsDelta,
  };
}
