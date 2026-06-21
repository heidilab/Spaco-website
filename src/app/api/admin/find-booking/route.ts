import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';

/**
 * GET /api/admin/find-booking?date=2026-07-04&venueId=cwb&startTime=13:00
 *
 * Lookup helper — find a booking by date/venue/time when admin only
 * remembers the schedule (not the 8-char id). Returns matching
 * bookings with their full doc data so we can inspect details
 * downstream.
 */
export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date');
  const venueId = req.nextUrl.searchParams.get('venueId');
  const startTime = req.nextUrl.searchParams.get('startTime');
  if (!date) return NextResponse.json({ error: 'date required' }, { status: 400 });

  let query: FirebaseFirestore.Query = adminDb.collection('bookings').where('date', '==', date);
  if (venueId) query = query.where('venueId', '==', venueId);
  const snap = await query.get();
  const rows = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
    .filter((b) => !startTime || (b as { startTime?: string }).startTime === startTime);
  return NextResponse.json({ count: rows.length, bookings: rows });
}
