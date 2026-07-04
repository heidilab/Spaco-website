import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
// Firestore read must run per-request — without this Vercel snapshots
// the response at build time and serves stale entries forever.
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/kpay-webhook-debug
 *
 * Returns the 50 most recent KPay webhook attempts (raw body, headers,
 * verification result, matched variant). Used to reverse-engineer KPay's
 * signing convention when Vercel CLI logs aren't surfacing recent runs.
 *
 * No auth (preview-only). Remove or gate before merging to main.
 */
export async function GET() {
  try {
    const snap = await adminDb
      .collection('_kpay_webhook_debug')
      .orderBy('receivedAt', 'desc')
      .limit(50)
      .get();
    const entries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ count: entries.length, entries });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed' },
      { status: 500 },
    );
  }
}
