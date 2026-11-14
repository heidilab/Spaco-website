// Booking lifecycle — ONE server-side path each for cancelling a booking,
// changing its status and settling its deposit (site review 2026-11-13,
// phase 5; items #4, #12, #13, #21).
//
// Before this, the browser did these step by step (status, then slots,
// then three fetches for Calendar / email / lock): closing the tab half
// way left a booking cancelled with its slots still blocked, or the
// reverse, and a cancel never gave back the points or the promo use.
//
// Each function: the state change — status, blocked_slots, rewards — in
// ONE Firestore transaction (all or nothing), then the external side
// effects (Google Calendar, TTLock, email) one by one, each recorded on
// the booking (`cancelEffects` / `statusEffects`) so a failure is visible
// and the call can simply be repeated. Admin SDK only.

import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './firebaseAdmin';
import { restoreBlockedSlotsIfMissing, finalizeConfirmedBooking } from './finalizeBooking';
import { consumeBookingRewards } from './bookingRewards';
import { removeBookingFromCalendar, updateBookingOnCalendar, pushBookingToCalendar } from './googleCalendar';
import { revokeBookingPasscode } from './lockPasscode';
import { buildBookingCancelledEmail, generateWhatsAppLink } from './email';
import { sendAutomatedEmail } from './emailAutomations';
import { PAYMENT_DETAILS } from './paymentDetails';
import { resolveVenueServer } from './venueRegistryServer';
import { settlementPlan, type SettlementPlan } from './settlementPlan';
import type { BookingRecord, UserProfile } from '@/types';

export interface Actor { uid?: string; email?: string; displayName?: string }
export type EffectResult = 'done' | 'skipped' | 'failed';
export interface Effects { [step: string]: EffectResult }

const bookingRef = (id: string) => adminDb.collection('bookings').doc(id);
const describe = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

/** Statuses during which the booking holds its time on the calendar. */
export const HOLDING_STATUSES = new Set(['awaiting_payment', 'awaiting_review', 'confirmed', 'completed', 'pending']);
/** Statuses a staff member may set by hand. */
export const SETTABLE_STATUSES = new Set(['awaiting_payment', 'awaiting_review', 'confirmed', 'completed', 'payment_not_completed', 'cancelled']);

/** Delete every blocked_slot of a booking inside a transaction. */
async function deleteSlotsTx(tx: FirebaseFirestore.Transaction, bookingId: string): Promise<number> {
  const slots = await tx.get(adminDb.collection('blocked_slots').where('bookingId', '==', bookingId));
  for (const s of slots.docs) tx.delete(s.ref);
  return slots.size;
}

async function runEffect(effects: Effects, errors: Record<string, string>, key: string, fn: () => Promise<EffectResult | void>) {
  try {
    effects[key] = (await fn()) || 'done';
  } catch (err) {
    effects[key] = 'failed';
    errors[key] = describe(err);
    console.error(`[bookingLifecycle] ${key} failed:`, err);
  }
}

// ── cancel ──────────────────────────────────────────────────────────────

export interface CancelResult {
  ok: true;
  alreadyCancelled: boolean;
  slotsDeleted: number;
  pointsRefunded: number;
  promoRestored: boolean;
  effects: Effects;
  errors: Record<string, string>;
}

/**
 * Cancel a booking: status + audit, blocked_slots gone, points and the
 * promo use given back — one transaction. Then Calendar event removed,
 * passcode revoked, customer emailed; each recorded. Idempotent: calling
 * it again on a cancelled booking only retries the failed effects.
 */
export async function cancelBookingServer(bookingId: string, actor: Actor, origin: string): Promise<CancelResult> {
  const ref = bookingRef(bookingId);
  const state = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('BOOKING_NOT_FOUND');
    const b = { ...(snap.data() as BookingRecord), id: bookingId };
    const alreadyCancelled = b.status === 'cancelled';

    // Rewards back (review #12): what was taken at confirmation.
    const refundPoints = !b.pointsRefundedAt && (b.pointsActuallyDeducted || 0) > 0 && !!b.userId;
    const restorePromo = !b.promoRefundedAt && !!b.promoRedeemedAt && !!b.promoCodeId;
    const userRef = refundPoints ? adminDb.collection('users').doc(b.userId) : null;
    const userSnap = userRef ? await tx.get(userRef) : null;
    const promoRef = restorePromo ? adminDb.collection('promo_codes').doc(b.promoCodeId!) : null;
    const promoSnap = promoRef ? await tx.get(promoRef) : null;
    const slotsDeleted = await deleteSlotsTx(tx, bookingId);

    const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (!alreadyCancelled) {
      patch.status = 'cancelled';
      patch.cancelledAt = FieldValue.serverTimestamp();
      if (actor.uid) patch.cancelledBy = actor.uid;
      if (actor.email) patch.cancelledByEmail = actor.email;
      if (actor.displayName) patch.cancelledByName = actor.displayName;
      if (b.pendingExpiresAt) patch.pendingExpiresAt = FieldValue.delete();
    }
    let pointsRefunded = 0;
    if (userRef && userSnap?.exists) {
      pointsRefunded = Math.floor(b.pointsActuallyDeducted || 0);
      tx.update(userRef, { loyaltyPoints: ((userSnap.data() as UserProfile).loyaltyPoints || 0) + pointsRefunded });
      patch.pointsRefundedAt = FieldValue.serverTimestamp();
      patch.pointsRefunded = pointsRefunded;
    } else if (refundPoints) {
      patch.pointsRefundedAt = FieldValue.serverTimestamp();
      patch.pointsRefunded = 0;
    }
    let promoRestored = false;
    if (promoRef) {
      if (promoSnap?.exists) {
        const count = (promoSnap.data() as { totalUsageCount?: number }).totalUsageCount || 0;
        tx.update(promoRef, { totalUsageCount: Math.max(0, count - 1) });
        promoRestored = true;
      }
      patch.promoRefundedAt = FieldValue.serverTimestamp();
    }
    tx.update(ref, patch);
    return { booking: b, alreadyCancelled, slotsDeleted, pointsRefunded, promoRestored };
  });

  const effects: Effects = {};
  const errors: Record<string, string> = {};
  const b = state.booking;
  const redirectUri = `${origin}/api/google/callback`;
  await runEffect(effects, errors, 'gcal', async () => {
    if (!b.googleEventId) return 'skipped';
    await removeBookingFromCalendar(redirectUri, { venueId: b.venueId, googleEventId: b.googleEventId });
    await ref.update({ googleEventId: null });
  });
  await runEffect(effects, errors, 'lock', async () => {
    if (!b.lockPasscode) return 'skipped';
    await revokeBookingPasscode(bookingId);
  });
  await runEffect(effects, errors, 'email', async () => {
    if (state.alreadyCancelled && b.cancelEffects?.email === 'done') return 'skipped';
    const userSnap = await adminDb.collection('users').doc(b.userId).get();
    const user = userSnap.exists ? (userSnap.data() as { email?: string; displayName?: string }) : null;
    if (!user?.email) return 'skipped';
    const venue = await resolveVenueServer(b.venueId);
    const tpl = buildBookingCancelledEmail({
      customerName: user.displayName || 'there',
      venueName: venue?.name.zh || b.venueId,
      date: b.date, startTime: b.startTime, endTime: b.endTime, endDate: b.endDate,
      bookingId,
      whatsappLink: generateWhatsAppLink(PAYMENT_DETAILS.fps.digitsOnly, `你好，預訂編號：${bookingId}\n想查詢取消／退款`),
    });
    const r = await sendAutomatedEmail({ automationKey: 'booking_cancelled', to: user.email, subject: tpl.subject, html: tpl.html });
    return r.sent ? 'done' : 'skipped';
  });
  await ref.update({ cancelEffects: { ...effects, at: FieldValue.serverTimestamp(), ...(Object.keys(errors).length ? { errors } : {}) } });
  return { ok: true, alreadyCancelled: state.alreadyCancelled, slotsDeleted: state.slotsDeleted, pointsRefunded: state.pointsRefunded, promoRestored: state.promoRestored, effects, errors };
}

// ── status change ───────────────────────────────────────────────────────

export interface StatusResult {
  ok: true;
  previous: string;
  status: string;
  slots: 'restored' | 'kept' | 'released' | 'conflict';
  effects: Effects;
  errors: Record<string, string>;
}

/**
 * Set a booking's status by hand. The status and the audit stamp in one
 * transaction; a status that holds the time gets its blocked_slots back
 * (conflict-checked — a taken slot flags the booking for review instead
 * of stacking), a dead status releases them. A booking that becomes
 * confirmed consumes its rewards and runs the confirmation effects
 * (passcode, staff notice, Calendar; the customer email only when asked);
 * any other status re-syncs the Calendar event.
 */
export async function setBookingStatusServer(
  bookingId: string,
  next: string,
  actor: Actor,
  origin: string,
  opts: { customerEmail?: boolean } = {},
): Promise<StatusResult | CancelResult> {
  if (next === 'cancelled') return cancelBookingServer(bookingId, actor, origin);
  if (!SETTABLE_STATUSES.has(next)) throw new Error('INVALID_STATUS');
  const ref = bookingRef(bookingId);
  const state = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('BOOKING_NOT_FOUND');
    const b = { ...(snap.data() as BookingRecord), id: bookingId };
    const patch: Record<string, unknown> = {
      status: next, updatedAt: FieldValue.serverTimestamp(),
      statusChangedAt: FieldValue.serverTimestamp(), statusChangedBy: actor.uid || null,
    };
    if (next === 'confirmed' && b.status !== 'confirmed' && !b.paymentVerifiedAt) patch.paymentVerifiedAt = FieldValue.serverTimestamp();
    if (HOLDING_STATUSES.has(next) && b.pendingExpiresAt && next !== 'awaiting_payment' && next !== 'pending') patch.pendingExpiresAt = FieldValue.delete();
    let released = 0;
    if (!HOLDING_STATUSES.has(next)) released = await deleteSlotsTx(tx, bookingId);
    tx.update(ref, patch);
    return { previous: b.status, released };
  });

  let slots = (HOLDING_STATUSES.has(next) ? 'kept' : 'released') as StatusResult['slots'];
  const effects: Effects = {};
  const errors: Record<string, string> = {};
  if (HOLDING_STATUSES.has(next)) {
    // restoreBlockedSlotsIfMissing only acts on confirmed / completed; for
    // the awaiting_* statuses the slots were never deleted by a status
    // change (the expiry cron owns those), so nothing to rebuild.
    await runEffect(effects, errors, 'slots', async () => {
      const fresh = (await ref.get()).data() as BookingRecord;
      const restored = await restoreBlockedSlotsIfMissing({ ...fresh, id: bookingId });
      const after = (await ref.get()).data() as BookingRecord;
      if (after.paymentReviewRequired && after.paymentReviewReason === 'slot_taken_on_restore') { slots = 'conflict'; return 'failed'; }
      if (restored) slots = 'restored';
      return restored ? 'done' : 'skipped';
    });
  }
  const becameConfirmed = (next === 'confirmed' || next === 'completed') && state.previous !== 'confirmed' && state.previous !== 'completed';
  if (next === 'confirmed' || next === 'completed') {
    await runEffect(effects, errors, 'rewards', async () => {
      const r = await consumeBookingRewards(bookingId);
      return r.skipped ? 'skipped' : 'done';
    });
  }
  if (becameConfirmed && slots !== 'conflict') {
    // Everything a confirmed booking needs — passcode, staff notice,
    // supplier order, Calendar — with the customer email only when asked.
    await runEffect(effects, errors, 'finalize', async () => {
      const r = await finalizeConfirmedBooking(bookingId, {
        isBalancePayment: false, paymentMethodLabel: 'FPS / 手動確認', origin,
        skipCustomerEmail: !opts.customerEmail, throwOnFailure: false,
      });
      Object.assign(effects, Object.fromEntries(Object.entries(r.done).map(([k, v]) => [`finalize.${k}`, v ? 'done' : 'failed'])));
      Object.assign(errors, Object.fromEntries(Object.entries(r.failures).map(([k, v]) => [`finalize.${k}`, v])));
      return Object.keys(r.failures).length ? 'failed' : 'done';
    });
  } else {
    await runEffect(effects, errors, 'gcal', async () => {
      const fresh = { ...((await ref.get()).data() as BookingRecord), id: bookingId };
      const redirectUri = `${origin}/api/google/callback`;
      const profile = fresh.userId ? (await adminDb.collection('users').doc(fresh.userId).get()).data() as UserProfile | undefined : undefined;
      if (fresh.googleEventId) {
        await updateBookingOnCalendar(redirectUri, { booking: fresh, customerName: profile?.displayName });
      } else if (next === 'confirmed' || next === 'completed') {
        const eventId = await pushBookingToCalendar(redirectUri, { booking: fresh, customerName: profile?.displayName });
        if (eventId) await ref.update({ googleEventId: eventId });
      } else {
        return 'skipped';
      }
    });
  }
  await ref.update({ statusEffects: { ...effects, at: FieldValue.serverTimestamp(), ...(Object.keys(errors).length ? { errors } : {}) } });
  return { ok: true, previous: state.previous, status: next, slots, effects, errors };
}

// ── deposit settlement ──────────────────────────────────────────────────

export interface SettleResult extends SettlementPlan {
  ok: true;
  /** Points actually moved this call (credit positive, take-back negative). */
  pointsApplied: number;
  /** A take-back the customer's balance could not cover. */
  pointsShortfall: number;
}

/**
 * Settle (or amend) the refundable deposit: refund, deductions, what is
 * still owed, the status and the loyalty points — one transaction, so a
 * double click or a second tab cannot credit twice (review #21). Points
 * for the overflow wait until it is paid (creditPendingOverflowPoints).
 */
export async function settleDepositServer(
  bookingId: string,
  deductionsRaw: unknown,
  actor: Actor,
  mode: 'settle' | 'amend' | 'recover-points',
): Promise<SettleResult> {
  const ref = bookingRef(bookingId);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('BOOKING_NOT_FOUND');
    const b = { ...(snap.data() as BookingRecord), id: bookingId };
    const stored = (b.depositRefund as { deductions?: Array<{ label: string; amount: number }>; refundedAt?: unknown } | null) || null;
    if (mode === 'settle') {
      if (stored) throw new Error('ALREADY_SETTLED');
      const endDay = b.endDate && b.endDate !== b.date ? b.endDate : b.date;
      if (Date.now() < new Date(`${endDay}T${b.endTime}:00+08:00`).getTime()) throw new Error('EVENT_NOT_ENDED');
    } else if (!stored) {
      throw new Error('NOT_SETTLED');
    }
    const plan = settlementPlan(b, mode === 'recover-points' ? stored?.deductions || [] : deductionsRaw);
    const userRef = b.userId ? adminDb.collection('users').doc(b.userId) : null;
    const userSnap = userRef ? await tx.get(userRef) : null;

    const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (mode !== 'recover-points') {
      patch.depositRefund = {
        amount: plan.refund,
        deductions: plan.deductions,
        refundedAt: mode === 'amend' && stored?.refundedAt ? stored.refundedAt : FieldValue.serverTimestamp(),
        ...(mode === 'amend' ? { amendedAt: FieldValue.serverTimestamp(), amendedBy: actor.email ?? null } : {}),
      };
      patch.balanceDue = plan.owed;
      patch.status = plan.status;
      if (plan.owed > 0 && b.balancePaidAt) patch.balancePaidAt = FieldValue.delete();
      patch.pointsPendingOverflow = plan.pointsPendingOverflow;
    }

    let pointsApplied = 0;
    let pointsShortfall = 0;
    if (userRef && userSnap?.exists && plan.pointsDelta !== 0) {
      const current = (userSnap.data() as UserProfile).loyaltyPoints || 0;
      if (plan.pointsDelta > 0) pointsApplied = plan.pointsDelta;
      else { pointsApplied = -Math.min(current, -plan.pointsDelta); pointsShortfall = -plan.pointsDelta - (-pointsApplied); }
      tx.update(userRef, { loyaltyPoints: current + pointsApplied });
      const credited = (b.pointsCreditedAt ? (b.pointsActuallyCredited || 0) : 0) + pointsApplied;
      patch.pointsActuallyCredited = credited;
      if (!b.pointsCreditedAt) patch.pointsCreditedAt = FieldValue.serverTimestamp();
    } else if (userRef && !userSnap?.exists && mode === 'recover-points') {
      throw new Error('USER_NOT_FOUND');
    }
    tx.update(ref, patch);
    return { ok: true as const, ...plan, pointsApplied, pointsShortfall };
  });
}

/**
 * The overflow of a settlement has been paid: credit the points that
 * waited for it. Called by the two routes that record such a payment.
 * Idempotent on `pointsOverflowCreditedAt`.
 */
export async function creditPendingOverflowPoints(bookingId: string): Promise<number> {
  const ref = bookingRef(bookingId);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return 0;
    const b = snap.data() as BookingRecord;
    const pending = Math.floor(b.pointsPendingOverflow || 0);
    if (pending <= 0 || b.pointsOverflowCreditedAt || !b.userId || (b.balanceDue ?? 0) > 0) return 0;
    const userRef = adminDb.collection('users').doc(b.userId);
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) return 0;
    tx.update(userRef, { loyaltyPoints: ((userSnap.data() as UserProfile).loyaltyPoints || 0) + pending });
    tx.update(ref, {
      pointsOverflowCreditedAt: FieldValue.serverTimestamp(),
      pointsPendingOverflow: 0,
      pointsActuallyCredited: (b.pointsActuallyCredited || 0) + pending,
      ...(b.pointsCreditedAt ? {} : { pointsCreditedAt: FieldValue.serverTimestamp() }),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return pending;
  });
}
