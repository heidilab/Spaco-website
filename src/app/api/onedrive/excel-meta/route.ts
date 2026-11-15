import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { getWorkbookMeta } from '@/lib/msgraph';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/onedrive/excel-meta?itemId=… → sheets with header rows + tables.
export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req, 'staff');
  if (!gate.ok) return gate.res;
  const itemId = req.nextUrl.searchParams.get('itemId');
  if (!itemId) return NextResponse.json({ error: 'itemId required' }, { status: 400 });
  try {
    return NextResponse.json(await getWorkbookMeta(itemId));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'workbook read failed' }, { status: 502 });
  }
}
