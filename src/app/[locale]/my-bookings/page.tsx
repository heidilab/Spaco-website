'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import { getUserBookings, updateBookingReceiptUploaded } from '@/lib/firestore';
import { storage } from '@/lib/firebase';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { BookingRecord } from '@/types';
import { venues } from '@/lib/venues';
import { generateWhatsAppLink } from '@/lib/email';
import { PAYMENT_DETAILS } from '@/lib/paymentDetails';
import { CalendarDays, Clock, Users, Upload, MessageCircle, CreditCard, AlertCircle, ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { Link } from '@/i18n/routing';
import AuthModal from '@/components/auth/AuthModal';

const statusColors: Record<string, string> = {
  pending: 'bg-amber-100/80 text-amber-700 border-amber-200',
  awaiting_payment: 'bg-orange-100/80 text-orange-700 border-orange-200',
  awaiting_review: 'bg-violet-100/80 text-violet-700 border-violet-200',
  confirmed: 'bg-emerald-100/80 text-emerald-700 border-emerald-200',
  completed: 'bg-sky-100/80 text-sky-700 border-sky-200',
  cancelled: 'bg-rose-100/80 text-rose-700 border-rose-200',
};

const statusLabels: Record<string, { zh: string; en: string }> = {
  pending: { zh: '待付款', en: 'Pending payment' },
  awaiting_payment: { zh: '待付款', en: 'Awaiting Payment' },
  awaiting_review: { zh: '待核實', en: 'Awaiting Review' },
  confirmed: { zh: '已確認', en: 'Confirmed' },
  completed: { zh: '已完成', en: 'Completed' },
  cancelled: { zh: '已取消', en: 'Cancelled' },
};

export default function MyBookingsPage() {
  const { user, loading: authLoading } = useAuth();
  const locale = useLocale() as 'zh' | 'en';
  const [bookings, setBookings] = useState<BookingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [authModalOpen, setAuthModalOpen] = useState(false);

  // Re-render every second so countdown timers tick down live.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    getUserBookings(user.uid).then((data) => {
      setBookings(data);
      setLoading(false);
    });
  }, [user, authLoading]);

  function refresh() {
    if (!user) return;
    getUserBookings(user.uid).then(setBookings);
  }

  // Hide bookings that should not appear in the customer's list:
  //   1. Created but no payment method picked yet (status='pending' + paymentMethod=null)
  //      — the customer abandoned the flow before committing to anything.
  //   2. Offline-payment bookings whose 30-min hold expired without a receipt
  //      — the cron will (or already did) auto-cancel them; hide immediately.
  const now = Date.now();
  const visibleBookings = bookings.filter((b) => {
    if (b.status === 'pending' && !b.paymentMethod) return false;
    if (b.status === 'cancelled') return false;
    const isOfflineAwaiting =
      b.status === 'awaiting_payment' &&
      b.paymentMethod !== 'stripe' &&
      !b.receiptUrl;
    if (isOfflineAwaiting && typeof b.pendingExpiresAt === 'number' && b.pendingExpiresAt <= now) {
      return false;
    }
    return true;
  });

  if (authLoading || loading) {
    return (
      <div className="pt-28 min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-ink-soft">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="pt-28 min-h-screen relative overflow-hidden">
        <div className="orb orb-pink animate-float-slow" style={{ width: 280, height: 280, top: '-60px', right: '-60px', opacity: 0.5 }} />
        <div className="max-content mx-auto px-6 md:px-12 lg:px-20 py-16 text-center relative z-10">
          <div className="glass-card p-10 max-w-md mx-auto">
            <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-gradient-pink flex items-center justify-center text-white shadow-glow">
              <CalendarDays size={28} />
            </div>
            <h1 className="text-heading font-display mb-4">
              <span className="text-gradient-warm">{locale === 'zh' ? '請先登入' : 'Please Log In'}</span>
            </h1>
            <p className="text-ink-soft mb-7">
              {locale === 'zh' ? '登入後即可查看您的預訂記錄' : 'Log in to view your booking history'}
            </p>
            <button onClick={() => setAuthModalOpen(true)} className="btn-primary">
              {locale === 'zh' ? '登入 / 註冊' : 'Log In / Sign Up'}
            </button>
          </div>
          <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} />
        </div>
      </div>
    );
  }

  return (
    <div className="pt-28 min-h-screen relative overflow-hidden">
      <div className="orb orb-pink animate-float-slow" style={{ width: 280, height: 280, top: '-60px', right: '-60px', opacity: 0.4 }} />
      <div className="max-content mx-auto px-6 md:px-12 lg:px-20 py-12 relative z-10">
        <div className="mb-10">
          <span className="chip mb-3">
            <CalendarDays size={12} className="text-pink" />
            Account
          </span>
          <h1 className="text-heading font-display">
            <span className="text-ink">{locale === 'zh' ? '我的' : 'My'}</span>{' '}
            <span className="text-gradient-pink">{locale === 'zh' ? '預訂' : 'Bookings'}</span>
          </h1>
        </div>

        {visibleBookings.length === 0 ? (
          <div className="glass-card p-12 text-center max-w-md mx-auto">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-white/60 flex items-center justify-center text-ink-soft">
              <CalendarDays size={28} />
            </div>
            <p className="text-ink-soft">{locale === 'zh' ? '暫無預訂記錄' : 'No bookings yet'}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {visibleBookings.map((booking, i) => (
              <BookingCard key={booking.id} booking={booking} index={i} locale={locale} onChange={refresh} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BookingCard({
  booking,
  index,
  locale,
  onChange,
}: {
  booking: BookingRecord;
  index: number;
  locale: 'zh' | 'en';
  onChange: () => void;
}) {
  const venue = venues.find((v) => v.id === booking.venueId);

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    try {
      const filename = `${Date.now()}-${file.name.replace(/[^\w.-]/g, '_')}`;
      const ref = storageRef(storage, `receipts/${booking.id}/${filename}`);
      await uploadBytes(ref, file);
      const url = await getDownloadURL(ref);
      await updateBookingReceiptUploaded(booking.id, url);
      onChange();
    } catch (err) {
      console.error(err);
      setUploadError(locale === 'zh' ? '上載失敗' : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  const balanceDue = booking.balanceDue ?? 0;
  const showResumePayment = booking.status === 'pending' || (booking.status === 'awaiting_payment' && !booking.receiptUrl);
  const showUploadReceipt =
    (booking.status === 'pending' || booking.status === 'awaiting_payment') && booking.paymentMethod !== 'stripe';
  const showPayBalance = booking.status === 'confirmed' && balanceDue > 0;

  // Live 30-min countdown for offline-payment bookings awaiting a receipt.
  // After expiry the row will be filtered out by the parent on the next render,
  // and the server cron will flip the booking to `cancelled` shortly after.
  const isOfflineAwaiting =
    booking.status === 'awaiting_payment' &&
    booking.paymentMethod !== 'stripe' &&
    !booking.receiptUrl &&
    typeof booking.pendingExpiresAt === 'number';
  const msLeft = isOfflineAwaiting
    ? Math.max(0, (booking.pendingExpiresAt as number) - Date.now())
    : 0;
  const minsLeft = Math.floor(msLeft / 60000);
  const secsLeft = Math.floor((msLeft % 60000) / 1000);

  const whatsappMsg =
    locale === 'zh'
      ? `你好，預訂編號：${booking.id}\n金額：HK$${booking.pricing.deposit.toLocaleString()}`
      : `Hi, Booking ID: ${booking.id}\nAmount: HK$${booking.pricing.deposit.toLocaleString()}`;
  const whatsappLink = generateWhatsAppLink(PAYMENT_DETAILS.fps.digitsOnly, whatsappMsg);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="glass-card p-6 cursor-pointer hover:bg-white/40 transition-colors"
      onClick={(e) => {
        // Ignore clicks that originate inside actions / inline links.
        const target = e.target as HTMLElement;
        if (target.closest('button') || target.closest('a')) return;
        window.location.href = `/${locale}/my-bookings/${booking.id}`;
      }}
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-3">
        <div className="space-y-2 flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h3 className="font-bold font-display text-lg text-ink">
              {venue?.name[locale] || booking.venueId}
            </h3>
            <span className={`px-3 py-1 rounded-pill text-xs font-medium border ${statusColors[booking.status]}`}>
              {statusLabels[booking.status]?.[locale] || booking.status}
            </span>
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-ink-soft">
            <span className="flex items-center gap-1.5">
              <CalendarDays size={14} className="text-pink" /> {booking.date}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock size={14} className="text-lavender" /> {booking.startTime} – {booking.endTime}{booking.endDate && booking.endDate !== booking.date ? (locale === 'zh' ? '（翌日）' : ' (next day)') : ''}
            </span>
            <span className="flex items-center gap-1.5">
              <Users size={14} className="text-coral" /> {booking.guestCount} {locale === 'zh' ? '人' : 'pax'}
            </span>
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold font-display text-gradient-pink">
            HK${(booking.pricing.subtotal + (booking.pricing.securityDeposit ?? 0)).toLocaleString()}
          </p>
          <p className="text-xs text-ink-soft">
            {locale === 'zh' ? '應付' : 'Due'}: HK${booking.pricing.deposit.toLocaleString()}
          </p>
          {balanceDue > 0 && (
            <p className="text-xs text-amber-700 mt-0.5">
              {locale === 'zh' ? '尾數' : 'Balance'}: HK${balanceDue.toLocaleString()}
            </p>
          )}
        </div>
      </div>

      {/* 30-min hold countdown for offline-payment bookings */}
      {isOfflineAwaiting && msLeft > 0 && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 mb-3 flex items-start gap-2.5">
          <AlertCircle size={16} className="text-amber-600 mt-0.5 flex-shrink-0" />
          <div className="flex-1 text-xs leading-relaxed">
            <p className="font-semibold text-amber-800">
              {locale === 'zh'
                ? `預約將於 ${minsLeft} 分 ${secsLeft.toString().padStart(2, '0')} 秒後自動取消`
                : `Booking auto-cancels in ${minsLeft}m ${secsLeft.toString().padStart(2, '0')}s`}
            </p>
            <p className="text-amber-700 mt-1">
              {locale === 'zh'
                ? '系統目前並未為閣下預留場地，以收到款項時間為準（先到先得）。請於 30 分鐘內完成付款並上載截圖，否則此預約會自動取消。'
                : 'The slot is NOT reserved yet — first-come-first-served, based on payment receipt time. Complete payment and upload your receipt within 30 minutes or this booking will auto-cancel.'}
            </p>
          </div>
        </div>
      )}

      {/* Action buttons */}
      {(showResumePayment || showUploadReceipt || showPayBalance) && (
        <div className="border-t border-white/40 pt-4 mt-2 flex flex-wrap gap-2">
          {showResumePayment && (
            <Link
              href={`/book/${booking.branchSlug}/payment/${booking.id}`}
              className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 flex items-center gap-1.5"
            >
              <CreditCard size={14} />
              {locale === 'zh' ? '繼續付款' : 'Resume payment'}
            </Link>
          )}

          {showUploadReceipt && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf"
                onChange={handleUpload}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="px-4 py-2 bg-white/70 border border-charcoal/15 rounded-lg text-sm font-medium hover:border-accent flex items-center gap-1.5 disabled:opacity-50"
              >
                <Upload size={14} />
                {uploading
                  ? (locale === 'zh' ? '上載中…' : 'Uploading…')
                  : (locale === 'zh' ? '上載付款截圖' : 'Upload receipt')}
              </button>
              <a
                href={whatsappLink}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 bg-[#25D366] text-white rounded-lg text-sm font-medium flex items-center gap-1.5"
              >
                <MessageCircle size={14} />
                WhatsApp
              </a>
            </>
          )}

          {showPayBalance && (
            <Link
              href={`/book/${booking.branchSlug}/pay-balance/${booking.id}`}
              className="px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600 flex items-center gap-1.5"
            >
              <CreditCard size={14} />
              {locale === 'zh' ? '找尾數' : 'Pay balance'}
              <span className="ml-1">HK${balanceDue.toLocaleString()}</span>
            </Link>
          )}
        </div>
      )}

      {uploadError && <p className="text-sm text-rose-500 mt-2">{uploadError}</p>}

      {/* View detail hint — explicit cue that the card is clickable */}
      <div className="border-t border-white/40 pt-3 mt-3">
        <Link
          href={`/my-bookings/${booking.id}`}
          className="text-sm text-pink hover:underline font-medium inline-flex items-center gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          {locale === 'zh' ? '查看詳情' : 'View details'} <ChevronRight size={14} />
        </Link>
      </div>
    </motion.div>
  );
}
