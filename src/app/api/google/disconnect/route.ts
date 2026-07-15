import { NextResponse } from 'next/server';
import { disconnectGoogle } from '@/lib/googleCalendar';
import { requireAdmin } from '@/lib/adminAuth';

// POST /api/google/disconnect → clear stored refresh token.
export async function POST(req: Request) {
  const _gate = await requireAdmin(req, 'gcal');
  if (!_gate.ok) return _gate.res;

  try {
    await disconnectGoogle();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Disconnect failed' },
      { status: 500 },
    );
  }
}
