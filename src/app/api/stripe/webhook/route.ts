import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { buildBookingConfirmationEmail, generateWhatsAppLink } from '@/lib/email';
import { sendAutomatedEmail, sendStaffBookingNotification } from '@/lib/emailAutomations';
import { getVenueById } from '@/lib/venues';
import { processBookingForLockAccess } from '@/lib/lockPasscode';
import { pushBookingToCalendar, updateBookingOnCalendar } from '@/lib/googleCalendar';
import { formatAddOnsForStaff } from '@/lib/pricing';
import { deductLoyaltyPoints } from '@/lib/loyaltyServer';
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
        // Pre-fetch so we can compute the rental/addOn/deposit split for
        // the payments[] audit entry below.
        const preStripeSnap = await bookingRef.get();
        const preStripe = preStripeSnap.data() as BookingRecord | undefined;
        const updates: Record<string, unknown> = {
          status: 'confirmed',
          updatedAt: FieldValue.serverTimestamp(),
        };
        if (isBalancePayment) {
          updates.balanceDue = 0;
          updates.balancePaidAt = FieldValue.serverTimestamp();
        }

        // Write a payments[] audit entry for EVERY Stripe charge, split
        // into venue rental (場租) / add-ons (附加項目) / refundable
        // deposit (按金). This lets PaymentHistory render each payment
        // separately (vs the old behaviour where it synthesised a single
        // combined "initial" row from pricing.* fields). Splits use the
        // booking's pricing snapshot at confirmation time:
        //   • initial deposit → pro-rata vs upfront/grandTotal
        //   • balance payment → whatever's left of each bucket
        if (preStripe) {
          const baseCharge = preStripe.pricing.baseCharge || 0;
          const addOnTotal = preStripe.pricing.addOnTotal || 0;
          const securityDeposit = preStripe.pricing.securityDeposit || 0;
          const grandTotal = baseCharge + addOnTotal + securityDeposit;
          const paidAmount = session.amount_total ? Math.round(session.amount_total / 100) : 0;
          let rentalAmount = 0;
          let addOnAmount = 0;
          let depositAmount = 0;
          if (grandTotal > 0 && paidAmount > 0) {
            // Pro-rata each bucket against the actual paid amount so a
            // 50% deposit splits the rental / addOn / refundable cleanly,
            // and a 100% (≤$10k) payment slots into bucket totals.
            rentalAmount = Math.round((baseCharge / grandTotal) * paidAmount);
            addOnAmount = Math.round((addOnTotal / grandTotal) * paidAmount);
            depositAmount = paidAmount - rentalAmount - addOnAmount;
          }
          updates.payments = FieldValue.arrayUnion({
            rentalAmount,
            addOnAmount,
            depositAmount,
            amount: paidAmount,
            method: 'stripe',
            kind: isBalancePayment ? 'balance' : 'initial',
            note: null,
            recordedBy: 'stripe-webhook',
            recordedAt: new Date().toISOString(),
          });
        }

        await bookingRef.update(updates);

        // 1b. If the customer redeemed loyalty points / applied a promo
        //     code, persist the deductions now (deposit payments only —
        //     balance payments don't touch points/promos again).
        try {
          const preNotifySnap = await bookingRef.get();
          const preData = preNotifySnap.data() as BookingRecord | undefined;
          // Firestore .data() drops the doc id — pin it back so any
          // downstream code that builds gcal/email content has it.
          const preBooking = preData ? ({ ...preData, id: bookingId } as BookingRecord) : undefined;
          if (preBooking && !isBalancePayment) {
            // Loyalty points — transactional deduction.
            if (preBooking.pointsUsed && preBooking.pointsUsed > 0) {
              const deducted = await deductLoyaltyPoints(preBooking.userId, preBooking.pointsUsed);
              await bookingRef.update({
                pointsRedeemedAt: FieldValue.serverTimestamp(),
                pointsActuallyDeducted: deducted,
              });
            }
            // Promo code — increment totalUsageCount on the code doc.
            if (preBooking.promoCodeId && !preBooking.promoRedeemedAt) {
              await adminDb.collection('promo_codes').doc(preBooking.promoCodeId).update({
                totalUsageCount: FieldValue.increment(1),
              });
              await bookingRef.update({ promoRedeemedAt: FieldValue.serverTimestamp() });
            }
          }
        } catch (err) {
          console.warn('[stripe webhook] points/promo deduction failed:', err);
          // Non-fatal — booking is already confirmed; admin can reconcile.
        }

        // 2. Send confirmation email to the customer.
        try {
          const bookingSnap = await bookingRef.get();
          const bookingData = bookingSnap.data() as BookingRecord | undefined;
          // .data() drops the doc id — pin it on so downstream surfaces
          // (gcal description / email body) render the real Booking ID.
          const booking = bookingData ? ({ ...bookingData, id: bookingId } as BookingRecord) : undefined;
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
                venueAddress: venue?.address.zh,
                date: booking.date,
                startTime: booking.startTime,
                endTime: booking.endTime,
                endDate: booking.endDate,
                guestCount: booking.guestCount,
                adultCount: booking.adultCount,
                childCount: booking.childCount,
                subtotal: booking.pricing.subtotal,
                deposit: booking.pricing.deposit,
                promoCode: booking.promoCode,
                promoDiscount: booking.promoDiscount,
                pointsUsed: booking.pointsUsed,
                pointsDiscount: booking.pointsDiscount,
                balanceDue: booking.balanceDue,
                balanceDueDate: booking.balanceDueDate,
                addOnsLine: formatAddOnsForStaff(booking.addOns, 'zh'),
                paymentMethod: 'Stripe',
                whatsappLink,
              });
              await sendAutomatedEmail({
                automationKey: 'booking_confirmation',
                to: customerEmail,
                subject: tpl.subject,
                html: tpl.html,
              });
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
          const freshData = fresh.data() as BookingRecord | undefined;
          const booking = freshData ? ({ ...freshData, id: bookingId } as BookingRecord) : undefined;
          bookingForNotify = booking;
          if (booking) {
            const userSnap = await adminDb.collection('users').doc(booking.userId).get();
            profileForNotify = userSnap.data() as UserProfile | undefined;
          }
          if (booking) {
            const customerName = profileForNotify?.displayName;
            const origin = request.nextUrl.origin;
            const redirectUri = `${origin}/api/google/callback`;
            if (booking.googleEventId) {
              // Balance payment OR re-confirmation — the event already
              // exists, just refresh its description so the "⚠️ 未找清
              // 尾數" line disappears and the price totals reflect the
              // new state. Without this, the calendar showed stale
              // balance warnings after the customer paid.
              await updateBookingOnCalendar(redirectUri, { booking, customerName });
            } else {
              const eventId = await pushBookingToCalendar(redirectUri, { booking, customerName });
              if (eventId) {
                await bookingRef.update({ googleEventId: eventId });
              }
            }
          }
        } catch (err) {
          console.warn('[stripe webhook] gcal sync failed:', err);
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
              endDate: bookingForNotify.endDate,
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
