import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { runPaymentFinalization } from '@/lib/paymentFinalization';
import { getPublicOrigin } from '@/lib/kpay';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const jobs = await adminDb.collection('_payment_finalizations').where('status', '==', 'pending').limit(5).get();
  let failed = 0;
  for (const job of jobs.docs) {
    try { await runPaymentFinalization(job.id, getPublicOrigin(req.nextUrl.origin)); }
    catch { failed++; }
  }
  return NextResponse.json({ scanned: jobs.size, failed });
}
