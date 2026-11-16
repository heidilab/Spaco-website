import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { runReceiptIngest } from '@/lib/receiptIngest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST /api/onedrive/sync — the 「立即同步」 button; same run as the cron.
export async function POST(req: Request) {
  const gate = await requireAdmin(req, 'staff');
  if (!gate.ok) return gate.res;
  return NextResponse.json(await runReceiptIngest({ maxFiles: 4, budgetMs: 38_000 }));
}
