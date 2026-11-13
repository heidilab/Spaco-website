// Consuming a booking's rewards — loyalty points redeemed and the promo
// code used — the moment the booking is CONFIRMED, on every path that
// confirms one. PURE-ish server module (Admin SDK), shared by the KPay
// webhook's cousin `settleKpayPayment`, the payment-confirmed route, the
// offline-payment / follow-up / settle-balance admin routes and the
// admin status change (via /api/admin/booking-confirmed).
//
// Site review 2026-11-13 (#6): only the KPay settlement and the
// payment-confirmed email route consumed rewards. 「已於線下付款」, the
// follow-up payment branch, settle-balance and the status dropdown did
// not — an FPS customer who redeemed points and a single-use voucher,
// confirmed by staff, kept the points and could reuse the voucher. The
// payment-confirmed route also returned early (no customer email) before
// its consumption block, and that block was not transactional.
//
// Idempotent: `pointsRedeemedAt` / `promoRedeemedAt` on the booking are
// the markers; a second call is a no-op. One Firestore transaction, so
// two concurrent confirmations cannot deduct or count twice.

import { adminDb } from './firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import type { BookingRecord } from '@/types';

export interface ConsumedRewards {
  /** Points actually taken off the account this call (0 when nothing to do). */
  pointsDeducted: number;
  /** Whether this call counted the promo code's use. */
  promoCounted: boolean;
  /** Why nothing happened, when nothing did. */
  skipped?: 'not-found' | 'not-confirmed' | 'already-consumed' | 'nothing-to-consume';
}

const CONFIRMED = new Set(['confirmed', 'completed']);

export async function consumeBookingRewards(bookingId: string): Promise<ConsumedRewards> {
  const ref = adminDb.collection('bookings').doc(bookingId);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { pointsDeducted: 0, promoCounted: false, skipped: 'not-found' };
    const b = snap.data() as BookingRecord;
    if (!CONFIRMED.has(b.status)) return { pointsDeducted: 0, promoCounted: false, skipped: 'not-confirmed' };

    const wantsPoints = (b.pointsUsed || 0) > 0 && !b.pointsRedeemedAt && !!b.userId;
    const wantsPromo = !!b.promoCodeId && !b.promoRedeemedAt;
    if (!wantsPoints && !wantsPromo) {
      return {
        pointsDeducted: 0, promoCounted: false,
        skipped: (b.pointsRedeemedAt || b.promoRedeemedAt) ? 'already-consumed' : 'nothing-to-consume',
      };
    }

    // Reads before writes (Firestore transaction rule).
    const userRef = wantsPoints ? adminDb.collection('users').doc(b.userId) : null;
    const userSnap = userRef ? await tx.get(userRef) : null;
    const promoRef = wantsPromo ? adminDb.collection('promo_codes').doc(b.promoCodeId!) : null;
    const promoSnap = promoRef ? await tx.get(promoRef) : null;

    const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    let pointsDeducted = 0;
    if (userRef && userSnap?.exists) {
      const current = (userSnap.data() as { loyaltyPoints?: number }).loyaltyPoints || 0;
      // Never below zero: deduct what the account still holds.
      pointsDeducted = Math.max(0, Math.min(current, Math.floor(b.pointsUsed || 0)));
      tx.update(userRef, { loyaltyPoints: current - pointsDeducted });
      patch.pointsRedeemedAt = FieldValue.serverTimestamp();
      patch.pointsActuallyDeducted = pointsDeducted;
    } else if (wantsPoints) {
      // Profile missing — record that nothing could be deducted so the
      // next call does not retry forever.
      patch.pointsRedeemedAt = FieldValue.serverTimestamp();
      patch.pointsActuallyDeducted = 0;
    }
    let promoCounted = false;
    if (promoRef) {
      if (promoSnap?.exists) tx.update(promoRef, { totalUsageCount: FieldValue.increment(1) });
      patch.promoRedeemedAt = FieldValue.serverTimestamp();
      promoCounted = !!promoSnap?.exists;
    }
    tx.update(ref, patch);
    return { pointsDeducted, promoCounted };
  });
}
