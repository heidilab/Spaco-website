import { NextRequest, NextResponse } from 'next/server';
import { runReceiptIngest } from '@/lib/receiptIngest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 單據自動入帳 — every 15 min: new files under Heidi's OneDrive receipts
 * folder → Claude reads them → `expenses` rows (source 'receipt') → her
 * Excel. Up to 4 files per run (each read is a few seconds); the rest
 * wait for the next tick. Does nothing until a folder is chosen in 後台.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const summary = await runReceiptIngest({ maxFiles: 4 });
  return NextResponse.json({ ok: !summary.error, ...summary });
}
