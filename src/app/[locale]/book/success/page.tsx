'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import { useRouter } from '@/i18n/routing';
import { useSearchParams } from 'next/navigation';
import { getBooking } from '@/lib/firestore';
import { venues } from '@/lib/venues';
import { BookingRecord } from '@/types';
import { generateWhatsAppLink } from '@/lib/email';
import { Check, CalendarDays, MessageCircle, ArrowRight, Clock, XCircle, RefreshCcw } from 'lucide-react';
import { motion } from 'framer-motion';

export default function BookingSuccessPage() {
  const locale = useLocale() as 'zh' | 'en';
  const router = useRouter();
  const searchParams = useSearchParams();
  const bookingId = searchParams.get('booking_id');
  const [booking, setBooking] = useState<BookingRecord | null>(null);
  const [loading, setLoading] = useState(true);
  // Track polling attempts so we don't loop forever when the webhook is
  // genuinely stalled (avoid hammering Firestore from the customer browser).
  const [pollCount, setPollCount] = useState(0);

  // Initial fetch + poll while status is awaiting_payment. KPay's webhook
  // can arrive after the customer's browser is redirected back, so the
  // first read may catch the booking pre-update. Re-poll every 3s up to
  // 10 times (~30s total) to let the webhook land.
  useEffect(() => {
    if (!bookingId) { setLoading(false); return; }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const fetchOnce = async () => {
      const b = await getBooking(bookingId);
      if (cancelled) return;
      setBooking(b);
      setLoading(false);
      // Keep polling if booking exists but hasn't been confirmed yet —
      // webhook may still be in flight. Stop once we hit a terminal state
      // or run out of attempts.
      if (b && b.status === 'awaiting_payment' && pollCount < 10) {
        timer = setTimeout(() => setPollCount((c) => c + 1), 3000);
      }
    };
    fetchOnce();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [bookingId, pollCount]);

  const venue = booking ? venues.find((v) => v.id === booking.venueId) : null;
  const whatsappNumber = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || '85292823060';
  const whatsappMsg = booking
    ? locale === 'zh'
      ? `你好，我已完成預訂付款。\n預訂編號：${bookingId}\n場地：${venue?.name.zh}\n日期：${booking.date}\n時間：${booking.startTime}-${booking.endTime}`
      : `Hi, I've completed my booking payment.\nBooking ID: ${bookingId}\nVenue: ${venue?.name.en}\nDate: ${booking.date}\nTime: ${booking.startTime}-${booking.endTime}`
    : '';

  // Decide which UI state to render based on the booking's true status,
  // NOT just the fact that we landed on this URL. (KPay redirects here
  // even when the customer cancels at the cashier — see Bug 2 fix.)
  const status: 'loading' | 'success' | 'pending' | 'failed' | 'unknown' = (() => {
    if (loading) return 'loading';
    if (!booking) return 'unknown';
    if (booking.status === 'confirmed' || booking.status === 'completed') return 'success';
    if (booking.status === 'awaiting_payment' || booking.status === 'pending') return 'pending';
    return 'failed';
  })();

  // Per-state heading + sub copy + icon.
  const heroByStatus = {
    loading: {
      title: locale === 'zh' ? '載入中…' : 'Loading…',
      subtitle: '',
      icon: <Clock size={36} className="text-white animate-pulse" strokeWidth={3} />,
      tint: 'bg-gradient-pink',
      gradient: 'text-gradient-warm',
    },
    success: {
      title: locale === 'zh' ? '預約成功！' : 'Booking Confirmed!',
      subtitle: locale === 'zh'
        ? '感謝你的預訂，場地密碼將於活動前 1-2 天發送。'
        : 'Thank you for your booking. The venue access code will be sent 1-2 days before your event.',
      icon: <Check size={36} className="text-white" strokeWidth={3} />,
      tint: 'bg-gradient-pink',
      gradient: 'text-gradient-warm',
    },
    pending: {
      title: locale === 'zh' ? '正在確認付款…' : 'Confirming Payment…',
      subtitle: locale === 'zh'
        ? '我哋仲未收到 KPay 嘅付款確認通知，請等幾秒。如果一直冇變，請點下面「重新查詢」。'
        : "We haven't received KPay's payment confirmation yet. This usually takes a few seconds.",
      icon: <Clock size={36} className="text-white animate-pulse" strokeWidth={3} />,
      tint: 'bg-amber-400',
      gradient: 'text-amber-600',
    },
    failed: {
      title: locale === 'zh' ? '付款未完成' : 'Payment Not Completed',
      subtitle: locale === 'zh'
        ? '此預訂嘅付款未完成（可能已取消或失敗）。你可以重新付款，或聯絡我哋查詢。'
        : 'This booking has not been paid (cancelled or failed). You can retry payment or contact us.',
      icon: <XCircle size={36} className="text-white" strokeWidth={3} />,
      tint: 'bg-rose-500',
      gradient: 'text-rose-600',
    },
    unknown: {
      title: locale === 'zh' ? '找不到預訂' : 'Booking Not Found',
      subtitle: locale === 'zh'
        ? '搵唔到呢個預訂編號。請檢查連結，或聯絡我哋。'
        : "We couldn't find this booking. Please check the link or contact us.",
      icon: <XCircle size={36} className="text-white" strokeWidth={3} />,
      tint: 'bg-charcoal/40',
      gradient: 'text-ink',
    },
  }[status];

  return (
    <div className="pt-28 min-h-screen flex items-center relative overflow-hidden">
      <div className="orb orb-pink animate-float-slow" style={{ width: 320, height: 320, top: '-80px', right: '-60px', opacity: 0.6 }} />
      <div className="orb orb-lavender animate-float-medium" style={{ width: 240, height: 240, bottom: '-60px', left: '-40px', opacity: 0.55 }} />
      <div className="orb orb-coral animate-float-fast" style={{ width: 140, height: 140, top: '20%', left: '15%', opacity: 0.55 }} />
      <div className="orb orb-sky animate-float-slow" style={{ width: 130, height: 130, bottom: '20%', right: '15%', opacity: 0.5 }} />

      <div className="max-content mx-auto px-6 md:px-12 lg:px-20 py-12 relative z-10 w-full">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-lg mx-auto"
        >
          <div className="glass-card p-8 md:p-10 text-center">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
              className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 shadow-glow ${heroByStatus.tint}`}
            >
              {heroByStatus.icon}
            </motion.div>

            <h1 className="text-heading font-display mb-3">
              <span className={heroByStatus.gradient}>{heroByStatus.title}</span>
            </h1>
            <p className="text-ink-soft mb-8">{heroByStatus.subtitle}</p>

            {/* Booking summary — same for any state so the customer can see
             *  what they tried to book. Hidden when booking is null. */}
            {booking && venue && (
              <div className="bg-white/40 backdrop-blur-md rounded-2xl p-5 border border-white/60 text-left mb-8">
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-ink-soft">{locale === 'zh' ? '預訂編號' : 'Booking ID'}</span>
                    <span className="font-mono font-medium text-ink">{bookingId?.slice(0, 8)}...</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-soft">{locale === 'zh' ? '場地' : 'Venue'}</span>
                    <span className="font-medium text-ink">{venue.name[locale]}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-soft">{locale === 'zh' ? '日期' : 'Date'}</span>
                    <span className="font-medium text-ink">{booking.date}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-soft">{locale === 'zh' ? '時間' : 'Time'}</span>
                    <span className="font-medium text-ink">{booking.startTime} - {booking.endTime}</span>
                  </div>
                  <div className="flex justify-between border-t border-white/60 pt-3">
                    <span className="text-ink-soft">{locale === 'zh' ? '訂單總額' : 'Order total'}</span>
                    <span className="font-bold text-lg font-display text-gradient-pink">
                      HK${(
                        Math.max(0, booking.pricing.subtotal - (booking.promoDiscount || 0))
                        + (booking.pricing.securityDeposit ?? 0)
                      ).toLocaleString()}
                    </span>
                  </div>
                  {(booking.pricing.securityDeposit ?? 0) > 0 && (
                    <p className="text-xs text-ink-soft text-right -mt-1">
                      {locale === 'zh'
                        ? `已包含場地按金 HK$${(booking.pricing.securityDeposit ?? 0).toLocaleString()}（活動後退還）`
                        : `Includes HK$${(booking.pricing.securityDeposit ?? 0).toLocaleString()} refundable security deposit`}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Per-state action set. */}
            <div className="space-y-3">
              {status === 'success' && (
                <>
                  <a
                    href={generateWhatsAppLink(whatsappNumber, whatsappMsg)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-[#25D366] text-white rounded-pill font-semibold hover:-translate-y-0.5 transition-transform shadow-glow"
                    style={{ boxShadow: '0 10px 30px -8px rgba(37, 211, 102, 0.55)' }}
                  >
                    <MessageCircle size={18} />
                    {locale === 'zh' ? 'WhatsApp 聯繫我們' : 'Contact Us on WhatsApp'}
                  </a>
                  <Link href="/my-bookings" className="w-full flex items-center justify-center gap-2 btn-glass">
                    <CalendarDays size={18} />
                    {locale === 'zh' ? '查看我的預訂' : 'View My Bookings'}
                  </Link>
                </>
              )}

              {status === 'pending' && (
                <button
                  onClick={() => setPollCount(0)}
                  className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-accent text-white rounded-pill font-semibold hover:-translate-y-0.5 transition-transform"
                >
                  <RefreshCcw size={18} />
                  {locale === 'zh' ? '重新查詢' : 'Refresh Status'}
                </button>
              )}

              {status === 'failed' && booking && (
                <>
                  <button
                    onClick={() => {
                      router.push(`/book/${booking.branchSlug}/payment/${booking.id}`);
                    }}
                    className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-accent text-white rounded-pill font-semibold hover:-translate-y-0.5 transition-transform"
                  >
                    <RefreshCcw size={18} />
                    {locale === 'zh' ? '重新付款' : 'Retry Payment'}
                  </button>
                  <a
                    href={generateWhatsAppLink(whatsappNumber, '')}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-[#25D366] text-white rounded-pill font-semibold hover:-translate-y-0.5 transition-transform"
                  >
                    <MessageCircle size={18} />
                    {locale === 'zh' ? 'WhatsApp 聯絡我們' : 'Contact Us on WhatsApp'}
                  </a>
                </>
              )}

              <Link href="/" className="w-full flex items-center justify-center gap-2 px-6 py-3 text-sm text-ink-soft hover:text-pink transition-colors">
                {locale === 'zh' ? '返回首頁' : 'Back to Home'}
                <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
