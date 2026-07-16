'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { useParams } from 'next/navigation';
import { Link } from '@/i18n/routing';
import { useAuth } from '@/contexts/AuthContext';
import { getBooking } from '@/lib/firestore';
import { getVenueById } from '@/lib/venues';
import {
  addOns as addOnCatalog, getShishaFlavorLabel, SHISHA_STAFF_SETUP_FEE,
  calculatePricing,
} from '@/lib/pricing';
import { generateWhatsAppLink } from '@/lib/email';
import PaymentHistory from '@/components/booking/PaymentHistory';
import { PAYMENT_DETAILS } from '@/lib/paymentDetails';
import { BookingRecord } from '@/types';
import {
  ArrowLeft, CalendarDays, Clock, Users, MapPin, Package, Sparkles,
  Tag, Key, MessageCircle, CreditCard, Edit3, AlertCircle,
} from 'lucide-react';
import { motion } from 'framer-motion';

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

export default function MyBookingDetailPage() {
  const locale = useLocale() as 'zh' | 'en';
  const params = useParams();
  const bookingId = params.id as string;
  const { user, loading: authLoading } = useAuth();

  const [booking, setBooking] = useState<BookingRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setError(locale === 'zh' ? '請先登入' : 'Please sign in');
      setLoading(false);
      return;
    }
    getBooking(bookingId)
      .then((b) => {
        if (!b) {
          setError(locale === 'zh' ? '找不到預訂' : 'Booking not found');
        } else if (b.userId !== user.uid) {
          setError(locale === 'zh' ? '無權查看此預訂' : 'Not authorized');
        } else {
          setBooking(b);
        }
      })
      .finally(() => setLoading(false));
  }, [bookingId, user, authLoading, locale]);

  if (authLoading || loading) {
    return (
      <div className="pt-28 min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-ink-soft">Loading…</div>
      </div>
    );
  }

  if (error || !booking) {
    return (
      <div className="pt-28 min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-rose-500 mb-4">{error || 'Error'}</p>
          <Link href="/my-bookings" className="text-sm text-pink hover:underline">
            {locale === 'zh' ? '← 返回我的預訂' : '← Back to bookings'}
          </Link>
        </div>
      </div>
    );
  }

  const venue = getVenueById(booking.venueId);
  const venueName = venue?.name[locale] || booking.branchSlug;
  const securityDeposit = booking.pricing.securityDeposit ?? 0;
  // Grand total = the full bill BEFORE points, matching the payment page
  // (訂單總計 = subtotal − promo + securityDeposit). Points are NOT folded
  // into the total — they're a redemption shown as a separate line below,
  // exactly like cash paid. Folding points in here (the old code did
  // − pointsDiscount) made the total read 1900 while 已付 showed 3400, so
  // the two looked swapped. Derived from primitives so it's correct
  // whether pricing.subtotal is stored PRE- or POST-promo.
  const grandTotal = Math.max(
    0,
    (booking.pricing.baseCharge || 0)
      + (booking.pricing.addOnTotal || 0)
      - (booking.promoDiscount || 0),
  ) + securityDeposit;
  const balanceDue = booking.balanceDue ?? 0;
  // Actual cash paid = sum of logged payments (single source of truth).
  // The old code showed pricing.deposit here (the deposit installment),
  // which for a points-redeemed booking overstated what was paid.
  const paidSoFar = (booking.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
  const peopleLine = (booking.childCount ?? 0) > 0
    ? (locale === 'zh'
        ? `${booking.guestCount} 人 (${booking.adultCount ?? booking.guestCount} 成人 + ${booking.childCount} 小童)`
        : `${booking.guestCount} pax (${booking.adultCount ?? booking.guestCount} adults + ${booking.childCount} kids)`)
    : `${booking.guestCount} ${locale === 'zh' ? '人' : 'pax'}`;

  // Modification eligibility: must be confirmed (or balance still owed),
  // and at least 24h before start, and not in the past.
  const startMs = new Date(`${booking.date}T${booking.startTime}:00+08:00`).getTime();
  const hoursUntilStart = (startMs - Date.now()) / (60 * 60 * 1000);
  const canModify = (booking.status === 'confirmed' || booking.status === 'awaiting_payment')
    && hoursUntilStart >= 24;

  // Show the "pay balance" button whenever a balance is owed on a booking
  // the customer has ALREADY paid into (payments[] non-empty) and that
  // isn't cancelled / expired / completed. Keying on payments instead of
  // status === 'confirmed' means a booking still stuck at
  // 'awaiting_payment' (e.g. a deposit paid via the pre-batch-1 KPay
  // webhook, or an admin add-on top-up that raised the balance) still
  // lets the customer pay — previously the button silently vanished.
  const hasPaidSomething = (booking.payments?.length ?? 0) > 0;
  const showPayBalance = balanceDue > 0 && hasPaidSomething
    && !['cancelled', 'payment_not_completed', 'completed'].includes(booking.status || '');

  const overnightSuffix = booking.endDate && booking.endDate !== booking.date
    ? (locale === 'zh' ? `（翌日 ${booking.endDate}）` : ` (next day ${booking.endDate})`)
    : '';
  const whatsappMsg = locale === 'zh'
    ? `你好，預訂編號：${booking.id}\n場地：${venueName}\n日期：${booking.date} ${booking.startTime}-${booking.endTime}${overnightSuffix}`
    : `Hi, Booking ID: ${booking.id}\nVenue: ${venueName}\nDate: ${booking.date} ${booking.startTime}-${booking.endTime}${overnightSuffix}`;
  const whatsappLink = generateWhatsAppLink(PAYMENT_DETAILS.fps.digitsOnly, whatsappMsg);

  return (
    <div className="pt-28 pb-20 relative overflow-hidden">
      <div className="orb orb-pink animate-float-slow" style={{ width: 280, height: 280, top: '-60px', right: '-60px', opacity: 0.3 }} />
      <div className="max-content mx-auto px-6 md:px-12 lg:px-20 relative z-10">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl mx-auto space-y-5">
          <Link href="/my-bookings" className="inline-flex items-center gap-2 text-sm text-ink-soft hover:text-pink">
            <ArrowLeft size={14} /> {locale === 'zh' ? '返回我的預訂' : 'Back to bookings'}
          </Link>

          {/* Header */}
          <div>
            <div className="flex items-center gap-3 flex-wrap mb-2">
              <h1 className="text-heading">
                <span className="text-gradient-pink">{venueName}</span>
              </h1>
              <span className={`px-3 py-1 rounded-pill text-xs font-medium border ${statusColors[booking.status]}`}>
                {statusLabels[booking.status]?.[locale] || booking.status}
              </span>
            </div>
            <p className="text-sm text-ink-soft font-mono">#{booking.id.slice(0, 10)}</p>
          </div>

          {/* Hero summary */}
          <div className="rounded-3xl p-6 bg-gradient-to-br from-pink/15 to-peach/15 border border-pink/20">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <SummaryStat icon={<CalendarDays size={16} />} label={locale === 'zh' ? '日期' : 'Date'} value={booking.date} />
              <SummaryStat icon={<Clock size={16} />} label={locale === 'zh' ? '時段' : 'Time'} value={`${booking.startTime} – ${booking.endTime}${overnightSuffix}`} />
              <SummaryStat icon={<Users size={16} />} label={locale === 'zh' ? '人數' : 'Guests'} value={peopleLine} />
            </div>
          </div>

          {/* Booking details */}
          <div className="glass-card p-6 space-y-3 text-sm">
            <h2 className="font-bold mb-3 flex items-center gap-2">
              <CalendarDays size={16} className="text-pink" />
              {locale === 'zh' ? '預訂明細' : 'Booking Details'}
            </h2>
            <Row icon={<MapPin size={14} />} label={locale === 'zh' ? '地址' : 'Address'} value={venue?.address[locale] || '—'} />
            <Row label={locale === 'zh' ? '時數' : 'Hours'} value={`${booking.hours} ${locale === 'zh' ? '小時' : 'hrs'}`} />
            {booking.addOns && booking.addOns.length > 0 && (() => {
              // Render add-ons with each item's individual calculation +
              // amount, so the customer can verify "15人 × $158 = $2,370"
              // for themselves. We pull breakdown lines from
              // calculatePricing() rather than hand-rolling the math —
              // the customer-facing display then mirrors the same
              // formula the booking record was priced against, no risk
              // of drift.
              const breakdown = venue
                ? calculatePricing(
                    venue,
                    booking.isWeekend,
                    booking.hours,
                    booking.guestCount,
                    booking.addOns,
                    booking.childCount ?? 0,
                  ).breakdown.slice(1) // drop "場地費" — already accounted for in subtotal line below
                : [];
              return (
                <div className="border-t border-white/30 pt-3">
                  <p className="text-xs text-ink-soft uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Package size={12} /> {locale === 'zh' ? '附加服務' : 'Add-ons'}
                  </p>
                  <ul className="space-y-2 text-sm">
                    {booking.addOns.map((a, idx) => {
                      const meta = addOnCatalog.find((c) => c.id === a.id);
                      const line = breakdown[idx];
                      return (
                        <li key={a.id}>
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="text-ink">
                              • {line?.label[locale] || meta?.name[locale] || a.id}
                            </span>
                            {line && (
                              <span className="font-medium text-ink whitespace-nowrap">
                                HK${line.amount.toLocaleString()}
                              </span>
                            )}
                          </div>
                          {a.id === 'shisha' && a.options?.flavors && a.options.flavors.length > 0 && (
                            <span className="block text-xs text-ink-soft pl-3 mt-0.5">
                              {a.options.flavors.map((f, i) => (
                                <span key={i}>
                                  #{i + 1} {getShishaFlavorLabel(f, locale)}
                                  {i < a.options!.flavors!.length - 1 ? '、' : ''}
                                </span>
                              ))}
                            </span>
                          )}
                          {a.id === 'shisha' && a.options?.staffSetup && (
                            <span className="block text-xs text-ink-soft pl-3">
                              + {locale === 'zh' ? `員工協助 setup (HK$${SHISHA_STAFF_SETUP_FEE})` : `Staff setup (HK$${SHISHA_STAFF_SETUP_FEE})`}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })()}
            {booking.hasBYOFood && (
              <Row label={locale === 'zh' ? '自攜食物' : 'BYO food'} value={locale === 'zh' ? '是' : 'Yes'} />
            )}
          </div>

          {/* Pricing */}
          <div className="glass-card p-6 space-y-2 text-sm">
            <h2 className="font-bold mb-2 flex items-center gap-2">
              <CreditCard size={16} className="text-pink" />
              {locale === 'zh' ? '金額' : 'Pricing'}
            </h2>
            <div className="flex justify-between">
              <span className="text-ink-soft">{locale === 'zh' ? '小計' : 'Subtotal'}</span>
              <span>HK${booking.pricing.subtotal.toLocaleString()}</span>
            </div>
            {booking.promoCode && (booking.promoDiscount ?? 0) > 0 && (
              <div className="flex justify-between text-emerald-700">
                <span className="flex items-center gap-1.5"><Tag size={12} />{locale === 'zh' ? '優惠碼' : 'Promo'} <span className="font-mono text-xs">{booking.promoCode}</span></span>
                <span>−HK${(booking.promoDiscount || 0).toLocaleString()}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-ink-soft">{locale === 'zh' ? '按金（活動後退還）' : 'Security deposit'}</span>
              <span>HK${securityDeposit.toLocaleString()}</span>
            </div>
            <div className="flex justify-between font-semibold pt-2 border-t border-white/40">
              <span>{locale === 'zh' ? '總計' : 'Grand total'}</span>
              <span>HK${grandTotal.toLocaleString()}</span>
            </div>
            <div className="flex justify-between pt-1">
              <span className="text-ink-soft">{locale === 'zh' ? '已付' : 'Paid'}</span>
              <span>HK${paidSoFar.toLocaleString()}</span>
            </div>
            {(booking.pointsDiscount ?? 0) > 0 && (
              <div className="flex justify-between text-violet-700">
                <span className="flex items-center gap-1.5"><Sparkles size={12} />{locale === 'zh' ? '積分抵扣' : 'Points'}</span>
                <span>−HK${(booking.pointsDiscount || 0).toLocaleString()} ({(booking.pointsUsed || 0).toLocaleString()} {locale === 'zh' ? '分' : 'pts'})</span>
              </div>
            )}
            {balanceDue > 0 && (
              <div className="flex justify-between text-amber-700 bg-amber-50 px-3 py-2 rounded-lg mt-2">
                <span className="font-semibold">{locale === 'zh' ? '尾數（活動前 2 日繳清）' : 'Balance (due 2 days before event)'}</span>
                <span className="font-bold">HK${balanceDue.toLocaleString()}</span>
              </div>
            )}
          </div>

          {/* Payment history — only renders if there's at least one entry */}
          <PaymentHistory booking={booking} locale={locale} />

          {/* Door passcode */}
          {booking.lockPasscode?.passcode && (
            <div className="glass-card p-6 bg-gradient-to-br from-emerald-50 to-emerald-100/30 border-emerald-200">
              <div className="flex items-center gap-2 mb-3">
                <Key size={16} className="text-emerald-700" />
                <h2 className="font-bold">{locale === 'zh' ? '門鎖密碼' : 'Door Passcode'}</h2>
              </div>
              <p className="text-3xl font-bold font-mono tracking-widest text-emerald-700 mb-2">
                {booking.lockPasscode.passcode}#
              </p>
              <p className="text-xs text-emerald-700">
                {locale === 'zh'
                  ? '密碼會喺活動開始前 1 小時生效，活動結束時間自動失效。'
                  : 'Active 1 hour before start, auto-expires at end time.'}
              </p>
            </div>
          )}

          {/* Refund details */}
          {booking.refundDetails && (
            <div className="glass-card p-6 space-y-2 text-sm">
              <h2 className="font-bold mb-2">{locale === 'zh' ? '按金退款方式' : 'Refund Method'}</h2>
              {booking.refundDetails.method === 'fps' ? (
                <Row label="FPS" value={booking.refundDetails.fpsIdentifier || '—'} />
              ) : (
                <>
                  <Row label={locale === 'zh' ? '銀行' : 'Bank'} value={booking.refundDetails.bankName || '—'} />
                  <Row label={locale === 'zh' ? '戶口持有人' : 'Account holder'} value={booking.refundDetails.accountHolderName || '—'} />
                  <Row label={locale === 'zh' ? '戶口號碼' : 'Account #'} value={booking.refundDetails.accountNumber || '—'} />
                </>
              )}
            </div>
          )}

          {/* Modification deadline notice */}
          {!canModify && booking.status !== 'cancelled' && booking.status !== 'completed' && (
            <div className="glass-card p-4 flex items-start gap-2.5 bg-amber-50/80 border-amber-200">
              <AlertCircle size={16} className="text-amber-600 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-800 leading-relaxed">
                {locale === 'zh'
                  ? '預約開始前 24 小時內已唔可以自助修改。如有需要，請 WhatsApp 我哋。'
                  : 'Self-service modifications are disabled within 24 hours of the start time. Please WhatsApp us if you need help.'}
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            {showPayBalance && (
              <Link
                href={`/book/${booking.branchSlug}/pay-balance/${booking.id}`}
                className="px-4 py-2.5 bg-amber-500 text-white rounded-xl text-sm font-semibold hover:bg-amber-600 flex items-center gap-1.5"
              >
                <CreditCard size={14} />
                {locale === 'zh' ? `找尾數 HK$${balanceDue.toLocaleString()}` : `Pay balance HK$${balanceDue.toLocaleString()}`}
              </Link>
            )}
            {canModify && (
              <Link
                href={`/my-bookings/${booking.id}/modify`}
                className="px-4 py-2.5 bg-white/70 border border-charcoal/15 rounded-xl text-sm font-medium hover:bg-white flex items-center gap-1.5"
              >
                <Edit3 size={14} />
                {locale === 'zh' ? '修改預訂' : 'Modify'}
              </Link>
            )}
            <a
              href={whatsappLink}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2.5 bg-[#25D366] text-white rounded-xl text-sm font-semibold flex items-center gap-1.5"
            >
              <MessageCircle size={14} /> WhatsApp
            </a>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function SummaryStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-ink-soft uppercase tracking-wider mb-1 flex items-center gap-1.5">
        {icon} {label}
      </p>
      <p className="font-semibold text-ink">{value}</p>
    </div>
  );
}

function Row({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-white/30 pb-2 last:border-0">
      <span className="flex items-center gap-1.5 text-ink-soft shrink-0">
        {icon} {label}
      </span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}
