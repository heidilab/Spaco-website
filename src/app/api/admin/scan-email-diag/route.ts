import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { requireCronSecret } from '@/lib/adminAuth';
import type { BookingRecord } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Diagnose "no email on new booking": shows the email-automation toggles,
 * the relevant env presence, and the most recent bookings (status /
 * paymentMethod / payments / timestamps) so we can tell what path a
 * booking took and whether notifications should have fired.
 * CRON_SECRET or DIAG_TOKEN.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') || '';
  const diagOk = !!process.env.DIAG_TOKEN && auth === `Bearer ${process.env.DIAG_TOKEN}`;
  if (!diagOk) {
    const gate = requireCronSecret(req);
    if (gate) return gate;
  }

  const toggleSnap = await adminDb.doc('system/email_automations').get();
  const toggles = toggleSnap.exists ? toggleSnap.data() : { _note: 'doc missing → all default ENABLED' };

  const snap = await adminDb.collection('bookings').get();
  const rows = snap.docs.map((d) => {
    const b = { id: d.id, ...d.data() } as BookingRecord & { createdAt?: unknown; updatedAt?: unknown };
    const ts = (v: unknown): number => {
      if (v && typeof (v as { toMillis?: () => number }).toMillis === 'function') return (v as { toMillis: () => number }).toMillis();
      if (typeof v === 'number') return v;
      if (typeof v === 'string') { const n = Date.parse(v); return Number.isFinite(n) ? n : 0; }
      return 0;
    };
    return {
      id: b.id,
      date: b.date,
      venueId: b.venueId,
      status: b.status,
      paymentMethod: b.paymentMethod,
      payments: (b.payments || []).length,
      guestCount: b.guestCount,
      createdMs: ts(b.createdAt),
      updatedMs: ts(b.updatedAt),
    };
  });
  rows.sort((a, b) => (b.createdMs || b.updatedMs) - (a.createdMs || a.updatedMs));

  return NextResponse.json({
    scannedAt: new Date().toISOString(),
    env: {
      STAFF_NOTIFICATION_EMAILS: process.env.STAFF_NOTIFICATION_EMAILS ? 'set' : 'MISSING',
      RESEND_API_KEY: process.env.RESEND_API_KEY ? 'set' : 'MISSING',
      RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL || 'MISSING',
    },
    emailToggles: toggles,
    recentBookings: rows.slice(0, 8),
  });
}
