'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { useParams } from 'next/navigation';
import { Link, useRouter } from '@/i18n/routing';
import { motion } from 'framer-motion';
import {
  ArrowLeft, ArrowRight, Calendar, Clock, Users, Sparkles, Check,
  AlertCircle, MessageCircle, LogIn, Loader2, ShieldAlert,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  claimBookingDraft, isDraftExpired, DRAFT_TTL_HOURS,
} from '@/lib/bookingDrafts';
import { getUserProfile, updateUserWhatsapp } from '@/lib/firestore';
import { isValidHkPhone, normalizeHkPhone, formatHkPhone } from '@/lib/whatsapp';
import { addOns as ALL_ADDONS, calculateSecurityDeposit } from '@/lib/pricing';
import { venues } from '@/lib/venues';
import { BookingDraft } from '@/types';
import AuthModal from '@/components/auth/AuthModal';

export default function ClaimBookingPage() {
  const params = useParams();
  const locale = useLocale() as 'zh' | 'en';
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const draftId = params.id as string;

  const [draft, setDraft] = useState<BookingDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // WhatsApp confirmation
  const [whatsappPhone, setWhatsappPhone] = useState('');
  const [savedWhatsappPhone, setSavedWhatsappPhone] = useState('');

  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);

  useEffect(() => {
    if (!draftId) return;
    // Fetch via the public API rather than the client Firestore SDK —
    // the customer hits this page from a WhatsApp link before signing
    // in, and the booking_drafts rule requires auth for direct reads.
    fetch(`/api/booking-draft/${encodeURIComponent(draftId)}`)
      .then(async (res) => {
        if (res.status === 404) {
          setError(locale === 'zh' ? '找唔到此預訂連結' : 'Booking link not found');
          return;
        }
        if (!res.ok) {
          setError(locale === 'zh' ? '載入預訂時出錯' : 'Failed to load booking');
          return;
        }
        const d = (await res.json()) as BookingDraft;
        setDraft(d);
      })
      .catch(() => setError(locale === 'zh' ? '載入預訂時出錯' : 'Failed to load booking'))
      .finally(() => setLoading(false));
  }, [draftId, locale]);

  // Pre-fill WhatsApp from user profile or draft hint
  useEffect(() => {
    if (!user) return;
    getUserProfile(user.uid).then((p) => {
      const stored = (p as { whatsappPhone?: string } | null)?.whatsappPhone || '';
      if (stored) {
        setSavedWhatsappPhone(stored);
        setWhatsappPhone(stored);
      } else if (draft?.customerWhatsapp) {
        setWhatsappPhone(draft.customerWhatsapp.replace(/^\+852/, ''));
      }
    });
  }, [user, draft]);

  const venue = useMemo(
    () => (draft ? venues.find((v) => v.id === draft.venueId) : null),
    [draft],
  );

  const draftExpired = !!draft && isDraftExpired(draft);

  const canClaim = useMemo(() => {
    if (!draft || !user) return false;
    if (draft.status !== 'pending' || draft.claimedBy) return false;
    if (draftExpired) return false;
    if (!isValidHkPhone(whatsappPhone)) return false;
    return true;
  }, [draft, user, whatsappPhone, draftExpired]);

  const handleClaim = async () => {
    if (!canClaim || !draft || !user) return;
    setSubmitting(true);
    try {
      const phoneE164 = normalizeHkPhone(whatsappPhone) || whatsappPhone;
      // Persist phone on profile so future bookings pre-fill
      try { await updateUserWhatsapp(user.uid, phoneE164); } catch { /* non-blocking */ }
      const bookingId = await claimBookingDraft(draft, user.uid, phoneE164);
      // Fire-and-forget push to Google Calendar (don't block the redirect).
      fetch('/api/google/push-booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId,
          customerName: draft.customerName || user.displayName || undefined,
          notes: draft.notes,
        }),
      }).catch(() => { /* gcal disconnected or error — non-blocking */ });
      // Send the customer straight to the confirm page so they can
      // fill the deposit-refund details and immediately pick a payment
      // method (FPS upload or Stripe checkout). The previous redirect to
      // /my-bookings left customers wondering how to actually pay.
      router.push(`/book/${draft.branchSlug}/confirm/${bookingId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'SLOT_TAKEN') {
        alert(locale === 'zh'
          ? '⚠️ 此時段已被其他客人預訂，連結已即時失效。請聯絡 SPACO 重新安排。'
          : '⚠️ This slot was just booked by another customer, the link is now invalid. Please contact SPACO to reschedule.');
        // Re-fetch draft so the page reflects cancelled status
        const fresh = await fetch(`/api/booking-draft/${encodeURIComponent(draft.id)}`)
          .then((r) => (r.ok ? r.json() as Promise<BookingDraft> : null))
          .catch(() => null);
        if (fresh) setDraft(fresh);
      } else {
        alert((locale === 'zh' ? '確認預訂失敗：' : 'Failed to confirm: ') + msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ───────────────────────────────────────
  // Loading / error
  // ───────────────────────────────────────
  if (loading) {
    return (
      <div className="pt-32 text-center text-ink-soft">
        <Loader2 size={20} className="animate-spin mx-auto mb-2" />
        Loading…
      </div>
    );
  }
  if (error || !draft) {
    return (
      <div className="pt-32 max-w-md mx-auto text-center px-6">
        <div className="glass-card p-8">
          <ShieldAlert size={32} className="text-rose-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-ink mb-2">
            {error || (locale === 'zh' ? '此連結無效' : 'Invalid link')}
          </h1>
          <p className="text-sm text-ink-soft mb-6">
            {locale === 'zh' ? '請聯絡 SPACO 重發連結。' : 'Please contact SPACO for a fresh link.'}
          </p>
          <Link href="/" className="btn-primary justify-center">
            {locale === 'zh' ? '返回首頁' : 'Back to Home'}
          </Link>
        </div>
      </div>
    );
  }

  // Already claimed by THIS user — go to bookings.
  if (draft.status === 'claimed' && draft.claimedBy === user?.uid) {
    return (
      <div className="pt-32 max-w-md mx-auto text-center px-6">
        <div className="glass-card p-8">
          <Check size={28} className="text-emerald-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-ink mb-2">
            {locale === 'zh' ? '此預訂已確認' : 'This booking is already claimed'}
          </h1>
          <Link href={`/my-bookings`} className="btn-primary justify-center mt-4">
            {locale === 'zh' ? '去我的預訂' : 'Go to My Bookings'}
          </Link>
        </div>
      </div>
    );
  }
  // Claimed by someone else, cancelled, or expired (status flag or TTL).
  if (draft.status !== 'pending' || draftExpired) {
    const reason = draftExpired
      ? (locale === 'zh' ? '連結已超過 8 小時失效。' : 'This link has passed its 8-hour expiry.')
      : draft.status === 'cancelled'
      ? (locale === 'zh' ? '可能此時段已被其他客人預訂，或者連結已被取消。' : 'The slot may have been booked by someone else, or the link was cancelled.')
      : draft.status === 'claimed'
      ? (locale === 'zh' ? '此連結已被使用。' : 'This link has already been used.')
      : (locale === 'zh' ? '請聯絡 SPACO 重新發送連結。' : 'Please contact SPACO for a fresh link.');
    return (
      <div className="pt-32 max-w-md mx-auto text-center px-6">
        <div className="glass-card p-8">
          <AlertCircle size={28} className="text-amber-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-ink mb-2">
            {locale === 'zh' ? '此連結已失效' : 'This link is no longer valid'}
          </h1>
          <p className="text-sm text-ink-soft mb-6">{reason}</p>
          <Link href="/" className="btn-primary justify-center">
            {locale === 'zh' ? '返回首頁' : 'Back to Home'}
          </Link>
        </div>
      </div>
    );
  }

  // Refundable security deposit (按金) — tiered $1k / $2k / $4k against
  // subtotal. Legacy drafts predate the field, fall back to recomputing
  // from subtotal so they still display consistent numbers.
  const securityDeposit =
    draft.pricing.securityDeposit ?? calculateSecurityDeposit(draft.pricing.subtotal);
  // Grand total = rental subtotal + refundable security deposit.
  // pricing.deposit is the UPFRONT amount (full if ≤ $10k else 50%) and
  // is shown as "今次支付" below the grand total — using it for "可退
  // 按金" was the bug that made admin-issued links show inflated numbers.
  const grandTotal = draft.pricing.subtotal + securityDeposit;
  const upfrontDue = draft.pricing.deposit;
  const balanceDue = Math.max(0, grandTotal - upfrontDue);
  const selectedAddOns = draft.addOns
    .map((a) => ALL_ADDONS.find((x) => x.id === a.id))
    .filter(Boolean);

  return (
    <div className="pt-28 pb-20 relative overflow-hidden">
      <div className="orb orb-pink animate-float-slow" style={{ width: 280, height: 280, top: '-60px', left: '5%', opacity: 0.45 }} />
      <div className="orb orb-lavender animate-float-medium" style={{ width: 200, height: 200, top: '40%', right: '-40px', opacity: 0.4 }} />

      <div className="max-content mx-auto px-6 md:px-12 lg:px-20 relative z-10">
        {/* Hero */}
        <div className="mb-8">
          <span className="chip mb-3">
            <Sparkles size={12} className="text-pink" />
            {locale === 'zh' ? '專屬預訂連結' : 'Personalised booking'}
          </span>
          <h1 className="text-heading font-display">
            <span className="text-ink">{locale === 'zh' ? '我哋已為你' : 'We\'ve prepared'}</span>
            <span>{' '}</span>
            <span className="text-gradient-pink">{locale === 'zh' ? '預備好預訂' : 'your booking'}</span>
          </h1>
          <p className="text-ink-soft mt-3 max-w-2xl">
            {locale === 'zh'
              ? '請核對以下內容，登入會員後撳「確認預訂」即可。所有預訂會自動綁定你個 SPACO account 方便日後管理。'
              : 'Please review and tap "Confirm" after logging in. The booking will be linked to your SPACO account for easy management.'}
          </p>
        </div>

        {/* Expiry / no-hold warning — visible to customer on every claim page */}
        <div className="rounded-2xl p-4 mb-6 max-w-2xl border-2 border-amber-300/60 bg-amber-50/80 backdrop-blur-md">
          <p className="text-xs uppercase tracking-wider font-bold text-amber-800 mb-2 flex items-center gap-1.5">
            <AlertCircle size={14} />
            {locale === 'zh' ? '請注意' : 'Please note'}
          </p>
          <ul className="text-sm text-amber-900 space-y-1 list-disc list-inside">
            <li>
              {locale === 'zh'
                ? `連結於 ${DRAFT_TTL_HOURS} 小時後失效`
                : `Link expires in ${DRAFT_TTL_HOURS} hours`}
            </li>
            <li>
              {locale === 'zh'
                ? '本店不設任何留位形式，一切以付款作確認，先到先得'
                : 'We do not hold slots — first to pay confirms the booking'}
            </li>
            <li>
              {locale === 'zh'
                ? '如所訂之日子時間已被其他客人預訂，連結會即時失效'
                : 'If this slot is booked by another customer first, the link invalidates immediately'}
            </li>
          </ul>
        </div>

        {draft.notes && (
          <div className="glass-strong rounded-2xl p-4 mb-6 max-w-2xl flex items-start gap-3">
            <MessageCircle size={16} className="text-emerald-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs uppercase tracking-wider text-ink-soft font-bold mb-1">
                {locale === 'zh' ? 'SPACO 備註' : 'Note from SPACO'}
              </p>
              <p className="text-sm text-ink whitespace-pre-line">{draft.notes}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Booking summary */}
          <motion.div
            className="lg:col-span-2 glass-card p-6 md:p-8"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <h2 className="text-xl font-bold mb-5 text-ink">
              {locale === 'zh' ? '預訂內容' : 'Booking details'}
            </h2>

            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-wider text-ink-soft font-semibold mb-1">
                  {locale === 'zh' ? '場地' : 'Venue'}
                </dt>
                <dd className="font-bold text-ink">{venue?.name[locale] || draft.venueId}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-ink-soft font-semibold mb-1 flex items-center gap-1">
                  <Calendar size={11} /> {locale === 'zh' ? '日期' : 'Date'}
                </dt>
                <dd className="font-bold text-ink">{draft.date}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-ink-soft font-semibold mb-1 flex items-center gap-1">
                  <Clock size={11} /> {locale === 'zh' ? '時段' : 'Session'}
                </dt>
                <dd className="font-bold text-ink">
                  {draft.startTime}–{draft.endTime}
                  <span className="text-ink-soft font-normal text-xs ml-2">
                    ({draft.hours} {locale === 'zh' ? '小時' : 'h'})
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-ink-soft font-semibold mb-1 flex items-center gap-1">
                  <Users size={11} /> {locale === 'zh' ? '人數' : 'Guests'}
                </dt>
                <dd className="font-bold text-ink">{draft.guestCount}</dd>
              </div>
            </dl>

            {selectedAddOns.length > 0 && (
              <>
                <hr className="my-5 border-charcoal/10" />
                <h3 className="text-xs uppercase tracking-wider font-bold text-ink-soft mb-2">
                  {locale === 'zh' ? '加購項目' : 'Add-ons'}
                </h3>
                <ul className="space-y-1.5">
                  {selectedAddOns.map((a) => {
                    if (!a) return null;
                    const qty = draft.addOns.find((x) => x.id === a.id)?.quantity || 1;
                    return (
                      <li key={a.id} className="text-sm text-ink flex items-start gap-2">
                        <Check size={14} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                        <span>{a.name[locale]}{qty > 1 ? ` × ${qty}` : ''}</span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}

            {draft.hasBYOFood && (
              <p className="mt-3 text-xs text-ink-soft italic">
                {locale === 'zh' ? '✓ 自攜食物（已安排 BBQ 爐）' : '✓ Bring-your-own food (BBQ grill arranged)'}
              </p>
            )}
          </motion.div>

          {/* Action panel */}
          <motion.div
            className="glass-strong rounded-3xl p-6 lg:sticky lg:top-28"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            {/* Pricing */}
            <div className="bg-white/40 backdrop-blur-md rounded-2xl border border-white/60 p-4 space-y-1.5 mb-5 text-sm">
              <div className="flex justify-between">
                <span className="text-ink-soft">{locale === 'zh' ? '小計' : 'Subtotal'}</span>
                <span className="font-medium text-ink">HK${draft.pricing.subtotal.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-soft">{locale === 'zh' ? '可退按金' : 'Refundable deposit'}</span>
                <span className="font-medium text-ink">HK${securityDeposit.toLocaleString()}</span>
              </div>
              <div className="border-t border-white/60 pt-2 flex justify-between items-baseline">
                <span className="text-ink-soft">{locale === 'zh' ? '總計' : 'Grand total'}</span>
                <span className="font-bold text-ink">HK${grandTotal.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-baseline">
                <span className="text-ink-soft">
                  {balanceDue > 0
                    ? (locale === 'zh' ? '今次支付（50%）' : 'Pay now (50%)')
                    : (locale === 'zh' ? '應付金額' : 'Total due')}
                </span>
                <span className="font-bold font-display text-2xl text-gradient-pink">
                  HK${upfrontDue.toLocaleString()}
                </span>
              </div>
              {balanceDue > 0 && (
                <div className="flex justify-between text-xs text-ink-soft pt-1">
                  <span>{locale === 'zh' ? '尾數（活動 2 日前繳付）' : 'Balance (due 2 days before event)'}</span>
                  <span>HK${balanceDue.toLocaleString()}</span>
                </div>
              )}
            </div>

            {!user ? (
              <>
                <button
                  onClick={() => setAuthOpen(true)}
                  className="btn-primary w-full justify-center"
                >
                  <LogIn size={16} />
                  {locale === 'zh' ? '登入 / 註冊' : 'Log in / Sign up'}
                </button>
                <p className="text-[11px] text-ink-soft mt-3 text-center">
                  {locale === 'zh' ? '登入後就會自動綁定此預訂' : 'After login, this booking will bind to your account'}
                </p>
                <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} />
              </>
            ) : (
              <>
                {/* WhatsApp */}
                <label className="text-xs text-ink-soft font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <MessageCircle size={12} className="text-emerald-600" />
                  {locale === 'zh' ? 'WhatsApp 聯絡' : 'WhatsApp'}
                  <span className="text-rose-500">*</span>
                </label>
                <input
                  type="tel"
                  value={whatsappPhone}
                  onChange={(e) => setWhatsappPhone(e.target.value)}
                  placeholder={locale === 'zh' ? '例如：9282 3060' : 'e.g. 9282 3060'}
                  className="w-full px-3 py-2.5 rounded-xl border-2 border-charcoal/15 text-sm bg-white/85 mb-1"
                />
                {whatsappPhone && !isValidHkPhone(whatsappPhone) && (
                  <p className="text-xs text-rose-600 mb-3 flex items-center gap-1">
                    <AlertCircle size={12} />
                    {locale === 'zh' ? '請輸入 8 位香港電話號碼' : 'Enter a valid 8-digit HK number'}
                  </p>
                )}
                {savedWhatsappPhone && isValidHkPhone(whatsappPhone) && (
                  <p className="text-[11px] text-ink-soft mb-3">
                    ✓ {formatHkPhone(whatsappPhone)}
                  </p>
                )}

                <button
                  onClick={handleClaim}
                  disabled={!canClaim || submitting}
                  className="btn-primary w-full justify-center disabled:opacity-40 disabled:cursor-not-allowed mt-2"
                >
                  {submitting ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  {submitting
                    ? (locale === 'zh' ? '確認中…' : 'Confirming…')
                    : (locale === 'zh' ? '確認預訂並付款' : 'Confirm & Pay')}
                  {!submitting && <ArrowRight size={14} />}
                </button>
                <p className="text-[11px] text-ink-soft mt-3 text-center">
                  {locale === 'zh' ? '撳「確認」之後可上載 FPS 入數紙' : 'After confirming, upload your FPS receipt'}
                </p>
              </>
            )}
          </motion.div>
        </div>

        <div className="mt-8">
          <Link href="/" className="text-sm text-ink-soft hover:text-pink inline-flex items-center gap-1">
            <ArrowLeft size={14} />
            {locale === 'zh' ? '返回首頁' : 'Back to home'}
          </Link>
        </div>
      </div>
    </div>
  );
}
