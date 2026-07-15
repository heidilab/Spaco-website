import { NextRequest, NextResponse } from 'next/server';
import { syncCalendars, getCalendarIds } from '@/lib/googleCalendar';
import { adminDb } from '@/lib/firebaseAdmin';
import { requireCronSecret } from '@/lib/adminAuth';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * GET /api/admin/diag-gcal-sync
 *
 * Diagnostic — runs the same syncCalendars() the cron uses and
 * surfaces the full SyncResult so we can see if Google → website
 * mirror is broken (token revoked, calendar IDs missing, API quota,
 * etc). Also reports how many `gcal`-sourced blocked_slots already
 * exist + the most recent sync timestamp on any of them.
 */
export async function GET(req: NextRequest) {
  const _gate = requireCronSecret(req);
  if (_gate) return _gate;

  const origin = req.nextUrl.origin;
  const redirectUri = `${origin}/api/google/callback`;

  // Snapshot of current gcal mirror state — useful to compare against
  // what we expect (Heidi's hand-entered calendar events).
  let existingCount = 0;
  let mostRecentSyncedAt: string | null = null;
  let mostRecentEventTitle: string | null = null;
  try {
    const snap = await adminDb
      .collection('blocked_slots')
      .where('reason', '==', 'gcal')
      .get();
    existingCount = snap.docs.length;
    let recentMs = 0;
    for (const d of snap.docs) {
      const data = d.data() as { syncedAt?: unknown; eventTitle?: string };
      const ts = data.syncedAt;
      let ms = 0;
      if (typeof ts === 'string') ms = new Date(ts).getTime();
      else if ((ts as { toMillis?: () => number })?.toMillis) ms = (ts as { toMillis: () => number }).toMillis();
      else if ((ts as { seconds?: number })?.seconds) ms = (ts as { seconds: number }).seconds * 1000;
      if (ms > recentMs) {
        recentMs = ms;
        mostRecentEventTitle = data.eventTitle ?? null;
      }
    }
    mostRecentSyncedAt = recentMs > 0 ? new Date(recentMs).toISOString() : null;
  } catch (err) {
    return NextResponse.json({ ok: false, stage: 'snapshot', error: err instanceof Error ? err.message : String(err) });
  }

  let syncResult: unknown = null;
  let syncErr: string | null = null;
  try {
    syncResult = await syncCalendars(redirectUri);
  } catch (err) {
    syncErr = err instanceof Error ? err.message : String(err);
  }

  // Surface which calendar IDs the cron is reading, so we can tell
  // whether a missing event is actually missing or just on a
  // calendar the cron doesn't know about.
  const calendarIds = getCalendarIds();
  const calendarsConfigured = Object.entries(calendarIds).map(([k, id]) => ({
    venueKey: k,
    configured: !!id,
    // Show last 10 chars of the id (calendar ids end in something
    // distinctive but we don't need to leak the whole thing in logs).
    idTail: id ? `…${id.slice(-12)}` : null,
  }));

  // Sample latest 5 gcal-mirrored slots so admin can spot whether
  // what's mirrored matches what they marked in Google.
  let sampleSlots: Array<Record<string, unknown>> = [];
  try {
    const snap = await adminDb
      .collection('blocked_slots')
      .where('reason', '==', 'gcal')
      .get();
    sampleSlots = snap.docs
      .map((d) => {
        const data = d.data() as { eventTitle?: string; date?: string; startTime?: string; endTime?: string; venueId?: string; googleEventId?: string };
        return {
          date: data.date,
          startTime: data.startTime,
          endTime: data.endTime,
          venueId: data.venueId,
          eventTitle: data.eventTitle,
          googleEventId: data.googleEventId,
        };
      })
      .sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`))
      .slice(0, 8);
  } catch { /* non-fatal */ }

  return NextResponse.json({
    ok: !syncErr,
    syncErr,
    existingMirroredSlots: existingCount,
    mostRecentSyncedAt,
    mostRecentEventTitle,
    calendarsConfigured,
    syncResult,
    sampleSlots,
  });
}
