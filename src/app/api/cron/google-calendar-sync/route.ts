import { NextRequest, NextResponse } from 'next/server';
import { syncCalendars } from '@/lib/googleCalendar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Pulls events from the 4 branch Google Calendars into `blocked_slots`
 * (Direction B). Runs on Vercel cron — see vercel.json.
 *
 * Direction A (booking → Google) is push-on-write at the relevant write
 * sites (Stripe webhook, admin approve, admin date/time edit).
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const origin = request.nextUrl.origin;
    const redirectUri = `${origin}/api/google/callback`;
    const result = await syncCalendars(redirectUri);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[gcal-sync cron] failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'sync failed' },
      { status: 500 },
    );
  }
}
