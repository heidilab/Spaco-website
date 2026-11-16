import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { rewriteReceiptExcelRows } from '@/lib/receiptIngest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST /api/onedrive/excel-rewrite — re-place every receipt line in her
// workbooks under the current placement rule. Relay while remaining > 0.
export async function POST(req: Request) {
  const gate = await requireAdmin(req, 'staff');
  if (!gate.ok) return gate.res;
  try {
    return NextResponse.json(await rewriteReceiptExcelRows(Date.now() + 38_000));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'rewrite failed' }, { status: 502 });
  }
}
