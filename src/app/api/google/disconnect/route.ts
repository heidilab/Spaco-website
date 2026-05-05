import { NextResponse } from 'next/server';
import { disconnectGoogle } from '@/lib/googleCalendar';

// POST /api/google/disconnect → clear stored refresh token.
export async function POST() {
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
