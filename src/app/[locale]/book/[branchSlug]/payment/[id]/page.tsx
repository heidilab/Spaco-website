'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { useParams } from 'next/navigation';
import { useRouter } from '@/i18n/routing';
import { useAuth } from '@/contexts/AuthContext';
import { getBooking, updateBookingPaymentMethod, createBooking } from '@/lib/firestore';
import { getVenueById } from '@/lib/venues';
import { BookingRecord } from '@/types';
import { motion } from 'framer-motion';
import { PAYMENT_DETAILS } from '@/lib/paymentDetails';
import {
  loadBookingCheckoutDraft, clearBookingCheckoutDraft,
  type BookingCheckoutDraft,
} from '@/lib/bookingCheckoutDraft';

// Local helper — synthesizes a BookingRecord-like object from the draft
// so the existing summary UI renders without changes. Kept in sync with
// the same helper on /confirm/[id]/page.tsx.
function draftToBooking(
  draft: BookingCheckoutDraft,
  userId: string,
): BookingRecord {
  return {
    id: 'new',
    userId,
    whatsappPhone: draft.whatsappPhone,
    venueId: draft.venueId,
    branchSlug: draft.branchSlug,
    date: draft.date,
    startTime: draft.startTime,
    endTime: draft.endTime,
    endDate: draft.endDate,
    hours: draft.hours,
    guestCount: draft.guestCount,
    adultCount: draft.adultCount,
    childCount: draft.childCount,
    isWeekend: draft.isWeekend,
    addOns: draft.addOns,
    hasBYOFood: draft.hasBYOFood,
    pricing: draft.pricing,
    refundDetails: draft.refundDetails,
    promoCode: draft.promoCode,
    promoCodeId: draft.promoCodeId,
    promoDiscount: draft.promoDiscount,
    promoFreeDrinksCost: draft.promoFreeDrinksCost,
    pointsUsed: draft.pointsUsed,
    pointsDiscount: draft.pointsDiscount,
    marketingChannel: draft.marketingChannel,
    marketingChannelOther: draft.marketingChannelOther,
    packageSlug: draft.packageSlug,
    decorationStyle: draft.decorationStyle,
    status: 'pending',
    paymentMethod: null,
    receiptUrl: null,
    depositRefund: null,
    createdAt: null,
    updatedAt: null,
  } as unknown as BookingRecord;
}

export default function PaymentMethodPage() {
  const locale = useLocale() as 'zh' | 'en';
  const params = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const bookingId = params.id as string;
  const slug = params.branchSlug as string;
  const isDraft = bookingId === 'new';

  const [booking, setBooking] = useState<BookingRecord | null>(null);
  const [draft, setDraft] = useState<BookingCheckoutDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 'submitting' starts as true now — we auto-redirect to KPay on
  // entry (no more picker UI). Stays true until the redirect fires
  // OR an error occurs.
  const [submitting, setSubmitting] = useState(true);
  // `fired` is a one-shot guard for the auto-redirect useEffect so
  // a re-render doesn't fire two createBooking calls. Declared HERE
  // (before any early return) to keep the Hook order stable.
  const [fired, setFired] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.push('/');
      return;
    }

    if (isDraft) {
      // Draft mode — read the sessionStorage payload and synthesize a
      // booking-shaped object. If the draft is missing/expired, bounce
      // back to the branch booking page so the customer can redo the
      // form. We refuse to render without refundDetails (same gate as
      // existing-booking mode).
      const d = loadBookingCheckoutDraft();
      if (!d) {
        router.push(`/book/${slug}`);
        return;
      }
      if (!d.refundDetails) {
        router.push(`/book/${slug}/confirm/new`);
        return;
      }
      setDraft(d);
      setBooking(draftToBooking(d, user.uid));
      setLoading(false);
      return;
    }

    getBooking(bookingId)
      .then((b) => {
        if (!b) {
          setError(locale === 'zh' ? '找不到預訂記錄' : 'Booking not found');
        } else if (b.userId !== user.uid) {
          setError(locale === 'zh' ? '無權查看此預訂' : 'Not authorized');
        } else if (!b.refundDetails) {
          // Skip back to confirm if refund details missing
          router.push(`/book/${slug}/confirm/${bookingId}`);
        } else {
          setBooking(b);
        }
      })
      .finally(() => setLoading(false));
  }, [bookingId, user, authLoading, router, locale, slug, isDraft]);

  // Auto-fire KPay redirect once booking + auth are ready. Declared
  // BEFORE any early-return so the hook count stays stable across
  // renders. `proceedToKpay` is a function declaration further down
  // — JS hoists it, so the reference resolves.
  useEffect(() => {
    if (fired || !booking || authLoading || loading) return;
    setFired(true);
    proceedToKpay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking, authLoading, loading]);

  if (authLoading || loading) {
    return (
      <div className="pt-28 min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-ink-soft">Loading...</div>
      </div>
    );
  }
  if (error || !booking) {
    return (
      <div className="pt-28 min-h-screen flex items-center justify-center">
        <p className="text-rose-500">{error || 'Error'}</p>
      </div>
    );
  }

  const venue = getVenueById(booking.venueId);
  const venueName = venue?.name[locale] || booking.branchSlug;

  async function proceedToKpay() {
    if (!booking) return;
    setError(null);
    setSubmitting(true);
    try {
      let effectiveBookingId = booking.id;

      // Draft mode — this is the FIRST write of the booking to Firestore.
      // createBooking is what creates the blocked_slot rows too, so the
      // physical slot only gets held now that the customer commits to
      // pay. 30-minute pendingExpiresAt countdown starts here.
      if (isDraft) {
        if (!draft || !draft.refundDetails || !user) {
          throw new Error('Draft missing');
        }
        const pendingExpiresAt =
          Date.now() + PAYMENT_DETAILS.pendingHoldMinutes * 60 * 1000;
        const newId = await createBooking({
          userId: user.uid,
          whatsappPhone: draft.whatsappPhone,
          venueId: draft.venueId,
          branchSlug: draft.branchSlug,
          date: draft.date,
          startTime: draft.startTime,
          endTime: draft.endTime,
          ...(draft.endDate ? { endDate: draft.endDate } : {}),
          hours: draft.hours,
          guestCount: draft.guestCount,
          adultCount: draft.adultCount,
          childCount: draft.childCount,
          isWeekend: draft.isWeekend,
          addOns: draft.addOns,
          hasBYOFood: draft.hasBYOFood,
          pricing: draft.pricing,
          status: 'awaiting_payment',
          paymentMethod: 'stripe',  // generic "online" — KPay's webhook
                                    // records the actual method (card /
                                    // FPS / AlipayHK / etc.) on each
                                    // payments[] entry.
          receiptUrl: null,
          refundDetails: draft.refundDetails,
          balanceDue: draft.effectiveBalanceDue ?? 0,
          pendingExpiresAt,
          depositRefund: null,
          ...(draft.promoCode ? { promoCode: draft.promoCode } : {}),
          ...(draft.promoCodeId ? { promoCodeId: draft.promoCodeId } : {}),
          ...(typeof draft.promoDiscount === 'number' ? { promoDiscount: draft.promoDiscount } : {}),
          ...(typeof draft.promoFreeDrinksCost === 'number'
            ? { promoFreeDrinksCost: draft.promoFreeDrinksCost } : {}),
          ...(typeof draft.pointsUsed === 'number' ? { pointsUsed: draft.pointsUsed } : {}),
          ...(typeof draft.pointsDiscount === 'number' ? { pointsDiscount: draft.pointsDiscount } : {}),
          ...(draft.marketingChannel ? { marketingChannel: draft.marketingChannel } : {}),
          ...(draft.marketingChannelOther ? { marketingChannelOther: draft.marketingChannelOther } : {}),
          ...(draft.packageSlug ? { packageSlug: draft.packageSlug } : {}),
          ...(draft.decorationStyle ? { decorationStyle: draft.decorationStyle } : {}),
        });
        effectiveBookingId = newId;
        clearBookingCheckoutDraft();
      } else {
        await updateBookingPaymentMethod(booking.id, 'stripe');
      }

      // Skip the method-picker page — KPay's hosted cashier supports
      // card + FPS + AlipayHK + WeChat HK + PayMe + Apple Pay all in
      // one place, so a Spaco-side picker is redundant.
      const pointsDiscount = booking.pointsDiscount || 0;
      const chargeAmount = Math.max(1, booking.pricing.deposit - pointsDiscount);
      const res = await fetch('/api/kpay/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId: effectiveBookingId,
          amount: chargeAmount,
          venueName,
          customerEmail: user?.email,
        }),
      });
      if (!res.ok) throw new Error(`Checkout API ${res.status}`);
      const { sessionUrl } = await res.json();
      if (!sessionUrl) throw new Error('No checkout URL returned');
      window.location.href = sessionUrl;
    } catch (err) {
      console.error(err);
      setError(locale === 'zh' ? '處理失敗，請重試' : 'Processing failed, please retry');
      setSubmitting(false);
    }
  }


  return (
    <div className="pt-28 pb-20 relative overflow-hidden min-h-screen flex items-center justify-center">
      <div className="orb orb-pink animate-float-slow" style={{ width: 280, height: 280, top: '-60px', right: '-60px', opacity: 0.4 }} />
      <div className="max-content mx-auto px-6 md:px-12 lg:px-20 relative z-10">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-md mx-auto text-center space-y-6">
          <h1 className="text-heading font-display">
            <span className="text-gradient-pink">
              {error
                ? (locale === 'zh' ? '處理失敗' : 'Payment Error')
                : (locale === 'zh' ? '正在跳轉到付款頁面' : 'Redirecting to Payment')}
            </span>
          </h1>
          <p className="text-ink-soft text-sm">
            {locale === 'zh' ? '應付金額' : 'Amount due'}：
            <span className="font-bold text-ink ml-1">HK${booking.pricing.deposit.toLocaleString()}</span>
          </p>
          {!error && (
            <p className="text-ink-soft text-xs">
              {locale === 'zh'
                ? 'KPay 安全收銀台支援信用卡 / FPS / AlipayHK / WeChat / PayMe / Apple Pay。請稍候…'
                : 'KPay secure cashier supports card / FPS / AlipayHK / WeChat / PayMe / Apple Pay. Hang tight…'}
            </p>
          )}
          {submitting && !error && (
            <div className="flex justify-center pt-2">
              <div className="w-10 h-10 border-3 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {error && (
            <>
              <p className="text-sm text-rose-500">{error}</p>
              <button
                onClick={() => { setFired(false); }}
                className="px-6 py-3 rounded-xl bg-accent text-white font-bold hover:bg-accent/90"
              >
                {locale === 'zh' ? '再試一次' : 'Try again'}
              </button>
            </>
          )}
        </motion.div>
      </div>
    </div>
  );
}
