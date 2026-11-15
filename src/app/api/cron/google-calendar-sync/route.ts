import { NextRequest, NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/adminAuth';
import { syncCalendars } from '@/lib/googleCalendar';
import { refreshStaleBookingEvents } from '@/lib/googleCalendarRefresh';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Six months of events across every branch calendar — do not let the
// default limit cut the run off before stale slots are removed.
export const maxDuration = 60;

/**
 * Pulls events from the 4 branch Google Calendars into `blocked_slots`
 * (Direction B). Runs on Vercel cron — see vercel.json.
 *
 * Direction A (booking → Google) is push-on-write at the relevant write
 * sites (Stripe webhook, admin approve, admin date/time edit). The same
 * run then self-heals the text of those pushed events: every future
 * event is rebuilt from its booking and rewritten on Google only where
 * the title / description differ (capped per run) — so a label rename
 * reaches existing events within 15 minutes.
 */
export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  try {
    const origin = request.nextUrl.origin;
    const redirectUri = `${origin}/api/google/callback`;
    // `pushedEvents` carries event text — keep it out of the response.
    const { pushedEvents, ...sync } = await syncCalendars(redirectUri);
    let refresh: Awaited<ReturnType<typeof refreshStaleBookingEvents>> | { error: string };
    try {
      refresh = await refreshStaleBookingEvents(redirectUri, pushedEvents);
    } catch (err) {
      // Direction B succeeded; the self-heal is best-effort.
      console.error('[gcal-sync cron] refresh failed:', err);
      refresh = { error: err instanceof Error ? err.message : 'refresh failed' };
    }
    return NextResponse.json({ ...sync, refresh });
  } catch (err) {
    console.error('[gcal-sync cron] failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'sync failed' },
      { status: 500 },
    );
  }
}
