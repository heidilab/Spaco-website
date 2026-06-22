import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/scan-slots?date=2026-07-04&venueId=cwb
 *
 * Diagnostic — dump every blocked_slot for the given date + venue.
 * Used to verify cleaning-buffer rows actually got written when a
 * booking was created (or to see why a second booking slipped past
 * the conflict check).
 */
export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date');
  const venueId = req.nextUrl.searchParams.get('venueId');
  if (!date) return NextResponse.json({ error: 'date required' }, { status: 400 });

  let q: FirebaseFirestore.Query = adminDb
    .collection('blocked_slots')
    .where('date', '==', date);
  if (venueId) q = q.where('venueId', '==', venueId);
  const snap = await q.get();
  const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
  rows.sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));
  return NextResponse.json({ count: rows.length, slots: rows });
}
