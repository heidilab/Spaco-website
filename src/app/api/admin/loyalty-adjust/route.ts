import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { requireAdmin } from '@/lib/adminAuth';
import { adminDb } from '@/lib/firebaseAdmin';
export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req, 'deposit');
  if (!gate.ok) return gate.res;
  const { userId, amount } = await req.json();
  if (typeof userId !== 'string' || !userId || userId.includes('/') || !Number.isSafeInteger(amount) || Math.abs(amount) > 10000000) {
    return NextResponse.json({ error: 'INVALID_ADJUSTMENT' }, { status: 400 });
  }
  const ref = adminDb.collection('users').doc(userId);
  const ok = await adminDb.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists || (snap.data()?.loyaltyPoints || 0) + amount < 0) return false;
    tx.update(ref, { loyaltyPoints: (snap.data()?.loyaltyPoints || 0) + amount });
    tx.create(adminDb.collection('_loyalty_adjustments').doc(), {
      userId, amount, recordedBy: gate.uid, createdAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
  return NextResponse.json({ ok, amount: ok ? amount : 0 });
}
