'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { useParams } from 'next/navigation';
import { useRouter } from '@/i18n/routing';
import { useAuth } from '@/contexts/AuthContext';
import { getBooking, updateBookingPaymentMethod } from '@/lib/firestore';
import { getVenueById } from '@/lib/venues';
import { BookingRecord } from '@/types';
import { LogIn, CreditCard, Smartphone, Building2 } from 'lucide-react';
import { motion } from 'framer-motion';
import AuthModal from '@/components/auth/AuthModal';
import { PAYMENT_DETAILS } from '@/lib/paymentDetails';
import {
  loadBookingCheckoutDraft, clearBookingCheckoutDraft,
  type BookingCheckoutDraft,
} from '@/lib/bookingCheckoutDraft';

/** Card-network payments (credit card / Apple Pay / Samsung Pay) carry
 *  a 1.5% surcharge passed through to the customer — KPay's fee on
 *  card rails is materially higher than on e-wallets. Must match
 *  CARD_SURCHARGE_RATE in /api/kpay/checkout. */
const CARD_SURCHARGE_RATE = 0.015;

function surchargeFor(amount: number): number {
  return Math.round(amount * CARD_SURCHARGE_RATE * 100) / 100;
}

type PayChoice = 'card' | 'wallet' | 'fps';

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
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState<PayChoice | null>(null);
  const [authOpen, setAuthOpen] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      // Don't bounce to '/' — keep the customer on this URL so when they
      // log in via AuthModal the useEffect re-runs and loads the booking.
      // (Same fix as pay-balance: an initial-payment link clicked while
      // logged out used to drop the bookingId and strand the customer.)
      setLoading(false);
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
          setError(locale === 'zh' ? '無權查看此預訂（請用預訂時嘅帳號登入）' : 'Not authorized — please sign in with the account used to make this booking');
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

  // Not signed in → show inline sign-in prompt instead of redirecting away.
  if (!user) {
    return (
      <div className="pt-28 pb-20 min-h-screen flex items-center justify-center px-6">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-md w-full text-center space-y-6">
          <h1 className="text-heading font-display">
            <span className="text-gradient-pink">{locale === 'zh' ? '預訂付款' : 'Booking Payment'}</span>
          </h1>
          <p className="text-ink-soft text-sm">
            {locale === 'zh'
              ? '請先登入您預訂時使用的帳號，以繼續付款。'
              : 'Please sign in with the account used to make this booking to continue.'}
          </p>
          <button
            onClick={() => setAuthOpen(true)}
            className="w-full bg-accent text-white py-4 rounded-xl font-bold text-lg hover:bg-accent/90 transition-colors flex items-center justify-center gap-2"
          >
            <LogIn size={18} />
            {locale === 'zh' ? '登入' : 'Sign In'}
          </button>
          <button
            onClick={() => router.push('/')}
            className="text-sm text-ink-soft hover:text-ink underline"
          >
            {locale === 'zh' ? '返回主頁' : 'Back to home'}
          </button>
        </motion.div>
        <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} />
      </div>
    );
  }

  if (error && !booking) {
    return (
      <div className="pt-28 min-h-screen flex items-center justify-center px-6">
        <div className="max-w-md w-full text-center space-y-4">
          <p className="text-rose-500">{error}</p>
          <button
            onClick={() => router.push('/account')}
            className="text-sm text-ink-soft hover:text-ink underline"
          >
            {locale === 'zh' ? '查看我的預訂' : 'View my bookings'}
          </button>
        </div>
      </div>
    );
  }
  if (!booking) {
    return (
      <div className="pt-28 min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-ink-soft">Loading...</div>
      </div>
    );
  }

  const venue = getVenueById(booking.venueId);
  const venueName = venue?.name[locale] || booking.branchSlug;
  const pointsDiscount = booking.pointsDiscount || 0;
  const chargeAmount = Math.max(1, booking.pricing.deposit - pointsDiscount);
  const cardFee = surchargeFor(chargeAmount);
  const cardTotal = Math.round((chargeAmount + cardFee) * 100) / 100;

  /** Draft mode: first (atomic, server-side) write of the booking —
   *  this is also what holds the physical slot. Returns the real id. */
  async function ensureBooking(paymentMethod: 'stripe' | 'fps'): Promise<string> {
    if (!isDraft) {
      await updateBookingPaymentMethod(booking!.id, paymentMethod);
      return booking!.id;
    }
    if (!draft || !draft.refundDetails || !user) throw new Error('Draft missing');
    const pendingExpiresAt =
      Date.now() + PAYMENT_DETAILS.pendingHoldMinutes * 60 * 1000;
    const createRes = await fetch('/api/bookings/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
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
        paymentMethod,
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
      }),
    });
    if (!createRes.ok) {
      const errData = await createRes.json().catch(() => ({}));
      throw new Error((errData as { error?: string }).error || 'CREATE_FAILED');
    }
    const { bookingId: newId } = await createRes.json() as { bookingId: string };
    clearBookingCheckoutDraft();
    return newId;
  }

  async function handleProceed() {
    if (!selected || !booking) return;
    setError(null);
    setSubmitting(true);
    try {
      if (selected === 'fps') {
        // FPS / bank transfer stays OFF KPay: customer transfers
        // directly and uploads the receipt; admin verifies by hand.
        const id = await ensureBooking('fps');
        fetch('/api/email/offline-pending', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId: id }),
        }).catch((err) => console.warn('[offline-pending email] failed:', err));
        router.push(`/book/${slug}/pay-offline/${id}`);
        return;
      }

      const id = await ensureBooking('stripe');
      const res = await fetch('/api/kpay/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId: id,
          amount: chargeAmount,
          venueName,
          customerEmail: user?.email,
          methodGroup: selected,   // 'card' → +1.5%, 'wallet' → none
        }),
      });
      if (!res.ok) throw new Error(`Checkout API ${res.status}`);
      const { sessionUrl } = await res.json();
      if (!sessionUrl) throw new Error('No checkout URL returned');
      window.location.href = sessionUrl;
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'SLOT_CONFLICT') {
        setError(locale === 'zh'
          ? '非常抱歉，此時段剛被其他人預訂。請返回選擇另一時段。'
          : 'Sorry, this slot was just booked by someone else. Please go back and choose another time.');
      } else {
        setError(locale === 'zh' ? '處理失敗，請重試' : 'Processing failed, please retry');
      }
      setSubmitting(false);
    }
  }

  function OptionCard(props: {
    choice: PayChoice;
    icon: React.ReactNode;
    title: string;
    subtitle: string;
    badge?: { text: string; tone: 'fee' | 'free' };
  }) {
    const active = selected === props.choice;
    return (
      <button
        onClick={() => setSelected(props.choice)}
        className={`w-full text-left border-2 rounded-2xl p-4 flex items-center gap-4 transition-all ${
          active ? 'border-accent bg-accent/5 shadow-sm' : 'border-line hover:border-ink-soft/40'
        }`}
      >
        <div className={`shrink-0 ${active ? 'text-accent' : 'text-ink-soft'}`}>{props.icon}</div>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-ink flex items-center gap-2 flex-wrap">
            {props.title}
            {props.badge && (
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                props.badge.tone === 'fee'
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-emerald-100 text-emerald-700'
              }`}>
                {props.badge.text}
              </span>
            )}
          </div>
          <div className="text-xs text-ink-soft mt-0.5">{props.subtitle}</div>
        </div>
        <div className={`w-5 h-5 rounded-full border-2 shrink-0 ${
          active ? 'border-accent bg-accent' : 'border-line'
        }`} />
      </button>
    );
  }

  return (
    <div className="pt-28 pb-20 relative overflow-hidden min-h-screen">
      <div className="orb orb-pink animate-float-slow" style={{ width: 280, height: 280, top: '-60px', right: '-60px', opacity: 0.4 }} />
      <div className="max-content mx-auto px-6 md:px-12 lg:px-20 relative z-10">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-md mx-auto space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-heading font-display">
              <span className="text-gradient-pink">{locale === 'zh' ? '選擇付款方式' : 'Choose Payment Method'}</span>
            </h1>
            <p className="text-ink-soft text-sm">{venueName} • {booking.date}</p>
            <p className="text-ink-soft text-sm">
              {locale === 'zh' ? '應付金額' : 'Amount due'}：
              <span className="font-bold text-ink ml-1">HK${chargeAmount.toLocaleString()}</span>
            </p>
          </div>

          <div className="space-y-3">
            <OptionCard
              choice="wallet"
              icon={<Smartphone size={24} />}
              title={locale === 'zh' ? '電子錢包' : 'E-Wallet'}
              subtitle={locale === 'zh' ? 'AlipayHK / 支付寶 / WeChat Pay / PayMe' : 'AlipayHK / Alipay / WeChat Pay / PayMe'}
              badge={{ text: locale === 'zh' ? '免手續費' : 'No fee', tone: 'free' }}
            />
            <OptionCard
              choice="fps"
              icon={<Building2 size={24} />}
              title={locale === 'zh' ? '轉數快 FPS / 銀行轉賬' : 'FPS / Bank Transfer'}
              subtitle={locale === 'zh' ? '過數後上載入數紙，職員核對後確認' : 'Transfer, upload the receipt, staff verifies'}
              badge={{ text: locale === 'zh' ? '免手續費' : 'No fee', tone: 'free' }}
            />
            <OptionCard
              choice="card"
              icon={<CreditCard size={24} />}
              title={locale === 'zh' ? '信用卡 / Apple Pay / Samsung Pay' : 'Card / Apple Pay / Samsung Pay'}
              subtitle={
                locale === 'zh'
                  ? `手續費 HK$${cardFee.toLocaleString()}，合共 HK$${cardTotal.toLocaleString()}`
                  : `HK$${cardFee.toLocaleString()} fee, total HK$${cardTotal.toLocaleString()}`
              }
              badge={{ text: locale === 'zh' ? '+1.5% 手續費' : '+1.5% fee', tone: 'fee' }}
            />
          </div>

          {selected === 'card' && (
            <p className="text-xs text-ink-soft text-center">
              {locale === 'zh'
                ? '💡 想慳返手續費？可以揀電子錢包或者轉數快付款。'
                : '💡 Choose an e-wallet or FPS to skip the card fee.'}
            </p>
          )}

          {error && <p className="text-sm text-rose-500 text-center">{error}</p>}

          <button
            disabled={!selected || submitting}
            onClick={handleProceed}
            className="w-full bg-accent text-white py-4 rounded-xl font-bold text-lg hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting
              ? (locale === 'zh' ? '處理中…' : 'Processing…')
              : selected === 'card'
                ? (locale === 'zh' ? `付款 HK$${cardTotal.toLocaleString()}` : `Pay HK$${cardTotal.toLocaleString()}`)
                : (locale === 'zh' ? `付款 HK$${chargeAmount.toLocaleString()}` : `Pay HK$${chargeAmount.toLocaleString()}`)}
          </button>

          <p className="text-xs text-ink-soft text-center">
            {locale === 'zh'
              ? '網上付款經 KPay 安全處理；轉數快為銀行直接過數。'
              : 'Online payments are securely processed by KPay; FPS is a direct bank transfer.'}
          </p>
        </motion.div>
      </div>
      <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} />
    </div>
  );
}
