import { NextRequest, NextResponse } from 'next/server';
import { createCalendarEvent } from '@/lib/calendarEvents';
import { CalendarEventType } from '@/types';
import { requireAdmin } from '@/lib/adminAuth';

const VALID_TYPES: CalendarEventType[] = ['site_visit', 'delivery'];

// POST /api/calendar-events
// body: { type, venueId, date, startTime, endTime, notes? }
export async function POST(req: NextRequest) {
  // 'bookings' (admin + cs), NOT 'gcal' (admin-only): site-visit /
  // delivery scheduling is CS daily work — the original 'gcal' gate
  // 403'd CS on 新增排程 (2026-08-12 'forbidden' incident).
  const _gate = await requireAdmin(req, 'bookings');
  if (!_gate.ok) return _gate.res;

  try {
    const body = await req.json();
    const { type, venueId, date, startTime, endTime, notes } = body || {};

    if (!type || !VALID_TYPES.includes(type)) {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
    }
    if (!venueId || !date || !startTime || !endTime) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const redirectUri = `${req.nextUrl.origin}/api/google/callback`;
    const event = await createCalendarEvent(redirectUri, {
      type, venueId, date, startTime, endTime, notes,
    });
    return NextResponse.json({ event });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Create failed' },
      { status: 500 },
    );
  }
}
