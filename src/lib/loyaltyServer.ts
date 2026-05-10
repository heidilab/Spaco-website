// Server-only loyalty point helpers. Live in their own file (rather than
// firestore.ts) because they import firebase-admin and would otherwise
// pollute the client bundle for every page that imports from firestore.ts.

import { adminDb } from './firebaseAdmin';

/** Deduct N points from a user atomically. Returns the actual amount
 *  deducted — capped to the current balance, so a customer who used
 *  redemption on multiple bookings concurrently can't go negative.
 *  The shortfall is logged for admin visibility. */
export async function deductLoyaltyPoints(userId: string, points: number): Promise<number> {
  if (!points || points <= 0) return 0;
  const userRef = adminDb.collection('users').doc(userId);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) {
      console.warn(`[loyalty] user ${userId} missing — skipping deduction of ${points} pts`);
      return 0;
    }
    const current = (snap.data() as { loyaltyPoints?: number }).loyaltyPoints || 0;
    const actual = Math.min(current, Math.floor(points));
    if (actual < points) {
      console.warn(`[loyalty] user ${userId} short ${points - actual} pts (had ${current}, asked ${points})`);
    }
    tx.update(userRef, { loyaltyPoints: current - actual });
    return actual;
  });
}

/** Refund N points to a user (used when a redeeming booking is
 *  cancelled / refunded). Server-side, no balance check. */
export async function refundLoyaltyPoints(userId: string, points: number): Promise<void> {
  if (!points || points <= 0) return;
  const userRef = adminDb.collection('users').doc(userId);
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) return;
    const current = (snap.data() as { loyaltyPoints?: number }).loyaltyPoints || 0;
    tx.update(userRef, { loyaltyPoints: current + Math.floor(points) });
  });
}
