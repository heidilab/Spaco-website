'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { useParams } from 'next/navigation';
import { useRouter } from '@/i18n/routing';
import { useAuth } from '@/contexts/AuthContext';
import { getBooking, updateBookingPaymentMethod } from '@/lib/firestore';
import { getVenueById } from '@/lib/venues';
import { BookingRecord } from '@/types';
import { CreditCard, Building2, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';

export default function PaymentMethodPage() {
  const locale = useLocale() as 'zh' | 'en';
  const params = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const bookingId = params.id as string;
  const slug = params.branchSlug as string;

  const [booking, setBooking] = useState<BookingRecord | null>(null);
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
  }, [bookingId, user, authLoading, router, locale, slug]);

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
      await updateBookingPaymentMethod(booking.id, selected);

      if (selected === 'stripe') {
        // Customer's loyalty redemption (set on the confirm page) reduces
        // the actual amount we charge.
        const pointsDiscount = booking.pointsDiscount || 0;
        const chargeAmount = Math.max(1, booking.pricing.deposit - pointsDiscount);
        const res = await fetch('/api/stripe/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookingId: booking.id,
            amount: chargeAmount,
            deposit: booking.pricing.deposit,
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
          body: JSON.stringify({ bookingId: booking.id }),
        }).catch((err) => console.warn('[offline-pending email] failed:', err));
        router.push(`/book/${slug}/pay-offline/${booking.id}`);
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
