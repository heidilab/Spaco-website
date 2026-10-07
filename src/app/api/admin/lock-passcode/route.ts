/**
 * Admin-triggered lock passcode operations:
 *
 *   POST /api/admin/lock-passcode   { bookingId, action }
 *     action="generate"  → run the same eligibility flow as the cron
 *                          for ONE booking (used after admin marks balance
 *                          as paid, or when admin wants to retry).
 *     action="resend"    → re-email the existing passcode to the customer
 *     action="revoke"    → delete the passcode on TTLock + clear from booking
 *
 * Auth: requires a logged-in admin user. We verify the Firebase ID token
 * server-side and check the staff role from Firestore.
 */

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebaseAdmin';
import { processBookingForLockAccess, revokeBookingPasscode, setManualPasscode, getLockGuideUrlForVenue } from '@/lib/lockPasscode';
import { buildLockPasscodeEmail } from '@/lib/email';
import { lockConfirmKey } from '@/lib/lockConfirmKey';
import { sendAutomatedEmail } from '@/lib/emailAutomations';
import { getVenueById } from '@/lib/venues';
import type { BookingRecord, UserProfile } from '@/types';
import { requireAdmin } from '@/lib/adminAuth';
import { sweepUpcomingBookings } from '@/lib/lockPasscode';

export const runtime = 'nodejs';
export const maxDuration = 60; // 'sweep' walks every booking in the window

interface Body {
  /** Not needed for action === 'sweep'. */
  bookingId?: string;
  action: 'generate' | 'resend' | 'revoke' | 'set-manual' | 'sweep';
  /** Required when action === 'set-manual' — the digits the customer types. */
  passcode?: string;
}

export async function POST(req: NextRequest) {
  // 1. Auth — any staff role with the `bookings` permission (admin + CS).
  //    A second check for the `content` permission used to sit here and
  //    403'd every CS click on 生成密碼 (CS has no content perm) — removed
  //    2026-10-07.
  const _gate = await requireAdmin(req, 'bookings');
  if (!_gate.ok) return _gate.res;

  // 2. Parse request body.
  const body = (await req.json()) as Body;
  if (!body.action || (body.action !== 'sweep' && !body.bookingId)) {
    return NextResponse.json({ error: 'missing-fields' }, { status: 400 });
  }

  // 3. Dispatch.
  try {
    if (body.action === 'sweep') {
      // Same idempotent sweep the 09:00 cron runs — lets staff catch up
      // immediately when the cron missed a day.
      const summary = await sweepUpcomingBookings();
      return NextResponse.json({ ok: true, ...summary });
    }
    const bookingId = body.bookingId as string;
    if (body.action === 'generate') {
      const result = await processBookingForLockAccess(bookingId);
      return NextResponse.json({ ok: true, result });
    }

    if (body.action === 'revoke') {
      await revokeBookingPasscode(bookingId);
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'set-manual') {
      const passcode = (body.passcode || '').trim();
      if (!/^\d{4,9}$/.test(passcode)) {
        return NextResponse.json({ error: 'invalid-passcode', message: '密碼必須係 4-9 位數字' }, { status: 400 });
      }
      const result = await setManualPasscode(bookingId, passcode);
      if (!result.ok) {
        return NextResponse.json({ error: result.reason }, { status: 400 });
      }
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'resend') {
      // Use the admin SDK throughout — the client SDK has no auth context
      // on the server, so Firestore rules reject reads/writes with the
      // "missing or insufficient permissions" error.
      const ref = adminDb.collection('bookings').doc(bookingId);
      const snap = await ref.get();
      if (!snap.exists) {
        return NextResponse.json({ error: 'booking-not-found' }, { status: 404 });
      }
      const b = snap.data() as BookingRecord;
      if (!b.lockPasscode) {
        return NextResponse.json({ error: 'no-passcode' }, { status: 400 });
      }
      const userSnap = await adminDb.collection('users').doc(b.userId).get();
      if (!userSnap.exists) {
        return NextResponse.json({ error: 'user-not-found' }, { status: 404 });
      }
      const profile = userSnap.data() as UserProfile;
      const venue = getVenueById(b.venueId);
      const lockGuideImageUrl = await getLockGuideUrlForVenue(b.venueId);
      const tpl = buildLockPasscodeEmail({
        customerName: profile.displayName || profile.email.split('@')[0],
        venueName:    venue?.name.zh || b.branchSlug,
        venueAddress: venue?.address.zh,
        date:         b.date,
        startTime:    b.startTime,
        endTime:      b.endTime,
        endDate:      b.endDate,
        passcode:     b.lockPasscode.passcode,
        confirmKey:   lockConfirmKey(b.venueId),
        validFromMs:  b.lockPasscode.validFrom,
        validToMs:    b.lockPasscode.validTo,
        whatsappLink: 'https://wa.me/85292823060',
        lockGuideImageUrl,
      });
      await sendAutomatedEmail({
        automationKey: 'lock_passcode',
        to: profile.email,
        subject: tpl.subject,
        html: tpl.html,
      });
      await ref.update({ 'lockPasscode.emailSentAt': FieldValue.serverTimestamp() });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'unknown-action' }, { status: 400 });
  } catch (err) {
    console.error('[admin/lock-passcode] failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
