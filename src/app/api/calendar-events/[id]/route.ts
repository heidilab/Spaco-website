import { NextRequest, NextResponse } from 'next/server';
import { updateCalendarEvent, deleteCalendarEvent } from '@/lib/calendarEvents';
import { requireAdmin } from '@/lib/adminAuth';

// PATCH /api/calendar-events/[id]
// body: partial update — { date?, startTime?, endTime?, venueId?, notes? }
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const _gate = await requireAdmin(req, 'gcal');
  if (!_gate.ok) return _gate.res;

  try {
    const body = await req.json();
    const redirectUri = `${req.nextUrl.origin}/api/google/callback`;
    await updateCalendarEvent(redirectUri, params.id, body || {});
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Update failed' },
      { status: 500 },
    );
  }
}

// DELETE /api/calendar-events/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const _gate = await requireAdmin(req, 'gcal');
  if (!_gate.ok) return _gate.res;

  try {
    const redirectUri = `${req.nextUrl.origin}/api/google/callback`;
    await deleteCalendarEvent(redirectUri, params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Delete failed' },
      { status: 500 },
    );
  }
}
