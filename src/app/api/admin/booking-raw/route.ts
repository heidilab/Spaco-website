import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';

/**
 * GET /api/admin/booking-raw?id=...
 *
 * Dump the entire booking doc as-is (minus timestamps that don't
 * serialise) — for diagnostics when we need to see fields the
 * inspect endpoint doesn't surface (guestCount/childCount/hours
 * combinations, custom add-on options, gcal eventId, etc).
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  let snap = await adminDb.collection('bookings').doc(id).get();
  let resolvedId = id;
  if (!snap.exists) {
    const all = await adminDb.collection('bookings').get();
    const hit = all.docs.find((d) => d.id.startsWith(id));
    if (!hit) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    snap = hit;
    resolvedId = hit.id;
  }
  const data = snap.data() as Record<string, unknown>;
  // Convert any Firestore Timestamps to ISO strings.
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && 'toDate' in (v as { toDate?: () => Date })) {
      try { clean[k] = (v as { toDate: () => Date }).toDate().toISOString(); }
      catch { clean[k] = v; }
    } else {
      clean[k] = v;
    }
  }
  return NextResponse.json({ id: resolvedId, ...clean });
}
