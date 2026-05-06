'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { useParams } from 'next/navigation';
import { useRouter } from '@/i18n/routing';
import { useAuth } from '@/contexts/AuthContext';
import { getBooking, updateBookingRefundDetails } from '@/lib/firestore';
import { getVenueById } from '@/lib/venues';
import { addOns as addOnCatalog } from '@/lib/pricing';
import { BookingRecord, RefundDetails } from '@/types';
import { CalendarDays, Clock, Users, MapPin, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';

export default function ConfirmBookingPage() {
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

  // Refund details form state
  const [method, setMethod] = useState<'fps' | 'bank'>('fps');
  const [fpsIdentifier, setFpsIdentifier] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountHolderName, setAccountHolderName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');

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
          setError(locale === 'zh' ? '無權查看此預訂' : 'Not authorized to view this booking');
        } else {
          setBooking(b);
          if (b.refundDetails) {
            setMethod(b.refundDetails.method);
            setFpsIdentifier(b.refundDetails.fpsIdentifier || '');
            setBankName(b.refundDetails.bankName || '');
            setAccountHolderName(b.refundDetails.accountHolderName || '');
            setAccountNumber(b.refundDetails.accountNumber || '');
          }
        }
      })
      .finally(() => setLoading(false));
  }, [bookingId, user, authLoading, router, locale]);

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
  const securityDeposit = booking.pricing.securityDeposit ?? 0;
  const grandTotal = booking.pricing.subtotal + securityDeposit;
  const isFullPayment = grandTotal <= 10000;
  const balanceDue = Math.max(0, grandTotal - booking.pricing.deposit);

  const refundReady =
    method === 'fps'
      ? fpsIdentifier.trim().length > 0
      : bankName.trim().length > 0 &&
        accountHolderName.trim().length > 0 &&
        accountNumber.trim().length > 0;

  async function handleProceed() {
    if (!refundReady || !booking) return;
    setSubmitting(true);
    try {
      const refundDetails: RefundDetails =
        method === 'fps'
          ? { method: 'fps', fpsIdentifier: fpsIdentifier.trim() }
          : {
              method: 'bank',
              bankName: bankName.trim(),
              accountHolderName: accountHolderName.trim(),
              accountNumber: accountNumber.trim(),
            };
      await updateBookingRefundDetails(booking.id, refundDetails);
      router.push(`/book/${slug}/payment/${booking.id}`);
    } catch (err) {
      console.error(err);
      setError(locale === 'zh' ? '儲存失敗，請重試' : 'Save failed, please retry');
      setSubmitting(false);
    }
  }

  return (
    <div className="pt-28 pb-20 relative overflow-hidden">
      <div className="orb orb-pink animate-float-slow" style={{ width: 280, height: 280, top: '-60px', right: '-60px', opacity: 0.4 }} />
      <div className="max-content mx-auto px-6 md:px-12 lg:px-20 relative z-10">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl mx-auto space-y-6">
          <div>
            <h1 className="text-heading font-display">
              <span className="text-gradient-pink">{locale === 'zh' ? '確認預約' : 'Confirm Booking'}</span>
            </h1>
            <p className="text-ink-soft mt-2 text-sm">
              {locale === 'zh' ? '請核對預約明細並填寫按金退款資料。' : 'Review your booking and fill in the deposit refund details.'}
            </p>
          </div>

          {/* Booking summary */}
          <div className="glass-card p-7 space-y-4">
            <h2 className="font-bold text-lg flex items-center gap-2">
              <CalendarDays size={18} className="text-accent" />
              {locale === 'zh' ? '預約明細' : 'Booking Details'}
            </h2>
            <Row icon={<MapPin size={14} />} label={locale === 'zh' ? '場地' : 'Venue'} value={venueName} />
            <Row icon={<CalendarDays size={14} />} label={locale === 'zh' ? '日期' : 'Date'} value={booking.date} />
            <Row icon={<Clock size={14} />} label={locale === 'zh' ? '時間' : 'Time'} value={`${booking.startTime} – ${booking.endTime} (${booking.hours} ${locale === 'zh' ? '小時' : 'hrs'})`} />
            <Row icon={<Users size={14} />} label={locale === 'zh' ? '人數' : 'Guests'} value={`${booking.guestCount} ${locale === 'zh' ? '人' : 'pax'}`} />
            {booking.addOns.length > 0 && (
              <div className="pt-2 border-t border-white/40 space-y-1">
                <p className="text-xs text-ink-soft">{locale === 'zh' ? '附加服務' : 'Add-ons'}</p>
                {booking.addOns.map((a) => {
                  const meta = addOnCatalog.find((c) => c.id === a.id);
                  return (
                    <p key={a.id} className="text-sm">
                      • {meta?.name[locale] || a.id} {a.quantity > 1 ? `× ${a.quantity}` : ''}
                    </p>
                  );
                })}
              </div>
            )}
            <div className="pt-3 border-t border-white/40 space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-ink-soft">{locale === 'zh' ? '小計' : 'Subtotal'}</span>
                <span>HK${booking.pricing.subtotal.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-ink-soft">{locale === 'zh' ? '按金（活動後退還）' : 'Security deposit (refunded after event)'}</span>
                <span>HK${securityDeposit.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm font-semibold pt-1.5 border-t border-white/40">
                <span>{locale === 'zh' ? '總計' : 'Grand total'}</span>
                <span>HK${grandTotal.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-base pt-2">
                <span className="text-ink-soft">
                  {isFullPayment
                    ? (locale === 'zh' ? '應付（全數）' : 'Due now (full)')
                    : (locale === 'zh' ? '應付（50%）' : 'Due now (50%)')}
                </span>
                <span className="font-bold text-gradient-pink text-xl">
                  HK${booking.pricing.deposit.toLocaleString()}
                </span>
              </div>
              {!isFullPayment && (
                <div className="flex justify-between text-xs text-amber-700 bg-amber-50 p-2 rounded mt-1">
                  <span>{locale === 'zh' ? '尾數（活動前 2 日繳清）' : 'Balance (due 2 days before event)'}</span>
                  <span className="font-semibold">HK${balanceDue.toLocaleString()}</span>
                </div>
              )}
            </div>
          </div>

          {/* Refund form */}
          <div className="glass-card p-7 space-y-4">
            <div>
              <h2 className="font-bold text-lg">{locale === 'zh' ? '按金退款資料' : 'Deposit Refund Details'}</h2>
              <p className="text-xs text-ink-soft mt-1">
                {locale === 'zh'
                  ? '活動結束後 24 小時內，按金（如無扣減）會用以下方式退回。'
                  : 'Within 24 hours after the event, the security deposit (less any deductions) will be refunded via the method below.'}
              </p>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMethod('fps')}
                className={`flex-1 py-2.5 rounded-lg border text-sm font-medium ${method === 'fps' ? 'border-accent bg-accent/10 text-accent' : 'border-charcoal/15 text-ink-soft'}`}
              >
                FPS {locale === 'zh' ? '轉數快' : ''}
              </button>
              <button
                type="button"
                onClick={() => setMethod('bank')}
                className={`flex-1 py-2.5 rounded-lg border text-sm font-medium ${method === 'bank' ? 'border-accent bg-accent/10 text-accent' : 'border-charcoal/15 text-ink-soft'}`}
              >
                {locale === 'zh' ? '銀行轉賬' : 'Bank transfer'}
              </button>
            </div>

            {method === 'fps' ? (
              <Field
                label={locale === 'zh' ? '電話號碼 / 轉數快 ID / Email' : 'Phone / FPS ID / Email'}
                value={fpsIdentifier}
                onChange={setFpsIdentifier}
                placeholder={locale === 'zh' ? '+852 9XXXXXXX 或 ID 或 email' : '+852 9XXXXXXX, ID, or email'}
              />
            ) : (
              <>
                <Field
                  label={locale === 'zh' ? '銀行名稱' : 'Bank name'}
                  value={bankName}
                  onChange={setBankName}
                  placeholder={locale === 'zh' ? '例：HSBC、東亞銀行' : 'e.g. HSBC, BEA Bank'}
                />
                <Field
                  label={locale === 'zh' ? '戶口持有人英文全名' : 'Account holder English name'}
                  value={accountHolderName}
                  onChange={setAccountHolderName}
                  placeholder={'CHAN TAI MAN'}
                />
                <Field
                  label={locale === 'zh' ? '戶口號碼' : 'Account number'}
                  value={accountNumber}
                  onChange={setAccountNumber}
                  placeholder={'XXX-XXX-XXXXXXXX'}
                />
              </>
            )}
          </div>

          {error && <p className="text-sm text-rose-500 text-center">{error}</p>}

          <button
            disabled={!refundReady || submitting}
            onClick={handleProceed}
            className="w-full bg-accent text-white py-4 rounded-xl font-bold text-lg hover:bg-accent/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting
              ? (locale === 'zh' ? '處理中…' : 'Processing…')
              : (locale === 'zh' ? '繼續付款' : 'Continue to Payment')}
            {!submitting && <ArrowRight size={18} />}
          </button>

          {!refundReady && (
            <p className="text-xs text-rose-400 text-center -mt-3">
              {locale === 'zh' ? '請填妥所有退款資料' : 'Please complete all refund fields'}
            </p>
          )}
        </motion.div>
      </div>
    </div>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-2 text-sm text-ink-soft">
        {icon}
        {label}
      </span>
      <span className="font-medium text-ink text-sm text-right">{value}</span>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-ink-soft mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-4 py-2.5 rounded-lg border border-charcoal/15 bg-white/60 text-sm focus:outline-none focus:border-accent"
      />
    </div>
  );
}
