import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { deleteCalendarEvent } from '@/lib/calendarEvents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * TEMPORARY one-off cleanup (Heidi 2026-09-30): the old multi-day
 * schedule loop duplicated a SW site visit (note 51602002 / "5160
 * 2002") across October. Deletes every matching site_visit between
 * 2026-09-30 and 2026-10-31 EXCEPT one kept on 2026-09-30, removing
 * the pushed Google Calendar events too. Token-gated; this route is
 * deleted right after the cleanup run.
 */
const ONE_OFF_TOKEN = '211a14ccf195be0b4c46b172e706c192c076d40f199ba6ea';

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get('token') !== ONE_OFF_TOKEN) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const dry = request.nextUrl.searchParams.get('dry') === '1';

  const snap = await adminDb.collection('calendar_events')
    .where('date', '>=', '2026-09-30')
    .where('date', '<=', '2026-10-31')
    .get();

  const matches = snap.docs.filter((d) => {
    const e = d.data() as { type?: string; venueId?: string; notes?: string };
    return e.type === 'site_visit'
      && String(e.venueId || '').startsWith('sw')
      && String(e.notes || '').replace(/\s+/g, '') === '51602002';
  }).sort((a, b) => String(a.data().date).localeCompare(String(b.data().date)));

  // Keep the first 2026-09-30 one (the visit Heidi actually wanted).
  const keep = matches.find((d) => d.data().date === '2026-09-30');
  const toDelete = matches.filter((d) => d.id !== keep?.id);

  if (dry) {
    return NextResponse.json({
      dry: true,
      total: matches.length,
      keep: keep ? { id: keep.id, ...keep.data() } : null,
      deleteCount: toDelete.length,
      deleteDates: toDelete.map((d) => d.data().date),
    });
  }

  const redirectUri = `${request.nextUrl.origin}/api/google/callback`;
  let deleted = 0;
  for (const d of toDelete) {
    try {
      await deleteCalendarEvent(redirectUri, d.id);
      deleted++;
    } catch (err) {
      console.warn('[cleanup-sitevisits] failed', d.id, err);
    }
  }
  return NextResponse.json({ ok: true, deleted, kept: keep?.id || null });
}
