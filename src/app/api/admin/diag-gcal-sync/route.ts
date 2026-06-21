import { NextRequest, NextResponse } from 'next/server';
import { syncCalendars } from '@/lib/googleCalendar';
import { adminDb } from '@/lib/firebaseAdmin';

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

  return NextResponse.json({
    ok: !syncErr,
    syncErr,
    existingMirroredSlots: existingCount,
    mostRecentSyncedAt,
    mostRecentEventTitle,
    syncResult,
  });
}
