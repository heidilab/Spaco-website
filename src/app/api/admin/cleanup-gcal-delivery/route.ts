import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getStoredToken, buildOAuthClient, getCalendarIdForVenue } from '@/lib/googleCalendar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * TEMPORARY one-off (Heidi 2026-09-30): delete duplicated 'delivery'
 * events pushed to Google Calendar across October by a hung/looping
 * submit. Keeps the FIRST occurrence per (calendar,date,start,summary),
 * deletes the rest. Token-gated; deleted right after the run.
 */
const T = '38791823681c68545ac7948f51080b47c45a2219e3f1eb4b';

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get('token') !== T) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const dry = request.nextUrl.searchParams.get('dry') === '1';
  const stored = await getStoredToken();
  if (!stored) return NextResponse.json({ error: 'no google token' }, { status: 400 });

  const redirectUri = `${request.nextUrl.origin}/api/google/callback`;
  const oauth2 = buildOAuthClient(redirectUri);
  oauth2.setCredentials({ refresh_token: stored.refresh_token });
  const cal = google.calendar({ version: 'v3', auth: oauth2 });

  // SW rooms share one calendar; dedupe calendar ids across the group.
  const calIds = Array.from(new Set((await Promise.all(
    ['sw-a', 'sw-b', 'sw-ab'].map((v) => getCalendarIdForVenue(v)),
  )).filter(Boolean))) as string[];

  // Every October (1–31) delivery is spam — the real one is 2026-09-29.
  const toDelete: Array<{ calendarId: string; id: string; date: string; summary: string; notes: string }> = [];

  for (const calendarId of calIds) {
    const res = await cal.events.list({
      calendarId,
      timeMin: '2026-10-01T00:00:00+08:00',
      timeMax: '2026-11-01T00:00:00+08:00',
      singleEvents: true,
      maxResults: 2500,
    });
    for (const ev of res.data.items || []) {
      const isDelivery = ev.extendedProperties?.private?.spaco_event_type === 'delivery'
        || /delivery|送貨/i.test(ev.summary || '');
      if (!isDelivery) continue;
      const start = ev.start?.dateTime || ev.start?.date || '';
      toDelete.push({ calendarId, id: ev.id!, date: start.slice(0, 10), summary: ev.summary || '', notes: ev.description || '' });
    }
  }
  const totalDelivery = toDelete.length;

  if (dry) {
    return NextResponse.json({ dry: true, totalDelivery,
      dates: toDelete.map((d) => d.date).sort(),
      summaries: Array.from(new Set(toDelete.map((d) => `${d.summary} / ${d.notes}`))) });
  }

  let deleted = 0;
  for (const d of toDelete) {
    try { await cal.events.delete({ calendarId: d.calendarId, eventId: d.id }); deleted++; }
    catch (err) { console.warn('[cleanup-gcal-delivery] failed', d.id, err); }
  }
  return NextResponse.json({ ok: true, totalDelivery, deleted });
}
