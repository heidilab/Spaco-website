import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { updateReceiptExpense, deleteReceiptExpense } from '@/lib/receiptIngest';

export const runtime = 'nodejs';
export const maxDuration = 30;

// PATCH /api/onedrive/expense { id, item?, amount?, date?, note?, reviewed? }
// Edits from 支出管理 to a receipt row — saved to Firestore AND mirrored to
// the Excel row with the same id. DELETE ?id=… removes both.
export async function PATCH(req: NextRequest) {
  const gate = await requireAdmin(req, 'staff');
  if (!gate.ok) return gate.res;
  let body: { id?: string; item?: string; amount?: number; date?: string; note?: string; reviewed?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  try {
    const { id, ...patch } = body;
    const row = await updateReceiptExpense(id, patch, gate.uid);
    return NextResponse.json({ ok: true, excel: row.excel || null });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'update failed' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const gate = await requireAdmin(req, 'staff');
  if (!gate.ok) return gate.res;
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  try {
    await deleteReceiptExpense(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'delete failed' }, { status: 500 });
  }
}
