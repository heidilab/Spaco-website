import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * GET /api/admin/scan-lock-eligibility?date=2026-06-10
 *
 * Diagnostic — list every booking for the given date (or tomorrow if
 * omitted) with the EXACT reason its lock passcode hasn't been
 * generated yet. Mirrors checkEligibility() in lib/lockPasscode.ts so
 * the report matches what the cron / Stripe-webhook trigger actually
 * sees.
 */
export async function GET(req: NextRequest) {
  const dateParam = req.nextUrl.searchParams.get('date');
  let targetDate = dateParam;
  if (!targetDate) {
    // Default = tomorrow (HKT). Build the YYYY-MM-DD in Asia/Hong_Kong.
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Hong_Kong',
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const parts = fmt.formatToParts(new Date(Date.now() + 24 * 60 * 60 * 1000));
    targetDate = `${parts.find((p) => p.type === 'year')?.value}-${parts.find((p) => p.type === 'month')?.value}-${parts.find((p) => p.type === 'day')?.value}`;
  }

  const snap = await adminDb.collection('bookings').where('date', '==', targetDate).get();
  const now = Date.now();
  const PASSCODE_WINDOW_DAYS = 2;
  const hkDateTimeToMs = (date: string, hhmm: string) => {
    // 'Asia/Hong_Kong' = UTC+8. Date+time interpreted at HK local.
    const [h, m] = hhmm.split(':').map((s) => parseInt(s, 10));
    return new Date(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+08:00`).getTime();
  };

  const rows = snap.docs.map((doc) => {
    const b = doc.data() as {
      venueId?: string;
      date?: string;
      startTime?: string;
      endTime?: string;
      status?: string;
      balanceDue?: number;
      lockPasscode?: { passcode?: string; source?: string; emailSentAt?: unknown };
      paymentVerifiedAt?: unknown;
      promoCode?: string;
    };
    const startMs = b.date && b.startTime ? hkDateTimeToMs(b.date, b.startTime) : null;
    const windowOpensAt = startMs != null ? startMs - PASSCODE_WINDOW_DAYS * 24 * 60 * 60 * 1000 : null;

    let reason = '';
    if (b.status === 'cancelled' || b.status === 'completed') reason = `status=${b.status}`;
    else if (b.status !== 'confirmed') reason = `status=${b.status} (not confirmed)`;
    else if (b.lockPasscode?.passcode) reason = 'passcode-already-exists';
    else if (startMs == null) reason = 'missing date/startTime';
    else if (windowOpensAt != null && now < windowOpensAt) reason = `window-not-open (opens ${new Date(windowOpensAt).toISOString()})`;
    else if (now > startMs) reason = 'booking-already-started';
    else if ((b.balanceDue ?? 0) > 0) reason = `balance-due HK$${b.balanceDue}`;
    else reason = 'eligible — should generate next cron run';

    return {
      id: doc.id.slice(0, 8),
      fullId: doc.id,
      venueId: b.venueId,
      date: b.date,
      startTime: b.startTime,
      endTime: b.endTime,
      status: b.status,
      balanceDue: b.balanceDue ?? 0,
      hasPasscode: !!b.lockPasscode?.passcode,
      passcodeSource: b.lockPasscode?.source ?? null,
      reason,
    };
  });
  return NextResponse.json({
    targetDate,
    nowIso: new Date(now).toISOString(),
    count: rows.length,
    bookings: rows,
  });
}
