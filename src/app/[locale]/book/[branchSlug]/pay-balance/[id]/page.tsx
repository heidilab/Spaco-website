'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { useParams } from 'next/navigation';
import { useRouter } from '@/i18n/routing';
import { useAuth } from '@/contexts/AuthContext';
import { getBooking } from '@/lib/firestore';
import { getVenueById } from '@/lib/venues';
import { BookingRecord } from '@/types';
import { LogIn, CreditCard, Smartphone, Building2 } from 'lucide-react';
import { motion } from 'framer-motion';
import AuthModal from '@/components/auth/AuthModal';

/** Must match CARD_SURCHARGE_RATE in /api/kpay/checkout. */
const CARD_SURCHARGE_RATE = 0.015;

function surchargeFor(amount: number): number {
  return Math.round(amount * CARD_SURCHARGE_RATE * 100) / 100;
}

type PayChoice = 'card' | 'wallet' | 'fps';

export default function PayBalancePage() {
  const locale = useLocale() as 'zh' | 'en';
  const params = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const bookingId = params.id as string;
  const slug = params.branchSlug as string;

  const [booking, setBooking] = useState<BookingRecord | null>(null);
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
      // (Heidi 2026-05-28: #uD9WqI2P couldn't reach the payment page from
      // the WhatsApp link because the homepage redirect dropped the URL.)
      setLoading(false);
      return;
    }
    setLoading(true);
    getBooking(bookingId)
      .then((b) => {
        if (!b) setError(locale === 'zh' ? '找不到預訂記錄' : 'Booking not found');
        else if (b.userId !== user.uid) setError(locale === 'zh' ? '無權查看此預訂（請用預訂時嘅帳號登入）' : 'Not authorized — please sign in with the account used to make this booking');
        else if ((b.balanceDue ?? 0) <= 0) setError(locale === 'zh' ? '此預訂沒有未繳尾數' : 'No outstanding balance');
        else { setBooking(b); setError(null); }
      })
      .finally(() => setLoading(false));
  }, [bookingId, user, authLoading, locale]);

  const venue = booking ? getVenueById(booking.venueId) : null;
  const venueName = venue?.name[locale] || booking?.branchSlug || '';
  const balance = booking?.balanceDue ?? 0;
  const cardFee = surchargeFor(balance);
  const cardTotal = Math.round((balance + cardFee) * 100) / 100;

  async function handleProceed() {
    if (!selected || !booking) return;
    setError(null);
    setSubmitting(true);
    try {
      if (selected === 'fps') {
        // Offline — reuse the pay-offline page (payment details + receipt upload).
        router.push(`/book/${slug}/pay-offline/${booking.id}`);
        return;
      }
      const res = await fetch('/api/kpay/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId: booking.id,
          amount: balance,
          venueName: `${venueName} (${locale === 'zh' ? '尾數' : 'balance'})`,
          customerEmail: user?.email,
          isBalancePayment: true,
          methodGroup: selected,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setError((data as { message?: string }).message
          || (locale === 'zh' ? '此預訂已付款' : 'This booking is already paid'));
        setSubmitting(false);
        return;
      }
      if (!res.ok) throw new Error(`Checkout API ${res.status}`);
      const { sessionUrl } = data as { sessionUrl?: string };
      if (!sessionUrl) throw new Error('No checkout URL returned');
      window.location.href = sessionUrl;
    } catch (err) {
      console.error(err);
      setError(locale === 'zh' ? '處理失敗，請重試' : 'Processing failed, please retry');
      setSubmitting(false);
    }
  }

  if (authLoading || loading) {
    return <div className="pt-28 min-h-screen flex items-center justify-center"><div className="animate-pulse text-ink-soft">Loading...</div></div>;
  }

  // Not signed in → show inline sign-in prompt instead of redirecting away.
  if (!user) {
    return (
      <div className="pt-28 pb-20 min-h-screen flex items-center justify-center px-6">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-md w-full text-center space-y-6">
          <h1 className="text-heading font-display">
            <span className="text-gradient-pink">{locale === 'zh' ? '繳付尾數' : 'Pay Balance'}</span>
          </h1>
          <p className="text-ink-soft text-sm">
            {locale === 'zh'
              ? '請先登入您預訂時使用的帳號，以繼續繳付尾數。'
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

  if (error || !booking) {
    return (
      <div className="pt-28 min-h-screen flex items-center justify-center px-6">
        <div className="max-w-md w-full text-center space-y-4">
          <p className="text-rose-500">{error || 'Error'}</p>
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
              <span className="text-gradient-pink">{locale === 'zh' ? '繳付尾數' : 'Pay Balance'}</span>
            </h1>
            <p className="text-ink-soft text-sm">{venueName} • {booking.date}</p>
            <p className="text-ink-soft text-sm">
              {locale === 'zh' ? '尾數' : 'Balance'}：
              <span className="font-bold text-ink ml-1">HK${balance.toLocaleString()}</span>
            </p>
          </div>

          <div className="space-y-3">
            <OptionCard
              choice="wallet"
              icon={<Smartphone size={24} />}
              title={locale === 'zh' ? '電子錢包' : 'E-Wallet'}
              subtitle={locale === 'zh' ? 'AlipayHK / 支付寶 / WeChat Pay' : 'AlipayHK / Alipay / WeChat Pay'}
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
              title={locale === 'zh' ? '信用卡 / Samsung Pay' : 'Card / Samsung Pay'}
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
                : (locale === 'zh' ? `付款 HK$${balance.toLocaleString()}` : `Pay HK$${balance.toLocaleString()}`)}
          </button>
        </motion.div>
      </div>
      <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} />
    </div>
  );
}
