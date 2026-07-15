import { NextRequest, NextResponse } from 'next/server';
import { syncCalendars } from '@/lib/googleCalendar';
import { requireAdmin } from '@/lib/adminAuth';

// POST /api/google/sync → run direction-B sync (Google → blocked_slots).
// Called by the admin "Sync now" button or by a cron job.
export async function POST(req: NextRequest) {
  const _gate = await requireAdmin(req, 'gcal');
  if (!_gate.ok) return _gate.res;

  try {
    const origin = req.nextUrl.origin;
    const redirectUri = `${origin}/api/google/callback`;
    const result = await syncCalendars(redirectUri);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Sync failed' },
      { status: 500 },
    );
  }
}
