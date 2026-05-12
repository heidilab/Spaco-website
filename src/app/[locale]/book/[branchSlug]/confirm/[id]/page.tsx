'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { useParams } from 'next/navigation';
import { useRouter } from '@/i18n/routing';
import { useAuth } from '@/contexts/AuthContext';
import {
  getBooking, updateBookingRefundDetails, getUserProfile,
  POINTS_PER_HKD, pointsToHkd,
} from '@/lib/firestore';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { getVenueById } from '@/lib/venues';
import { addOns as addOnCatalog, getShishaFlavorLabel, SHISHA_STAFF_SETUP_FEE, calculatePricing, freeDrinksVenues } from '@/lib/pricing';
import { BookingRecord, RefundDetails, MarketingChannel, MARKETING_CHANNEL_LABELS } from '@/types';
import { CalendarDays, Clock, Users, MapPin, ArrowRight, Sparkles, Tag, X as XIcon, Loader2, Check } from 'lucide-react';
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

  // Loyalty point redemption — points balance loaded from user profile.
  const [pointsBalance, setPointsBalance] = useState<number>(0);
  // Customer-chosen amount of HK$ to redeem (live state). Capped by both
  // their balance and the remaining payable amount.
  const [redeemHkd, setRedeemHkd] = useState<number>(0);

  // Marketing channel — required on the customer's FIRST booking.
  // We treat first-booking as: user profile has no firstBookingChannel
  // recorded yet AND this is the booking they're about to confirm.
  const [isFirstTime, setIsFirstTime] = useState<boolean>(false);
  const [marketingChannel, setMarketingChannel] = useState<MarketingChannel | ''>('');
  const [marketingOther, setMarketingOther] = useState<string>('');

  // Promo code state — entered by customer; validated server-side.
  // Once validated, `applied` carries the resolved discount.
  const [promoInput, setPromoInput] = useState<string>('');
  const [promoChecking, setPromoChecking] = useState<boolean>(false);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [applied, setApplied] = useState<{
    codeId: string;
    code: string;
    type: 'percent' | 'cash' | 'free_drinks' | 'per_pax';
    amount: number;
    freeDrinks: boolean;
  } | null>(null);

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
    Promise.all([
      getBooking(bookingId),
      getUserProfile(user.uid).catch(() => null),
    ])
      .then(([b, profile]) => {
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
          // Restore previous redemption if the user came back to this page.
          if (b.pointsDiscount && b.pointsDiscount > 0) setRedeemHkd(b.pointsDiscount);
          // Restore promo code if previously applied.
          if (b.promoCode && b.promoCodeId) {
            setPromoInput(b.promoCode);
            setApplied({
              codeId: b.promoCodeId,
              code: b.promoCode,
              type: 'cash', // placeholder; real type recovered if user re-checks
              amount: b.promoDiscount || 0,
              freeDrinks: !!b.promoFreeDrinksCost,
            });
          }
        }
        if (profile) {
          const p = profile as { loyaltyPoints?: number; firstBookingChannel?: MarketingChannel };
          setPointsBalance(p.loyaltyPoints || 0);
          // First-time = no channel recorded on profile yet.
          setIsFirstTime(!p.firstBookingChannel);
        } else {
          // Profile read failed — treat as first-time to be safe (better
          // to ask twice than miss the data point).
          setIsFirstTime(true);
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

  // Promo discount reduces the *effective subtotal*. Deposit (% rule)
  // is recomputed from the new subtotal so the customer pays less both
  // upfront and on balance, proportionally.
  const promoDiscount = applied?.amount || 0;
  const effectiveSubtotal = Math.max(0, booking.pricing.subtotal - promoDiscount);
  const effectiveGrandTotal = effectiveSubtotal + securityDeposit;
  const isFullPayment = effectiveGrandTotal <= 10000;
  const effectiveDeposit = isFullPayment
    ? effectiveGrandTotal
    : Math.round(effectiveGrandTotal * 0.5);
  const balanceDue = Math.max(0, effectiveGrandTotal - effectiveDeposit);

  // Redemption math — applied AFTER promo. Keep at least HK$1 charged.
  const maxRedeemHkd = Math.min(pointsToHkd(pointsBalance), Math.max(0, effectiveDeposit - 1));
  const clampedRedeem = Math.max(0, Math.min(redeemHkd, maxRedeemHkd));
  const pointsUsed = clampedRedeem * POINTS_PER_HKD;
  const dueNow = effectiveDeposit - clampedRedeem;

  const refundReady =
    method === 'fps'
      ? fpsIdentifier.trim().length > 0
      : bankName.trim().length > 0 &&
        accountHolderName.trim().length > 0 &&
        accountNumber.trim().length > 0;

  // Marketing channel must be selected on first-time bookings, and if
  // 'other' is picked the free-text detail must be non-empty.
  const marketingReady = !isFirstTime || (
    !!marketingChannel && (marketingChannel !== 'other' || marketingOther.trim().length > 0)
  );

  async function handleApplyPromo() {
    const code = promoInput.trim().toUpperCase();
    if (!code) return;
    setPromoChecking(true);
    setPromoError(null);
    try {
      // Compute the drinks portion as if it were already in the cart —
      // for `free_drinks` codes we'll auto-add the drinks add-on below
      // even if the customer hadn't picked it themselves.
      const adultEquiv = (booking?.adultCount ?? booking?.guestCount ?? 0)
        + 0.5 * (booking?.childCount ?? 0);
      const venueIncludesDrinksFree = booking
        ? freeDrinksVenues.includes(booking.venueId)
        : false;
      const projectedDrinksCost = venueIncludesDrinksFree
        ? 0
        : Math.round(25 * adultEquiv);

      const res = await fetch('/api/promo/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          subtotal: booking?.pricing.subtotal,
          adultEquiv: adultEquiv || 1,
          drinksCost: projectedDrinksCost,
          userId: user?.uid,
          venueId: booking?.venueId,
        }),
      });
      const data = await res.json();
      if (!data.valid) {
        const reason = data.reason as string;
        const msg = (() => {
          if (reason === 'not_found') return locale === 'zh' ? '優惠碼不存在' : 'Code not found';
          if (reason === 'disabled') return locale === 'zh' ? '此優惠碼已暫停' : 'Code disabled';
          if (reason === 'not_started') return locale === 'zh' ? `優惠由 ${data.startDate} 開始` : `Starts ${data.startDate}`;
          if (reason === 'expired') return locale === 'zh' ? `優惠已於 ${data.endDate} 結束` : `Expired ${data.endDate}`;
          if (reason === 'min_subtotal') return locale === 'zh' ? `需滿 HK$${data.minSubtotal} 先可用` : `Min subtotal HK$${data.minSubtotal}`;
          if (reason === 'wrong_venue') return locale === 'zh' ? '此優惠碼唔適用於依間分店' : 'Code not valid at this branch';
          if (reason === 'sold_out') return locale === 'zh' ? '優惠碼已用完' : 'Code sold out';
          if (reason === 'per_user_limit') return locale === 'zh' ? `你已用過呢個 code（每人限 ${data.perUserLimit} 次）` : `You've already used this code (limit ${data.perUserLimit})`;
          return locale === 'zh' ? '優惠碼無效' : 'Invalid code';
        })();
        setApplied(null);
        setPromoError(msg);
        return;
      }
      // If the promo grants free drinks but the customer hadn't added the
      // drinks add-on themselves, auto-add it to the booking now — the
      // promo discount covers the cost so the net charge is unchanged.
      // Venues that already include drinks (TST) are skipped because
      // there's nothing to add.
      let finalApplied = {
        codeId: data.codeId,
        code: data.code,
        type: data.type,
        amount: data.amount,
        freeDrinks: data.freeDrinks,
      };
      if (
        data.freeDrinks
        && booking
        && !freeDrinksVenues.includes(booking.venueId)
        && !booking.addOns?.some((a) => a.id === 'drinks')
      ) {
        const venue = getVenueById(booking.venueId);
        if (venue) {
          const newAddOns = [...(booking.addOns || []), { id: 'drinks', quantity: 1 }];
          const newPricing = calculatePricing(
            venue,
            booking.isWeekend,
            booking.hours,
            booking.guestCount,
            newAddOns,
            booking.childCount,
          );
          await updateDoc(doc(db, 'bookings', booking.id), {
            addOns: newAddOns,
            'pricing.baseCharge':  newPricing.baseCharge,
            'pricing.addOnTotal':  newPricing.addOnTotal,
            'pricing.subtotal':    newPricing.subtotal,
          });
          // Reload the booking so the rest of the page (breakdown, deposit
          // calc) sees the new add-on + pricing.
          const fresh = await getBooking(booking.id);
          if (fresh) setBooking(fresh);
          // The promo's discount tracks the actual drinks cost we just added.
          const drinksCost = Math.round(25 * adultEquiv);
          finalApplied = { ...finalApplied, amount: drinksCost };
        }
      }
      setApplied(finalApplied);
      setPromoError(null);
    } catch {
      setPromoError(locale === 'zh' ? '驗證失敗，請重試' : 'Validation failed');
    } finally {
      setPromoChecking(false);
    }
  }

  function handleClearPromo() {
    setApplied(null);
    setPromoInput('');
    setPromoError(null);
  }

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
      // Persist promo + points redemption + recomputed deposit.
      const bookingPatch: Record<string, unknown> = {
        promoCode: applied?.code || null,
        promoCodeId: applied?.codeId || null,
        promoDiscount: applied?.amount || null,
        promoFreeDrinksCost: applied?.freeDrinks ? applied.amount : null,
        pointsUsed: pointsUsed > 0 ? pointsUsed : null,
        pointsDiscount: clampedRedeem > 0 ? clampedRedeem : null,
        // Recompute deposit / balance to reflect promo discount so the
        // payment page + Stripe webhook see the right amounts.
        'pricing.deposit': effectiveDeposit,
        balanceDue,
      };

      // Marketing channel — first-time customers picked an answer;
      // repeat customers auto-tag as 'loyalty_member'.
      if (isFirstTime && marketingChannel) {
        bookingPatch.marketingChannel = marketingChannel;
        if (marketingChannel === 'other') {
          bookingPatch.marketingChannelOther = marketingOther.trim();
        }
        // Persist to user profile so subsequent bookings auto-tag.
        if (user) {
          const profilePatch: Record<string, unknown> = {
            firstBookingChannel: marketingChannel,
          };
          if (marketingChannel === 'other') profilePatch.firstBookingChannelOther = marketingOther.trim();
          await updateDoc(doc(db, 'users', user.uid), profilePatch);
        }
      } else if (!isFirstTime) {
        bookingPatch.marketingChannel = 'loyalty_member';
      }

      await updateDoc(doc(db, 'bookings', booking.id), bookingPatch);
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
            <Row
              icon={<Users size={14} />}
              label={locale === 'zh' ? '人數' : 'Guests'}
              value={
                (booking.childCount ?? 0) > 0
                  ? (locale === 'zh'
                      ? `${booking.guestCount} 人 (${booking.adultCount ?? booking.guestCount} 成人 + ${booking.childCount} 小童)`
                      : `${booking.guestCount} pax (${booking.adultCount ?? booking.guestCount} adults + ${booking.childCount} kids)`)
                  : `${booking.guestCount} ${locale === 'zh' ? '人' : 'pax'}`
              }
            />
            {booking.addOns.length > 0 && (
              <div className="pt-2 border-t border-white/40 space-y-1">
                <p className="text-xs text-ink-soft">{locale === 'zh' ? '附加服務' : 'Add-ons'}</p>
                {booking.addOns.map((a) => {
                  const meta = addOnCatalog.find((c) => c.id === a.id);
                  return (
                    <div key={a.id} className="text-sm">
                      <p>
                        • {meta?.name[locale] || a.id} {a.quantity > 1 ? `× ${a.quantity}` : ''}
                      </p>
                      {a.id === 'shisha' && (
                        <p className="text-xs text-ink-soft pl-3 mt-0.5">
                          {(() => {
                            const pipes = a.options?.pipes ?? Math.min(2, a.quantity);
                            return locale === 'zh'
                              ? `${pipes} 支水煙 / ${a.quantity} 個煙頭`
                              : `${pipes} pipe${pipes > 1 ? 's' : ''} / ${a.quantity} head${a.quantity > 1 ? 's' : ''}`;
                          })()}
                        </p>
                      )}
                      {a.id === 'shisha' && a.options?.flavors && a.options.flavors.length > 0 && (
                        <p className="text-xs text-ink-soft pl-3 mt-0.5">
                          {a.options.flavors.map((f, i) => (
                            <span key={i}>
                              #{i + 1} {getShishaFlavorLabel(f, locale)}
                              {i < a.options!.flavors!.length - 1 ? '、' : ''}
                            </span>
                          ))}
                        </p>
                      )}
                      {a.id === 'shisha' && a.options?.staffSetup && (
                        <p className="text-xs text-ink-soft pl-3">
                          {locale === 'zh' ? `+ 員工協助 setup (HK$${SHISHA_STAFF_SETUP_FEE})` : `+ Staff setup help (HK$${SHISHA_STAFF_SETUP_FEE})`}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <div className="pt-3 border-t border-white/40 space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-ink-soft">{locale === 'zh' ? '小計' : 'Subtotal'}</span>
                <span>HK${booking.pricing.subtotal.toLocaleString()}</span>
              </div>
              {applied && applied.amount > 0 && (
                <div className="flex justify-between text-sm text-emerald-700">
                  <span>− {locale === 'zh' ? '優惠碼' : 'Promo'} <span className="font-mono text-xs">{applied.code}</span></span>
                  <span>−HK${applied.amount.toLocaleString()}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-ink-soft">{locale === 'zh' ? '按金（活動後退還）' : 'Security deposit (refunded after event)'}</span>
                <span>HK${securityDeposit.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm font-semibold pt-1.5 border-t border-white/40">
                <span>{locale === 'zh' ? '總計' : 'Grand total'}</span>
                <span>HK${effectiveGrandTotal.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-ink-soft">
                  {isFullPayment
                    ? (locale === 'zh' ? '應付（全數）' : 'Due now (full)')
                    : (locale === 'zh' ? '應付（50%）' : 'Due now (50%)')}
                </span>
                <span className="font-medium">HK${effectiveDeposit.toLocaleString()}</span>
              </div>
              {clampedRedeem > 0 && (
                <div className="flex justify-between text-sm text-pink">
                  <span>− {locale === 'zh' ? '積分抵扣' : 'Points redemption'}</span>
                  <span>−HK${clampedRedeem.toLocaleString()}</span>
                </div>
              )}
              <div className="flex justify-between text-base pt-2 border-t border-white/40">
                <span className="text-ink-soft font-semibold">
                  {locale === 'zh' ? '即時應付' : 'Pay now'}
                </span>
                <span className="font-bold text-gradient-pink text-xl">
                  HK${dueNow.toLocaleString()}
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

          {/* Promo code */}
          <div className="glass-card p-7 space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-warm flex items-center justify-center text-white shrink-0">
                <Tag size={18} />
              </div>
              <div className="flex-1">
                <h2 className="font-bold text-lg">{locale === 'zh' ? '優惠碼' : 'Promo Code'}</h2>
                <p className="text-xs text-ink-soft mt-1">
                  {locale === 'zh' ? '輸入優惠碼可獲折扣（不影響按金）。' : 'Enter a code for a discount (does not affect the security deposit).'}
                </p>
              </div>
            </div>

            {applied ? (
              <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                <div>
                  <p className="font-mono font-bold text-emerald-700">{applied.code}</p>
                  <p className="text-xs text-emerald-600 mt-0.5">
                    {locale === 'zh' ? `已減 HK$${applied.amount.toLocaleString()}` : `−HK$${applied.amount.toLocaleString()} applied`}
                    {applied.freeDrinks && (locale === 'zh' ? '（飲品免費）' : ' (free drinks)')}
                  </p>
                </div>
                <button
                  onClick={handleClearPromo}
                  className="w-8 h-8 rounded-full bg-white/70 hover:bg-white text-ink-soft flex items-center justify-center"
                >
                  <XIcon size={14} />
                </button>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <input
                    value={promoInput}
                    onChange={(e) => setPromoInput(e.target.value)}
                    placeholder="WELCOME10"
                    className="flex-1 px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white/85 font-mono uppercase"
                    onKeyDown={(e) => e.key === 'Enter' && handleApplyPromo()}
                  />
                  <button
                    onClick={handleApplyPromo}
                    disabled={!promoInput.trim() || promoChecking}
                    className="px-4 py-2 rounded-xl bg-gradient-pink text-white text-sm font-semibold disabled:opacity-40 flex items-center gap-1.5"
                  >
                    {promoChecking ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    {locale === 'zh' ? '應用' : 'Apply'}
                  </button>
                </div>
                {promoError && (
                  <p className="text-xs text-rose-600">{promoError}</p>
                )}
              </>
            )}
          </div>

          {/* Loyalty point redemption */}
          {pointsBalance > 0 && (
            <div className="glass-card p-7 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-2xl bg-gradient-pink flex items-center justify-center text-white shrink-0">
                  <Sparkles size={18} />
                </div>
                <div className="flex-1">
                  <h2 className="font-bold text-lg">{locale === 'zh' ? '用積分抵扣' : 'Redeem Loyalty Points'}</h2>
                  <p className="text-xs text-ink-soft mt-1">
                    {locale === 'zh'
                      ? `你有 ${pointsBalance.toLocaleString()} 分（= HK$${pointsToHkd(pointsBalance).toLocaleString()}）。${POINTS_PER_HKD} 分 = HK$1。`
                      : `You have ${pointsBalance.toLocaleString()} pts (= HK$${pointsToHkd(pointsBalance).toLocaleString()}). ${POINTS_PER_HKD} pts = HK$1.`}
                  </p>
                </div>
              </div>

              {maxRedeemHkd === 0 ? (
                <p className="text-sm text-ink-soft">
                  {locale === 'zh' ? '今次預訂金額太細，未夠用積分。' : 'Booking amount too small to redeem points.'}
                </p>
              ) : (
                <>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-ink-soft">
                        {locale === 'zh' ? '想用幾多 HK$？' : 'Redeem how much?'}
                      </span>
                      <span className="font-bold text-pink">
                        HK${clampedRedeem.toLocaleString()}{' '}
                        <span className="text-xs text-ink-soft font-normal">
                          ({pointsUsed.toLocaleString()} {locale === 'zh' ? '分' : 'pts'})
                        </span>
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={maxRedeemHkd}
                      step={1}
                      value={clampedRedeem}
                      onChange={(e) => setRedeemHkd(parseInt(e.target.value, 10) || 0)}
                      className="w-full accent-pink"
                    />
                    <div className="flex items-center justify-between text-xs text-ink-soft">
                      <span>HK$0</span>
                      <span>{locale === 'zh' ? `上限 HK$${maxRedeemHkd.toLocaleString()}` : `Max HK$${maxRedeemHkd.toLocaleString()}`}</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setRedeemHkd(0)}
                      className="px-3 py-1.5 rounded-pill text-xs bg-white/70 border border-charcoal/15 hover:bg-white"
                    >
                      {locale === 'zh' ? '清除' : 'Clear'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRedeemHkd(maxRedeemHkd)}
                      className="px-3 py-1.5 rounded-pill text-xs bg-pink/10 text-pink border border-pink/20 hover:bg-pink/20"
                    >
                      {locale === 'zh' ? `用盡 (HK$${maxRedeemHkd.toLocaleString()})` : `Max (HK$${maxRedeemHkd.toLocaleString()})`}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

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

          {/* Marketing channel — first-time customers only.
           *  Required field; admin uses this to track acquisition.
           *  Repeat customers auto-tag as 'loyalty_member' silently. */}
          {isFirstTime && (
            <div className="glass-card p-7 space-y-4">
              <div>
                <h2 className="font-bold text-lg">
                  {locale === 'zh' ? '請問你係喺邊度知道我哋？' : 'How did you hear about us?'}
                  <span className="text-rose-500 ml-1">*</span>
                </h2>
                <p className="text-xs text-ink-soft mt-1">
                  {locale === 'zh'
                    ? '只問新會員一次。呢個資料用嚟改善我哋嘅推廣，唔會公開。'
                    : 'Asked once on your first booking. Used internally to improve our marketing.'}
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {(Object.keys(MARKETING_CHANNEL_LABELS) as MarketingChannel[]).map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => setMarketingChannel(ch)}
                    className={`px-3 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                      marketingChannel === ch
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-charcoal/10 bg-white/60 text-ink hover:border-charcoal/25'
                    }`}
                  >
                    {MARKETING_CHANNEL_LABELS[ch][locale]}
                  </button>
                ))}
              </div>

              {marketingChannel === 'other' && (
                <div>
                  <label className="block text-xs text-ink-soft mb-1.5">
                    {locale === 'zh' ? '請說明 *' : 'Please specify *'}
                  </label>
                  <input
                    value={marketingOther}
                    onChange={(e) => setMarketingOther(e.target.value)}
                    placeholder={locale === 'zh' ? '例：商場 / 巴士廣告' : 'e.g. mall / bus ad'}
                    className="w-full px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white/85"
                  />
                </div>
              )}
            </div>
          )}

          {error && <p className="text-sm text-rose-500 text-center">{error}</p>}

          <button
            disabled={!refundReady || !marketingReady || submitting}
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
          {refundReady && !marketingReady && (
            <p className="text-xs text-rose-400 text-center -mt-3">
              {locale === 'zh' ? '請選擇一個市場推廣渠道' : 'Please select a marketing channel'}
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
