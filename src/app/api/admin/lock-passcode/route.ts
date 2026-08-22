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
import { sendAutomatedEmail } from '@/lib/emailAutomations';
import { getVenueById } from '@/lib/venues';
import { adminVerifyIdToken, adminUserHasContentPerm } from '@/lib/adminAuth';
import type { BookingRecord, UserProfile } from '@/types';
import { requireAdmin } from '@/lib/adminAuth';

export const runtime = 'nodejs';
export const maxDuration = 30;

interface Body {
  bookingId: string;
  action: 'generate' | 'resend' | 'revoke' | 'set-manual';
  /** Required when action === 'set-manual' — the digits the customer types. */
  passcode?: string;
}

export async function POST(req: NextRequest) {
  const _gate = await requireAdmin(req, 'bookings');
  if (!_gate.ok) return _gate.res;
  // 1. Verify the caller is an authenticated admin.
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    return NextResponse.json({ error: 'missing-token' }, { status: 401 });
  }
  let uid: string;
  try {
    const decoded = await adminVerifyIdToken(token);
    uid = decoded.uid;
  } catch {
    return NextResponse.json({ error: 'invalid-token' }, { status: 401 });
  }
  if (!(await adminUserHasContentPerm(uid))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // 2. Parse request body.
  const body = (await req.json()) as Body;
  if (!body.bookingId || !body.action) {
    return NextResponse.json({ error: 'missing-fields' }, { status: 400 });
  }

  // 3. Dispatch.
  try {
    if (body.action === 'generate') {
      const result = await processBookingForLockAccess(body.bookingId);
      return NextResponse.json({ ok: true, result });
    }

    if (body.action === 'revoke') {
      await revokeBookingPasscode(body.bookingId);
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'set-manual') {
      const passcode = (body.passcode || '').trim();
      if (!/^\d{4,9}$/.test(passcode)) {
        return NextResponse.json({ error: 'invalid-passcode', message: '密碼必須係 4-9 位數字' }, { status: 400 });
      }
      const result = await setManualPasscode(body.bookingId, passcode);
      if (!result.ok) {
        return NextResponse.json({ error: result.reason }, { status: 400 });
      }
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'resend') {
      // Use the admin SDK throughout — the client SDK has no auth context
      // on the server, so Firestore rules reject reads/writes with the
      // "missing or insufficient permissions" error.
      const ref = adminDb.collection('bookings').doc(body.bookingId);
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
