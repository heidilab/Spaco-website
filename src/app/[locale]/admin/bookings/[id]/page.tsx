'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import { Link } from '@/i18n/routing';
import { useAuth } from '@/contexts/AuthContext';
import {
  getBooking,
  getUserProfile,
  updateBookingDateTime,
  updateBookingStatus,
  updateBookingDepositRefund,
  creditLoyaltyPoints,
} from '@/lib/firestore';
import { BookingRecord, UserProfile, MarketingChannel, MARKETING_CHANNEL_LABELS } from '@/types';
import { venues } from '@/lib/venues';
import { formatAddOnsForStaff } from '@/lib/pricing';
import PaymentHistory from '@/components/booking/PaymentHistory';
import { buildWhatsAppLink, formatHkPhone } from '@/lib/whatsapp';
import {
  ArrowLeft, CalendarDays, Clock, Users, Save, MessageCircle,
  Mail, Phone, User as UserIcon, Sparkles, AlertCircle, CalendarPlus, Package,
  Calculator, Plus, Minus, Check,
} from 'lucide-react';

// Standard fixed deductions — same set as /admin/deposit so the
// inline form stays in lockstep with the dedicated page.
const FIXED_DEDUCTIONS = [
  { id: 'oven', label: { zh: '沒有關閉焗爐', en: 'Oven not turned off' }, amount: 2000 },
  { id: 'ac', label: { zh: '沒有關閉冷氣', en: 'AC not turned off' }, amount: 800 },
  { id: 'lights', label: { zh: '沒有關閉電燈', en: 'Lights not turned off' }, amount: 500 },
  { id: 'cookware', label: { zh: '沒有清洗爐具', en: 'Cookware not cleaned' }, amount: 500 },
  { id: 'mess', label: { zh: '嘔吐物/場地髒亂', en: 'Vomit/venue mess' }, amount: 800 },
  { id: 'ballpit', label: { zh: '波波池飲食違規', en: 'Ball pit food violation' }, amount: 1500 },
];

const statusLabels: Record<string, { zh: string; en: string }> = {
  pending: { zh: '待處理', en: 'Pending' },
  awaiting_payment: { zh: '待付款', en: 'Awaiting Payment' },
  awaiting_review: { zh: '待核實入數', en: 'Awaiting Review' },
  confirmed: { zh: '已確認', en: 'Confirmed' },
  completed: { zh: '已完成', en: 'Completed' },
  cancelled: { zh: '已取消', en: 'Cancelled' },
};

export default function AdminBookingDetailPage() {
  const locale = useLocale() as 'zh' | 'en';
  const params = useParams();
  const router = useRouter();
  const { hasPermission, user } = useAuth();
  const bookingId = params.id as string;
  const canAccess = hasPermission('bookings');

  const [booking, setBooking] = useState<BookingRecord | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Editable fields
  const [date, setDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [guestCount, setGuestCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [statusValue, setStatusValue] = useState('');
  const [statusSaving, setStatusSaving] = useState(false);

  // Post-edit payment recording modal — split into rental + deposit
  // so the booking's pricing.subtotal and pricing.securityDeposit can
  // be bumped accurately (and loyalty-point credit later stays correct).
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [payRentalAmount, setPayRentalAmount] = useState<string>('');
  const [payDepositAmount, setPayDepositAmount] = useState<string>('');
  const [payMethod, setPayMethod] = useState<'fps' | 'stripe' | 'bank' | 'cash' | 'other'>('fps');
  const [payNote, setPayNote] = useState<string>('');
  const [followupBusy, setFollowupBusy] = useState(false);
  const [followupMsg, setFollowupMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Manual gcal push (for backfilling bookings whose webhook ran while
  // Google was disconnected, or that were created via admin without auto-sync).
  const [pushing, setPushing] = useState(false);
  const [pushMsg, setPushMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Deposit settlement state — admin inputs deductions after the event,
  // saves once, system marks booking completed + credits loyalty points.
  const [selectedFixed, setSelectedFixed] = useState<string[]>([]);
  const [customDeductions, setCustomDeductions] = useState<{ label: string; amount: number }[]>([]);
  const [settling, setSettling] = useState(false);
  const [settleMsg, setSettleMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!canAccess) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const b = await getBooking(bookingId);
        if (!b) {
          setError(locale === 'zh' ? '找不到預訂' : 'Booking not found');
          return;
        }
        setBooking(b);
        setDate(b.date);
        setEndDate(b.endDate || b.date);
        setStartTime(b.startTime);
        setEndTime(b.endTime);
        setGuestCount(b.guestCount);
        setStatusValue(b.status);
        if (b.userId) {
          const p = await getUserProfile(b.userId).catch(() => null);
          if (p) setProfile(p as unknown as UserProfile);
        }
      } catch (err) {
        console.error(err);
        setError(locale === 'zh' ? '載入失敗' : 'Failed to load');
      } finally {
        setLoading(false);
      }
    })();
  }, [bookingId, canAccess, locale]);

  if (!canAccess) {
    return (
      <div className="text-center py-20 text-muted">
        {locale === 'zh' ? '無權限存取' : 'Access Denied'}
      </div>
    );
  }
  if (loading) return <div className="animate-pulse text-muted p-8">Loading...</div>;
  if (error || !booking) {
    return <div className="text-rose-500 p-8">{error || 'Error'}</div>;
  }

  const venue = venues.find((v) => v.id === booking.venueId);
  const dirty =
    date !== booking.date ||
    endDate !== (booking.endDate || booking.date) ||
    startTime !== booking.startTime ||
    endTime !== booking.endTime ||
    guestCount !== booking.guestCount;

  // Validation: end (date+time) must be strictly after start (date+time).
  const startMs = (date && startTime) ? new Date(`${date}T${startTime}:00+08:00`).getTime() : 0;
  const endMs = (endDate && endTime) ? new Date(`${endDate}T${endTime}:00+08:00`).getTime() : 0;
  const isOvernight = endDate !== date;

  async function handleSave() {
    if (!booking || !dirty) return;
    if (endMs <= startMs) {
      setError(locale === 'zh' ? '結束時間必須晚於開始時間' : 'End must be after start');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateBookingDateTime(booking.id, { date, startTime, endTime, endDate, guestCount });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      // Refresh
      const fresh = await getBooking(booking.id);
      if (fresh) setBooking(fresh);
      // Open the payment / followup modal so admin can record any
      // top-up payment and trigger email re-send + gcal sync.
      setShowPaymentModal(true);
      setFollowupMsg(null);
    } catch (err) {
      console.error(err);
      setError(
        locale === 'zh'
          ? '儲存失敗，可能與其他預訂衝突'
          : 'Save failed — may conflict with another booking'
      );
    } finally {
      setSaving(false);
    }
  }

  /** Sum of fixed + custom deductions (HK$). */
  function totalDeductions(): number {
    const fixed = selectedFixed.reduce((sum, id) => {
      const item = FIXED_DEDUCTIONS.find((d) => d.id === id);
      return sum + (item?.amount || 0);
    }, 0);
    const custom = customDeductions.reduce((sum, d) => sum + (d.amount || 0), 0);
    return fixed + custom;
  }

  async function handleSettleDeposit() {
    if (!booking) return;
    setSettling(true);
    setSettleMsg(null);
    try {
      const securityDeposit = booking.pricing.securityDeposit ?? 0;
      const total = totalDeductions();
      const refundAmount = Math.max(0, securityDeposit - total);

      const deductions = [
        ...selectedFixed.map((id) => {
          const item = FIXED_DEDUCTIONS.find((d) => d.id === id)!;
          return { label: item.label[locale], amount: item.amount };
        }),
        ...customDeductions.filter((d) => d.label && d.amount > 0),
      ];

      await updateBookingDepositRefund(booking.id, { amount: refundAmount, deductions });

      // Credit loyalty points: subtotal (rental + add-ons) + deducted
      // deposit (forfeited security deposit counts as additional spend
      // per product spec). 1 HK$ = 1 point.
      let creditedPoints = 0;
      if (booking.userId) {
        const points = booking.pricing.subtotal + total;
        creditedPoints = await creditLoyaltyPoints(booking.userId, points);
      }

      setSettleMsg({
        kind: 'ok',
        text: locale === 'zh'
          ? `✓ 結算完成。退款 HK$${refundAmount.toLocaleString()}，已 credit ${creditedPoints.toLocaleString()} 積分。`
          : `✓ Settled. Refund HK$${refundAmount.toLocaleString()}; credited ${creditedPoints.toLocaleString()} pts.`,
      });
      const fresh = await getBooking(booking.id);
      if (fresh) setBooking(fresh);
      setSelectedFixed([]);
      setCustomDeductions([]);
    } catch (err) {
      setSettleMsg({
        kind: 'err',
        text: (locale === 'zh' ? '結算失敗：' : 'Settle failed: ') +
          (err instanceof Error ? err.message : 'unknown'),
      });
    } finally {
      setSettling(false);
    }
  }

  /** Fire after admin edit: optionally records a payment top-up,
   *  re-sends the customer confirmation email, and updates the
   *  matching Google Calendar event with the new schedule.
   *
   *  Payment is split into rental + deposit components so the booking's
   *  pricing.subtotal (rental + add-ons) and pricing.securityDeposit
   *  can be patched accurately. Without the split, downstream things
   *  like loyalty-point credit at deposit-settlement time would be off. */
  async function handleFollowup(opts: { skipPayment?: boolean } = {}) {
    if (!booking || !user) return;
    setFollowupBusy(true);
    setFollowupMsg(null);
    try {
      const body: Record<string, unknown> = { bookingId: booking.id };
      const rental = parseFloat(payRentalAmount) || 0;
      const dep = parseFloat(payDepositAmount) || 0;
      if (!opts.skipPayment && (rental + dep) > 0) {
        body.payment = {
          rentalAmount: rental,
          depositAmount: dep,
          method: payMethod,
          note: payNote.trim() || undefined,
          recordedBy: user.uid,
        };
      }
      const res = await fetch('/api/admin/booking-edit-followup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Followup failed');
      setFollowupMsg({
        kind: 'ok',
        text: locale === 'zh' ? '✓ 已重發 email + 更新 Google 日曆' : '✓ Email resent + Google Calendar updated',
      });
      const fresh = await getBooking(booking.id);
      if (fresh) setBooking(fresh);
      // Reset payment form
      setPayRentalAmount('');
      setPayDepositAmount('');
      setPayNote('');
      setTimeout(() => setShowPaymentModal(false), 1500);
    } catch (err) {
      setFollowupMsg({
        kind: 'err',
        text: (locale === 'zh' ? '失敗：' : 'Failed: ') +
          (err instanceof Error ? err.message : 'unknown'),
      });
    } finally {
      setFollowupBusy(false);
    }
  }

  async function handlePushToGcal() {
    if (!booking || pushing) return;
    setPushing(true);
    setPushMsg(null);
    try {
      const res = await fetch('/api/google/push-booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Push failed');
      if (data.skipped) {
        setPushMsg({
          kind: 'err',
          text: locale === 'zh'
            ? 'Google 日曆未連接或場地未對應 calendar — 請先去 Calendar Sync 連接'
            : 'Google not connected, or no calendar mapped for this venue.',
        });
      } else {
        setPushMsg({
          kind: 'ok',
          text: locale === 'zh' ? '✓ 已推送到 Google 日曆' : '✓ Pushed to Google Calendar',
        });
        const fresh = await getBooking(booking.id);
        if (fresh) setBooking(fresh);
      }
    } catch (err) {
      setPushMsg({
        kind: 'err',
        text: (locale === 'zh' ? '推送失敗：' : 'Push failed: ') +
          (err instanceof Error ? err.message : 'unknown'),
      });
    } finally {
      setPushing(false);
    }
  }

  async function handleStatusChange(next: string) {
    if (!booking || next === booking.status) return;
    setStatusSaving(true);
    try {
      await updateBookingStatus(booking.id, next);
      setStatusValue(next);
      const fresh = await getBooking(booking.id);
      if (fresh) setBooking(fresh);
    } catch (err) {
      console.error(err);
    } finally {
      setStatusSaving(false);
    }
  }

  const memberWa = booking.whatsappPhone || profile?.whatsappPhone;
  const memberPhone = profile?.phone || memberWa;
  const memberName = profile?.displayName || (locale === 'zh' ? '訪客' : 'Guest');
  const memberEmail = profile?.email;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/bookings" className="inline-flex items-center gap-2 text-sm text-ink-soft hover:text-pink mb-4">
          <ArrowLeft size={14} /> {locale === 'zh' ? '返回預訂列表' : 'Back to bookings'}
        </Link>
        <h1 className="text-heading">
          {locale === 'zh' ? '預訂詳情' : 'Booking Detail'}
          <span className="ml-3 text-xs font-mono text-ink-soft align-middle">#{booking.id.slice(0, 8)}</span>
        </h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT — booking info + edit */}
        <div className="lg:col-span-2 space-y-6">
          {/* Status */}
          <div className="glass-card p-6">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-bold">{locale === 'zh' ? '狀態' : 'Status'}</h2>
              {statusSaving && <span className="text-xs text-ink-soft">Saving…</span>}
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(statusLabels).map(([k, l]) => (
                <button
                  key={k}
                  onClick={() => handleStatusChange(k)}
                  disabled={statusSaving}
                  className={`px-3 py-1.5 rounded-pill text-xs font-medium border transition ${
                    statusValue === k
                      ? 'bg-gradient-pink text-white border-transparent shadow-glow'
                      : 'bg-white/60 text-ink-soft border-charcoal/10 hover:bg-white/80'
                  }`}
                >
                  {l[locale]}
                </button>
              ))}
            </div>
          </div>

          {/* Google Calendar push — only shown when not yet synced */}
          {!booking.googleEventId && (
            <div className="glass-card p-6">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <h2 className="font-bold flex items-center gap-2">
                    <CalendarPlus size={16} />
                    {locale === 'zh' ? 'Google 日曆' : 'Google Calendar'}
                  </h2>
                  <p className="text-xs text-ink-soft mt-1">
                    {locale === 'zh'
                      ? '此預訂尚未推送到 Google 日曆。撳下面個鈕補返。'
                      : 'This booking is not yet on Google Calendar. Click to push.'}
                  </p>
                </div>
                <button
                  onClick={handlePushToGcal}
                  disabled={pushing}
                  className="btn-primary disabled:opacity-40 flex items-center gap-2"
                >
                  <CalendarPlus size={14} />
                  {pushing
                    ? (locale === 'zh' ? '推送中…' : 'Pushing…')
                    : (locale === 'zh' ? '推送到 Google 日曆' : 'Push to Google Calendar')}
                </button>
              </div>
              {pushMsg && (
                <div
                  className={`mt-3 text-sm rounded-lg px-3 py-2 ${
                    pushMsg.kind === 'ok'
                      ? 'text-emerald-700 bg-emerald-50'
                      : 'text-rose-600 bg-rose-50'
                  }`}
                >
                  {pushMsg.text}
                </div>
              )}
            </div>
          )}

          {/* Editable date / time */}
          <div className="glass-card p-6 space-y-4">
            <h2 className="font-bold">
              {locale === 'zh' ? '修改日期、時間及人數' : 'Edit Date / Time / Guests'}
            </h2>
            <p className="text-xs text-ink-soft -mt-2">
              {locale === 'zh'
                ? '修改後系統會自動更新場地時段封鎖；如有衝突會儲存失敗。'
                : 'On save, the venue block is updated. Conflicting bookings will block the save.'}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label={locale === 'zh' ? '場地' : 'Venue'}>
                <input
                  value={venue?.name[locale] || booking.venueId}
                  disabled
                  className="w-full px-3 py-2 rounded-lg border border-charcoal/10 bg-cream/60 text-sm"
                />
              </Field>
              <Field label={locale === 'zh' ? '日期' : 'Date'}>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-charcoal/10 bg-white text-sm focus:outline-none focus:border-accent"
                />
              </Field>
              <Field label={locale === 'zh' ? '開始時間' : 'Start time'}>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-charcoal/10 bg-white text-sm focus:outline-none focus:border-accent"
                />
              </Field>
              <Field label={locale === 'zh' ? '結束日期' : 'End date'}>
                <input
                  type="date"
                  value={endDate}
                  min={date}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-charcoal/10 bg-white text-sm focus:outline-none focus:border-accent"
                />
              </Field>
              <Field label={locale === 'zh' ? '結束時間' : 'End time'}>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-charcoal/10 bg-white text-sm focus:outline-none focus:border-accent"
                />
              </Field>
              <Field label={locale === 'zh' ? '人數' : 'Guests'}>
                <input
                  type="number"
                  min={1}
                  value={guestCount}
                  onChange={(e) => setGuestCount(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border border-charcoal/10 bg-white text-sm focus:outline-none focus:border-accent"
                />
              </Field>
            </div>

            {isOvernight && (
              <div className="flex items-start gap-2 text-xs text-violet-700 bg-violet-50 rounded-lg px-3 py-2">
                <AlertCircle size={12} className="mt-0.5 shrink-0" />
                {locale === 'zh'
                  ? `過夜預訂：${date} ${startTime} → ${endDate} ${endTime}。系統會自動分日創建場地封鎖時段。`
                  : `Overnight: ${date} ${startTime} → ${endDate} ${endTime}. Cross-midnight blocked slots will be created automatically.`}
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">
                <AlertCircle size={14} className="mt-0.5" /> {error}
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={handleSave}
                disabled={!dirty || saving}
                className="btn-primary disabled:opacity-40 flex items-center gap-2"
              >
                <Save size={14} />
                {saving
                  ? (locale === 'zh' ? '儲存中…' : 'Saving…')
                  : (locale === 'zh' ? '儲存修改' : 'Save changes')}
              </button>
              {saved && (
                <span className="text-sm text-emerald-600">
                  {locale === 'zh' ? '✓ 已儲存' : '✓ Saved'}
                </span>
              )}
            </div>
          </div>

          {/* Read-only summary */}
          <div className="glass-card p-6 space-y-3 text-sm">
            <h2 className="font-bold mb-2">{locale === 'zh' ? '預訂資料' : 'Booking Data'}</h2>
            <Row icon={<CalendarDays size={14} />} label={locale === 'zh' ? '日期' : 'Date'} value={booking.date} />
            <Row icon={<Clock size={14} />} label={locale === 'zh' ? '時段' : 'Time'} value={`${booking.startTime} – ${booking.endTime} (${booking.hours}h)`} />
            <Row
              icon={<Users size={14} />}
              label={locale === 'zh' ? '人數' : 'Guests'}
              value={
                (booking.childCount ?? 0) > 0
                  ? (locale === 'zh'
                      ? `${booking.guestCount} (${booking.adultCount ?? booking.guestCount} 成人 + ${booking.childCount} 小童)`
                      : `${booking.guestCount} (${booking.adultCount ?? booking.guestCount} adults + ${booking.childCount} kids)`)
                  : `${booking.guestCount}`
              }
            />
            {booking.addOns && booking.addOns.length > 0 && (
              <Row
                icon={<Package size={14} />}
                label={locale === 'zh' ? '附加服務' : 'Add-ons'}
                value={formatAddOnsForStaff(booking.addOns, locale)}
                highlight="violet"
              />
            )}
            {booking.hasBYOFood && (
              <Row label={locale === 'zh' ? '自攜食物' : 'BYO Food'} value={locale === 'zh' ? '是' : 'Yes'} />
            )}
            <Row label={locale === 'zh' ? '小計' : 'Subtotal'} value={`HK$${booking.pricing.subtotal.toLocaleString()}`} />
            <Row label={locale === 'zh' ? '按金' : 'Deposit'} value={`HK$${booking.pricing.deposit.toLocaleString()}`} />
            {(booking.pointsUsed ?? 0) > 0 && (
              <Row
                icon={<Sparkles size={14} />}
                label={locale === 'zh' ? '積分抵扣' : 'Points redeemed'}
                value={`−HK$${(booking.pointsDiscount || 0).toLocaleString()} (${booking.pointsUsed!.toLocaleString()} ${locale === 'zh' ? '分' : 'pts'})`}
                highlight="violet"
              />
            )}
            {booking.promoCode && (booking.promoDiscount ?? 0) > 0 && (
              <Row
                label={locale === 'zh' ? '優惠碼' : 'Promo'}
                value={`${booking.promoCode} (−HK$${(booking.promoDiscount || 0).toLocaleString()})`}
                highlight="emerald"
              />
            )}
            {booking.marketingChannel && (
              <Row
                label={locale === 'zh' ? '推廣渠道' : 'Channel'}
                value={
                  booking.marketingChannel === 'loyalty_member'
                    ? (locale === 'zh' ? '🌟 老會員' : '🌟 Loyalty Member')
                    : `📣 ${MARKETING_CHANNEL_LABELS[booking.marketingChannel as MarketingChannel][locale]}${booking.marketingChannelOther ? `: ${booking.marketingChannelOther}` : ''}`
                }
              />
            )}
            {(booking.balanceDue ?? 0) > 0 && (
              <Row label={locale === 'zh' ? '欠尾數' : 'Balance due'} value={`HK$${booking.balanceDue!.toLocaleString()}`} highlight="amber" />
            )}
            <Row label={locale === 'zh' ? '付款方式' : 'Payment method'} value={booking.paymentMethod || '—'} />
            {booking.lockPasscode?.passcode && (
              <Row label={locale === 'zh' ? '門鎖密碼' : 'Lock passcode'} value={booking.lockPasscode.passcode} highlight="emerald" />
            )}
          </div>

          {/* Payment history — surfaces the audit log of every payment
           *  captured for this booking. Rendered only when there's at
           *  least one entry (component handles empty internally). */}
          <PaymentHistory booking={booking} locale={locale} />

          {/* Deposit Settlement — admin inputs deductions after the
           *  event, system marks completed + credits loyalty points.
           *  Already-settled bookings show a read-only summary with
           *  the option to re-open. */}
          {(booking.status === 'confirmed' || booking.status === 'completed') && (booking.pricing.securityDeposit ?? 0) > 0 && (
            <DepositSettlement
              booking={booking}
              locale={locale}
              selectedFixed={selectedFixed}
              setSelectedFixed={setSelectedFixed}
              customDeductions={customDeductions}
              setCustomDeductions={setCustomDeductions}
              total={totalDeductions()}
              settling={settling}
              settleMsg={settleMsg}
              onSettle={handleSettleDeposit}
            />
          )}
        </div>

        {/* RIGHT — member info */}
        <div className="space-y-4">
          <div className="glass-card p-6 space-y-3">
            <h2 className="font-bold flex items-center gap-2">
              <UserIcon size={16} className="text-pink" />
              {locale === 'zh' ? '會員資料' : 'Member'}
            </h2>
            <p className="text-lg font-semibold">{memberName}</p>
            {memberEmail && (
              <a href={`mailto:${memberEmail}`} className="flex items-center gap-2 text-sm text-ink-soft hover:text-accent">
                <Mail size={13} /> {memberEmail}
              </a>
            )}
            {memberPhone && (
              <p className="flex items-center gap-2 text-sm text-ink-soft">
                <Phone size={13} /> {formatHkPhone(memberPhone) || memberPhone}
              </p>
            )}
            {memberWa && (
              <a
                href={buildWhatsAppLink(
                  memberWa,
                  locale === 'zh'
                    ? `你好，關於你 ${booking.date} ${booking.startTime}-${booking.endTime} 喺 ${venue?.name.zh || booking.venueId} 嘅預訂…`
                    : `Hi, regarding your booking on ${booking.date} ${booking.startTime}-${booking.endTime} at ${venue?.name.en || booking.venueId}…`
                )}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 mt-1 px-3 py-1.5 rounded-pill bg-[#25D366]/15 text-[#075E54] text-xs font-semibold hover:bg-[#25D366]/30"
              >
                <MessageCircle size={13} /> WhatsApp
              </a>
            )}
            <div className="border-t border-white/40 pt-3 flex items-center gap-2 text-sm">
              <Sparkles size={14} className="text-pink" />
              <span className="text-ink-soft">{locale === 'zh' ? '會員積分' : 'Loyalty Points'}:</span>
              <span className="font-bold">{(profile?.loyaltyPoints || 0).toLocaleString()}</span>
            </div>
          </div>

          {booking.refundDetails && (
            <div className="glass-card p-6 space-y-2 text-sm">
              <h2 className="font-bold">{locale === 'zh' ? '按金退款資料' : 'Refund Details'}</h2>
              <p>
                <span className="text-ink-soft">{locale === 'zh' ? '方法' : 'Method'}: </span>
                <span className="font-medium uppercase">{booking.refundDetails.method}</span>
              </p>
              {booking.refundDetails.method === 'fps' ? (
                <p>
                  <span className="text-ink-soft">FPS: </span>
                  <span className="font-mono">{booking.refundDetails.fpsIdentifier}</span>
                </p>
              ) : (
                <>
                  <p>
                    <span className="text-ink-soft">{locale === 'zh' ? '銀行' : 'Bank'}: </span>
                    {booking.refundDetails.bankName}
                  </p>
                  <p>
                    <span className="text-ink-soft">{locale === 'zh' ? '戶口' : 'Account'}: </span>
                    {booking.refundDetails.accountHolderName} / {booking.refundDetails.accountNumber}
                  </p>
                </>
              )}
            </div>
          )}

          {booking.receiptUrl && (
            <div className="glass-card p-6 space-y-2">
              <h2 className="font-bold text-sm">{locale === 'zh' ? '入數紙' : 'Receipt'}</h2>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={booking.receiptUrl} alt="receipt" className="w-full rounded-xl" />
            </div>
          )}
        </div>
      </div>

      {/* Post-edit followup modal — record top-up payment, re-send
       *  customer email, sync Google Calendar event */}
      {showPaymentModal && (
        <div className="fixed inset-0 z-50 bg-charcoal/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-glass-lg max-w-md w-full p-6">
            <h3 className="font-bold text-lg mb-1">
              {locale === 'zh' ? '修改已儲存' : 'Edit saved'}
            </h3>
            <p className="text-sm text-ink-soft mb-4">
              {locale === 'zh'
                ? '客人有額外付款嗎？確認後會重發 email + 更新 Google 日曆。'
                : 'Did the customer pay anything extra? On confirm, we re-send the email + update Google Calendar.'}
            </p>

            <div className="space-y-3 mb-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-ink-soft mb-1">
                    {locale === 'zh' ? '場租 (HK$)' : 'Rental (HK$)'}
                  </label>
                  <input
                    type="number"
                    value={payRentalAmount}
                    onChange={(e) => setPayRentalAmount(e.target.value)}
                    placeholder="0"
                    className="w-full px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white"
                  />
                  <p className="text-[11px] text-ink-soft mt-1">
                    {locale === 'zh' ? '加入小計（賺積分）' : 'Adds to subtotal (earns points)'}
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-soft mb-1">
                    {locale === 'zh' ? '按金 (HK$)' : 'Deposit (HK$)'}
                  </label>
                  <input
                    type="number"
                    value={payDepositAmount}
                    onChange={(e) => setPayDepositAmount(e.target.value)}
                    placeholder="0"
                    className="w-full px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white"
                  />
                  <p className="text-[11px] text-ink-soft mt-1">
                    {locale === 'zh' ? '加入按金（活動後退還）' : 'Adds to refundable deposit'}
                  </p>
                </div>
              </div>

              {(parseFloat(payRentalAmount) || 0) + (parseFloat(payDepositAmount) || 0) > 0 && (
                <div className="rounded-lg bg-pink/10 px-3 py-2 text-xs">
                  {locale === 'zh' ? '總共記錄：' : 'Total recorded: '}
                  <span className="font-bold">HK${((parseFloat(payRentalAmount) || 0) + (parseFloat(payDepositAmount) || 0)).toLocaleString()}</span>
                </div>
              )}

              {(booking.balanceDue ?? 0) > 0 && (
                <p className="text-[11px] text-amber-700">
                  {locale === 'zh' ? `現有未繳尾數：HK$${booking.balanceDue!.toLocaleString()}` : `Outstanding balance: HK$${booking.balanceDue!.toLocaleString()}`}
                </p>
              )}

              <div>
                <label className="block text-xs font-semibold text-ink-soft mb-1">
                  {locale === 'zh' ? '付款方式' : 'Method'}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['fps', 'bank', 'cash', 'stripe', 'other'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setPayMethod(m)}
                      className={`px-2 py-1.5 rounded-lg text-xs font-medium border transition ${
                        payMethod === m
                          ? 'bg-accent/10 border-accent text-accent'
                          : 'bg-white/60 border-charcoal/15 text-ink-soft hover:bg-white'
                      }`}
                    >
                      {m === 'fps' ? 'FPS' : m === 'bank' ? (locale === 'zh' ? '銀行' : 'Bank') : m === 'cash' ? (locale === 'zh' ? '現金' : 'Cash') : m === 'stripe' ? 'Stripe' : (locale === 'zh' ? '其他' : 'Other')}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink-soft mb-1">
                  {locale === 'zh' ? '備註（內部）' : 'Note (internal)'}
                </label>
                <input
                  type="text"
                  value={payNote}
                  onChange={(e) => setPayNote(e.target.value)}
                  placeholder={locale === 'zh' ? '例：延長 3 小時 / FPS 已收 ref XXX' : 'e.g. 3-hr extension / FPS ref XXX'}
                  className="w-full px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white"
                />
              </div>
            </div>

            {followupMsg && (
              <div className={`text-xs rounded-lg px-3 py-2 mb-3 ${
                followupMsg.kind === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
              }`}>{followupMsg.text}</div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => handleFollowup({ skipPayment: true })}
                disabled={followupBusy}
                className="flex-1 px-4 py-2.5 rounded-xl bg-white/70 border border-charcoal/15 text-sm font-medium hover:bg-white disabled:opacity-40"
              >
                {locale === 'zh' ? '冇額外付款' : 'No payment'}
              </button>
              <button
                onClick={() => handleFollowup()}
                disabled={followupBusy || ((parseFloat(payRentalAmount) || 0) + (parseFloat(payDepositAmount) || 0)) <= 0}
                className="flex-1 btn-primary disabled:opacity-40 flex items-center justify-center gap-1.5"
              >
                {followupBusy ? '…' : (
                  <>
                    <Check size={14} />
                    {locale === 'zh' ? '記錄並通知' : 'Record + Notify'}
                  </>
                )}
              </button>
            </div>
            <button
              onClick={() => setShowPaymentModal(false)}
              className="w-full mt-2 text-xs text-ink-soft hover:text-ink"
            >
              {locale === 'zh' ? '稍後再處理' : 'Skip for now'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-ink-soft mb-1">{label}</label>
      {children}
    </div>
  );
}

function Row({
  icon,
  label,
  value,
  highlight,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  highlight?: 'amber' | 'emerald' | 'violet';
}) {
  const color =
    highlight === 'amber' ? 'text-amber-700'
    : highlight === 'emerald' ? 'text-emerald-700 font-mono'
    : highlight === 'violet' ? 'text-violet-700'
    : 'text-ink';
  return (
    <div className="flex items-start justify-between gap-3 border-b border-white/30 pb-2 last:border-0">
      <span className="flex items-center gap-1.5 text-ink-soft shrink-0">
        {icon} {label}
      </span>
      <span className={`font-medium text-right ${color}`}>{value}</span>
    </div>
  );
}

interface DepositSettlementProps {
  booking: BookingRecord;
  locale: 'zh' | 'en';
  selectedFixed: string[];
  setSelectedFixed: (s: string[]) => void;
  customDeductions: { label: string; amount: number }[];
  setCustomDeductions: (d: { label: string; amount: number }[]) => void;
  total: number;
  settling: boolean;
  settleMsg: { kind: 'ok' | 'err'; text: string } | null;
  onSettle: () => void;
}

function DepositSettlement(props: DepositSettlementProps) {
  const {
    booking, locale, selectedFixed, setSelectedFixed,
    customDeductions, setCustomDeductions, total, settling, settleMsg, onSettle,
  } = props;
  const securityDeposit = booking.pricing.securityDeposit ?? 0;
  const refundAmount = Math.max(0, securityDeposit - total);
  const alreadySettled = !!booking.depositRefund;

  // Past-event check: settlement should only be done after the event.
  const endMs = new Date(`${booking.date}T${booking.endTime}:00+08:00`).getTime();
  const isAfterEvent = Date.now() >= endMs;

  function toggleFixed(id: string) {
    setSelectedFixed(selectedFixed.includes(id)
      ? selectedFixed.filter((x) => x !== id)
      : [...selectedFixed, id]);
  }
  function addCustom() {
    setCustomDeductions([...customDeductions, { label: '', amount: 0 }]);
  }
  function updateCustom(i: number, field: 'label' | 'amount', val: string | number) {
    const updated = [...customDeductions];
    if (field === 'amount') updated[i].amount = Number(val);
    else updated[i].label = val as string;
    setCustomDeductions(updated);
  }
  function removeCustom(i: number) {
    setCustomDeductions(customDeductions.filter((_, idx) => idx !== i));
  }

  return (
    <div className="glass-card p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Calculator size={16} className="text-pink" />
        <h2 className="font-bold">{locale === 'zh' ? '按金結算' : 'Deposit Settlement'}</h2>
      </div>

      {alreadySettled ? (
        <div className="space-y-2 text-sm">
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
            <p className="font-semibold text-emerald-700 mb-1">
              {locale === 'zh' ? '✓ 已結算' : '✓ Settled'}
            </p>
            <p className="text-xs text-emerald-700">
              {locale === 'zh' ? '退款金額：' : 'Refund: '}HK${(booking.depositRefund as { amount?: number })?.amount?.toLocaleString() || 0}
            </p>
          </div>
          {(booking.depositRefund as { deductions?: { label: string; amount: number }[] })?.deductions?.length ? (
            <ul className="text-xs text-ink-soft space-y-1 pl-4 list-disc">
              {(booking.depositRefund as { deductions?: { label: string; amount: number }[] }).deductions!.map((d, i) => (
                <li key={i}>{d.label} −HK${d.amount.toLocaleString()}</li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-ink-soft">{locale === 'zh' ? '無扣費' : 'No deductions'}</p>
          )}
        </div>
      ) : (
        <>
          {!isAfterEvent && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 flex items-start gap-1.5">
              <AlertCircle size={12} className="text-amber-600 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-800">
                {locale === 'zh'
                  ? '活動仲未完成。可以預先選定扣費，但建議活動結束後先確認結算。'
                  : 'Event hasn\'t ended yet. You can pre-select deductions, but it\'s safer to confirm after the event.'}
              </p>
            </div>
          )}

          <div className="bg-cream/60 rounded-xl p-3 text-sm">
            <p className="text-xs text-ink-soft">{locale === 'zh' ? '原始按金' : 'Original deposit'}</p>
            <p className="text-xl font-bold">HK${securityDeposit.toLocaleString()}</p>
          </div>

          {/* Fixed deductions */}
          <div>
            <p className="text-xs font-semibold text-ink-soft uppercase tracking-wider mb-2">
              {locale === 'zh' ? '固定扣費' : 'Fixed deductions'}
            </p>
            <div className="space-y-1.5">
              {FIXED_DEDUCTIONS.map((item) => (
                <label
                  key={item.id}
                  className={`flex items-center justify-between p-2.5 rounded-lg border cursor-pointer text-sm transition-colors ${
                    selectedFixed.includes(item.id)
                      ? 'border-rose-300 bg-rose-50'
                      : 'border-charcoal/10 bg-white/60 hover:bg-white'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedFixed.includes(item.id)}
                      onChange={() => toggleFixed(item.id)}
                      className="w-4 h-4 accent-rose-500"
                    />
                    <span>{item.label[locale]}</span>
                  </div>
                  <span className="font-medium text-rose-600">−HK${item.amount.toLocaleString()}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Custom deductions */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-ink-soft uppercase tracking-wider">
                {locale === 'zh' ? '自訂扣費' : 'Custom'}
              </p>
              <button onClick={addCustom} className="text-xs text-pink hover:underline flex items-center gap-1">
                <Plus size={12} /> {locale === 'zh' ? '新增' : 'Add'}
              </button>
            </div>
            {customDeductions.map((item, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={item.label}
                  onChange={(e) => updateCustom(i, 'label', e.target.value)}
                  placeholder={locale === 'zh' ? '說明' : 'Description'}
                  className="flex-1 px-2.5 py-1.5 rounded-lg border border-charcoal/15 text-xs"
                />
                <input
                  type="number"
                  value={item.amount || ''}
                  onChange={(e) => updateCustom(i, 'amount', e.target.value)}
                  placeholder="$"
                  className="w-20 px-2.5 py-1.5 rounded-lg border border-charcoal/15 text-xs"
                />
                <button onClick={() => removeCustom(i)} className="w-8 h-8 rounded-lg bg-rose-50 text-rose-500 flex items-center justify-center">
                  <Minus size={12} />
                </button>
              </div>
            ))}
          </div>

          {/* Summary */}
          <div className="border-t border-white/40 pt-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-ink-soft">{locale === 'zh' ? '總扣費' : 'Total deductions'}</span>
              <span className="text-rose-600 font-medium">−HK${total.toLocaleString()}</span>
            </div>
            <div className="flex justify-between font-bold">
              <span>{locale === 'zh' ? '退還客人' : 'Refund to customer'}</span>
              <span className="text-emerald-600">HK${refundAmount.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-xs text-ink-soft">
              <span>{locale === 'zh' ? '會員 credit 積分' : 'Loyalty points credit'}</span>
              <span>+{(booking.pricing.subtotal + total).toLocaleString()} {locale === 'zh' ? '分' : 'pts'}</span>
            </div>
          </div>

          {settleMsg && (
            <div className={`text-xs rounded-lg px-3 py-2 ${
              settleMsg.kind === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
            }`}>
              {settleMsg.text}
            </div>
          )}

          <button
            onClick={onSettle}
            disabled={settling}
            className="w-full btn-primary justify-center disabled:opacity-50 flex items-center gap-2"
          >
            {settling ? '...' : (
              <>
                <Calculator size={14} />
                {locale === 'zh' ? '確認結算 · 退款 + 加積分' : 'Confirm settlement'}
              </>
            )}
          </button>
          <p className="text-[11px] text-ink-soft leading-relaxed">
            {locale === 'zh'
              ? '退還按金部分需離線轉帳客人。系統會自動：(1) 將預訂標記為「已完成」 (2) credit 積分（小計 + 已扣按金）。'
              : 'Refund the customer offline. System will: (1) mark booking completed (2) credit points (subtotal + deducted deposit).'}
          </p>
        </>
      )}
    </div>
  );
}
