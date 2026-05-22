import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { buildPostEventEmail } from '@/lib/email';
import { sendAutomatedEmail } from '@/lib/emailAutomations';
import { getVenueById } from '@/lib/venues';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sweeps confirmed bookings whose event date is exactly 3 days in the past
 * and emails the customer:
 *   • thanks them for the visit
 *   • shows points earned this booking + new running balance
 *   • nudges them to follow @spacohk on Instagram
 *
 * The flag `postEventEmailSentAt` is written so re-running the cron is a
 * no-op for the same booking.
 *
 * Suggested cron schedule: once per day (e.g. 0 3 * * *).
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Compute "3 days ago" in HKT (UTC+8) → YYYY-MM-DD
  const now = new Date();
  const threeDaysAgoMs = now.getTime() - 3 * 24 * 60 * 60 * 1000;
  const hkt = new Date(threeDaysAgoMs + 8 * 60 * 60 * 1000);
  const targetDate = `${hkt.getUTCFullYear()}-${String(hkt.getUTCMonth() + 1).padStart(2, '0')}-${String(hkt.getUTCDate()).padStart(2, '0')}`;

  const snap = await adminDb
    .collection('bookings')
    .where('date', '==', targetDate)
    .where('status', 'in', ['confirmed', 'completed'])
    .get();

  const sent: string[] = [];
  const skipped: string[] = [];

  for (const docSnap of snap.docs) {
    const booking = docSnap.data() as Record<string, unknown> & {
      userId: string;
      venueId: string;
      date: string;
      pricing: { subtotal: number; deposit: number };
      postEventEmailSentAt?: unknown;
    };

    if (booking.postEventEmailSentAt) {
      skipped.push(docSnap.id);
      continue;
    }
    if (!booking.userId) {
      skipped.push(docSnap.id);
      continue;
    }

    try {
      const userSnap = await adminDb.collection('users').doc(booking.userId).get();
      if (!userSnap.exists) {
        skipped.push(docSnap.id);
        continue;
      }
      const user = userSnap.data() as { email?: string; displayName?: string; loyaltyPoints?: number };
      if (!user.email) {
        skipped.push(docSnap.id);
        continue;
      }

      // Points earned forecast: rental + add-ons (excluding security
      // deposit), MINUS promo + points discounts (free items aren't
      // "消費"). Admin's deposit settlement may credit a higher amount
      // later if part of the security deposit was kept; the customer
      // will see the actual balance when they next check.
      const promoDiscount = (booking as { promoDiscount?: number }).promoDiscount || 0;
      const pointsDiscount = (booking as { pointsDiscount?: number }).pointsDiscount || 0;
      const pointsEarned = Math.max(0, Math.floor(booking.pricing.subtotal - promoDiscount - pointsDiscount));
      const venue = getVenueById(booking.venueId);

      const tpl = buildPostEventEmail({
        customerName: user.displayName || 'there',
        venueName: venue?.name.zh || booking.venueId,
        date: booking.date,
        pointsEarned,
        pointsBalance: user.loyaltyPoints || 0,
      });
      await sendAutomatedEmail({
        automationKey: 'post_event',
        to: user.email,
        subject: tpl.subject,
        html: tpl.html,
      });

      await docSnap.ref.update({
        postEventEmailSentAt: FieldValue.serverTimestamp(),
      });
      sent.push(docSnap.id);
    } catch (err) {
      console.error('[post-event] failed for', docSnap.id, err);
      skipped.push(docSnap.id);
    }
  }

  return NextResponse.json({ targetDate, scanned: snap.size, sent, skipped });
}
