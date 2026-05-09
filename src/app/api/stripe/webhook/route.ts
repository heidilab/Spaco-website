import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import {
  sendEmail, buildBookingConfirmationEmail, generateWhatsAppLink,
  sendStaffBookingNotification,
} from '@/lib/email';
import { getVenueById } from '@/lib/venues';
import { processBookingForLockAccess } from '@/lib/lockPasscode';
import { pushBookingToCalendar } from '@/lib/googleCalendar';
import { formatAddOnsForStaff } from '@/lib/pricing';
import type { BookingRecord, UserProfile } from '@/types';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const body = await request.text();
  const sig = request.headers.get('stripe-signature');

  if (!sig) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  try {
    const event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET || ''
    );

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const bookingId = session.metadata?.bookingId;
      const isBalancePayment = session.metadata?.isBalancePayment === 'true';

      if (bookingId) {
        // 1. Update booking — confirm + (if balance payment) clear balanceDue.
        const bookingRef = adminDb.collection('bookings').doc(bookingId);
        const updates: Record<string, unknown> = {
          status: 'confirmed',
          updatedAt: FieldValue.serverTimestamp(),
        };
        if (isBalancePayment) {
          updates.balanceDue = 0;
          updates.balancePaidAt = FieldValue.serverTimestamp();
        }
        await bookingRef.update(updates);

        // 2. Send confirmation email to the customer.
        try {
          const bookingSnap = await bookingRef.get();
          const booking = bookingSnap.data() as BookingRecord | undefined;
          if (booking) {
            const userSnap = await adminDb.collection('users').doc(booking.userId).get();
            const profile = userSnap.data() as UserProfile | undefined;
            const customerEmail =
              profile?.email || session.customer_details?.email || session.customer_email;
            if (customerEmail) {
              const venue = getVenueById(booking.venueId);
              const venueName = venue?.name.zh || booking.branchSlug;
              const whatsappNumber = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || '85292823060';
              const whatsappLink = generateWhatsAppLink(
                whatsappNumber,
                `你好，我已完成預訂付款。\n預訂編號：${bookingId}\n場地：${venueName}\n日期：${booking.date}`
              );
              const tpl = buildBookingConfirmationEmail({
                customerName: profile?.displayName || customerEmail.split('@')[0],
                venueName,
                date: booking.date,
                startTime: booking.startTime,
                endTime: booking.endTime,
                guestCount: booking.guestCount,
                subtotal: booking.pricing.subtotal,
                deposit: booking.pricing.deposit,
                paymentMethod: 'Stripe',
                whatsappLink,
              });
              await sendEmail({ to: customerEmail, subject: tpl.subject, html: tpl.html });
            }
          }
        } catch (err) {
          console.warn('[stripe webhook] confirmation email failed:', err);
          // Non-fatal — booking is already confirmed.
        }

        // 3. If the booking is within the 2-day lock-passcode window, this
        //    generates the passcode + emails the customer immediately, OR
        //    sends a balance-due reminder if there's outstanding balance.
        //    Otherwise it no-ops; the daily cron will pick it up at T−2 days.
        try {
          await processBookingForLockAccess(bookingId);
        } catch (err) {
          console.warn('[stripe webhook] lock passcode trigger failed:', err);
          // Non-fatal — the cron will retry tomorrow.
        }

        // 4. Push the confirmed booking to Google Calendar so staff see it
        //    in their normal workflow. Skipped if already pushed earlier
        //    (eventId persisted) or if Google isn't connected.
        let bookingForNotify: BookingRecord | undefined;
        let profileForNotify: UserProfile | undefined;
        try {
          const fresh = await bookingRef.get();
          const booking = fresh.data() as BookingRecord | undefined;
          bookingForNotify = booking;
          if (booking) {
            const userSnap = await adminDb.collection('users').doc(booking.userId).get();
            profileForNotify = userSnap.data() as UserProfile | undefined;
          }
          if (booking && !booking.googleEventId) {
            const customerName = profileForNotify?.displayName;
            const origin = request.nextUrl.origin;
            const redirectUri = `${origin}/api/google/callback`;
            const eventId = await pushBookingToCalendar(redirectUri, { booking, customerName });
            if (eventId) {
              await bookingRef.update({ googleEventId: eventId });
            }
          }
        } catch (err) {
          console.warn('[stripe webhook] gcal push failed:', err);
          // Non-fatal — periodic sync cron will reconcile.
        }

        // 5. Notify staff of the new confirmed booking. Includes full
        //    add-on detail so CS / ops can place supplier orders.
        try {
          if (bookingForNotify) {
            const venue = getVenueById(bookingForNotify.venueId);
            const origin = request.nextUrl.origin;
            await sendStaffBookingNotification({
              bookingId: bookingForNotify.id,
              venueName: venue?.name.zh || bookingForNotify.branchSlug,
              date: bookingForNotify.date,
              startTime: bookingForNotify.startTime,
              endTime: bookingForNotify.endTime,
              guestCount: bookingForNotify.guestCount,
              adultCount: bookingForNotify.adultCount,
              childCount: bookingForNotify.childCount,
              customerName: profileForNotify?.displayName || '—',
              customerEmail: profileForNotify?.email,
              whatsappPhone: bookingForNotify.whatsappPhone,
              subtotal: bookingForNotify.pricing.subtotal,
              deposit: bookingForNotify.pricing.deposit,
              balanceDue: bookingForNotify.balanceDue ?? 0,
              addOnsLine: formatAddOnsForStaff(bookingForNotify.addOns, 'zh'),
              hasBYOFood: !!bookingForNotify.hasBYOFood,
              paymentMethod: 'Stripe',
              adminUrl: `${origin}/zh/admin/bookings/${bookingForNotify.id}`,
            });
          }
        } catch (err) {
          console.warn('[stripe webhook] staff notify failed:', err);
          // Non-fatal — booking is already confirmed.
        }
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err);
    return NextResponse.json({ error: 'Webhook failed' }, { status: 400 });
  }
}
