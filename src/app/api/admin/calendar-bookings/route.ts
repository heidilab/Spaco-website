import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUserHasBookingsPerm } from '@/lib/adminAuth';
import { adminDb } from '@/lib/firebaseAdmin';
export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req, 'calendar');
  if (!gate.ok) return gate.res;
  const month = req.nextUrl.searchParams.get('month') || '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return NextResponse.json({ error: 'INVALID_MONTH' }, { status: 400 });
  const canManage = await adminUserHasBookingsPerm(gate.uid);
  const snap = await adminDb.collection('bookings').where('date', '>=', `${month}-01`).where('date', '<=', `${month}-31`).get();
  const bookings = snap.docs.map(doc => {
    const data = doc.data();
    if (canManage) return { ...data, id: doc.id };
    // Calendar-only staff get operational fields, never financials, customer contacts or passcodes.
    const result: Record<string, unknown> = { id: doc.id, userId: '' };
    for (const key of ['venueId', 'date', 'endDate', 'startTime', 'endTime', 'hours', 'guestCount', 'status', 'isTest']) {
      if (data[key] !== undefined) result[key] = data[key];
    }
    return result;
  });
  return NextResponse.json({ bookings, canManage });
}
