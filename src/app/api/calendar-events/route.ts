import { NextRequest, NextResponse } from 'next/server';
import { createCalendarEvent } from '@/lib/calendarEvents';
import { CalendarEventType } from '@/types';

const VALID_TYPES: CalendarEventType[] = ['site_visit', 'delivery'];

// POST /api/calendar-events
// body: { type, venueId, date, startTime, endTime, notes? }
export async function POST(req: NextRequest) {
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
