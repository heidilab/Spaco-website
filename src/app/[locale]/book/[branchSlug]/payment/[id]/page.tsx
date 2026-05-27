'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { useParams } from 'next/navigation';
import { useRouter } from '@/i18n/routing';
import { useAuth } from '@/contexts/AuthContext';
import { getBooking, updateBookingPaymentMethod, createBooking } from '@/lib/firestore';
import { getVenueById } from '@/lib/venues';
import { BookingRecord } from '@/types';
import { CreditCard, Building2, ArrowRight } from 'lucide-react';
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
  const [selected, setSelected] = useState<'stripe' | 'fps' | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

  async function handleProceed() {
    if (!selected || !booking) return;
    setSubmitting(true);
    try {
      let effectiveBookingId = booking.id;

      // Draft mode — this is the FIRST write of the booking to Firestore.
      // createBooking is what creates the blocked_slot rows too, so the
      // physical slot only gets held now that the customer has chosen a
      // payment method. 30-minute pendingExpiresAt countdown starts here.
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
          paymentMethod: selected,
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
        // Form payload is no longer needed — wipe it so a Back button
        // doesn't re-submit the same draft.
        clearBookingCheckoutDraft();
      } else {
        await updateBookingPaymentMethod(booking.id, selected);
      }

      if (selected === 'stripe') {
        // 'stripe' option label is preserved for now — it routes through
        // KPay on this branch (kpay-integration). Production main still
        // uses Stripe. After sandbox passes + we merge, the label can
        // be renamed to 信用卡 / Card.
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
      } else {
        // Offline (FPS / bank transfer) — go to instructions page.
        // Fire the待付款 reminder email (non-blocking).
        fetch('/api/email/offline-pending', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId: effectiveBookingId }),
        }).catch((err) => console.warn('[offline-pending email] failed:', err));
        router.push(`/book/${slug}/pay-offline/${effectiveBookingId}`);
      }
    } catch (err) {
      console.error(err);
      setError(locale === 'zh' ? '處理失敗，請重試' : 'Processing failed, please retry');
      setSubmitting(false);
    }
  }

  return (
    <div className="pt-28 pb-20 relative overflow-hidden">
      <div className="orb orb-pink animate-float-slow" style={{ width: 280, height: 280, top: '-60px', right: '-60px', opacity: 0.4 }} />
      <div className="max-content mx-auto px-6 md:px-12 lg:px-20 relative z-10">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-xl mx-auto space-y-6">
          <div>
            <h1 className="text-heading font-display">
              <span className="text-gradient-pink">{locale === 'zh' ? '選擇付款方式' : 'Choose Payment'}</span>
            </h1>
            <p className="text-ink-soft mt-2 text-sm">
              {locale === 'zh' ? '應付金額' : 'Amount due'}：
              <span className="font-bold text-ink ml-1">HK${booking.pricing.deposit.toLocaleString()}</span>
            </p>
          </div>

          <div className="space-y-3">
            <Option
              selected={selected === 'stripe'}
              onClick={() => setSelected('stripe')}
              icon={<CreditCard size={22} />}
              title={locale === 'zh' ? '信用卡網上付款' : 'Online Credit Card'}
              subtitle={locale === 'zh' ? '透過 Stripe 安全付款，即時確認' : 'Secure Stripe checkout, instant confirmation'}
            />
            <Option
              selected={selected === 'fps'}
              onClick={() => setSelected('fps')}
              icon={<Building2 size={22} />}
              title={locale === 'zh' ? '線下付款（FPS / 銀行轉賬）' : 'Offline (FPS / Bank Transfer)'}
              subtitle={locale === 'zh' ? '上載付款截圖，由我們人手核對後確認' : 'Upload payment screenshot, verified by our team'}
            />
          </div>

          {error && <p className="text-sm text-rose-500 text-center">{error}</p>}

          <button
            disabled={!selected || submitting}
            onClick={handleProceed}
            className="w-full bg-accent text-white py-4 rounded-xl font-bold text-lg hover:bg-accent/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? (locale === 'zh' ? '處理中…' : 'Processing…') : (locale === 'zh' ? '付款' : 'Pay')}
            {!submitting && <ArrowRight size={18} />}
          </button>
        </motion.div>
      </div>
    </div>
  );
}

function Option({
  selected,
  onClick,
  icon,
  title,
  subtitle,
}: {
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left p-5 rounded-xl border transition-colors ${
        selected ? 'border-accent bg-accent/5' : 'border-charcoal/15 bg-white/60 hover:border-charcoal/30'
      }`}
    >
      <div className="flex items-start gap-4">
        <div className={`mt-0.5 ${selected ? 'text-accent' : 'text-ink-soft'}`}>{icon}</div>
        <div className="flex-1">
          <p className="font-semibold text-ink">{title}</p>
          <p className="text-xs text-ink-soft mt-0.5">{subtitle}</p>
        </div>
        <div className={`w-5 h-5 rounded-full border-2 mt-1 flex items-center justify-center ${selected ? 'border-accent' : 'border-charcoal/25'}`}>
          {selected && <div className="w-2.5 h-2.5 rounded-full bg-accent" />}
        </div>
      </div>
    </button>
  );
}
