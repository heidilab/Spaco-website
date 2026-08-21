import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_SOURCES = new Set([
  'google_ads', 'google_organic', 'instagram', 'facebook',
  'whatsapp', 'threads', 'xiaohongshu', 'direct', 'other',
]);

/**
 * POST /api/track-visit — one event per browser session, written by
 * <VisitTracker />. Unauthenticated by design (visitors aren't logged
 * in); payload is whitelisted + clamped so junk can't bloat the doc.
 *
 * visits/{auto}: { visitorId, userId?, source, referrerHost?, utm*,
 *                  landingPath, month: 'YYYY-MM', createdAt }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const clamp = (v: unknown, n: number) =>
      typeof v === 'string' && v.length > 0 ? v.slice(0, n) : null;

    const visitorId = clamp(body.visitorId, 64);
    const source = typeof body.source === 'string' && VALID_SOURCES.has(body.source)
      ? body.source : 'other';
    if (!visitorId) {
      return NextResponse.json({ error: 'visitorId required' }, { status: 400 });
    }

    // HK-local month key so "August" means HK August, not UTC.
    const now = new Date();
    const hk = new Date(now.getTime() + 8 * 3600 * 1000);
    const month = hk.toISOString().slice(0, 7);

    await adminDb.collection('visits').add({
      visitorId,
      userId: clamp(body.userId, 64),
      source,
      referrerHost: clamp(body.referrerHost, 128),
      utmSource: clamp(body.utmSource, 64),
      utmMedium: clamp(body.utmMedium, 64),
      utmCampaign: clamp(body.utmCampaign, 128),
      landingPath: clamp(body.landingPath, 256),
      month,
      createdAt: FieldValue.serverTimestamp(),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[track-visit]', err);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
