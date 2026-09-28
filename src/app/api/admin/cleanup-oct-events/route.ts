import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { adminDb } from '@/lib/firebaseAdmin';
import { getStoredToken, buildOAuthClient, getCalendarIdForVenue } from '@/lib/googleCalendar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// TEMP one-off (Heidi 2026-09-30): purge the runaway site_visit/delivery
// spam across October — Google Calendar events + any Firestore
// calendar_events + gcal blocked_slots in the month. Token-gated.
const T = '41235b4ca15eaf71008a294df515e6530949cb3b3f89e8f5';

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get('token') !== T) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const dry = request.nextUrl.searchParams.get('dry') === '1';
  const out: Record<string, unknown> = {};

  // ── Firestore calendar_events in October ──
  const ceSnap = await adminDb.collection('calendar_events')
    .where('date', '>=', '2026-10-01').where('date', '<=', '2026-10-31').get();
  out.calendarEvents = ceSnap.size;

  // ── Firestore gcal blocked_slots in October ──
  const bsSnap = await adminDb.collection('blocked_slots')
    .where('date', '>=', '2026-10-01').where('date', '<=', '2026-10-31').get();
  const bsGcal = bsSnap.docs.filter((d) => (d.data() as { reason?: string }).reason === 'gcal');
  out.gcalBlockedSlots = bsGcal.length;

  // ── Google Calendar October site_visit + delivery ──
  const stored = await getStoredToken();
  const gEvents: Array<{ calendarId: string; id: string; date: string; summary: string }> = [];
  if (stored) {
    const redirectUri = `${request.nextUrl.origin}/api/google/callback`;
    const oauth2 = buildOAuthClient(redirectUri);
    oauth2.setCredentials({ refresh_token: stored.refresh_token });
    const cal = google.calendar({ version: 'v3', auth: oauth2 });
    const calIds = Array.from(new Set((await Promise.all(
      ['cwb', 'sw-a', 'sw-b', 'sw-ab', 'tst', 'wanchai'].map((v) => getCalendarIdForVenue(v)),
    )).filter(Boolean))) as string[];
    for (const calendarId of calIds) {
      const res = await cal.events.list({
        calendarId, timeMin: '2026-10-01T00:00:00+08:00', timeMax: '2026-11-01T00:00:00+08:00',
        singleEvents: true, maxResults: 2500,
      });
      for (const ev of res.data.items || []) {
        const t = ev.extendedProperties?.private?.spaco_event_type;
        const isTarget = t === 'site_visit' || t === 'delivery'
          || /site visit|delivery|送貨/i.test(ev.summary || '');
        if (!isTarget) continue;
        const start = ev.start?.dateTime || ev.start?.date || '';
        gEvents.push({ calendarId, id: ev.id!, date: start.slice(0, 10), summary: ev.summary || '' });
      }
    }
  }
  out.googleEvents = gEvents.length;

  if (dry) {
    return NextResponse.json({ dry: true, ...out,
      googleDates: gEvents.map((g) => g.date).sort(),
      googleSummaries: Array.from(new Set(gEvents.map((g) => g.summary))) });
  }

  // ── Delete everything ──
  let ceDel = 0, bsDel = 0, gDel = 0;
  for (const d of ceSnap.docs) { await d.ref.delete(); ceDel++; }
  for (const d of bsGcal) { await d.ref.delete(); bsDel++; }
  if (stored) {
    const redirectUri = `${request.nextUrl.origin}/api/google/callback`;
    const oauth2 = buildOAuthClient(redirectUri);
    oauth2.setCredentials({ refresh_token: stored.refresh_token });
    const cal = google.calendar({ version: 'v3', auth: oauth2 });
    for (const g of gEvents) {
      try { await cal.events.delete({ calendarId: g.calendarId, eventId: g.id }); gDel++; }
      catch (err) { console.warn('[cleanup-oct] gcal del failed', g.id, err); }
    }
  }
  return NextResponse.json({ ok: true, calendarEventsDeleted: ceDel, gcalBlockedSlotsDeleted: bsDel, googleEventsDeleted: gDel });
}
