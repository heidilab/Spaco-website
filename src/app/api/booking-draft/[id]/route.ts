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
  const data = snap.data()!;
  if (data.status !== 'pending' || data.claimedBy || !data.expiresAt?.toMillis || data.expiresAt.toMillis() <= Date.now()) {
    return NextResponse.json({ error: 'link-unavailable' }, { status: 410 });
  }
  const result: Record<string, unknown> = { id: snap.id, claimedBy: null };
  for (const key of ['venueId', 'branchSlug', 'date', 'endDate', 'startTime', 'endTime', 'hours',
    'guestCount', 'adultCount', 'childCount', 'isWeekend', 'addOns', 'hasBYOFood', 'pricing',
    'peakSurchargeOverride', 'promoCode', 'promoCodeId', 'promoDiscount', 'promoFreeDrinksCost',
    'packageSlug', 'status']) {
    if (data[key] !== undefined) result[key] = data[key];
  }
  result.expiresAt = data.expiresAt.toMillis();
  return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
}
