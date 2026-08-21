import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { requireAdmin } from '@/lib/adminAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/traffic-report?month=YYYY-MM
 *
 * Monthly traffic + conversion analytics from the visits collection:
 *   • per source: visit count, unique visitors, bookings converted
 *     (visitor booked in the same month, attributed to their FIRST
 *     visit source of that month), revenue from those bookings
 *   • journey stats: average visits per converting visitor, and the
 *     distribution of how many times people visited before booking
 */
export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req, 'bookings');
  if (!gate.ok) return gate.res;

  const month = req.nextUrl.searchParams.get('month')
    || new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'bad month' }, { status: 400 });
  }

  // Visits this month.
  const visitsSnap = await adminDb.collection('visits')
    .where('month', '==', month).get();
  interface V { visitorId: string; userId?: string | null; source: string; createdAt?: FirebaseFirestore.Timestamp }
  const visits = visitsSnap.docs.map((d) => d.data() as V);

  // Bookings created this month (live ones only).
  const monthStart = new Date(`${month}-01T00:00:00+08:00`);
  const nextMonth = new Date(monthStart);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const bookingsSnap = await adminDb.collection('bookings')
    .where('createdAt', '>=', monthStart)
    .where('createdAt', '<', nextMonth)
    .get();
  const bookings = bookingsSnap.docs
    .map((d) => ({ id: d.id, ...d.data() } as {
      id: string; status: string; visitorId?: string; userId?: string;
      firstTouchSource?: string;
      pricing?: { subtotal?: number; securityDeposit?: number };
      promoDiscount?: number;
    }))
    .filter((b) => b.status !== 'cancelled' && b.status !== 'payment_not_completed');

  // Per-visitor journey within the month.
  const byVisitor = new Map<string, V[]>();
  for (const v of visits) {
    const arr = byVisitor.get(v.visitorId) || [];
    arr.push(v);
    byVisitor.set(v.visitorId, arr);
  }
  // userId → visitorId links (login on any visit links the two).
  const userToVisitor = new Map<string, string>();
  for (const v of visits) {
    if (v.userId) userToVisitor.set(v.userId, v.visitorId);
  }

  // Attribute each booking to a visitor (direct visitorId stamp first,
  // then via the customer's userId appearing on a visit).
  const revenueOf = (b: typeof bookings[number]) =>
    Math.max(0, (b.pricing?.subtotal || 0) - (b.promoDiscount || 0));

  interface SourceRow {
    visits: number; uniqueVisitors: number; bookings: number; revenue: number;
  }
  const bySource: Record<string, SourceRow> = {};
  const row = (s: string) => (bySource[s] ||= { visits: 0, uniqueVisitors: 0, bookings: 0, revenue: 0 });

  for (const v of visits) row(v.source).visits += 1;
  const seenVisitorSource = new Set<string>();
  for (const v of visits) {
    const key = `${v.visitorId}|${v.source}`;
    if (!seenVisitorSource.has(key)) {
      seenVisitorSource.add(key);
      row(v.source).uniqueVisitors += 1;
    }
  }

  const visitCountsBeforeBooking: number[] = [];
  let attributed = 0;
  for (const b of bookings) {
    const visitorId = b.visitorId
      || (b.userId ? userToVisitor.get(b.userId) : undefined);
    const journey = visitorId ? (byVisitor.get(visitorId) || []) : [];
    // Attribution: the visitor's FIRST visit source this month; falls
    // back to the first-touch source stamped on the booking itself.
    const src = journey.length > 0
      ? journey.sort((a, c) => (a.createdAt?.toMillis?.() || 0) - (c.createdAt?.toMillis?.() || 0))[0].source
      : (b.firstTouchSource || null);
    if (src) {
      row(src).bookings += 1;
      row(src).revenue += revenueOf(b);
      attributed += 1;
      if (journey.length > 0) visitCountsBeforeBooking.push(journey.length);
    }
  }

  const avgVisitsBeforeBooking = visitCountsBeforeBooking.length
    ? Math.round((visitCountsBeforeBooking.reduce((s, n) => s + n, 0) / visitCountsBeforeBooking.length) * 10) / 10
    : null;

  return NextResponse.json({
    month,
    totals: {
      visits: visits.length,
      uniqueVisitors: byVisitor.size,
      bookings: bookings.length,
      attributedBookings: attributed,
      unattributedBookings: bookings.length - attributed,
      avgVisitsBeforeBooking,
      visitDistribution: visitCountsBeforeBooking,
    },
    bySource,
  });
}
