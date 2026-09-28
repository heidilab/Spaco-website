// Server-side CRUD for staff calendar events (site visits, deliveries).
// Uses Firebase Admin SDK so it bypasses Firestore rules — only call from
// API routes. Each mutation also pushes/updates/deletes the corresponding
// Google Calendar event (best-effort: silently no-op if Google not connected).

import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './firebaseAdmin';
import { CalendarEvent, CalendarEventType } from '@/types';
import { pushEventToCalendar, updatePushedEvent, deletePushedEvent } from './googleCalendar';

const COLLECTION = 'calendar_events';

const TYPE_LABELS: Record<CalendarEventType, string> = {
  site_visit: 'Site Visit',
  delivery: 'Delivery',
};

interface CreateInput {
  type: CalendarEventType;
  venueId: string;
  date: string;
  startTime: string;
  endTime: string;
  notes?: string;
}

export async function createCalendarEvent(
  redirectUri: string,
  input: CreateInput,
): Promise<CalendarEvent> {
  // DEDUP + ANTI-SPAM GUARD (Heidi 2026-09-30). A stale client bundle
  // looped a multi-day range, hammering this route ~every 2.5s and
  // spamming one event per day across the calendar. Query by notes only
  // (single-field, no composite index needed — a composite query here
  // would throw FAILED_PRECONDITION and break creation), then in memory:
  //   1. exact duplicate (same type/venue/date/time/notes) → return it
  //      (idempotent — repeated identical submits are harmless)
  //   2. same signature (type/venue/startTime/notes) created in the last
  //      2 minutes on ANY date → BLOCK as runaway-loop spam
  try {
    const sigSnap = await adminDb.collection(COLLECTION)
      .where('notes', '==', input.notes || '')
      .get();
    const nowMs = Date.now();
    for (const d of sigSnap.docs) {
      const e = d.data() as CalendarEvent & { createdAt?: { toMillis?: () => number } };
      const sameSig = e.type === input.type && e.venueId === input.venueId
        && e.startTime === input.startTime;
      if (!sameSig) continue;
      if (e.date === input.date && e.endTime === input.endTime) {
        return { id: d.id, ...d.data() } as unknown as CalendarEvent; // exact dup
      }
      const createdMs = e.createdAt?.toMillis?.() ?? 0;
      if (createdMs && nowMs - createdMs < 120000) {
        // Runaway loop — refuse silently (client keeps its stale state
        // but nothing new is written / pushed).
        throw new Error('CALENDAR_EVENT_SPAM_BLOCKED');
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message === 'CALENDAR_EVENT_SPAM_BLOCKED') throw err;
    console.error('[calendarEvents] dedup check failed (proceeding):', err);
  }

  // Write the Firestore doc FIRST so the request returns fast and can
  // never hang on Google. The push is best-effort with a 10s cap; the
  // gcal-sync cron reconciles anything that didn't land.
  const docRef = adminDb.collection(COLLECTION).doc();
  const base = {
    type: input.type,
    venueId: input.venueId,
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
    notes: input.notes || '',
    createdAt: FieldValue.serverTimestamp(),
  };
  await docRef.set({ ...base, googleEventId: null });

  let googleEventId: string | null = null;
  try {
    googleEventId = await Promise.race([
      pushEventToCalendar(redirectUri, {
        venueId: input.venueId,
        date: input.date,
        startTime: input.startTime,
        endTime: input.endTime,
        label: TYPE_LABELS[input.type],
        eventType: input.type,
        notes: input.notes,
      }),
      new Promise<null>((_, rej) => setTimeout(() => rej(new Error('gcal push timeout')), 10000)),
    ]);
    if (googleEventId) await docRef.update({ googleEventId });
  } catch (err) {
    console.error('[calendarEvents] Google push failed/timeout (doc kept):', err);
  }

  return { id: docRef.id, ...base, googleEventId } as unknown as CalendarEvent;
}

interface UpdateInput {
  date?: string;
  startTime?: string;
  endTime?: string;
  venueId?: string;
  notes?: string;
}

export async function updateCalendarEvent(
  redirectUri: string,
  id: string,
  input: UpdateInput,
): Promise<void> {
  const ref = adminDb.collection(COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Event not found');
  const current = snap.data() as CalendarEvent;

  const merged = {
    venueId: input.venueId ?? current.venueId,
    date: input.date ?? current.date,
    startTime: input.startTime ?? current.startTime,
    endTime: input.endTime ?? current.endTime,
    notes: input.notes ?? current.notes,
  };

  // If venue changed, the event needs to move calendar — easier to delete +
  // recreate than patch (Google doesn't support cross-calendar move via patch).
  let newGoogleEventId: string | null | undefined = current.googleEventId;
  if (input.venueId && input.venueId !== current.venueId) {
    if (current.googleEventId) {
      try {
        await deletePushedEvent(redirectUri, {
          venueId: current.venueId,
          googleEventId: current.googleEventId,
        });
      } catch (err) { console.error('[calendarEvents] delete on venue change failed:', err); }
    }
    try {
      newGoogleEventId = await pushEventToCalendar(redirectUri, {
        venueId: merged.venueId,
        date: merged.date,
        startTime: merged.startTime,
        endTime: merged.endTime,
        label: TYPE_LABELS[current.type],
        eventType: current.type,
        notes: merged.notes,
      });
    } catch (err) {
      console.error('[calendarEvents] push on venue change failed:', err);
      newGoogleEventId = null;
    }
  } else if (current.googleEventId) {
    try {
      await updatePushedEvent(redirectUri, {
        venueId: merged.venueId,
        googleEventId: current.googleEventId,
        date: merged.date,
        startTime: merged.startTime,
        endTime: merged.endTime,
        label: TYPE_LABELS[current.type],
        eventType: current.type,
        notes: merged.notes,
      });
    } catch (err) { console.error('[calendarEvents] update push failed:', err); }
  }

  await ref.update({
    ...merged,
    googleEventId: newGoogleEventId,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function deleteCalendarEvent(
  redirectUri: string,
  id: string,
): Promise<void> {
  const ref = adminDb.collection(COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return;
  const current = snap.data() as CalendarEvent;

  if (current.googleEventId) {
    try {
      await deletePushedEvent(redirectUri, {
        venueId: current.venueId,
        googleEventId: current.googleEventId,
      });
    } catch (err) { console.error('[calendarEvents] delete push failed:', err); }
  }

  await ref.delete();
}
