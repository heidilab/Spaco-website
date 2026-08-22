import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { requireAdmin } from '@/lib/adminAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/traffic-report?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Date-range traffic + conversion analytics from the visits collection
 * (defaults to the last 30 days):
 *   • per source: visit count, unique visitors, bookings converted
 *     (attributed to the visitor's FIRST visit source in range),
 *     revenue from those bookings
 *   • journey stats: average visits per converting visitor
 */
export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req, 'bookings');
  if (!gate.ok) return gate.res;

  const todayHk = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const defaultFrom = new Date(Date.now() + 8 * 3600 * 1000 - 29 * 86400 * 1000)
    .toISOString().slice(0, 10);
  const from = req.nextUrl.searchParams.get('from') || defaultFrom;
  const to = req.nextUrl.searchParams.get('to') || todayHk;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    return NextResponse.json({ error: 'bad range' }, { status: 400 });
  }
  const rangeStart = new Date(`${from}T00:00:00+08:00`);
  const rangeEnd = new Date(`${to}T23:59:59.999+08:00`);

  // Visits in range.
  const visitsSnap = await adminDb.collection('visits')
    .where('createdAt', '>=', rangeStart)
    .where('createdAt', '<=', rangeEnd)
    .get();
  interface V {
    visitorId: string; userId?: string | null; source: string;
    utmSource?: string | null; referrerHost?: string | null;
    createdAt?: FirebaseFirestore.Timestamp;
  }
  const visits = visitsSnap.docs.map((d) => d.data() as V);

  // ai_assistant visits sub-split by model, derived from the raw
  // utm_source / referrer the AI tool stamped (e.g. chatgpt.com).
  const aiModelOf = (v: V): string => {
    const raw = `${v.utmSource || ''} ${v.referrerHost || ''}`.toLowerCase();
    if (raw.includes('chatgpt') || raw.includes('openai')) return 'chatgpt';
    if (raw.includes('perplexity')) return 'perplexity';
    if (raw.includes('gemini') || raw.includes('bard')) return 'gemini';
    if (raw.includes('copilot') || raw.includes('bing')) return 'copilot';
    if (raw.includes('claude') || raw.includes('anthropic')) return 'claude';
    return 'unknown';
  };
  const srcKey = (v: V): string =>
    v.source === 'ai_assistant' ? `ai_assistant:${aiModelOf(v)}` : v.source;

  // Bookings created in range (live ones only).
  const bookingsSnap = await adminDb.collection('bookings')
    .where('createdAt', '>=', rangeStart)
    .where('createdAt', '<=', rangeEnd)
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

  for (const v of visits) row(srcKey(v)).visits += 1;
  const seenVisitorSource = new Set<string>();
  for (const v of visits) {
    const key = `${v.visitorId}|${srcKey(v)}`;
    if (!seenVisitorSource.has(key)) {
      seenVisitorSource.add(key);
      row(srcKey(v)).uniqueVisitors += 1;
    }
  }

  const visitCountsBeforeBooking: number[] = [];
  let attributed = 0;
  for (const b of bookings) {
    const visitorId = b.visitorId
      || (b.userId ? userToVisitor.get(b.userId) : undefined);
    const journey = visitorId ? (byVisitor.get(visitorId) || []) : [];
    // Attribution: the visitor's FIRST visit source in range; falls
    // back to the first-touch source stamped on the booking itself.
    const src = journey.length > 0
      ? srcKey(journey.sort((a, c) => (a.createdAt?.toMillis?.() || 0) - (c.createdAt?.toMillis?.() || 0))[0])
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
    from,
    to,
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
