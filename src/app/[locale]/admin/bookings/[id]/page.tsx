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
  redeemLoyaltyPoints,
} from '@/lib/firestore';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { BookingRecord, UserProfile, MarketingChannel, MARKETING_CHANNEL_LABELS } from '@/types';
import { venues } from '@/lib/venues';
import {
  formatAddOnsForStaff,
  addOns as ADDON_CATALOG,
  calculatePricing,
  calcShishaPrice,
} from '@/lib/pricing';
import PaymentHistory from '@/components/booking/PaymentHistory';
import { buildWhatsAppLink, formatHkPhone } from '@/lib/whatsapp';
import {
  ArrowLeft, CalendarDays, Clock, Users, Save, MessageCircle,
  Mail, Phone, User as UserIcon, Sparkles, AlertCircle, CalendarPlus, Package,
  Calculator, Plus, Minus, Check, KeyRound, Send,
} from 'lucide-react';
import { getSiteContent } from '@/lib/content';
import { resendLockPasscode, setManualLockPasscode, tryGenerateLockPasscode } from '@/lib/lockPasscodeClient';
import { cancelBooking } from '@/lib/cancelBooking';

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
  payment_not_completed: { zh: '沒有完成付款', en: 'Payment Not Completed' },
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
  // Venue is editable so admin can relocate a booking (e.g. leak / clash).
  // The conflict check on save will block the move if the target venue
  // is already booked at the same time.
  const [venueId, setVenueId] = useState('');
  // Editable add-ons map — id → quantity. Pre-populated from the booking
  // on load. Quantity > 0 means selected. Saving runs the full pricing
  // recompute in lib/firestore.ts so the booking's subtotal /
  // securityDeposit / balanceDue all reflect the change.
  const [addOnQty, setAddOnQty] = useState<Record<string, number>>({});
  // Shisha sub-options (pipes / per-head flavors / staff setup). Filling
  // these in is what Heidi was missing on admin-issued links — admin
  // can leave flavors blank when creating and finalise here after the
  // customer tells them which ones they want.
  const [shishaOptions, setShishaOptions] = useState<{
    pipes: number;
    flavors: string[];
    staffSetup: boolean;
  }>({ pipes: 1, flavors: [], staffSetup: false });
  // Editable refundable deposit (HK$). Pre-fills from the booking's
  // stored securityDeposit. Saving with a different value passes it as
  // `securityDepositOverride` to updateBookingDateTime — bypasses
  // sticky preserve for the cases where admin wants to (a) bump
  // because add-ons crossed a tier and the customer agreed to pay
  // more refundable, or (b) repair a legacy booking whose deposit
  // was auto-bumped before the sticky rule shipped.
  const [depositOverride, setDepositOverride] = useState<string>('');
  // Editable consumption subtotal (HK$). Pre-fills from the booking's
  // stored pricing.subtotal. When admin edits this AND saves, it goes
  // to lib/firestore.ts as `subtotalOverride`, bypassing the
  // calculatePricing formula. Use for off-system price agreements
  // or repairing data corruption — e.g. #WYtymQm7 where the formula
  // gives $2,700 but Heidi knows the real consumption was $1,700.
  const [subtotalOverride, setSubtotalOverride] = useState<string>('');
  // Editable "total amount already paid" (HK$). Pre-fills from the
  // booking's derived paidSoFar. When admin saves with a value
  // different from the derived one, it goes to lib/firestore.ts as
  // `totalPaidOverride` and bypasses the derive-from-old-state formula
  // (paidSoFar = oldGrandTotal − oldBalanceDue). That formula
  // compounds past errors: a wrong subtotal save leaves a wrong
  // balanceDue, and the pair gets baked into the next save's
  // paidSoFar. Use this to break the loop — type the actual real-world
  // total the customer paid via Stripe/FPS/bank and it sets balanceDue
  // directly. Repair case: #hlJJh9K5 stuck at $4 phantom after a
  // mis-typed subtotal save.
  const [totalPaidOverride, setTotalPaidOverride] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [statusValue, setStatusValue] = useState('');
  const [statusSaving, setStatusSaving] = useState(false);

  // Post-edit payment recording modal — split into rental + deposit
  // so the booking's pricing.subtotal and pricing.securityDeposit can
  // be bumped accurately (and loyalty-point credit later stays correct).
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  // Three-bucket payment split — 場租 (baseCharge), 附加項目 (addOnTotal),
  // 按金 (securityDeposit). Heidi's spec: every payment recorded MUST
  // be itemised by bucket so the customer's receipt + finance reports
  // attribute the money correctly.
  const [payRentalAmount, setPayRentalAmount] = useState<string>('');
  const [payAddOnAmount, setPayAddOnAmount] = useState<string>('');
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
  const [recoveringPoints, setRecoveringPoints] = useState(false);

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
        setVenueId(b.venueId);
        setStatusValue(b.status);
        // Hydrate add-on quantities from the booking so the edit panel
        // reflects what the customer originally booked.
        const initialQty: Record<string, number> = {};
        for (const a of b.addOns || []) {
          initialQty[a.id] = a.quantity;
        }
        setAddOnQty(initialQty);
        // Hydrate the deposit override input from the stored value so
        // saving with no edits leaves the deposit alone.
        setDepositOverride(String(b.pricing.securityDeposit ?? 0));
        setSubtotalOverride(String(b.pricing.subtotal ?? 0));
        // Hydrate shisha sub-options (pipes / flavors / staffSetup).
        // Defaults match the calcShishaPrice fallback when fields are
        // missing on legacy bookings.
        const shishaEntry = b.addOns?.find((a) => a.id === 'shisha');
        if (shishaEntry) {
          const heads = shishaEntry.quantity;
          const pipes = Math.min(2, Math.max(1, shishaEntry.options?.pipes ?? Math.min(2, heads)));
          const flavors = Array.from(
            { length: heads },
            (_, i) => shishaEntry.options?.flavors?.[i] || '',
          );
          setShishaOptions({
            pipes,
            flavors,
            staffSetup: !!shishaEntry.options?.staffSetup,
          });
        }
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

  // Keep shishaOptions.flavors length in sync with the chosen head
  // count. Declared before the early returns below so React's hook
  // order stays stable across renders (eslint react-hooks/rules-of-hooks).
  const shishaHeadsHook = addOnQty['shisha'] || 0;
  useEffect(() => {
    if (shishaHeadsHook === 0) return;
    setShishaOptions((prev) => {
      const flavors = Array.from({ length: shishaHeadsHook }, (_, i) => prev.flavors[i] || '');
      const pipes = Math.min(2, Math.max(1, Math.min(prev.pipes, shishaHeadsHook)));
      return { ...prev, pipes, flavors };
    });
  }, [shishaHeadsHook]);

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

  const venue = venues.find((v) => v.id === venueId) ?? venues.find((v) => v.id === booking.venueId);

  // Compare current add-on selection against what's stored on the booking.
  // Keyed dirty check: any id whose qty differs (including newly added with
  // qty>0 or removed by setting qty=0) flips dirty.
  const storedAddOnMap: Record<string, number> = {};
  for (const a of booking.addOns || []) storedAddOnMap[a.id] = a.quantity;
  const addOnIds = new Set([...Object.keys(storedAddOnMap), ...Object.keys(addOnQty)]);
  const qtyDirty = Array.from(addOnIds).some((id) => {
    const cur = addOnQty[id] || 0;
    const old = storedAddOnMap[id] || 0;
    return cur !== old;
  });
  // Shisha options dirty: admin can add a flavor pick after the fact
  // without changing qty, so we need a separate check that diffs pipes
  // / per-head flavors / staff-setup against what's stored on the
  // booking's existing shisha entry.
  const storedShisha = booking.addOns?.find((a) => a.id === 'shisha');
  const storedFlavors = storedShisha?.options?.flavors || [];
  const flavorsLine = (arr: string[]) =>
    arr.map((f) => f || '').join(',');
  const shishaDirty =
    (addOnQty['shisha'] || 0) > 0
    && (
      (storedShisha?.options?.pipes ?? 1) !== shishaOptions.pipes
      || !!storedShisha?.options?.staffSetup !== shishaOptions.staffSetup
      || flavorsLine(storedFlavors) !== flavorsLine(shishaOptions.flavors)
    );
  const addOnsDirty = qtyDirty || shishaDirty;

  const depositOverrideNum = parseFloat(depositOverride);
  const depositDirty =
    Number.isFinite(depositOverrideNum)
    && depositOverrideNum !== (booking.pricing.securityDeposit ?? 0);
  const subtotalOverrideNum = parseFloat(subtotalOverride);
  const subtotalDirty =
    Number.isFinite(subtotalOverrideNum)
    && subtotalOverrideNum !== (booking.pricing.subtotal ?? 0);
  // Derived "paid so far" — what the booking currently thinks the
  // customer has paid. Mirrors lib/firestore.ts's paidSoFar formula
  // (sum of payments[]) so the override input pre-fills with the
  // value the system would use if admin DIDN'T override. Diff against
  // that to detect dirty.
  const derivedPaidSoFar = (booking.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
  const totalPaidOverrideNum = parseFloat(totalPaidOverride);
  const totalPaidDirty =
    Number.isFinite(totalPaidOverrideNum)
    && totalPaidOverrideNum !== derivedPaidSoFar;

  const dirty =
    date !== booking.date ||
    endDate !== (booking.endDate || booking.date) ||
    startTime !== booking.startTime ||
    endTime !== booking.endTime ||
    guestCount !== booking.guestCount ||
    venueId !== booking.venueId ||
    addOnsDirty ||
    depositDirty ||
    subtotalDirty ||
    totalPaidDirty;

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
      const targetVenue = venues.find((v) => v.id === venueId);
      const venueChanged = venueId !== booking.venueId;
      // Build the new addOns array from the qty map. Drops entries with
      // qty <= 0 so removed add-ons clear from the booking. Shisha gets
      // its pipes / flavors / staffSetup options attached so the saved
      // BookingRecord (and the gcal description + price recompute) all
      // see the right tier.
      const newAddOns = addOnsDirty
        ? Object.entries(addOnQty)
            .filter(([, q]) => q > 0)
            .map(([id, quantity]) => {
              if (id === 'shisha') {
                const flavors = (shishaOptions.flavors || []).filter((f) => !!f);
                return {
                  id,
                  quantity,
                  options: {
                    pipes: shishaOptions.pipes,
                    flavors,
                    staffSetup: shishaOptions.staffSetup,
                  },
                };
              }
              return { id, quantity };
            })
        : undefined;
      await updateBookingDateTime(booking.id, {
        date,
        startTime,
        endTime,
        endDate,
        guestCount,
        ...(venueChanged
          ? { venueId, branchSlug: targetVenue?.slug || booking.branchSlug }
          : {}),
        ...(newAddOns ? { addOns: newAddOns } : {}),
        // Pass the deposit override only when admin actually changed
        // the input — otherwise sticky-preserve handles things.
        ...(depositDirty ? { securityDepositOverride: depositOverrideNum } : {}),
        // Pass the subtotal override only when admin changed it —
        // otherwise calculatePricing's formula stays in charge.
        ...(subtotalDirty ? { subtotalOverride: subtotalOverrideNum } : {}),
        // Pass the total-paid override only when admin changed it —
        // otherwise paidSoFar derives from old state as usual.
        ...(totalPaidDirty ? { totalPaidOverride: totalPaidOverrideNum } : {}),
      });

      // Push the change to Google Calendar immediately — admin should
      // never have to click anything for the calendar to mirror the
      // booking. The blocked_slots side of the master calendar is
      // already updated inside updateBookingDateTime above.
      // syncOnly=true skips the customer email + payment-recording
      // branches; admin can still trigger those via the payment modal
      // below if they want to record a top-up. Failures are non-fatal.
      try {
        await fetch('/api/admin/booking-edit-followup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId: booking.id, syncOnly: true }),
        });
      } catch (err) {
        console.warn('[handleSave] gcal auto-sync failed:', err);
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      // Refresh
      const fresh = await getBooking(booking.id);
      if (fresh) setBooking(fresh);
      // Open the payment / followup modal so admin can record any
      // top-up payment + send the customer the update email. Gcal +
      // blocked_slots are already synced above regardless of whether
      // admin uses the modal.
      setShowPaymentModal(true);
      setFollowupMsg(null);
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      // assertNoSlotConflict in lib/firestore.ts throws this prefix so
      // we can surface a specific red warning instead of a generic save
      // failure. Format: SLOT_CONFLICT:<venueId> or SLOT_CONFLICT:<venueId> #<bookingIdPrefix>
      if (msg.startsWith('SLOT_CONFLICT')) {
        const target = venues.find((v) => v.id === venueId);
        const targetName = target?.name[locale] || venueId;
        setError(
          locale === 'zh'
            ? `⚠️ ${targetName} 喺呢個時段已經有其他預訂，無法更改場地。請揀其他場地或時段。`
            : `⚠️ ${targetName} already has a booking at this time. Cannot move — pick another venue or time.`
        );
      } else {
        setError(
          locale === 'zh'
            ? '儲存失敗，可能與其他預訂衝突'
            : 'Save failed — may conflict with another booking'
        );
      }
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

      // Credit loyalty points: subtotal (rental + add-ons) + forfeited
      // security deposit (the part SPACO actually kept). Refundable
      // amount that went BACK to the customer doesn't count — per
      // Heidi's spec, only money the company actually pocketed earns
      // points. 1 HK$ = 1 point.
      //
      // Idempotency: skip if booking.pointsCreditedAt is already set
      // (admin re-clicked settle or used the 補加積分 recovery action).
      // Returned `creditedPoints` is 0 in that case — the message
      // below reads as "已 credit 0 積分" but the settled state
      // panel renders the original pointsActuallyCredited value.
      let creditedPoints = 0;
      if (booking.userId && !booking.pointsCreditedAt) {
        const points = booking.pricing.subtotal + total;
        creditedPoints = await creditLoyaltyPoints(booking.userId, points);
        if (creditedPoints > 0) {
          await updateDoc(doc(db, 'bookings', booking.id), {
            pointsCreditedAt: serverTimestamp(),
            pointsActuallyCredited: creditedPoints,
            updatedAt: serverTimestamp(),
          });
        }
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

  /** Credit loyalty points for an already-settled booking whose
   *  original settle didn't fire the credit (e.g. legacy rows, or
   *  booking.userId was empty at settle time and customer signed up
   *  later). Idempotent via pointsCreditedAt — safe to click twice;
   *  the second click no-ops. */
  async function handleRecoverPoints() {
    if (!booking || !booking.userId || booking.pointsCreditedAt) return;
    setRecoveringPoints(true);
    try {
      const settledDeductions =
        (booking.depositRefund as { deductions?: { amount: number }[] } | null)?.deductions
          ?.reduce((s, d) => s + (d.amount || 0), 0) || 0;
      const points = (booking.pricing.subtotal || 0) + settledDeductions;
      const credited = await creditLoyaltyPoints(booking.userId, points);
      if (credited > 0) {
        await updateDoc(doc(db, 'bookings', booking.id), {
          pointsCreditedAt: serverTimestamp(),
          pointsActuallyCredited: credited,
          updatedAt: serverTimestamp(),
        });
        const fresh = await getBooking(booking.id);
        if (fresh) setBooking(fresh);
        setSettleMsg({
          kind: 'ok',
          text: locale === 'zh'
            ? `✓ 已補加 ${credited.toLocaleString()} 積分`
            : `✓ Credited ${credited.toLocaleString()} pts`,
        });
      } else {
        setSettleMsg({
          kind: 'err',
          text: locale === 'zh'
            ? '補加失敗：客戶 user doc 唔存在'
            : 'Credit failed: user doc not found',
        });
      }
    } catch (err) {
      setSettleMsg({
        kind: 'err',
        text: (locale === 'zh' ? '補加失敗：' : 'Credit failed: ') +
          (err instanceof Error ? err.message : 'unknown'),
      });
    } finally {
      setRecoveringPoints(false);
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
      const addOn = parseFloat(payAddOnAmount) || 0;
      const dep = parseFloat(payDepositAmount) || 0;
      if (!opts.skipPayment && (rental + addOn + dep) > 0) {
        body.payment = {
          rentalAmount: rental,
          addOnAmount: addOn,
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
      setPayAddOnAmount('');
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
          text: data.updated
            ? (locale === 'zh' ? '✓ 已更新 Google 日曆（同步咗最新嘅 add-ons / 賬目）' : '✓ Updated Google Calendar with the latest add-ons / totals')
            : (locale === 'zh' ? '✓ 已推送到 Google 日曆' : '✓ Pushed to Google Calendar'),
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
      if (next === 'cancelled') {
        // Centralised cancel cleanup — frees blocked_slots, removes from
        // Google Calendar, revokes any passcode, emails the customer.
        await cancelBooking(booking.id);
      } else {
        await updateBookingStatus(booking.id, next);
        // Sync gcal so the event description reflects the new status
        // (e.g. payment_not_completed should drop the booking from the
        // active calendar surface; awaiting_review hints CS to review).
        // Skipped for cancel since cancelBooking handles its own gcal
        // removal. Fire-and-forget — booking is already saved.
        fetch('/api/admin/booking-edit-followup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId: booking.id, syncOnly: true }),
        }).catch((err) => console.warn('[status-change gcal sync] failed:', err));
      }
      setStatusValue(next);
      // Mirror the trigger that /admin/receipts and /admin/bookings (list)
      // already fire: when admin manually flips a booking to "confirmed"
      // and it's within the 2-day window, generate the lock passcode +
      // email the customer right away. Fire-and-forget — the panel below
      // also has a manual button so any silent failure can be retried.
      if (next === 'confirmed') {
        tryGenerateLockPasscode(booking.id).catch((err) =>
          console.warn('[ttlock] status-change generate failed:', err),
        );
      }
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

          {/* Editable date / time / venue */}
          <div className="glass-card p-6 space-y-4">
            <h2 className="font-bold">
              {locale === 'zh' ? '修改場地、日期、時間及人數' : 'Edit Venue / Date / Time / Guests'}
            </h2>
            <p className="text-xs text-ink-soft -mt-2">
              {locale === 'zh'
                ? '修改後系統會自動更新場地時段封鎖；如目標場地喺指定時間已有預訂，儲存會失敗並顯示紅色警告。'
                : 'On save, blocked slots are migrated to the new venue. A red warning blocks the save if the target venue is already booked at this time.'}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label={locale === 'zh' ? '場地' : 'Venue'}>
                <select
                  value={venueId}
                  onChange={(e) => setVenueId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-charcoal/10 bg-white text-sm focus:outline-none focus:border-accent"
                >
                  {venues.map((v) => (
                    <option key={v.id} value={v.id}>{v.name[locale]}</option>
                  ))}
                </select>
                {venueId !== booking.venueId && (
                  <p className="mt-1 text-[11px] text-amber-700">
                    {locale === 'zh'
                      ? `⚠ 場地改動：${venues.find((v) => v.id === booking.venueId)?.name[locale] || booking.venueId} → ${venues.find((v) => v.id === venueId)?.name[locale] || venueId}（儲存後會檢查衝突）`
                      : `⚠ Venue change: ${venues.find((v) => v.id === booking.venueId)?.name[locale] || booking.venueId} → ${venues.find((v) => v.id === venueId)?.name[locale] || venueId} (conflict checked on save)`}
                  </p>
                )}
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

            {/* Add-ons editor — checkboxes + quantity inputs. Same catalogue
             *  as the customer booking flow. On save, lib/firestore.ts
             *  recomputes the full pricing block (subtotal, addOnTotal,
             *  securityDeposit, deposit, balanceDue) so admin doesn't need
             *  to also manually patch numbers. Package bookings are
             *  excluded — their pricing is flat and follows pkg.price. */}
            {!booking.packageSlug && (
              <div className="pt-4 mt-2 border-t border-charcoal/10 space-y-3">
                <h3 className="font-semibold text-sm flex items-center gap-1.5">
                  <Package size={14} className="text-accent" />
                  {locale === 'zh' ? '附加服務' : 'Add-ons'}
                </h3>
                <p className="text-xs text-ink-soft -mt-1">
                  {locale === 'zh'
                    ? '改動會即時重新計算場租 / 附加服務小計 / 可退按金 / 應付 / 尾數，並寫入預訂。'
                    : 'Changes re-run pricing (rental / add-on subtotal / refundable / due / balance) on save.'}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {ADDON_CATALOG.map((cfg) => {
                    const qty = addOnQty[cfg.id] || 0;
                    const enabled = qty > 0;
                    // Per-head add-ons (BBQ / hotpot packages, drinks)
                    // charge against the full guest count. Stored qty
                    // is just a presence flag — no qty selector here.
                    const isPerHead = cfg.unit === 'person';
                    return (
                      <label
                        key={cfg.id}
                        className={`flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer text-xs ${
                          enabled
                            ? 'border-accent bg-accent/5'
                            : 'border-charcoal/10 bg-white hover:bg-cream/30'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={(e) => {
                            setAddOnQty((prev) => ({
                              ...prev,
                              [cfg.id]: e.target.checked ? Math.max(prev[cfg.id] || 1, 1) : 0,
                            }));
                          }}
                          className="mt-0.5 accent-accent flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline justify-between gap-1">
                            <span className="font-medium truncate">{cfg.name[locale]}</span>
                            <span className="text-ink-soft text-[11px] whitespace-nowrap">
                              {cfg.id === 'shisha' && enabled
                                ? `$${calcShishaPrice(shishaOptions.pipes, qty, shishaOptions.staffSetup).toLocaleString()}`
                                : `$${cfg.pricePerUnit}${isPerHead ? '/位' : ''}`}
                            </span>
                          </div>
                          {enabled && isPerHead && (
                            <p className="text-[11px] text-ink-soft mt-1">
                              {locale === 'zh'
                                ? `全部 ${guestCount} 人，自動按人數計`
                                : `Applied to all ${guestCount} guests`}
                            </p>
                          )}
                          {enabled && !isPerHead && (
                            <div className="flex items-center gap-1.5 mt-1.5">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  setAddOnQty((prev) => ({
                                    ...prev,
                                    [cfg.id]: Math.max(1, (prev[cfg.id] || 1) - 1),
                                  }));
                                }}
                                className="w-6 h-6 rounded-md bg-white border border-charcoal/15 flex items-center justify-center text-ink-soft hover:bg-cream"
                              >
                                <Minus size={10} />
                              </button>
                              <input
                                type="number"
                                min={1}
                                value={qty}
                                onChange={(e) =>
                                  setAddOnQty((prev) => ({
                                    ...prev,
                                    [cfg.id]: Math.max(1, parseInt(e.target.value) || 1),
                                  }))
                                }
                                className="w-12 px-1 py-0.5 rounded border border-charcoal/15 text-center text-xs bg-white"
                              />
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  setAddOnQty((prev) => ({
                                    ...prev,
                                    [cfg.id]: (prev[cfg.id] || 1) + 1,
                                  }));
                                }}
                                className="w-6 h-6 rounded-md bg-white border border-charcoal/15 flex items-center justify-center text-ink-soft hover:bg-cream"
                              >
                                <Plus size={10} />
                              </button>
                            </div>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>

                {/* Shisha sub-options — only renders when shisha is selected.
                 *  Lets admin finalise pipe count + per-head flavors +
                 *  staff-setup AFTER the booking was created (Heidi's
                 *  follow-up workflow: customer doesn't pick flavors
                 *  upfront, admin fills them in once they let CS know). */}
                {(addOnQty['shisha'] || 0) > 0 && (() => {
                  const shishaCfg = ADDON_CATALOG.find((c) => c.id === 'shisha');
                  if (!shishaCfg?.variants) return null;
                  const heads = addOnQty['shisha'] || 0;
                  return (
                    <div className="mt-3 rounded-lg border border-accent/30 bg-accent/5 p-3 space-y-3">
                      <p className="text-xs font-semibold text-ink flex items-center gap-1.5">
                        <Package size={12} className="text-accent" />
                        {locale === 'zh' ? 'Shisha 詳細設定' : 'Shisha details'}
                      </p>

                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-ink-soft font-semibold uppercase tracking-wider">
                          {locale === 'zh' ? '水煙支數' : 'Pipes'}
                        </span>
                        <div className="flex gap-1">
                          {[1, 2].map((p) => (
                            <button
                              key={p}
                              type="button"
                              onClick={() =>
                                setShishaOptions((prev) => ({
                                  ...prev,
                                  pipes: Math.min(p, heads),
                                }))
                              }
                              className={`px-3 py-1 rounded-md text-xs font-semibold border transition ${
                                shishaOptions.pipes === Math.min(p, heads)
                                  ? 'bg-accent/15 border-accent text-accent'
                                  : 'bg-white border-charcoal/15 text-ink-soft hover:bg-cream'
                              }`}
                              disabled={p > heads}
                            >
                              {p}
                            </button>
                          ))}
                        </div>
                        <span className="text-[11px] text-ink-soft">
                          {locale === 'zh'
                            ? `${heads} 個煙頭（自助 DIY 換頭）`
                            : `${heads} head${heads > 1 ? 's' : ''} (DIY swap)`}
                        </span>
                      </div>

                      <div>
                        <p className="text-xs text-ink-soft font-semibold uppercase tracking-wider mb-1.5">
                          {locale === 'zh' ? '揀煙頭口味（每個頭一款）' : 'Flavor per head'}
                          <span className="text-[10px] font-normal normal-case text-ink-soft/70 ml-2">
                            {locale === 'zh' ? '可留空' : 'Optional'}
                          </span>
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                          {Array.from({ length: heads }).map((_, headIndex) => (
                            <label
                              key={headIndex}
                              className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white border border-charcoal/10"
                            >
                              <span className="text-[10px] font-bold text-ink-soft uppercase">
                                #{headIndex + 1}
                              </span>
                              <select
                                value={shishaOptions.flavors[headIndex] || ''}
                                onChange={(e) => {
                                  const flavors = [...shishaOptions.flavors];
                                  flavors[headIndex] = e.target.value;
                                  setShishaOptions((prev) => ({ ...prev, flavors }));
                                }}
                                className="flex-1 text-xs bg-transparent focus:outline-none"
                              >
                                <option value="">
                                  {locale === 'zh' ? '— 未揀 —' : '— Not picked —'}
                                </option>
                                {shishaCfg.variants!.map((v) => (
                                  <option key={v.id} value={v.id}>
                                    {v.name[locale]}
                                  </option>
                                ))}
                              </select>
                            </label>
                          ))}
                        </div>
                      </div>

                      <label className="flex items-center gap-2 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={shishaOptions.staffSetup}
                          onChange={(e) =>
                            setShishaOptions((prev) => ({ ...prev, staffSetup: e.target.checked }))
                          }
                          className="w-3.5 h-3.5 accent-accent"
                        />
                        <span className="text-ink-soft">
                          {locale === 'zh'
                            ? '人手 setup +HK$180'
                            : 'Staff setup +HK$180'}
                        </span>
                      </label>
                    </div>
                  );
                })()}

                {/* Refundable deposit override — pre-fills with the
                 *  booking's current securityDeposit. When admin edits
                 *  this value, save passes it as securityDepositOverride
                 *  and lib/firestore.ts uses it verbatim (bypasses the
                 *  sticky-preserve fallback). Use cases:
                 *    - Add-on edit crosses a tier threshold and the
                 *      customer agreed to put down more refundable.
                 *    - Legacy booking whose deposit was auto-bumped
                 *      before sticky shipped — admin reverts to the
                 *      original tier amount.
                 *  The amber tier-crossed banner above the input
                 *  surfaces when the computed-from-current-subtotal
                 *  tier differs from the stored deposit, so admin sees
                 *  the suggestion without it being forced. */}
                {(() => {
                  // Compute the suggested tier deposit against the
                  // CURRENT (post-edit) subtotal so the banner reflects
                  // what admin's about to save, not what's stored.
                  const liveAddOns = Object.entries(addOnQty)
                    .filter(([, q]) => q > 0)
                    .map(([id, quantity]) => {
                      if (id === 'shisha') {
                        const flavors = (shishaOptions.flavors || []).filter((f) => !!f);
                        return {
                          id,
                          quantity,
                          options: {
                            pipes: shishaOptions.pipes,
                            flavors,
                            staffSetup: shishaOptions.staffSetup,
                          },
                        };
                      }
                      return { id, quantity };
                    });
                  const liveVenue = venues.find((v) => v.id === venueId);
                  let suggestedTier: number | null = null;
                  let suggestedSubtotal = 0;
                  if (liveVenue) {
                    try {
                      const live = calculatePricing(
                        liveVenue,
                        booking.isWeekend,
                        booking.hours,
                        guestCount,
                        liveAddOns,
                        booking.childCount ?? 0,
                      );
                      suggestedSubtotal = live.subtotal;
                      suggestedTier = live.securityDeposit;
                    } catch { /* venue mismatch — skip suggestion */ }
                  }
                  const currentDeposit = booking.pricing.securityDeposit ?? 0;
                  const tierCrossed =
                    suggestedTier !== null && suggestedTier > currentDeposit;

                  return (
                    <div className="mt-3 pt-3 border-t border-charcoal/10 space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-semibold text-ink-soft flex items-center gap-1.5">
                            <Calculator size={12} className="text-pink" />
                            {locale === 'zh' ? '消費小計（HK$）' : 'Consumption subtotal (HK$)'}
                          </label>
                          <div className="flex items-center gap-2 mt-1">
                            <input
                              type="number"
                              min={0}
                              value={subtotalOverride}
                              onChange={(e) => setSubtotalOverride(e.target.value)}
                              className="w-32 px-3 py-1.5 rounded-lg border-2 border-charcoal/15 text-sm bg-white"
                            />
                            {/* One-click reset to the formula value —
                             *  shows up only when the stored / typed
                             *  value differs from what venue × pax ×
                             *  hours + add-ons would give. Most
                             *  legacy repairs are exactly this: stored
                             *  got inflated, click reset to fix. */}
                            {suggestedSubtotal > 0
                              && parseFloat(subtotalOverride) !== suggestedSubtotal && (
                              <button
                                type="button"
                                onClick={() => setSubtotalOverride(String(suggestedSubtotal))}
                                className="px-2 py-1 rounded-pill bg-pink/10 text-pink text-[11px] font-semibold hover:bg-pink/20"
                                title={locale === 'zh'
                                  ? `撳一下重設為公式計嘅金額 HK$${suggestedSubtotal.toLocaleString()}`
                                  : `Click to reset to formula value HK$${suggestedSubtotal.toLocaleString()}`}
                              >
                                {locale === 'zh' ? `🔄 重設為 ${suggestedSubtotal.toLocaleString()}` : `🔄 Reset to ${suggestedSubtotal.toLocaleString()}`}
                              </button>
                            )}
                          </div>
                          <p className="text-[11px] text-ink-soft mt-1 leading-relaxed">
                            {locale === 'zh'
                              ? `預設係 booking 入面已儲存嘅金額（可能因為之前嘅錯誤操作而偏離公式）。公式計算：${suggestedSubtotal > 0 ? `venue × 人 × 鐘頭 + add-ons = HK$${suggestedSubtotal.toLocaleString()}` : '尚未能計算'}。如實際收費同公式有差距（off-system 議價、或舊單數據錯），可手動覆寫。`
                              : `Pre-fills with the value stored on the booking (which may have drifted from the formula due to past mistakes). Formula gives: ${suggestedSubtotal > 0 ? `venue × pax × hours + add-ons = HK$${suggestedSubtotal.toLocaleString()}` : 'not computable'}. Override when actual charge differs.`}
                          </p>
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-ink-soft flex items-center gap-1.5">
                            <Calculator size={12} className="text-pink" />
                            {locale === 'zh' ? '可退按金（HK$）' : 'Refundable deposit (HK$)'}
                          </label>
                          <input
                            type="number"
                            min={0}
                            value={depositOverride}
                            onChange={(e) => setDepositOverride(e.target.value)}
                            className="w-32 px-3 py-1.5 mt-1 rounded-lg border-2 border-charcoal/15 text-sm bg-white"
                          />
                          <p className="text-[11px] text-ink-soft mt-1 leading-relaxed">
                            {locale === 'zh'
                              ? '預設保留原訂單已收按金。如附加項目加碼跨咗 tier，可選擇加收按金（輸入新嘅總按金額）。'
                              : 'Defaults to the booking\'s existing deposit. If add-ons cross a tier you may collect more refundable — type the new total.'}
                          </p>
                        </div>
                      </div>
                      {tierCrossed && (
                        <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-800 leading-relaxed flex items-start gap-1.5">
                          <AlertCircle size={12} className="mt-0.5 shrink-0" />
                          <div>
                            <p className="font-semibold">
                              {locale === 'zh'
                                ? `小計 HK$${suggestedSubtotal.toLocaleString()} 已達 HK$${suggestedTier!.toLocaleString()} 按金級別`
                                : `Subtotal HK$${suggestedSubtotal.toLocaleString()} now in the HK$${suggestedTier!.toLocaleString()} deposit tier`}
                            </p>
                            <p className="mt-0.5">
                              {locale === 'zh'
                                ? `建議加收按金至 HK$${suggestedTier!.toLocaleString()}（多收 HK$${(suggestedTier! - currentDeposit).toLocaleString()}）。如客人同意，輸入 ${suggestedTier!.toLocaleString()} 並儲存；如無加收，保留原本 HK$${currentDeposit.toLocaleString()}。`
                                : `Consider bumping to HK$${suggestedTier!.toLocaleString()} (+HK$${(suggestedTier! - currentDeposit).toLocaleString()}). If the customer agrees, enter ${suggestedTier!.toLocaleString()} and save; otherwise leave at HK$${currentDeposit.toLocaleString()}.`}
                            </p>
                          </div>
                        </div>
                      )}
                      {/* "已收總額" override — break the
                       *  derive-from-old-state loop. Past-mistake repairs:
                       *  type the actual Stripe + FPS + bank total the
                       *  customer paid. balanceDue gets set directly to
                       *  effectiveGrandTotal − this value. Without this,
                       *  paidSoFar derives from (oldGrandTotal − oldBalance)
                       *  which compounds any earlier wrong subtotal save. */}
                      <div className="pt-3 border-t border-dashed border-charcoal/15">
                        <label className="text-xs font-semibold text-ink-soft flex items-center gap-1.5">
                          <Calculator size={12} className="text-pink" />
                          {locale === 'zh' ? '已收總額（HK$）— 修復用' : 'Total amount paid (HK$) — repair tool'}
                        </label>
                        <div className="flex items-center gap-2 mt-1">
                          <input
                            type="number"
                            min={0}
                            value={totalPaidOverride}
                            placeholder={String(derivedPaidSoFar)}
                            onChange={(e) => setTotalPaidOverride(e.target.value)}
                            className="w-40 px-3 py-1.5 rounded-lg border-2 border-charcoal/15 text-sm bg-white"
                          />
                          <button
                            type="button"
                            onClick={() => setTotalPaidOverride(String(derivedPaidSoFar))}
                            className="px-2 py-1 rounded-pill bg-pink/10 text-pink text-[11px] font-semibold hover:bg-pink/20"
                            title={locale === 'zh'
                              ? `撳一下預填現時系統計嘅已收金額 HK$${derivedPaidSoFar.toLocaleString()}`
                              : `Click to prefill with the system's current derived paid amount HK$${derivedPaidSoFar.toLocaleString()}`}
                          >
                            {locale === 'zh'
                              ? `預填 ${derivedPaidSoFar.toLocaleString()}`
                              : `Prefill ${derivedPaidSoFar.toLocaleString()}`}
                          </button>
                        </div>
                        <p className="text-[11px] text-ink-soft mt-1 leading-relaxed">
                          {locale === 'zh'
                            ? `淨係喺修復舊單嘅 balanceDue 偏差時用。現時系統計到嘅已收金額：HK$${derivedPaidSoFar.toLocaleString()}。如客人實際俾過嘅總額同呢個唔同（例如之前儲過錯誤嘅小計而引致 balance 凍結咗錯數），喺度輸入正確嘅 Stripe+FPS+銀行總額，儲存後 balanceDue 會直接 = 大計 − 呢個數，唔再行公式。`
                            : `Repair tool — use only when an old booking has a stuck balanceDue caused by a past wrong subtotal save. System currently thinks paid = HK$${derivedPaidSoFar.toLocaleString()}. If the real Stripe+FPS+bank total differs, type the correct amount here — balanceDue is set directly to grandTotal − this number, bypassing the formula.`}
                        </p>
                      </div>
                    </div>
                  );
                })()}
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
            {booking.addOns && booking.addOns.length > 0 && (() => {
              // Render each add-on with its individual calculation +
              // amount, NOT just the name. Heidi's spec: "依張單，
              // 水煙套餐 $390，燒烤套餐 $138×15位＝$2,070, 要清楚
              // breakdown比客人睇". Pull the breakdown lines from
              // calculatePricing() so the per-head math comes from the
              // exact same formula the booking was priced against.
              const bookingVenue = venues.find((v) => v.id === booking.venueId);
              const breakdown = bookingVenue
                ? calculatePricing(
                    bookingVenue,
                    booking.isWeekend,
                    booking.hours,
                    booking.guestCount,
                    booking.addOns,
                    booking.childCount ?? 0,
                  ).breakdown.slice(1) // drop venue rental — already in 小計 below
                : [];
              return (
                <div className="flex items-start gap-2 py-1 border-b border-charcoal/5">
                  <div className="text-violet-700 mt-0.5">
                    <Package size={14} />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-ink-soft mb-1">
                      {locale === 'zh' ? '附加服務' : 'Add-ons'}
                    </p>
                    <ul className="space-y-0.5 text-sm">
                      {booking.addOns.map((a, idx) => {
                        const line = breakdown[idx];
                        const meta = ADDON_CATALOG.find((c) => c.id === a.id);
                        return (
                          <li key={a.id} className="flex items-baseline justify-between gap-3">
                            <span className="text-violet-700">
                              {line?.label[locale] || meta?.name[locale] || a.id}
                            </span>
                            {line && (
                              <span className="font-medium text-ink whitespace-nowrap">
                                HK${line.amount.toLocaleString()}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              );
            })()}
            {booking.hasBYOFood && (
              <Row label={locale === 'zh' ? '自攜食物' : 'BYO Food'} value={locale === 'zh' ? '是' : 'Yes'} />
            )}
            <Row label={locale === 'zh' ? '小計' : 'Subtotal'} value={`HK$${booking.pricing.subtotal.toLocaleString()}`} />
            <Row label={locale === 'zh' ? '可退按金' : 'Refundable deposit'} value={`HK$${(booking.pricing.securityDeposit ?? 0).toLocaleString()}`} />
            {(() => {
              // "已收" must reflect money actually received, not the quoted
              // upfront amount. For unpaid bookings it's the sum of any
              // admin-logged payments (often zero). For paid bookings it's
              // grandTotal − balanceDue, which correctly accounts for 50%
              // upfront + later balance top-ups since pricing.* fields are
              // mutated on every recorded payment.
              const grandTotal =
                (booking.pricing.subtotal || 0) + (booking.pricing.securityDeposit || 0);
              const loggedSum =
                (booking.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
              const isPaid =
                booking.status === 'confirmed' ||
                booking.status === 'completed' ||
                !!booking.paymentVerifiedAt;
              const actualPaid = isPaid
                ? Math.max(0, grandTotal - (booking.balanceDue || 0))
                : loggedSum;
              const upfrontQuote = booking.pricing.deposit || 0;
              return (
                <>
                  <Row
                    label={locale === 'zh' ? '應付（首期）' : 'Due (upfront)'}
                    value={`HK$${upfrontQuote.toLocaleString()}`}
                  />
                  <Row
                    label={locale === 'zh' ? '已收' : 'Paid'}
                    value={
                      actualPaid > 0
                        ? `HK$${actualPaid.toLocaleString()}`
                        : (locale === 'zh' ? '— 未收款' : '— Not yet paid')
                    }
                    highlight={actualPaid > 0 ? 'emerald' : undefined}
                  />
                  {(booking.balanceDue || 0) > 0 && isPaid && (
                    <Row
                      label={locale === 'zh' ? '尚欠（尾數）' : 'Outstanding'}
                      value={`HK$${(booking.balanceDue || 0).toLocaleString()}`}
                      highlight="amber"
                    />
                  )}
                </>
              );
            })()}
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
          </div>

          {/* Payment history — surfaces the audit log of every payment
           *  captured for this booking. Rendered only when there's at
           *  least one entry (component handles empty internally).
           *  adminMode exposes a "拆分" button on legacy entries that
           *  pre-date the rental/deposit split. */}
          <PaymentHistory
            booking={booking}
            locale={locale}
            adminMode
            onUpdated={async () => {
              const fresh = await getBooking(booking.id);
              if (fresh) setBooking(fresh);
            }}
          />

          {/* Outstanding balance — visible whenever the booking has a
           *  non-zero balanceDue (typically post-edit when admin added an
           *  add-on, or for high-value bookings that paid only the 50%
           *  upfront deposit). Admin sees the amount + can either send
           *  the customer the online pay-balance link (WhatsApp / copy)
           *  or record an offline payment via the modal. The same
           *  balanceDue surfaces on the customer's /my-bookings card as
           *  a "找尾數" button, so the customer can self-serve too. */}
          {(booking.balanceDue ?? 0) > 0 && (
            <OutstandingBalanceSection
              booking={booking}
              locale={locale}
              memberWa={memberWa}
              onUpdated={async () => {
                const fresh = await getBooking(booking.id);
                if (fresh) setBooking(fresh);
              }}
              onRecordPaymentClick={() => {
                setPayRentalAmount('');
                setPayAddOnAmount('');
                setPayDepositAmount('');
                setPayNote('');
                setFollowupMsg(null);
                setShowPaymentModal(true);
              }}
            />
          )}

          {/* Lock passcode panel — for TTLock-mapped venues shows the
           *  auto-generated passcode + resend button. For non-TTLock
           *  venues (sw-b, sw-ab, …) lets admin enter a passcode by hand. */}
          <LockPasscodePanel
            booking={booking}
            locale={locale}
            onUpdated={async () => {
              const fresh = await getBooking(booking.id);
              if (fresh) setBooking(fresh);
            }}
          />

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
              onRecoverPoints={handleRecoverPoints}
              recoveringPoints={recoveringPoints}
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
            {/* Name links to the members page pre-filtered to this uid —
             *  admin can jump to the customer's profile + history with
             *  one click. Guest bookings (no userId) stay plain text. */}
            {booking.userId ? (
              <Link
                href={`/admin/members?uid=${encodeURIComponent(booking.userId)}`}
                className="text-lg font-semibold text-pink hover:underline inline-flex items-center gap-1"
              >
                {memberName}
                <span className="text-xs text-ink-soft">→</span>
              </Link>
            ) : (
              <p className="text-lg font-semibold">{memberName}</p>
            )}
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
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-ink-soft mb-1">
                    {locale === 'zh' ? '場租 (HK$)' : 'Rental (HK$)'}
                  </label>
                  <input
                    type="number"
                    value={payRentalAmount}
                    onChange={(e) => setPayRentalAmount(e.target.value)}
                    placeholder="0"
                    className="w-full px-2 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-soft mb-1">
                    {locale === 'zh' ? '附加項目 (HK$)' : 'Add-ons (HK$)'}
                  </label>
                  <input
                    type="number"
                    value={payAddOnAmount}
                    onChange={(e) => setPayAddOnAmount(e.target.value)}
                    placeholder="0"
                    className="w-full px-2 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white"
                  />
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
                    className="w-full px-2 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white"
                  />
                </div>
              </div>
              <p className="text-[11px] text-ink-soft -mt-1">
                {locale === 'zh'
                  ? '場租 + 附加項目會加入小計（賺積分）；按金活動後退還'
                  : 'Rental + add-ons adds to subtotal (earns points); deposit refunded after the event'}
              </p>

              {(parseFloat(payRentalAmount) || 0)
                + (parseFloat(payAddOnAmount) || 0)
                + (parseFloat(payDepositAmount) || 0) > 0 && (
                <div className="rounded-lg bg-pink/10 px-3 py-2 text-xs">
                  {locale === 'zh' ? '總共記錄：' : 'Total recorded: '}
                  <span className="font-bold">
                    HK${(
                      (parseFloat(payRentalAmount) || 0)
                      + (parseFloat(payAddOnAmount) || 0)
                      + (parseFloat(payDepositAmount) || 0)
                    ).toLocaleString()}
                  </span>
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
                disabled={followupBusy || (
                  (parseFloat(payRentalAmount) || 0)
                  + (parseFloat(payAddOnAmount) || 0)
                  + (parseFloat(payDepositAmount) || 0)
                ) <= 0}
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

/**
 * "未付尾數" panel for admin — surfaces the outstanding balance + lets
 * admin (a) WhatsApp the customer-facing pay-balance link, (b) copy
 * that link, or (c) open the existing payment-recording modal for
 * offline confirmation. Customer sees a "找尾數" CTA on /my-bookings
 * for the same balance.
 */
function OutstandingBalanceSection({
  booking,
  locale,
  memberWa,
  onRecordPaymentClick,
  onUpdated,
}: {
  booking: BookingRecord;
  locale: 'zh' | 'en';
  memberWa?: string;
  onRecordPaymentClick: () => void;
  /** Called after the "標記尾數已收" action settles the balance, so
   *  the parent page reloads the fresh booking. */
  onUpdated?: () => void;
}) {
  const balance = booking.balanceDue ?? 0;
  const [origin, setOrigin] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [settling, setSettling] = useState<boolean>(false);
  const [settleMsg, setSettleMsg] = useState<string | null>(null);
  const [recalcing, setRecalcing] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window !== 'undefined') setOrigin(window.location.origin);
  }, []);

  /** Re-run the pricing recompute for THIS booking using current
   *  date / time / guests / addOns — picks up any policy fix that
   *  has shipped since the last edit (e.g. the sticky-deposit fix
   *  that prevents auto-bumping securityDeposit on already-paid
   *  bookings). Calls updateBookingDateTime with the booking's
   *  EXISTING field values so blocked_slots / venueId / etc. don't
   *  move, only the pricing block + balanceDue get refreshed.
   *
   *  ALSO reconciles loyalty points if the booking was already
   *  settled+credited: re-derives the expected credit (subtotal +
   *  forfeited deposit) against the new pricing.subtotal and
   *  credits/deducts the diff against the user's balance so
   *  bookings that got over-credited (e.g. #WYtymQm7's $2,700 →
   *  $1,700 after subtotal repair) self-heal in one click.
   *  Triggers the auto gcal sync that handleSave normally fires. */
  async function handleRecalculate() {
    setRecalcing(true);
    setSettleMsg(null);
    try {
      await updateBookingDateTime(booking.id, {
        date: booking.date,
        startTime: booking.startTime,
        endTime: booking.endTime,
        ...(booking.endDate ? { endDate: booking.endDate } : {}),
        guestCount: booking.guestCount,
        ...(typeof booking.adultCount === 'number' ? { adultCount: booking.adultCount } : {}),
        ...(typeof booking.childCount === 'number' ? { childCount: booking.childCount } : {}),
        addOns: booking.addOns || [],
        hasBYOFood: booking.hasBYOFood,
      });

      // Points reconciliation — runs only when the booking was already
      // settled AND credited. Without this, repairing an over-credited
      // booking (subtotal was inflated when the credit fired) leaves
      // the user permanently overpaid in points.
      let pointsMsg = '';
      const fresh = await getBooking(booking.id);
      if (fresh && fresh.pointsCreditedAt && fresh.userId) {
        const settledDeductions =
          (fresh.depositRefund as { deductions?: { amount: number }[] } | null)?.deductions
            ?.reduce((s, d) => s + (d.amount || 0), 0) || 0;
        const expected = (fresh.pricing.subtotal || 0) + settledDeductions;
        const oldCredited = fresh.pointsActuallyCredited || 0;
        const diff = expected - oldCredited;
        if (diff > 0) {
          // Under-credited — top up by diff.
          const added = await creditLoyaltyPoints(fresh.userId, diff);
          await updateDoc(doc(db, 'bookings', fresh.id), {
            pointsActuallyCredited: oldCredited + added,
            updatedAt: serverTimestamp(),
          });
          pointsMsg = locale === 'zh'
            ? `；積分補加 +${added.toLocaleString()}`
            : `; +${added.toLocaleString()} pts credited`;
        } else if (diff < 0) {
          // Over-credited — deduct -diff. Falls back to whatever the
          // user has left if their balance dropped below the amount.
          const taken = await redeemLoyaltyPoints(fresh.userId, -diff);
          if (taken) {
            await updateDoc(doc(db, 'bookings', fresh.id), {
              pointsActuallyCredited: expected,
              updatedAt: serverTimestamp(),
            });
            pointsMsg = locale === 'zh'
              ? `；積分扣返 −${(-diff).toLocaleString()}`
              : `; −${(-diff).toLocaleString()} pts deducted`;
          } else {
            pointsMsg = locale === 'zh'
              ? `；積分需減 ${(-diff).toLocaleString()} 但客戶餘額不足，請手動調整`
              : `; need to deduct ${(-diff).toLocaleString()} pts but user balance too low, adjust manually`;
          }
        }
      }

      // Mirror handleSave's auto-gcal-sync so the event description
      // reflects the refreshed totals.
      fetch('/api/admin/booking-edit-followup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id, syncOnly: true }),
      }).catch((err) => console.warn('[recalc gcal sync] failed:', err));
      setSettleMsg((locale === 'zh' ? '✓ 已重新計算金額' : '✓ Pricing recomputed') + pointsMsg);
      onUpdated?.();
    } catch (err) {
      setSettleMsg(
        (locale === 'zh' ? '失敗：' : 'Failed: ')
        + (err instanceof Error ? err.message : 'unknown'),
      );
    } finally {
      setRecalcing(false);
    }
  }

  /** Mark the outstanding balance as paid offline — adds a payments[]
   *  entry split via reverse bucket-fill (附加項目 → 場租 → 按金) and
   *  clears balanceDue, WITHOUT inflating pricing.* (which is what
   *  the 「記錄線下付款」 modal does, since it's designed for "extend
   *  booking & charge more" scenarios). Used when admin already
   *  verified the customer's balance receipt on /admin/receipts but
   *  the old approve handler didn't write the audit entry. */
  async function handleSettleBalance() {
    if (!confirm(
      locale === 'zh'
        ? `確認將 HK$${balance.toLocaleString()} 標記為已收？將會新增付款記錄並清零尾數。`
        : `Mark HK$${balance.toLocaleString()} as received? Adds a payments[] entry and clears the balance.`,
    )) return;
    setSettling(true);
    setSettleMsg(null);
    try {
      const res = await fetch('/api/admin/booking-settle-balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Settle failed');
      // Sync Google Calendar — the "⚠️ 未找清尾數" warning line in the
      // event description needs to disappear now that balance is 0.
      fetch('/api/admin/booking-edit-followup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id, syncOnly: true }),
      }).catch((err) => console.warn('[settle-balance gcal sync] failed:', err));
      setSettleMsg(locale === 'zh' ? '✓ 已標記尾數已收' : '✓ Balance settled');
      onUpdated?.();
    } catch (err) {
      setSettleMsg(
        (locale === 'zh' ? '失敗：' : 'Failed: ')
        + (err instanceof Error ? err.message : 'unknown'),
      );
    } finally {
      setSettling(false);
    }
  }

  if (balance <= 0) return null;

  const payUrl = origin
    ? `${origin}/${locale}/book/${booking.branchSlug}/pay-balance/${booking.id}`
    : '';

  const venueName = venues.find((v) => v.id === booking.venueId)?.name[locale] || booking.venueId;
  const message =
    locale === 'zh'
      ? `你好！你嘅 SPACO 預訂 (${venueName} · ${booking.date} ${booking.startTime}) 仲未付尾數 HK$${balance.toLocaleString()}。可以撳呢條連結網上付款：${payUrl}`
      : `Hi! Your SPACO booking (${venueName} · ${booking.date} ${booking.startTime}) has an outstanding balance of HK$${balance.toLocaleString()}. Click here to pay online: ${payUrl}`;
  const whatsappHref = memberWa
    ? buildWhatsAppLink(memberWa, message)
    : null;

  async function handleCopy() {
    if (!payUrl) return;
    try {
      await navigator.clipboard.writeText(payUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback: select-and-copy not supported in this browser
      window.prompt(locale === 'zh' ? '複製此連結：' : 'Copy this link:', payUrl);
    }
  }

  return (
    <div className="glass-card p-6 border-2 border-amber-300/60 bg-amber-50/40">
      <div className="flex items-start gap-3 mb-3">
        <AlertCircle size={18} className="text-amber-600 mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <h2 className="font-bold text-amber-900 mb-1">
            {locale === 'zh' ? '預訂未付尾數' : 'Outstanding Balance'}
          </h2>
          <p className="text-sm text-amber-800">
            {locale === 'zh'
              ? '客人需要補付尾數，請發送付款連結或記錄線下收款。'
              : 'Customer owes the balance below — send them the pay link, or record an offline payment.'}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-amber-700 uppercase tracking-wider font-semibold">
            {locale === 'zh' ? '尚欠' : 'Owed'}
          </p>
          <p className="text-2xl font-bold text-amber-900 font-display">
            HK${balance.toLocaleString()}
          </p>
        </div>
      </div>

      {/* Payment URL — read-only input so admin can see + select manually
       *  if clipboard write fails (Safari / locked-down browsers). */}
      <div className="mb-3">
        <label className="block text-xs text-ink-soft mb-1 font-semibold">
          {locale === 'zh' ? '線上付款連結（可發送俾客人）' : 'Online payment link (send to customer)'}
        </label>
        <div className="flex gap-2">
          <input
            value={payUrl}
            readOnly
            className="flex-1 px-3 py-2 rounded-lg border border-charcoal/15 bg-white text-xs font-mono text-ink"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            onClick={handleCopy}
            disabled={!payUrl}
            className="px-3 py-2 rounded-lg bg-white border border-charcoal/15 text-xs font-medium hover:bg-cream flex items-center gap-1 disabled:opacity-40"
          >
            {copied ? <Check size={12} /> : null}
            {copied
              ? (locale === 'zh' ? '已複製' : 'Copied')
              : (locale === 'zh' ? '複製' : 'Copy')}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {whatsappHref ? (
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 bg-[#25D366] text-white rounded-lg text-sm font-medium hover:opacity-90 flex items-center gap-1.5"
          >
            <MessageCircle size={14} />
            {locale === 'zh' ? 'WhatsApp 發送連結' : 'Send via WhatsApp'}
          </a>
        ) : (
          <span className="px-4 py-2 bg-stone-100 text-stone-500 rounded-lg text-sm font-medium flex items-center gap-1.5">
            <MessageCircle size={14} />
            {locale === 'zh' ? 'WhatsApp 不適用（客人未綁定電話）' : 'WhatsApp unavailable (no phone on file)'}
          </span>
        )}

        <button
          onClick={handleSettleBalance}
          disabled={settling}
          className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm font-medium hover:bg-emerald-600 disabled:opacity-50 flex items-center gap-1.5"
        >
          <Check size={14} />
          {settling
            ? (locale === 'zh' ? '處理中…' : 'Settling…')
            : (locale === 'zh' ? '標記尾數已收' : 'Mark balance as paid')}
        </button>

        <button
          onClick={onRecordPaymentClick}
          className="px-4 py-2 bg-white border border-charcoal/15 text-ink rounded-lg text-sm font-medium hover:bg-cream flex items-center gap-1.5"
        >
          <Calculator size={14} />
          {locale === 'zh' ? '記錄額外付款（會加入賬單）' : 'Record extra charge (adds to bill)'}
        </button>

        <button
          onClick={handleRecalculate}
          disabled={recalcing}
          className="px-4 py-2 bg-white border border-charcoal/15 text-ink-soft rounded-lg text-sm font-medium hover:bg-cream disabled:opacity-50 flex items-center gap-1.5"
          title={locale === 'zh'
            ? '用現時嘅日期 / 人數 / 附加服務重新行一次定價，套用最新嘅 deposit 政策（不會 bump 已 paid booking 嘅按金）'
            : 'Re-run pricing with the current date/guests/add-ons, applying the latest policy (e.g. sticky deposit on already-paid bookings)'}
        >
          <Calculator size={14} />
          {recalcing
            ? (locale === 'zh' ? '計算中…' : 'Recalculating…')
            : (locale === 'zh' ? '重新計算金額' : 'Recalculate')}
        </button>
      </div>

      {settleMsg && (
        <p className="text-[11px] text-emerald-700 mt-2">{settleMsg}</p>
      )}

      <p className="text-[11px] text-ink-soft mt-3 leading-relaxed">
        {locale === 'zh'
          ? '※「標記尾數已收」係客人確認交咗尾數（線下/匯款/或者你已喺收據頁批核咗）後撳，只會新增付款記錄同清零尾數，唔會加大張單。「記錄額外付款」係用嚟收新增嘅費用，例如延長場地、額外收費，會將金額加埋落小計。「重新計算金額」係用嚟修補舊有預訂—套用最新政策（例如已 paid booking 加 add-on 唔再 auto-bump 按金 tier）後 refresh 金額。'
          : '※ "Mark balance as paid" — customer paid the existing balance; adds payments[] entry + clears balanceDue, no bill increase. "Record extra charge" — new charges (extended hours, etc.) inflate the bill. "Recalculate" — re-run pricing with the latest policy; useful to repair old bookings whose deposit was wrongly bumped before the sticky-deposit fix.'}
      </p>
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
  /** Settle without re-running deductions — only for already-settled
   *  bookings that didn't credit loyalty points (e.g. legacy rows or
   *  bookings settled while the user account didn't exist yet). */
  onRecoverPoints: () => void;
  recoveringPoints: boolean;
}

function DepositSettlement(props: DepositSettlementProps) {
  const {
    booking, locale, selectedFixed, setSelectedFixed,
    customDeductions, setCustomDeductions, total, settling, settleMsg, onSettle,
    onRecoverPoints, recoveringPoints,
  } = props;
  const securityDeposit = booking.pricing.securityDeposit ?? 0;
  const refundAmount = Math.max(0, securityDeposit - total);
  const alreadySettled = !!booking.depositRefund;
  const pointsCredited = !!booking.pointsCreditedAt;
  const expectedPoints = (() => {
    const settledDeductions =
      (booking.depositRefund as { deductions?: { amount: number }[] } | null)?.deductions
        ?.reduce((s, d) => s + (d.amount || 0), 0) || 0;
    return (booking.pricing.subtotal || 0) + settledDeductions;
  })();

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

          {/* Loyalty points status — settled bookings that crashed the
           *  credit step (e.g. legacy rows, or the user doc didn't exist
           *  at settle time) get a recovery button so admin can credit
           *  the points after the fact. Already-credited rows show the
           *  amount as proof; further clicks are no-ops via the
           *  pointsCreditedAt idempotency guard. */}
          <div className="border-t border-emerald-200/60 pt-2 mt-2">
            {pointsCredited ? (
              <p className="text-xs text-emerald-700 flex items-center gap-1.5">
                <Sparkles size={12} />
                {locale === 'zh'
                  ? `已 credit ${(booking.pointsActuallyCredited || 0).toLocaleString()} 積分`
                  : `Credited ${(booking.pointsActuallyCredited || 0).toLocaleString()} pts`}
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-amber-700 flex items-center gap-1.5">
                  <AlertCircle size={12} />
                  {locale === 'zh'
                    ? `尚未 credit 積分（預計 ${expectedPoints.toLocaleString()} 分）`
                    : `Points not credited yet (expected ${expectedPoints.toLocaleString()} pts)`}
                </p>
                <button
                  type="button"
                  onClick={onRecoverPoints}
                  disabled={recoveringPoints || !booking.userId}
                  className="px-3 py-1.5 rounded-pill bg-pink/10 text-pink text-xs font-semibold hover:bg-pink/20 disabled:opacity-40 flex items-center gap-1"
                >
                  <Sparkles size={11} />
                  {recoveringPoints
                    ? (locale === 'zh' ? '處理中…' : 'Crediting…')
                    : (locale === 'zh' ? `補加 ${expectedPoints.toLocaleString()} 積分` : `Credit ${expectedPoints.toLocaleString()} pts`)}
                </button>
              </div>
            )}
          </div>
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

// ─────────────────────────────────────────────────────────────
// Lock passcode panel
// ─────────────────────────────────────────────────────────────

interface LockPasscodePanelProps {
  booking: BookingRecord;
  locale: 'zh' | 'en';
  onUpdated: () => void | Promise<void>;
}

function LockPasscodePanel({ booking, locale, onUpdated }: LockPasscodePanelProps) {
  const [hasTTLock, setHasTTLock] = useState<boolean | null>(null);   // null = unknown
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Look up whether the venue is mapped to a TTLock lockId in
  // site_content/settings. Drives which controls we show: TTLock-mapped
  // venues display the cron-generated passcode + resend; the rest get a
  // manual-entry form.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cms = await getSiteContent('settings');
        const raw = (cms?.[`ttlock_${booking.venueId}`]?.zh
                  || cms?.[`ttlock_${booking.venueId}`]?.en
                  || '').trim();
        const parsed = parseInt(raw, 10);
        if (!cancelled) setHasTTLock(Number.isFinite(parsed) && parsed > 0);
      } catch {
        if (!cancelled) setHasTTLock(false);
      }
    })();
    return () => { cancelled = true; };
  }, [booking.venueId]);

  const existing = booking.lockPasscode;
  const isManual = existing?.source === 'manual' || (existing && !existing.ttlockPwdId);

  async function handleSetManual() {
    setMsg(null);
    const passcode = input.trim();
    if (!/^\d{4,9}$/.test(passcode)) {
      setMsg({ kind: 'err', text: locale === 'zh' ? '密碼必須係 4-9 位數字' : 'Passcode must be 4–9 digits' });
      return;
    }
    setBusy(true);
    try {
      await setManualLockPasscode(booking.id, passcode);
      setInput('');
      setMsg({ kind: 'ok', text: locale === 'zh' ? '✓ 已儲存並寄出 email' : '✓ Saved and emailed' });
      await onUpdated();
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Failed' });
    } finally {
      setBusy(false);
    }
  }

  async function handleResend() {
    setMsg(null);
    setBusy(true);
    try {
      await resendLockPasscode(booking.id);
      setMsg({ kind: 'ok', text: locale === 'zh' ? '✓ 已重發 email' : '✓ Email resent' });
      await onUpdated();
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Failed' });
    } finally {
      setBusy(false);
    }
  }

  // Run the same eligibility flow the cron / webhook uses, but synchronously
  // so admin sees exactly why nothing happens (e.g. balance-due, no-lockid,
  // ttlock-not-configured). Surfaces `result.reason` returned by the API.
  async function handleGenerate() {
    setMsg(null);
    setBusy(true);
    try {
      const resp = await tryGenerateLockPasscode(booking.id);
      const r = (resp as { result?: { action?: string; reason?: string; error?: string } }).result;
      if (r?.action === 'generated') {
        setMsg({ kind: 'ok', text: locale === 'zh' ? '✓ 已生成密碼並 email 客人' : '✓ Passcode generated and emailed' });
      } else if (r?.action === 'reminded') {
        setMsg({ kind: 'ok', text: locale === 'zh' ? '✓ 已寄出尾數提醒（未付清，唔會生成密碼）' : '✓ Balance reminder sent (passcode held)' });
      } else {
        // Surface the skip / error reason so admin knows what to fix.
        setMsg({
          kind: 'err',
          text: locale === 'zh'
            ? `未生成密碼 — 原因：${r?.reason || 'unknown'}${r?.error ? ` (${r.error})` : ''}`
            : `Not generated — reason: ${r?.reason || 'unknown'}${r?.error ? ` (${r.error})` : ''}`,
        });
      }
      await onUpdated();
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Failed' });
    } finally {
      setBusy(false);
    }
  }

  // Mirror the email's display so admin can preview the validity window.
  const formatHkt = (ms?: number) => {
    if (!ms) return '—';
    const d = new Date(ms + 8 * 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  };

  return (
    <div className="glass-card p-6 space-y-4">
      <h2 className="font-bold flex items-center gap-2">
        <KeyRound size={16} className="text-pink" />
        {locale === 'zh' ? '門鎖密碼' : 'Lock Passcode'}
        {hasTTLock === false && (
          <span className="chip text-[10px] ml-1">{locale === 'zh' ? '手動' : 'Manual'}</span>
        )}
        {hasTTLock === true && (
          <span className="chip text-[10px] ml-1">TTLock</span>
        )}
      </h2>

      {existing ? (
        <div className="space-y-2">
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4">
            <p className="text-xs text-emerald-700 mb-1">{locale === 'zh' ? '密碼' : 'Passcode'}</p>
            <p className="font-mono text-2xl font-bold text-emerald-900 tracking-widest">
              {existing.passcode}
            </p>
            <p className="text-xs text-emerald-700 mt-2">
              {locale === 'zh' ? '有效期' : 'Valid'}: {formatHkt(existing.validFrom)} → {formatHkt(existing.validTo)}
            </p>
            {isManual && (
              <p className="text-xs text-emerald-700 mt-1">
                {locale === 'zh' ? '由 admin 手動輸入' : 'Manually entered by admin'}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={handleResend}
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-charcoal/15 hover:bg-white/90 text-sm font-medium disabled:opacity-50"
          >
            <Send size={14} /> {locale === 'zh' ? '重發 email 畀客人' : 'Resend email to customer'}
          </button>
        </div>
      ) : hasTTLock === true ? (
        <div className="space-y-3">
          <p className="text-sm text-ink-soft">
            {locale === 'zh'
              ? '此場地已配 TTLock — 系統會喺活動前 2 日自動生成密碼並 email 客人。如未到 2 日窗口而想即時生成，可以撳下面個掣。'
              : 'This venue is on TTLock — the system auto-generates a passcode 2 days before the event. Use the button below to trigger generation manually.'}
          </p>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-pink text-white font-semibold disabled:opacity-50"
          >
            <KeyRound size={14} /> {locale === 'zh' ? '即時生成密碼' : 'Generate passcode now'}
          </button>
        </div>
      ) : hasTTLock === false ? (
        <div className="space-y-3">
          <p className="text-sm text-ink-soft">
            {locale === 'zh'
              ? '此場地暫未配 TTLock。請手動輸入鎖上嘅密碼，系統會自動 email 畀客人。'
              : 'This venue is not on TTLock. Enter the physical-lock passcode and we will email it to the customer.'}
            {' '}
            <Link href="/admin/help/lock-passcode-manual" className="text-pink underline whitespace-nowrap">
              📘 {locale === 'zh' ? '查看 SOP' : 'View SOP'}
            </Link>
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={input}
              onChange={(e) => setInput(e.target.value.replace(/[^0-9]/g, '').slice(0, 9))}
              placeholder={locale === 'zh' ? '4-9 位數字' : '4–9 digits'}
              className="flex-1 px-3 py-2 rounded-xl border border-charcoal/15 font-mono tracking-widest text-lg"
            />
            <button
              type="button"
              onClick={handleSetManual}
              disabled={busy || input.length < 4}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-pink text-white font-semibold disabled:opacity-50"
            >
              <Send size={14} /> {locale === 'zh' ? '儲存並寄 email' : 'Save & email'}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted">{locale === 'zh' ? '載入中…' : 'Loading…'}</p>
      )}

      {msg && (
        <p className={`text-sm ${msg.kind === 'ok' ? 'text-emerald-600' : 'text-rose-600'}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
