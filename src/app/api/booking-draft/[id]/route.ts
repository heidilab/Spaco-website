import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Public GET endpoint for a booking draft. The client SDK requires auth
 * to read /booking_drafts, but the claim flow needs an unauthenticated
 * customer to be able to view their booking before signing in.
 *
 * Treats the unguessable draft id as the secret — same model as a
 * Stripe payment link. Anyone with the URL can read the draft contents.
 *
 * The claim action itself (writing claimedBy) still goes through the
 * Firestore client SDK and remains gated on the user being signed in.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'missing-id' }, { status: 400 });
  }
  const snap = await adminDb.collection('booking_drafts').doc(id).get();
  if (!snap.exists) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }
  // Spread first so the firestore-injected fields are overridden by an
  // explicit id at the top level.
  return NextResponse.json({ id: snap.id, ...snap.data() });
}
