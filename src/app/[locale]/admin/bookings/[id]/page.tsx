'use client';

import { adminApiFetch } from '@/lib/adminApiFetch';
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
import { getHoliday } from '@/lib/hkHolidays';
import { getPackageBySlug } from '@/lib/packages';
import { getDecorationById } from '@/lib/decorations';
import CateringPickerModal, { type CateringSelection } from '@/components/booking/CateringPickerModal';
import {
  formatAddOnsForStaff,
  addOns as ADDON_CATALOG,
  calculatePricing,
  calcShishaPrice,
  calcCateringTotal,
  freeDrinksVenues,
  earlySetupPriceByVenue,
} from '@/lib/pricing';
import { amountOwed, paidBase, isSettlementOverflow, computeGrandTotal, netConsumption, discountedSubtotal } from '@/lib/bookingMoney';

/**
 * Live-preview recompute of free_drinks promo amount when admin
 * changes pax / child count / addOns / venue on the edit form.
 * MUST mirror the exact same logic in updateBookingDateTime
 * (lib/firestore.ts) so what admin sees in the preview matches what
 * gets saved on click. Without this, changing 7 → 12 pax shows the
 * old 7-pax-worth promo until save, then jumps to the right number
 * after save — confusing.
 *
 * Returns the effective promo discount in HK$.
 *  - Non-free_drinks promos → returns stored promoDiscount unchanged
 *    (their amount was locked at apply time and doesn't depend on
 *    pax).
 *  - Free_drinks promo + drinks add-on present → recompute as
 *    round(25 × adultEquiv) using the LIVE pax count.
 *  - Free_drinks promo but drinks removed → 0 (no discount).
 */
function livePromoForBooking(opts: {
  storedPromoDiscount: number;
  promoFreeDrinksCost: number | undefined;
  liveGuestCount: number;
  liveChildCount: number;
  liveAddOns: Array<{ id?: string }>;
  liveVenueId: string;
}): number {
  const isFreeDrinks = (opts.promoFreeDrinksCost ?? 0) > 0;
  if (!isFreeDrinks) return opts.storedPromoDiscount;
  const hasDrinks = opts.liveAddOns.some((a) => a.id === 'drinks');
  if (!hasDrinks) return 0;
  const adults = Math.max(0, opts.liveGuestCount - opts.liveChildCount);
  const adultEquiv = adults + 0.5 * opts.liveChildCount;
  return freeDrinksVenues.includes(opts.liveVenueId) ? 0 : Math.round(25 * adultEquiv);
}
import PaymentHistory from '@/components/booking/PaymentHistory';
import { buildWhatsAppLink, formatHkPhone } from '@/lib/whatsapp';
import {
  ArrowLeft, CalendarDays, Clock, Users, Save, MessageCircle,
  Mail, Phone, User as UserIcon, Sparkles, AlertCircle, CalendarPlus, Package,
  Calculator, Plus, Minus, Check, KeyRound, Send, X as XIcon, Edit2,
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
  const [adultCount, setAdultCount] = useState(0);
  const [childCount, setChildCount] = useState(0);
  // Venue is editable so admin can relocate a booking (e.g. leak / clash).
  // The conflict check on save will block the move if the target venue
  // is already booked at the same time.
  const [venueId, setVenueId] = useState('');
  // Editable add-ons map — id → quantity. Pre-populated from the booking
  // on load. Quantity > 0 means selected. Saving runs the full pricing
  // recompute in lib/firestore.ts so the booking's subtotal /
  // securityDeposit / balanceDue all reflect the change.
  const [addOnQty, setAddOnQty] = useState<Record<string, number>>({});
  // Admin-defined custom add-ons (name + price). Each entry has a
  // unique `id` of the form `custom-<timestamp>` so the booking can
  // hold multiple in parallel. Customers never see these (they're not
  // in the public catalog) — admin uses them for ad-hoc charges like
  // 「4位代燒員」 or 「額外清潔費」 that aren't pre-defined.
  const [customAddOns, setCustomAddOns] = useState<Array<{ id: string; name: string; price: number }>>([]);
  // Shisha sub-options (pipes / per-head flavors / staff setup). Filling
  // these in is what Heidi was missing on admin-issued links — admin
  // can leave flavors blank when creating and finalise here after the
  // customer tells them which ones they want.
  const [shishaOptions, setShishaOptions] = useState<{
    pipes: number;
    flavors: string[];
    staffSetup: boolean;
    staffSetupTime?: string;
  }>({ pipes: 1, flavors: [], staffSetup: false });
  // Catering modal state. Selection hydrates from the stored
  // catering add-on's options on load; save merges back into addOns.
  const [cateringModalOpen, setCateringModalOpen] = useState(false);
  const [cateringSelection, setCateringSelection] = useState<CateringSelection | null>(null);
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
  // Single amount input for offline payments — Heidi's 2026-05-23
  // spec: payments[] entries don't track per-bucket allocation, only
  // the running total matters. The bucket fields on the schema stay
  // (legacy entries still have them) but new entries get 0s.
  const [payAmount, setPayAmount] = useState<string>('');
  // Admin-entered payments NEVER include 'stripe' — Stripe payments
  // must be system-detected via the webhook (Heidi's spec:
  // "stripe必須透過連結付款而系統亦必然會自動Detect"). Manually typing
  // a Stripe payment created phantom entries on bookings like
  // #WIiQYL2I that never actually charged.
  const [payMethod, setPayMethod] = useState<'fps' | 'bank' | 'cash' | 'other'>('fps');
  const [payNote, setPayNote] = useState<string>('');
  const [followupBusy, setFollowupBusy] = useState(false);
  const [followupMsg, setFollowupMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Manual gcal push (for backfilling bookings whose webhook ran while
  // Google was disconnected, or that were created via admin without auto-sync).
  const [pushing, setPushing] = useState(false);
  const [pushMsg, setPushMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [resendingEmail, setResendingEmail] = useState(false);
  const [resendMsg, setResendMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Deposit settlement state — admin inputs deductions after the event,
  // saves once, system marks booking completed + credits loyalty points.
  const [selectedFixed, setSelectedFixed] = useState<string[]>([]);
  const [customDeductions, setCustomDeductions] = useState<{ label: string; amount: number }[]>([]);
  const [settling, setSettling] = useState(false);
  const [settleMsg, setSettleMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  // Amend-settlement mode (admin role only) — re-opens the deduction form
  // prefilled with the stored settlement so it can be corrected.
  const [amendingSettle, setAmendingSettle] = useState(false);
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
        setAdultCount(b.adultCount ?? b.guestCount);
        setChildCount(b.childCount ?? 0);
        setVenueId(b.venueId);
        setStatusValue(b.status);
        // Hydrate add-on quantities from the booking so the edit panel
        // reflects what the customer originally booked.
        const initialQty: Record<string, number> = {};
        const initialCustom: Array<{ id: string; name: string; price: number }> = [];
        for (const a of b.addOns || []) {
          if (a.id.startsWith('custom-')) {
            initialCustom.push({
              id: a.id,
              name: a.options?.customName || '',
              price: Math.max(0, a.options?.customPrice ?? 0),
            });
          } else {
            initialQty[a.id] = a.quantity;
          }
        }
        setAddOnQty(initialQty);
        setCustomAddOns(initialCustom);
        // Hydrate the deposit override input from the stored value so
        // saving with no edits leaves the deposit alone.
        setDepositOverride(String(b.pricing.securityDeposit ?? 0));
        // Display the EFFECTIVE subtotal (post-promo) — Heidi's spec:
        // "消費小計" should reflect what the customer actually pays
        // for consumption, not the gross. Storage stays pre-promo
        // (promoDiscount is a separate field); on save we add the
        // discount back so the schema invariant holds.
        setSubtotalOverride(String(Math.max(0, (b.pricing.subtotal ?? 0) - (b.promoDiscount || 0))));
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
            staffSetupTime: shishaEntry.options?.staffSetupTime,
          });
        }
        // Hydrate catering selection — admin opens the modal to see/edit.
        const cateringEntry = b.addOns?.find((a) => a.id === 'catering');
        if (cateringEntry?.options) {
          const o = cateringEntry.options as Partial<CateringSelection>;
          if (o.tierId) {
            setCateringSelection({
              tierId: o.tierId,
              dishCodes: o.dishCodes || [],
              deliveryZoneId: o.deliveryZoneId || '',
              doorstepDelivery: !!o.doorstepDelivery,
              noCutlery: !!o.noCutlery,
              extraCutlerySets: o.extraCutlerySets || 0,
              extraFoodTongs: o.extraFoodTongs || 0,
              deliveryTime: o.deliveryTime,
            });
          }
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

  // Auto-sync 消費小計 to the live formula value whenever admin edits
  // add-ons / custom items / shisha options / guest count. Heidi's
  // spec: "幫客人新增了附加服務，'消費小計'應該即時自動調整為最新嘅
  // 價錢". Admin can still type a manual override afterward; the next
  // add-on change will re-sync. Deposit deliberately doesn't auto-sync
  // — the amber 'tier-crossed' banner asks admin to choose.
  const bookingForFormula = booking;
  useEffect(() => {
    if (!bookingForFormula) return;
    const liveVenue = venues.find((v) => v.id === venueId);
    if (!liveVenue) return;
    const liveAddOns = [
      ...Object.entries(addOnQty)
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
                ...(shishaOptions.staffSetup && shishaOptions.staffSetupTime
                  ? { staffSetupTime: shishaOptions.staffSetupTime }
                  : {}),
              },
            };
          }
          if (id === 'catering' && cateringSelection) {
            return { id, quantity: 1, options: cateringSelection };
          }
          return { id, quantity };
        }),
      ...customAddOns
        .filter((c) => c.name.trim() !== '' && c.price >= 0)
        .map((c) => ({
          id: c.id,
          quantity: 1,
          options: { customName: c.name.trim(), customPrice: Math.max(0, Math.floor(c.price)) },
        })),
    ];
    // Derive hours + isWeekend from the EDITED date/time (not the stored
    // values) so a combined date/time + pax/add-on edit previews the
    // correct price. Mirrors updateBookingDateTime's own recompute — must
    // stay in sync with it. Falls back to stored values if the edited
    // date/time isn't parseable yet (mid-typing).
    let liveHours = bookingForFormula.hours;
    let liveIsWeekend = bookingForFormula.isWeekend;
    if (date && startTime && endTime) {
      const effEndDate = endDate && endDate !== date ? endDate : date;
      const startMs = new Date(`${date}T${startTime}:00+08:00`).getTime();
      const endMs = new Date(`${effEndDate}T${endTime}:00+08:00`).getTime();
      if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
        liveHours = Math.max(1, Math.round((endMs - startMs) / 3600000));
      }
      const day = new Date(date).getDay();
      const holiday = getHoliday(date);
      const nextDay = new Date(`${date}T00:00:00`);
      nextDay.setDate(nextDay.getDate() + 1);
      const nextDayStr = `${nextDay.getFullYear()}-${String(nextDay.getMonth() + 1).padStart(2, '0')}-${String(nextDay.getDate()).padStart(2, '0')}`;
      const eveHoliday = getHoliday(nextDayStr);
      liveIsWeekend = day === 5 || day === 6 || holiday?.type === 'public' || eveHoliday?.type === 'public';
    }
    try {
      const live = calculatePricing(
        liveVenue,
        liveIsWeekend,
        liveHours,
        guestCount,
        liveAddOns,
        childCount,
      );
      // Display the effective (post-promo) subtotal — see hydrate
      // comment above. Storage stays pre-promo. Promo recomputes for
      // free_drinks so the preview matches what updateBookingDateTime
      // will save.
      const livePromo = livePromoForBooking({
        storedPromoDiscount: bookingForFormula.promoDiscount || 0,
        promoFreeDrinksCost: bookingForFormula.promoFreeDrinksCost,
        liveGuestCount: guestCount,
        liveChildCount: childCount,
        liveAddOns,
        liveVenueId: venueId,
      });
      const effective = Math.max(0, live.subtotal - livePromo);
      setSubtotalOverride(String(effective));
    } catch { /* venue mismatch — keep current value */ }
    // We intentionally omit setSubtotalOverride from deps — it's a
    // setter (stable identity) and reading bookingForFormula via the
    // capture is safe because it's the most recent booking from state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    addOnQty, customAddOns, shishaOptions, guestCount, childCount, venueId,
    date, startTime, endTime, endDate,
    bookingForFormula,
  ]);

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
  // Custom add-ons dirty: compare current customAddOns array against
  // what's stored. Any add / remove / rename / reprice flips dirty.
  const storedCustomLine = (b: BookingRecord) =>
    (b.addOns || [])
      .filter((a) => a.id.startsWith('custom-'))
      .map((a) => `${a.id}|${a.options?.customName || ''}|${a.options?.customPrice ?? 0}`)
      .sort()
      .join('\n');
  const liveCustomLine = customAddOns
    .map((c) => `${c.id}|${c.name}|${c.price}`)
    .sort()
    .join('\n');
  const customDirty = liveCustomLine !== storedCustomLine(booking);
  const addOnsDirty = qtyDirty || shishaDirty || customDirty;

  const depositOverrideNum = parseFloat(depositOverride);
  const depositDirty =
    Number.isFinite(depositOverrideNum)
    && depositOverrideNum !== (booking.pricing.securityDeposit ?? 0);
  // Admin types the EFFECTIVE (post-promo) subtotal in the UI; we
  // compare against the stored effective value for dirty detection,
  // and add promoDiscount back when sending to the backend so the
  // schema's pricing.subtotal stays the pre-promo gross.
  const subtotalOverrideEffective = parseFloat(subtotalOverride);
  const storedEffectiveSubtotal = (booking.pricing.subtotal ?? 0) - (booking.promoDiscount || 0);
  const subtotalDirty =
    Number.isFinite(subtotalOverrideEffective)
    && subtotalOverrideEffective !== storedEffectiveSubtotal;
  // What we actually pass to lib/firestore.ts — the gross subtotal
  // including the promo amount (since promoDiscount is preserved
  // separately on the booking record).
  const subtotalOverrideNum = Number.isFinite(subtotalOverrideEffective)
    ? subtotalOverrideEffective + (booking.promoDiscount || 0)
    : NaN;
  const dirty =
    date !== booking.date ||
    endDate !== (booking.endDate || booking.date) ||
    startTime !== booking.startTime ||
    endTime !== booking.endTime ||
    guestCount !== booking.guestCount ||
    adultCount !== (booking.adultCount ?? booking.guestCount) ||
    childCount !== (booking.childCount ?? 0) ||
    venueId !== booking.venueId ||
    addOnsDirty ||
    depositDirty ||
    subtotalDirty;

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
        ? [
            ...Object.entries(addOnQty)
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
                if (id === 'catering' && cateringSelection) {
                  return { id, quantity: 1, options: cateringSelection };
                }
                return { id, quantity };
              }),
            // Admin-defined custom add-ons get appended with their
            // name + price baked into `options`. We drop entries whose
            // price ≤ 0 OR name is blank (admin-added rows that were
            // never filled out) to keep the booking clean.
            ...customAddOns
              .filter((c) => c.name.trim() !== '' && c.price >= 0)
              .map((c) => ({
                id: c.id,
                quantity: 1,
                options: {
                  customName: c.name.trim(),
                  customPrice: Math.max(0, Math.floor(c.price)),
                },
              })),
          ]
        : undefined;
      // Snapshot pre-edit values so the followup endpoint can diff and
      // include a "已更改項目" banner in the confirmation email.
      // (Captured BEFORE updateBookingDateTime overwrites Firestore.)
      const previousSnapshot = {
        date: booking.date,
        startTime: booking.startTime,
        endTime: booking.endTime,
        endDate: booking.endDate || null,
        venueId: booking.venueId,
        guestCount: booking.guestCount,
        adultCount: booking.adultCount,
        childCount: booking.childCount,
        addOnsLine: formatAddOnsForStaff(booking.addOns, 'zh'),
      };

      await updateBookingDateTime(booking.id, {
        date,
        startTime,
        endTime,
        endDate,
        guestCount,
        adultCount,
        childCount,
        ...(venueChanged
          ? { venueId, branchSlug: targetVenue?.slug || booking.branchSlug }
          : {}),
        ...(newAddOns ? { addOns: newAddOns } : {}),
        ...(depositDirty ? { securityDepositOverride: depositOverrideNum } : {}),
        ...(subtotalDirty ? { subtotalOverride: subtotalOverrideNum } : {}),
      });

      // Followup: send customer the "預訂已更新" email (with diff banner
      // listing every changed field) + sync Google Calendar. Heidi 2026-06:
      // previously this was syncOnly=true so customer NEVER got an email
      // after admin edits — only the auto-cancellation noise from gcal
      // attendee removal. Now we always email so the customer has a
      // concrete record of the new schedule.
      try {
        await adminApiFetch('/api/admin/booking-edit-followup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookingId: booking.id,
            previousSnapshot,
          }),
        });
      } catch (err) {
        console.warn('[handleSave] followup (email + gcal) failed:', err);
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      // Refresh
      const fresh = await getBooking(booking.id);
      if (fresh) setBooking(fresh);
      // Per Heidi's spec post-#WIiQYL2I: save does NOT pop up the
      // payment modal anymore. Pricing recompute + gcal sync happen
      // automatically; admin records offline payments separately
      // via the dedicated 「已於線下付款」 button when the customer
      // actually pays. The Stripe path is webhook-only (no admin
      // entry), and the 預訂未付尾數 card surfaces the payment link
      // + WhatsApp share so the customer can complete payment
      // through Stripe themselves.
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
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

  /** Sum of fixed + custom deductions (HK$). Defensive: ignore any
   *  negative amounts so a stale input value can never push the
   *  refund ABOVE the security deposit (#HtMEinHx). */
  function totalDeductions(): number {
    const fixed = selectedFixed.reduce((sum, id) => {
      const item = FIXED_DEDUCTIONS.find((d) => d.id === id);
      return sum + Math.max(0, item?.amount || 0);
    }, 0);
    const custom = customDeductions.reduce(
      (sum, d) => sum + Math.max(0, d.amount || 0),
      0,
    );
    return fixed + custom;
  }

  /** Enter amend mode: prefill the deduction form from the STORED
   *  settlement (fixed items matched back by label+amount; the rest load
   *  as custom rows). Admin-role only — gated at the button. */
  function startAmendSettle() {
    if (!booking) return;
    const stored = (booking.depositRefund as { deductions?: { label: string; amount: number }[] } | null)?.deductions || [];
    const fixedIds: string[] = [];
    const custom: { label: string; amount: number }[] = [];
    for (const d of stored) {
      const fixed = FIXED_DEDUCTIONS.find(
        (f) => (f.label.zh === d.label || f.label.en === d.label) && f.amount === d.amount,
      );
      if (fixed && !fixedIds.includes(fixed.id)) fixedIds.push(fixed.id);
      else custom.push({ label: d.label, amount: d.amount });
    }
    setSelectedFixed(fixedIds);
    setCustomDeductions(custom);
    setSettleMsg(null);
    setAmendingSettle(true);
  }

  function cancelAmendSettle() {
    setAmendingSettle(false);
    setSelectedFixed([]);
    setCustomDeductions([]);
    setSettleMsg(null);
  }

  /** Overwrite an existing settlement with corrected deductions.
   *  Recomputes refund/overflow, keeps balanceDue PAYMENT-AWARE (money
   *  already received toward the old overflow stays counted), and
   *  reconciles loyalty points against the new expected credit. */
  async function handleAmendSettle() {
    if (!booking || !booking.depositRefund) return;
    const securityDeposit = booking.pricing.securityDeposit ?? 0;
    const total = totalDeductions();
    const refundAmount = Math.max(0, Math.min(securityDeposit, securityDeposit - total));
    const overflowAmount = Math.max(0, total - securityDeposit);
    if (!window.confirm(locale === 'zh'
      ? `確認修改結算？\n\n新總扣費：HK$${total.toLocaleString()}\n新退款金額：HK$${refundAmount.toLocaleString()}${overflowAmount > 0 ? `\n客人需補付：HK$${overflowAmount.toLocaleString()}` : ''}\n\n會覆蓋原有結算並自動調整積分。`
      : `Amend settlement?\n\nNew deductions: HK$${total.toLocaleString()}\nNew refund: HK$${refundAmount.toLocaleString()}${overflowAmount > 0 ? `\nCustomer owes: HK$${overflowAmount.toLocaleString()}` : ''}\n\nOverwrites the stored settlement and reconciles points.`)) return;
    setSettling(true);
    setSettleMsg(null);
    try {
      const deductions = [
        ...selectedFixed.map((id) => {
          const item = FIXED_DEDUCTIONS.find((d) => d.id === id)!;
          return { label: item.label[locale], amount: item.amount };
        }),
        ...customDeductions.filter((d) => d.label && d.amount > 0),
      ];

      // Money already received BEYOND the canonical bill = what the
      // customer paid toward the previous overflow. The amended balance
      // only asks for the part of the NEW overflow not yet covered, so
      // shrinking a deduction never re-bills money already collected.
      const paidTowardOverflow = Math.max(0, paidBase(booking) - computeGrandTotal(booking));
      const newBalance = Math.max(0, overflowAmount - paidTowardOverflow);

      const prevRefundedAt = (booking.depositRefund as { refundedAt?: unknown })?.refundedAt;
      await updateDoc(doc(db, 'bookings', booking.id), {
        depositRefund: {
          amount: refundAmount,
          deductions,
          refundedAt: prevRefundedAt ?? serverTimestamp(),
          amendedAt: serverTimestamp(),
          amendedBy: user?.email ?? null,
        },
        balanceDue: newBalance,
        status: newBalance > 0 ? 'confirmed' : 'completed',
        updatedAt: serverTimestamp(),
      });

      // Loyalty reconciliation — same expected-credit formula as settle:
      // net consumption + deposit actually consumed + overflow the
      // customer pays out of pocket. Diff against what was credited.
      let pointsMsg = '';
      if (booking.userId && booking.pointsCreditedAt) {
        const expected = netConsumption(booking) + Math.min(total, securityDeposit) + overflowAmount;
        const oldCredited = booking.pointsActuallyCredited || 0;
        const diff = expected - oldCredited;
        if (diff > 0) {
          const added = await creditLoyaltyPoints(booking.userId, diff);
          await updateDoc(doc(db, 'bookings', booking.id), {
            pointsActuallyCredited: oldCredited + added, updatedAt: serverTimestamp(),
          });
          pointsMsg = locale === 'zh' ? `；積分補加 +${added.toLocaleString()}` : `; +${added.toLocaleString()} pts`;
        } else if (diff < 0) {
          const taken = await redeemLoyaltyPoints(booking.userId, -diff);
          if (taken) {
            await updateDoc(doc(db, 'bookings', booking.id), {
              pointsActuallyCredited: expected, updatedAt: serverTimestamp(),
            });
            pointsMsg = locale === 'zh' ? `；積分扣返 −${(-diff).toLocaleString()}` : `; −${(-diff).toLocaleString()} pts`;
          } else {
            pointsMsg = locale === 'zh'
              ? `；積分需減 ${(-diff).toLocaleString()} 但客戶餘額不足，請手動調整`
              : `; need −${(-diff).toLocaleString()} pts but balance too low — adjust manually`;
          }
        }
      }

      setSettleMsg({
        kind: 'ok',
        text: (locale === 'zh'
          ? `✓ 已修改結算。新退款 HK$${refundAmount.toLocaleString()}${newBalance > 0 ? `；客人尚欠 HK$${newBalance.toLocaleString()}` : ''}`
          : `✓ Settlement amended. Refund HK$${refundAmount.toLocaleString()}${newBalance > 0 ? `; customer owes HK$${newBalance.toLocaleString()}` : ''}`) + pointsMsg,
      });
      const fresh = await getBooking(booking.id);
      if (fresh) setBooking(fresh);
      setAmendingSettle(false);
      setSelectedFixed([]);
      setCustomDeductions([]);
    } catch (err) {
      setSettleMsg({
        kind: 'err',
        text: (locale === 'zh' ? '修改失敗：' : 'Amend failed: ') + (err instanceof Error ? err.message : 'unknown'),
      });
    } finally {
      setSettling(false);
    }
  }

  async function handleSettleDeposit() {
    if (!booking) return;
    // Deposit can only be settled AFTER the event ends — it's refunded
    // once the guest has left and the venue is checked. Guard here too
    // (not just the disabled button) so it can't fire early.
    const settleEndDay = booking.endDate && booking.endDate !== booking.date ? booking.endDate : booking.date;
    const eventEndMs = new Date(`${settleEndDay}T${booking.endTime}:00+08:00`).getTime();
    if (Date.now() < eventEndMs) {
      setSettleMsg({
        kind: 'err',
        text: locale === 'zh' ? '活動結束後才可結算按金。' : 'Deposit can only be settled after the event ends.',
      });
      return;
    }
    setSettling(true);
    setSettleMsg(null);
    try {
      const securityDeposit = booking.pricing.securityDeposit ?? 0;
      const total = totalDeductions();
      // Refund clamped to [0, securityDeposit] — SPACO can never
      // refund more than was originally collected as deposit, even
      // if deductions math went sideways. Without this clamp,
      // #HtMEinHx silently set refund to \$1,450 on a \$1,000 deposit.
      const refundAmount = Math.max(0, Math.min(securityDeposit, securityDeposit - total));
      // Overflow = the part of deductions that EXCEEDED the deposit.
      // Heidi's case (#B7PlO6qv): deductions 加時 HK$2,250 vs deposit
      // HK$2,000 → overflow HK$250. Booking goes back to 'confirmed'
      // with balanceDue = 250 so admin can chase + record payment.
      const overflowAmount = Math.max(0, total - securityDeposit);

      const deductions = [
        ...selectedFixed.map((id) => {
          const item = FIXED_DEDUCTIONS.find((d) => d.id === id)!;
          return { label: item.label[locale], amount: item.amount };
        }),
        ...customDeductions.filter((d) => d.label && d.amount > 0),
      ];

      await updateBookingDepositRefund(booking.id, {
        amount: refundAmount,
        deductions,
        overflowAmount,
      });

      // Credit loyalty points: subtotal (rental + add-ons) + the
      // PORTION of deductions the deposit actually covered. The
      // overflow ($250 in #B7PlO6qv's case) isn't credited yet —
      // customer hasn't paid it. Admin can credit it manually after
      // the offline payment via /admin/members → adjust points.
      //
      // MINUS the promo / points discounts (free items aren't "消費").
      // Refunded portion doesn't count either — only money SPACO
      // actually pocketed earns points. 1 HK$ = 1 point.
      //
      // Idempotency: skip if booking.pointsCreditedAt is already set.
      let creditedPoints = 0;
      if (booking.userId && !booking.pointsCreditedAt) {
        const promoDiscount = booking.promoDiscount || 0;
        const pointsDiscount = booking.pointsDiscount || 0;
        const consumedDeposit = Math.min(total, securityDeposit);
        // When deductions exceed the security deposit, the overflow
        // amount is what the customer pays out-of-pocket on top
        // (#udz81KFK: 加時 \$1,392 vs \$1,000 deposit → \$392 overflow
        // paid by customer). That money is real consumption + must
        // count for loyalty points too.
        const overflowPaid = Math.max(0, total - securityDeposit);
        // Derive earnable spend from primitives so the math is right
        // regardless of whether pricing.subtotal happens to be stored
        // PRE- or POST-promo (convention drift between admin/bookings/new
        // and updateBookingPricing).
        const effectiveSpend = netConsumption(booking);
        const points = effectiveSpend + consumedDeposit + overflowPaid;
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
        text: overflowAmount > 0
          ? (locale === 'zh'
              ? `✓ 結算完成。扣減超出按金 HK$${overflowAmount.toLocaleString()} — 客人需補付，請喺結算後用「已於線下付款」記錄收到嘅金額。已 credit ${creditedPoints.toLocaleString()} 積分。`
              : `✓ Settled. Deductions exceed deposit by HK$${overflowAmount.toLocaleString()} — customer owes this amount; use 已於線下付款 to record receipt. Credited ${creditedPoints.toLocaleString()} pts.`)
          : (locale === 'zh'
              ? `✓ 結算完成。退款 HK$${refundAmount.toLocaleString()}，已 credit ${creditedPoints.toLocaleString()} 積分。`
              : `✓ Settled. Refund HK$${refundAmount.toLocaleString()}; credited ${creditedPoints.toLocaleString()} pts.`),
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
      // Match the settle-deposit formula. Derive earnable spend from
      // primitives + split deductions into consumed-deposit and
      // overflow-paid (#udz81KFK class — \$1,392 deductions on
      // \$1,000 deposit leaves \$392 customer paid in cash, which
      // counts as spend too).
      const promoDiscount = booking.promoDiscount || 0;
      const pointsDiscount = booking.pointsDiscount || 0;
      const securityDepositAtSettle = booking.pricing.securityDeposit ?? 0;
      const consumedDeposit = Math.min(settledDeductions, securityDepositAtSettle);
      const overflowPaid = Math.max(0, settledDeductions - securityDepositAtSettle);
      const effectiveSpend = netConsumption(booking);
      const points = effectiveSpend + consumedDeposit + overflowPaid;
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
   *  Records an offline payment (FPS / bank / cash / other) without
   *  inflating pricing.* — pricing was already locked by the booking
   *  edit save; this only logs what the customer paid and updates
   *  balanceDue. After write, also fires a gcal-only sync so the
   *  event description reflects the new balance line. */
  async function handleRecordOfflinePayment() {
    if (!booking || !user) return;
    setFollowupBusy(true);
    setFollowupMsg(null);
    try {
      const total = parseFloat(payAmount) || 0;
      if (total <= 0) {
        setFollowupMsg({
          kind: 'err',
          text: locale === 'zh' ? '請輸入金額' : 'Enter an amount',
        });
        setFollowupBusy(false);
        return;
      }
      const res = await adminApiFetch('/api/admin/booking-record-offline-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId: booking.id,
          amount: total,
          method: payMethod,
          note: payNote.trim() || undefined,
          recordedBy: user.uid,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Record failed');
      // Mirror booking-edit-followup gcal-only sync so the calendar
      // event description's balance line updates.
      adminApiFetch('/api/admin/booking-edit-followup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id, syncOnly: true }),
      }).catch((err) => console.warn('[offline-pay gcal sync] failed:', err));
      setFollowupMsg({
        kind: 'ok',
        text: locale === 'zh' ? '✓ 已記錄付款' : '✓ Payment recorded',
      });
      const fresh = await getBooking(booking.id);
      if (fresh) setBooking(fresh);
      // If this settled the balance, try to generate the door passcode now
      // (same as the receipts-approve flow). Without this, a same-day
      // balance settlement left the customer with no door code until the
      // next 01:00 cron — after the event. tryGenerateLockPasscode checks
      // eligibility internally (confirmed + balanceDue 0 + within window),
      // so it's a safe no-op when not applicable.
      if ((fresh?.balanceDue ?? 1) <= 0) {
        tryGenerateLockPasscode(booking.id).catch((err) =>
          console.warn('[offline-pay passcode] failed:', err));
      }
      setPayAmount('');
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

  /** Re-send the booking confirmation email to the customer — used when
   *  the customer reports they didn't receive the original. Reuses the
   *  same booking-edit-followup endpoint with resendEmail=true; no diff
   *  banner is included (resend is the same content the customer would
   *  have got at first confirmation). */
  async function handleResendEmail() {
    if (!booking) return;
    setResendingEmail(true);
    setResendMsg(null);
    try {
      const res = await adminApiFetch('/api/admin/booking-edit-followup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId: booking.id,
          resendEmail: true,
          syncOnly: true,   // skip gcal re-sync (not needed for a resend)
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setResendMsg({
        kind: 'ok',
        text: locale === 'zh' ? '✓ 已重新發送確認 email 俾客人' : '✓ Confirmation email re-sent',
      });
    } catch (err) {
      setResendMsg({
        kind: 'err',
        text: (locale === 'zh' ? '失敗:' : 'Failed: ') + (err instanceof Error ? err.message : 'unknown'),
      });
    } finally {
      setResendingEmail(false);
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
    if (next === 'cancelled') {
      // IRREVERSIBLE — confirm before firing. Captures the current
      // admin's identity as the cancelledBy audit field (Heidi's
      // 2026-05-23 spec).
      const label = `${booking.date} ${booking.startTime} · ${booking.venueId} · #${booking.id.slice(0, 8)}`;
      if (!confirm(
        locale === 'zh'
          ? `⚠️ 確定取消預訂？\n\n${label}\n\n取消後不能還原。會即時釋放時段、移除 Google Calendar event、通知客人。`
          : `⚠️ Cancel this booking?\n\n${label}\n\nCannot be undone. Slot is released, gcal event removed, and customer is notified immediately.`,
      )) return;
    }
    setStatusSaving(true);
    try {
      if (next === 'cancelled') {
        await cancelBooking(booking.id, {
          uid: user?.uid,
          email: user?.email || undefined,
          displayName: user?.displayName || undefined,
        });
      } else {
        await updateBookingStatus(booking.id, next);
        // Sync gcal so the event description reflects the new status
        // (e.g. payment_not_completed should drop the booking from the
        // active calendar surface; awaiting_review hints CS to review).
        // Skipped for cancel since cancelBooking handles its own gcal
        // removal. Fire-and-forget — booking is already saved.
        adminApiFetch('/api/admin/booking-edit-followup', {
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

          {/* Resend confirmation email — always available so CS can fire
              it when customer says they didn't receive the original. */}
          <div className="glass-card p-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h2 className="font-bold flex items-center gap-2">
                  <Mail size={16} />
                  {locale === 'zh' ? '重新發送確認 email' : 'Resend Confirmation Email'}
                </h2>
                <p className="text-xs text-ink-soft mt-1 leading-relaxed">
                  {locale === 'zh'
                    ? '客人話收唔到原本嘅確認 email?撳呢度即時重新發送一封,內容同首次確認一樣(會 send 去客人 profile 嗰個 email)。'
                    : "Customer didn't receive the original confirmation? Click to resend (same content as first confirmation, to the customer's profile email)."}
                </p>
              </div>
              <button
                onClick={handleResendEmail}
                disabled={resendingEmail}
                className="btn-primary disabled:opacity-40 flex items-center gap-2 flex-shrink-0"
              >
                <Mail size={14} />
                {resendingEmail
                  ? (locale === 'zh' ? '發送中…' : 'Sending…')
                  : (locale === 'zh' ? '重新發送' : 'Resend')}
              </button>
            </div>
            {resendMsg && (
              <div
                className={`mt-3 text-sm rounded-lg px-3 py-2 ${
                  resendMsg.kind === 'ok'
                    ? 'text-emerald-700 bg-emerald-50'
                    : 'text-rose-700 bg-rose-50'
                }`}
              >
                {resendMsg.text}
              </div>
            )}
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
              <Field label={locale === 'zh' ? '人數（總）' : 'Guests (total)'}>
                <input
                  type="number"
                  min={1}
                  value={guestCount}
                  onChange={(e) => {
                    const total = Number(e.target.value);
                    setGuestCount(total);
                    // Keep adults in sync: adults = total − children
                    setAdultCount(Math.max(0, total - childCount));
                  }}
                  className="w-full px-3 py-2 rounded-lg border border-charcoal/10 bg-white text-sm focus:outline-none focus:border-accent"
                />
              </Field>
              <Field label={locale === 'zh' ? '成人' : 'Adults'}>
                <input
                  type="number"
                  min={0}
                  value={adultCount}
                  onChange={(e) => {
                    const adults = Number(e.target.value);
                    setAdultCount(adults);
                    setGuestCount(adults + childCount);
                  }}
                  className="w-full px-3 py-2 rounded-lg border border-charcoal/10 bg-white text-sm focus:outline-none focus:border-accent"
                />
              </Field>
              <Field label={locale === 'zh' ? '小童（0.5 計）' : 'Children (×0.5)'}>
                <input
                  type="number"
                  min={0}
                  value={childCount}
                  onChange={(e) => {
                    const kids = Number(e.target.value);
                    setChildCount(kids);
                    setGuestCount(adultCount + kids);
                  }}
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
            {booking.packageSlug && (
              <PackageAddOnsEditor booking={booking} locale={locale} />
            )}
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
                    // Catering: open modal instead of toggling a
                    // checkbox; selection populates the booking on save.
                    if (cfg.id === 'catering') {
                      return (
                        <button
                          type="button"
                          key={cfg.id}
                          onClick={() => setCateringModalOpen(true)}
                          className={`text-left rounded-lg border px-3 py-2 text-xs transition-all ${
                            cateringSelection
                              ? 'border-pink bg-pink/5'
                              : 'border-charcoal/10 bg-white hover:bg-cream/30'
                          }`}
                        >
                          <div className="flex items-baseline justify-between gap-1">
                            <span className="font-medium truncate">{cfg.name[locale]}</span>
                            <span className="text-pink text-[11px] font-bold whitespace-nowrap">
                              {cateringSelection
                                ? (locale === 'zh' ? '編輯' : 'Edit')
                                : (locale === 'zh' ? '揀餐單' : 'Pick menu')}
                            </span>
                          </div>
                          {cateringSelection && (
                            <p className="text-[11px] text-pink mt-1">
                              {locale === 'zh'
                                ? `已揀 ${(cateringSelection.dishCodes || []).length} 盤 · ${cateringSelection.tierId} · HK$${calcCateringTotal(cateringSelection).toLocaleString()}`
                                : `${(cateringSelection.dishCodes || []).length} portions · ${cateringSelection.tierId} · HK$${calcCateringTotal(cateringSelection).toLocaleString()}`}
                            </p>
                          )}
                        </button>
                      );
                    }
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
                                : cfg.id === 'early-setup'
                                  ? `$${(earlySetupPriceByVenue[venueId] || 500).toLocaleString()}/小時`
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

                {/* Custom add-ons — admin-defined name + flat price. Each
                 *  entry gets a `custom-<timestamp>-<idx>` id so the
                 *  booking can hold multiple. customName + customPrice
                 *  live on the entry's `options`. Pricing math + gcal
                 *  description handle these via the `custom-` prefix
                 *  branch in lib/pricing.ts. */}
                <div className="pt-2 mt-2 border-t border-dashed border-charcoal/15">
                  <div className="flex items-center justify-between mb-1.5">
                    <h4 className="text-xs font-semibold text-ink-soft uppercase tracking-wider">
                      {locale === 'zh' ? '自訂項目' : 'Custom items'}
                    </h4>
                    <button
                      type="button"
                      onClick={() => {
                        const newId = `custom-${Date.now()}-${customAddOns.length}`;
                        setCustomAddOns((prev) => [...prev, { id: newId, name: '', price: 0 }]);
                      }}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-pill bg-accent/10 text-accent text-[11px] font-semibold hover:bg-accent/20"
                    >
                      <Plus size={12} />
                      {locale === 'zh' ? '新增自訂項目' : 'Add custom item'}
                    </button>
                  </div>
                  {customAddOns.length === 0 ? (
                    <p className="text-[11px] text-ink-soft/70 italic">
                      {locale === 'zh'
                        ? '冇自訂項目。撳上面個「新增」掣可以加一條（例如：4位代燒員 $1500、額外清潔費 $300）。'
                        : 'No custom items. Click "Add" to define one (e.g. 4 BBQ chefs $1500, extra cleaning $300).'}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {customAddOns.map((c, idx) => (
                        <div key={c.id} className="grid grid-cols-[1fr,110px,48px,32px] gap-2 items-center">
                          <input
                            type="text"
                            value={c.name}
                            onChange={(e) => {
                              const next = [...customAddOns];
                              next[idx] = { ...next[idx], name: e.target.value };
                              setCustomAddOns(next);
                            }}
                            placeholder={locale === 'zh' ? '項目名稱（例：4位代燒員）' : 'Item name (e.g. 4 BBQ chefs)'}
                            className="px-2 py-1.5 rounded-lg border border-charcoal/15 text-xs bg-white"
                          />
                          <input
                            type="number"
                            min={0}
                            value={c.price === 0 && c.name.trim() === '' ? '' : c.price}
                            onChange={(e) => {
                              const next = [...customAddOns];
                              next[idx] = { ...next[idx], price: Math.max(0, parseInt(e.target.value, 10) || 0) };
                              setCustomAddOns(next);
                            }}
                            placeholder="HK$"
                            className={`px-2 py-1.5 rounded-lg border text-xs text-right ${
                              c.price === 0 && c.name.trim() !== ''
                                ? 'border-emerald-300 bg-emerald-50 text-emerald-700 font-semibold'
                                : 'border-charcoal/15 bg-white'
                            }`}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const next = [...customAddOns];
                              next[idx] = { ...next[idx], price: 0 };
                              setCustomAddOns(next);
                            }}
                            className={`px-2 py-1 rounded-lg text-[10px] font-semibold transition-colors ${
                              c.price === 0 && c.name.trim() !== ''
                                ? 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300'
                                : 'bg-pink/10 text-pink hover:bg-pink/20'
                            }`}
                            title={locale === 'zh' ? '設為免費' : 'Mark as free'}
                          >
                            {locale === 'zh' ? '免費' : 'FREE'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setCustomAddOns(customAddOns.filter((_, i) => i !== idx))}
                            className="w-7 h-7 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 flex items-center justify-center"
                            title={locale === 'zh' ? '刪除' : 'Remove'}
                          >
                            <XIcon size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
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
                            setShishaOptions((prev) => ({
                              ...prev,
                              staffSetup: e.target.checked,
                              ...(e.target.checked ? {} : { staffSetupTime: undefined }),
                            }))
                          }
                          className="w-3.5 h-3.5 accent-accent"
                        />
                        <span className="text-ink-soft">
                          {locale === 'zh'
                            ? '人手 setup +HK$180'
                            : 'Staff setup +HK$180'}
                        </span>
                      </label>
                      {shishaOptions.staffSetup && (
                        <div className="ml-5 mt-1 p-2 rounded-lg bg-white/60 border border-charcoal/10">
                          <label className="text-[11px] font-semibold text-ink-soft block mb-1">
                            {locale === 'zh' ? 'Setup 時間 *' : 'Setup time *'}
                          </label>
                          <select
                            value={shishaOptions.staffSetupTime || ''}
                            onChange={(e) =>
                              setShishaOptions((prev) => ({ ...prev, staffSetupTime: e.target.value || undefined }))
                            }
                            className={`w-full px-2 py-1 rounded border text-xs ${
                              shishaOptions.staffSetupTime
                                ? 'border-charcoal/15 bg-white'
                                : 'border-rose-300 bg-rose-50 text-rose-700'
                            }`}
                          >
                            <option value="">
                              {startTime && endTime ? `${startTime} – ${endTime}` : '請揀'}
                            </option>
                            {(() => {
                              const toMin = (s: string) => {
                                const [h, m] = s.split(':').map(Number);
                                return h * 60 + (m || 0);
                              };
                              const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
                              const sm = startTime ? toMin(startTime) : 8 * 60;
                              const em = endTime ? toMin(endTime) : 23 * 60 + 45;
                              const out: string[] = [];
                              for (let m = sm; m <= em; m += 15) out.push(fmt(m));
                              return out.map((t) => <option key={t} value={t}>{t}</option>);
                            })()}
                          </select>
                        </div>
                      )}
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
                  const liveAddOns = [
                    ...Object.entries(addOnQty)
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
                        if (id === 'catering' && cateringSelection) {
                          return { id, quantity: 1, options: cateringSelection };
                        }
                        return { id, quantity };
                      }),
                    ...customAddOns
                      .filter((c) => c.name.trim() !== '' && c.price >= 0)
                      .map((c) => ({
                        id: c.id,
                        quantity: 1,
                        options: { customName: c.name.trim(), customPrice: Math.max(0, Math.floor(c.price)) },
                      })),
                  ];
                  const liveVenue = venues.find((v) => v.id === venueId);
                  let suggestedTier: number | null = null;
                  let suggestedSubtotalGross = 0;
                  let suggestedSubtotal = 0;
                  // Recompute promo for free_drinks (matches save-time
                  // logic in updateBookingDateTime). Without this the
                  // hint text shows the old pax-count's promo amount
                  // until save — e.g. 13 → 12 pax kept showing
                  // 「優惠碼 DRINK2026 HK$325」 (= 13-pax worth) on
                  // the 12-pax preview.
                  const livePromoDiscount = livePromoForBooking({
                    storedPromoDiscount: booking.promoDiscount || 0,
                    promoFreeDrinksCost: booking.promoFreeDrinksCost,
                    liveGuestCount: guestCount,
                    liveChildCount: childCount,
                    liveAddOns,
                    liveVenueId: venueId,
                  });
                  if (liveVenue) {
                    try {
                      const live = calculatePricing(
                        liveVenue,
                        booking.isWeekend,
                        booking.hours,
                        guestCount,
                        liveAddOns,
                        childCount,
                      );
                      suggestedSubtotalGross = live.subtotal;
                      // Effective subtotal = formula − promo. The
                      // input + reset button + hint all show this
                      // post-promo number per Heidi's spec.
                      suggestedSubtotal = Math.max(0, live.subtotal - livePromoDiscount);
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
                              ? `已扣減優惠碼後嘅金額（會員積分以此為基礎）。`
                                + (suggestedSubtotalGross > 0
                                  ? ` 公式：venue × 人 × 鐘頭 + add-ons = HK$${suggestedSubtotalGross.toLocaleString()}`
                                    + (livePromoDiscount > 0
                                      ? ` − 優惠碼${booking.promoCode ? ` ${booking.promoCode}` : ''} HK$${livePromoDiscount.toLocaleString()} = HK$${suggestedSubtotal.toLocaleString()}`
                                      : '')
                                    + '。'
                                  : ' 尚未能計算。')
                                + ' 如實際收費同公式有差距，可手動覆寫。'
                              : `Post-promo subtotal (loyalty points are based on this). `
                                + (suggestedSubtotalGross > 0
                                  ? `Formula: venue × pax × hours + add-ons = HK$${suggestedSubtotalGross.toLocaleString()}`
                                    + (livePromoDiscount > 0
                                      ? ` − promo${booking.promoCode ? ` ${booking.promoCode}` : ''} HK$${livePromoDiscount.toLocaleString()} = HK$${suggestedSubtotal.toLocaleString()}`
                                      : '')
                                    + '. '
                                  : 'Not computable. ')
                                + 'Override when actual charge differs.'}
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
            {/* Package booking — show which package the customer
             *  picked + which decoration colour (birthday packages
             *  include a free 3-colour decoration choice). Without
             *  this admin had no way to see decoration selections
             *  except by opening the raw Firestore doc (#mjtp9UKB:
             *  pink decoration was invisible in the UI). Only renders
             *  for package bookings since the fields are scoped to
             *  packages. */}
            {booking.packageSlug && (() => {
              const pkg = getPackageBySlug(booking.packageSlug);
              return (
                <Row
                  icon={<Package size={14} />}
                  label={locale === 'zh' ? '套餐' : 'Package'}
                  value={pkg ? `${pkg.name[locale]} (${booking.packageSlug})` : booking.packageSlug}
                  highlight="violet"
                />
              );
            })()}
            {booking.decorationStyle && (() => {
              const decor = getDecorationById(booking.decorationStyle);
              return (
                <Row
                  label={locale === 'zh' ? '佈置款式' : 'Decoration'}
                  value={
                    decor
                      ? `${decor.label[locale]} — ${decor.description[locale]}`
                      : booking.decorationStyle
                  }
                  highlight="pink"
                />
              );
            })()}
            {/* 場租 — venue rental line. Pulled from pricing.baseCharge
             *  (storage) so it survives off-formula edits. Heidi's spec
             *  places this between 人數 and 附加服務. */}
            {(booking.pricing?.baseCharge ?? 0) > 0 && (
              <Row
                icon={<Calculator size={14} />}
                label={locale === 'zh' ? '場租' : 'Venue rental'}
                value={`HK$${(booking.pricing.baseCharge || 0).toLocaleString()}`}
              />
            )}
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
            {/* Heidi's spec (2026-05-23):
             *   日期 / 時段 / 人數 / 場租 / 附加服務 / 優惠碼 /
             *   小計 / 可退按金 / 總額 / 已收 / 尚欠 / 推廣渠道 / 付款方式
             *
             * 場租 is the venue rental line from calculatePricing (always
             * the first breakdown entry). Add-ons are rendered above
             * this block. 優惠碼 is inserted between add-ons and 小計 so
             * the math reads as: 場租 + add-ons − 優惠碼 = 小計
             * (post-promo). 總額 = 小計 + 按金. 尚欠 = 總額 − 已收.
             *
             * grandTotal is derived from primitives
             * (baseCharge + addOnTotal − promo + securityDeposit) so
             * the math is correct regardless of whether
             * `pricing.subtotal` was stored PRE- or POST-promo —
             * convention drift between admin/bookings/new (PRE-promo
             * post-e1900f0) and updateBookingPricing (POST-promo).
             * Previously this used `subtotal + securityDeposit`, which
             * inflated 尚欠 by the promo amount for every PRE-promo
             * booking (#asQzC4PU showed phantom HK\$500 outstanding). */}
            {(booking.promoCode && (booking.promoDiscount ?? 0) > 0) && (() => {
              // For free_drinks promos, detect if promoDiscount is out of
              // sync with the current pax (e.g. after customer modified).
              const isFreeDrinksPromo = (booking.promoFreeDrinksCost ?? 0) > 0;
              const hasDrinks = (booking.addOns || []).some((a) => a.id === 'drinks');
              let expectedPromo = booking.promoDiscount || 0;
              if (isFreeDrinksPromo && hasDrinks) {
                const pa = Math.max(0, booking.guestCount - (booking.childCount ?? 0));
                const ae = pa + 0.5 * (booking.childCount ?? 0);
                expectedPromo = Math.round(25 * ae);
              }
              const promoDrift = isFreeDrinksPromo && expectedPromo !== (booking.promoDiscount || 0);
              return (
                <div>
                  <Row
                    label={locale === 'zh' ? '優惠碼' : 'Promo'}
                    value={`${booking.promoCode} (−HK$${(booking.promoDiscount || 0).toLocaleString()})`}
                    highlight="emerald"
                  />
                  {promoDrift && (
                    <div className="flex items-center gap-2 mt-1 ml-1">
                      <span className="text-xs text-amber-700">
                        {locale === 'zh'
                          ? `⚠️ 飲品優惠應為 −HK$${expectedPromo} (人數已更改)`
                          : `⚠️ Promo should be −HK$${expectedPromo} (pax changed)`}
                      </span>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!booking) return;
                          setSaving(true);
                          try {
                            const res = await adminApiFetch('/api/admin/fix-free-drinks-promo', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ bookingId: booking.id }),
                            });
                            if (!res.ok) throw new Error(await res.text());
                            const fresh = await getBooking(booking.id);
                            if (fresh) setBooking(fresh);
                          } catch (e) {
                            setError(String(e));
                          } finally {
                            setSaving(false);
                          }
                        }}
                        className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-800 hover:bg-amber-200 border border-amber-300"
                      >
                        {locale === 'zh' ? '立即修正' : 'Fix now'}
                      </button>
                    </div>
                  )}
                </div>
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
            {/* 小計 sits BELOW the −優惠碼 row, so it must already reflect
              * the deduction (#nbWTrtyG showed gross $1,650 under a −$150
              * promo line): 場租 + 加購 − 優惠 = 小計. */}
            <Row label={locale === 'zh' ? '小計' : 'Subtotal'} value={`HK$${discountedSubtotal(booking.pricing.subtotal, booking.promoDiscount).toLocaleString()}`} />
            <Row label={locale === 'zh' ? '可退按金' : 'Refundable deposit'} value={`HK$${(booking.pricing.securityDeposit ?? 0).toLocaleString()}`} />
            {(() => {
              const grandTotal =
                computeGrandTotal(booking);
              const actualPaid =
                (booking.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
              const outstanding = Math.max(0, grandTotal - actualPaid);
              const isPaid =
                booking.status === 'confirmed' ||
                booking.status === 'completed' ||
                !!booking.paymentVerifiedAt;
              return (
                <>
                  <Row
                    label={locale === 'zh' ? '總額' : 'Grand total'}
                    value={`HK$${grandTotal.toLocaleString()}`}
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
                  {outstanding > 0 && isPaid && (
                    <Row
                      label={locale === 'zh' ? '尚欠（尾數）' : 'Outstanding'}
                      value={`HK$${outstanding.toLocaleString()}`}
                      highlight="amber"
                    />
                  )}
                </>
              );
            })()}
            {/* Deposit settlement summary — only renders once admin has
             *  closed out the booking via 「按金結算」. Shows the three
             *  cases from Heidi's 2026-06-21 spec:
             *   A. Full refund (no deductions)         → 已退還按金 + 最後結算
             *   B. Partial deduction + refund          → 按金扣費 + 已退還按金 + 最後結算
             *   C. Overflow (deductions > 按金)        → 按金扣費 + 已退還按金 \$0 + 最後結算
             *  Last total = sum(payments) − depositRefund.amount  (what
             *  customer net spent, after the refund went back to them). */}
            {booking.depositRefund && (() => {
              const dr = booking.depositRefund as {
                amount: number;
                deductions?: Array<{ label: string; amount: number }>;
              };
              const deductions = (dr.deductions || []).filter((d) => d && d.amount > 0);
              const deductionsTotal = deductions.reduce((s, d) => s + (d.amount || 0), 0);
              const paymentsSum = (booking.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
              const finalNet = Math.max(0, paymentsSum - (dr.amount || 0));
              return (
                <>
                  <div className="pt-2 mt-2 border-t border-white/40 text-xs font-semibold text-ink-soft uppercase tracking-wide">
                    {locale === 'zh' ? '結算摘要' : 'Settlement Summary'}
                  </div>
                  {deductions.length > 0 && (
                    <div className="flex items-start gap-2 py-1 border-b border-white/30">
                      <span className="flex items-center gap-1.5 text-ink-soft shrink-0">
                        {locale === 'zh' ? '按金扣費' : 'Deposit deductions'}
                      </span>
                      <div className="flex-1 text-right">
                        <span className="font-medium text-rose-700">−HK${deductionsTotal.toLocaleString()}</span>
                        <ul className="text-[11px] text-ink-soft mt-0.5 space-y-0.5">
                          {deductions.map((d, idx) => (
                            <li key={idx} className="flex justify-between gap-3">
                              <span className="truncate">{d.label}</span>
                              <span className="whitespace-nowrap">HK${d.amount.toLocaleString()}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                  <Row
                    label={locale === 'zh' ? '已退還按金' : 'Deposit refunded'}
                    value={`HK$${(dr.amount || 0).toLocaleString()}`}
                    highlight={dr.amount > 0 ? 'emerald' : 'amber'}
                  />
                  <Row
                    label={locale === 'zh' ? '訂單最後結算總額' : 'Final settled total'}
                    value={`HK$${finalNet.toLocaleString()}`}
                    highlight="violet"
                  />
                </>
              );
            })()}
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
            <Row label={locale === 'zh' ? '付款方式' : 'Payment method'} value={booking.paymentMethod || '—'} />
            {/* Cancellation audit — only renders for cancelled bookings.
             *  Shows who hit the X (staff name + email) and when, so
             *  admin can trace a mis-click. */}
            {booking.status === 'cancelled' && (booking.cancelledByName || booking.cancelledByEmail) && (
              <Row
                label={locale === 'zh' ? '取消者' : 'Cancelled by'}
                value={`${booking.cancelledByName || booking.cancelledByEmail || ''}${booking.cancelledByEmail && booking.cancelledByName ? ` · ${booking.cancelledByEmail}` : ''}`}
                highlight="amber"
              />
            )}
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
          {booking.status !== 'cancelled' && (
            <OutstandingBalanceSection
              booking={booking}
              locale={locale}
              memberWa={memberWa}
              onUpdated={async () => {
                const fresh = await getBooking(booking.id);
                if (fresh) setBooking(fresh);
              }}
              onRecordPaymentClick={() => {
                setPayAmount('');
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
              canAmend={hasPermission('staff')}
              amending={amendingSettle}
              onStartAmend={startAmendSettle}
              onCancelAmend={cancelAmendSettle}
              onAmendSettle={handleAmendSettle}
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

      {/* 已於線下付款 — admin records the FPS / bank / cash / other
       *  payment the customer made offline. Does NOT inflate
       *  pricing.* (Heidi's spec post-#WIiQYL2I); only appends to
       *  payments[] + recomputes balanceDue. Stripe payments are
       *  webhook-only, never entered here. */}
      {showPaymentModal && (
        <div className="fixed inset-0 z-50 bg-charcoal/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-glass-lg max-w-md w-full p-6">
            <h3 className="font-bold text-lg mb-1">
              {locale === 'zh' ? '已於線下付款' : 'Offline payment'}
            </h3>
            <p className="text-sm text-ink-soft mb-4">
              {locale === 'zh'
                ? '輸入客人實際俾過嘅金額。只會記入付款記錄，唔會改變張單嘅應付金額。'
                : 'Enter the amount the customer actually paid offline. Only logs to payments[]; does not change the bill total.'}
            </p>

            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-xs font-semibold text-ink-soft mb-1">
                  {locale === 'zh' ? '金額 (HK$)' : 'Amount (HK$)'}
                </label>
                <input
                  type="number"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  placeholder="0"
                  className="w-full px-3 py-2.5 rounded-xl border-2 border-charcoal/15 text-base font-bold bg-white"
                  autoFocus
                />
              </div>

              {(booking.balanceDue ?? 0) > 0 && (
                <p className="text-[11px] text-amber-700">
                  {locale === 'zh' ? `現有未繳尾數：HK$${booking.balanceDue!.toLocaleString()}` : `Outstanding balance: HK$${booking.balanceDue!.toLocaleString()}`}
                </p>
              )}

              <div>
                <label className="block text-xs font-semibold text-ink-soft mb-1">
                  {locale === 'zh' ? '付款方式' : 'Method'}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(['fps', 'bank', 'cash', 'other'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setPayMethod(m)}
                      className={`px-2 py-1.5 rounded-lg text-xs font-medium border transition ${
                        payMethod === m
                          ? 'bg-accent/10 border-accent text-accent'
                          : 'bg-white/60 border-charcoal/15 text-ink-soft hover:bg-white'
                      }`}
                    >
                      {m === 'fps' ? 'FPS' : m === 'bank' ? (locale === 'zh' ? '銀行' : 'Bank') : m === 'cash' ? (locale === 'zh' ? '現金' : 'Cash') : (locale === 'zh' ? '其他' : 'Other')}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-ink-soft leading-relaxed">
                  {locale === 'zh'
                    ? 'Stripe 付款必須由系統自動偵測，唔接受人手輸入。'
                    : 'Stripe payments must be system-detected; manual entry is disabled.'}
                </p>
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
                onClick={() => setShowPaymentModal(false)}
                disabled={followupBusy}
                className="flex-1 px-4 py-2.5 rounded-xl bg-white/70 border border-charcoal/15 text-sm font-medium hover:bg-white disabled:opacity-40"
              >
                {locale === 'zh' ? '取消' : 'Cancel'}
              </button>
              <button
                onClick={() => handleRecordOfflinePayment()}
                disabled={followupBusy || (parseFloat(payAmount) || 0) <= 0}
                className="flex-1 btn-primary disabled:opacity-40 flex items-center justify-center gap-1.5"
              >
                {followupBusy ? '…' : (
                  <>
                    <Check size={14} />
                    {locale === 'zh' ? '記錄付款' : 'Record payment'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <CateringPickerModal
        open={cateringModalOpen}
        initial={cateringSelection || undefined}
        locale={locale}
        bookingDate={date}
        bookingStartTime={startTime}
        bookingEndTime={endTime}
        onClose={() => setCateringModalOpen(false)}
        onSave={(sel) => {
          setCateringSelection(sel);
          setAddOnQty((prev) => ({ ...prev, catering: 1 }));
          setCateringModalOpen(false);
        }}
        onRemove={() => {
          setCateringSelection(null);
          setAddOnQty((prev) => ({ ...prev, catering: 0 }));
          setCateringModalOpen(false);
        }}
      />
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
  // Money figures come from the shared bookingMoney module. `owed` covers
  // BOTH ways a booking can owe (unpaid bill vs post-payment charge such
  // as settlement overflow) — see amountOwed's docs; narrowing it to one
  // term has broken production twice (#2qzYQOU4, #LSi5Z31A).
  const balance = booking.balanceDue ?? 0;
  const paidTotal = paidBase(booking);
  const owed = amountOwed(booking);
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
        // Match settle-deposit formula: exclude promo + points
        // discounts from the points base.
        const freshPromoDiscount = fresh.promoDiscount || 0;
        const freshPointsDiscount = fresh.pointsDiscount || 0;
        const expected = Math.max(0, (fresh.pricing.subtotal || 0) - freshPromoDiscount - freshPointsDiscount) + settledDeductions;
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
      adminApiFetch('/api/admin/booking-edit-followup', {
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
      const res = await adminApiFetch('/api/admin/booking-settle-balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Settle failed');
      // Sync Google Calendar — the "⚠️ 未找清尾數" warning line in the
      // event description needs to disappear now that balance is 0.
      adminApiFetch('/api/admin/booking-edit-followup', {
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

  if (owed <= 0) return null;

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
            {paidTotal <= 0
              ? (locale === 'zh'
                  ? '此預訂仲未有任何付款記錄。如客人已用 FPS／銀行／現金付款，請用下面「已於線下付款」記錄；或發送線上付款連結。'
                  : 'No payment recorded yet. If the customer paid by FPS / bank / cash, log it with "Record offline payment" below, or send the online pay link.')
              : isSettlementOverflow(booking)
                ? (locale === 'zh'
                    ? '按金結算後扣減超出按金，客人需補付以下金額。請發送付款連結或用「已於線下付款」記錄收到嘅金額。'
                    : 'Deductions exceeded the security deposit at settlement — the customer owes the amount below. Send the pay link or record an offline payment.')
                : (locale === 'zh'
                    ? '客人需要補付尾數，請發送付款連結或記錄線下收款。'
                    : 'Customer owes the balance below — send them the pay link, or record an offline payment.')}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-amber-700 uppercase tracking-wider font-semibold">
            {locale === 'zh' ? '尚欠' : 'Owed'}
          </p>
          <p className="text-2xl font-bold text-amber-900 font-display">
            HK${owed.toLocaleString()}
          </p>
        </div>
      </div>

      {/* Online pay-link — only meaningful when there's a `balanceDue` the
       *  pay-balance page can actually charge. A brand-new unpaid booking
       *  has balanceDue 0 (its deposit link is the original payment page),
       *  so we hide the balance link there and steer admin to record the
       *  offline payment instead. */}
      {balance > 0 && (
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
      )}

      <div className="flex flex-wrap gap-2">
        {balance > 0 && (whatsappHref ? (
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
        ))}

        <button
          onClick={onRecordPaymentClick}
          className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm font-medium hover:bg-emerald-600 flex items-center gap-1.5"
        >
          <Check size={14} />
          {locale === 'zh' ? '已於線下付款' : 'Record offline payment'}
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
          ? '※「已於線下付款」用嚟記錄客人嘅 FPS / 銀行 / 現金 / 其他 付款，輸入金額 + 場租/附加項目/按金分配；只會記入付款記錄，唔會改變張單嘅應付總額。客人經連結用 Stripe 付款會由系統自動偵測，唔需要 admin 手動輸入。「重新計算金額」係用嚟修補舊有預訂—套用最新政策（例如已 paid booking 加 add-on 唔再 auto-bump 按金 tier）後 refresh 金額。'
          : '※ "Record offline payment" — log a customer\'s FPS / bank / cash / other payment with bucket split; appends to payments[] only, does not change the bill total. Stripe payments via the customer link are detected automatically by the webhook. "Recalculate" — re-run pricing with the latest policy.'}
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
  highlight?: 'amber' | 'emerald' | 'violet' | 'pink';
}) {
  const color =
    highlight === 'amber' ? 'text-amber-700'
    : highlight === 'emerald' ? 'text-emerald-700 font-mono'
    : highlight === 'violet' ? 'text-violet-700'
    : highlight === 'pink' ? 'text-pink-700'
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
  /** Admin role only — amend an existing settlement. */
  canAmend: boolean;
  amending: boolean;
  onStartAmend: () => void;
  onCancelAmend: () => void;
  onAmendSettle: () => void;
}

function DepositSettlement(props: DepositSettlementProps) {
  const {
    booking, locale, selectedFixed, setSelectedFixed,
    customDeductions, setCustomDeductions, total, settling, settleMsg, onSettle,
    onRecoverPoints, recoveringPoints,
    canAmend, amending, onStartAmend, onCancelAmend, onAmendSettle,
  } = props;
  const securityDeposit = booking.pricing.securityDeposit ?? 0;
  const refundAmount = Math.max(0, securityDeposit - total);
  const alreadySettled = !!booking.depositRefund;
  const pointsCredited = !!booking.pointsCreditedAt;
  const expectedPoints = (() => {
    const settledDeductions =
      (booking.depositRefund as { deductions?: { amount: number }[] } | null)?.deductions
        ?.reduce((s, d) => s + (d.amount || 0), 0) || 0;
    // Match the actual credit formula in handleSettleDeposit: earnable
    // spend = gross consumption − promo − points, plus the settled
    // deductions (consumed deposit + any overflow). Previously this used
    // the gross subtotal without subtracting promo/points, so the preview
    // overstated the points the button would actually credit.
    const effectiveSpend = netConsumption(booking);
    return effectiveSpend + settledDeductions;
  })();

  // Past-event check: settlement should only be done after the event.
  const settleEndDay = booking.endDate && booking.endDate !== booking.date ? booking.endDate : booking.date;
  const endMs = new Date(`${settleEndDay}T${booking.endTime}:00+08:00`).getTime();
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
    if (field === 'amount') {
      // Clamp to non-negative — admin previously typed "-450" thinking
      // it meant "deduct $450", which made totalDeductions negative
      // and inflated the refund to deposit + 450 (#HtMEinHx: refund
      // shown as \$1,450 instead of correct \$550). The UI hint
      // 「總扣費 −HK\$X」 has the minus sign already in markup; admin
      // only ever types the magnitude.
      updated[i].amount = Math.max(0, Number(val) || 0);
    } else {
      updated[i].label = val as string;
    }
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

      {alreadySettled && !amending ? (
        <div className="space-y-2 text-sm">
          {/* Detect "deductions exceed deposit" — overflow lives on
           *  booking.balanceDue when status is still 'confirmed' after
           *  settlement. Render an amber warning so admin remembers to
           *  chase the customer for the difference + record receipt
           *  via 已於線下付款 in the Outstanding Balance card above. */}
          {(booking.balanceDue ?? 0) > 0 && booking.status === 'confirmed' ? (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
              <p className="font-semibold text-amber-800 mb-1">
                ⚠️ {locale === 'zh' ? '結算完成 — 客人尚欠' : 'Settled — customer owes'} HK${(booking.balanceDue || 0).toLocaleString()}
              </p>
              <p className="text-xs text-amber-700">
                {locale === 'zh'
                  ? '扣減超出按金，請喺上面「預訂未付尾數」卡片用「已於線下付款」記錄收到嘅補款。'
                  : 'Deductions exceeded the deposit. Use 已於線下付款 on the Outstanding Balance card above once the customer pays.'}
              </p>
            </div>
          ) : (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
              <p className="font-semibold text-emerald-700 mb-1">
                {locale === 'zh' ? '✓ 已結算' : '✓ Settled'}
              </p>
              <p className="text-xs text-emerald-700">
                {locale === 'zh' ? '退款金額：' : 'Refund: '}HK${(booking.depositRefund as { amount?: number })?.amount?.toLocaleString() || 0}
              </p>
            </div>
          )}
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

          {/* Amend — admin role only. Re-opens the deduction form
            * prefilled with the stored settlement; saving overwrites it,
            * payment-aware, and reconciles loyalty points. */}
          {canAmend && (
            <button
              type="button"
              onClick={onStartAmend}
              className="w-full mt-1 px-3 py-2 rounded-xl border border-charcoal/15 bg-white text-xs font-semibold text-ink-soft hover:bg-cream flex items-center justify-center gap-1.5"
            >
              <Edit2 size={12} />
              {locale === 'zh' ? '修改結算（只限 Admin）' : 'Amend settlement (admin only)'}
            </button>
          )}
        </div>
      ) : (
        <>
          {amending && (
            <div className="bg-violet-50 border border-violet-200 rounded-xl px-3 py-2 flex items-start justify-between gap-2">
              <p className="text-xs text-violet-800 font-semibold">
                ✏️ {locale === 'zh'
                  ? '修改結算模式 — 儲存會覆蓋原有結算並自動調整退款/尾數/積分。'
                  : 'Amending — saving overwrites the stored settlement and reconciles refund / balance / points.'}
              </p>
              <button type="button" onClick={onCancelAmend} className="text-xs text-violet-700 underline whitespace-nowrap">
                {locale === 'zh' ? '取消' : 'Cancel'}
              </button>
            </div>
          )}
          {!isAfterEvent && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 flex items-start gap-1.5">
              <AlertCircle size={12} className="text-amber-600 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-800">
                {locale === 'zh'
                  ? '活動仲未結束，暫時未可以結算按金。按金要喺客人離場、場地檢查完畢後先退還，所以結算掣會喺活動結束後先開放。你可以預先剔選扣費項目。'
                  : 'The event hasn\'t ended, so the deposit can\'t be settled yet. Deposits are only refunded after the guest leaves and the venue is checked, so the button unlocks after the event ends. You can pre-select deductions now.'}
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
              <span>+{(
                // Mirror handleSettleDeposit's points formula EXACTLY:
                // effectiveSpend (rental+addOns net of promo/points)
                // + consumedDeposit (deductions ≤ security deposit)
                // + overflowPaid (deductions − security deposit, what
                //                  customer pays out of pocket).
                netConsumption(booking)
                + Math.min(total, booking.pricing.securityDeposit || 0)
                + Math.max(0, total - (booking.pricing.securityDeposit || 0))
              ).toLocaleString()} {locale === 'zh' ? '分' : 'pts'}</span>
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
            onClick={amending ? onAmendSettle : onSettle}
            disabled={settling || (!amending && !isAfterEvent)}
            title={!amending && !isAfterEvent
              ? (locale === 'zh' ? '活動結束後才可結算按金' : 'Deposit can only be settled after the event ends')
              : undefined}
            className="w-full btn-primary justify-center disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {settling ? '...' : (
              <>
                <Calculator size={14} />
                {amending
                  ? (locale === 'zh' ? '確認修改結算（覆蓋原結算）' : 'Confirm amendment (overwrites)')
                  : !isAfterEvent
                    ? (locale === 'zh' ? '活動結束後才可結算' : 'Available after the event')
                    : (locale === 'zh' ? '確認結算 · 退款 + 加積分' : 'Confirm settlement')}
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
              {existing.passcode}#
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

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleResend}
              disabled={busy}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-charcoal/15 hover:bg-white/90 text-sm font-medium disabled:opacity-50"
            >
              <Send size={14} /> {locale === 'zh' ? '重發 email 畀客人' : 'Resend email to customer'}
            </button>
            {(() => {
              // WhatsApp send button — Heidi's 2026-05-23 spec. Pre-fills
              // the message with passcode + validity window + venue name
              // so admin just confirms and sends from the WhatsApp client.
              if (!booking.whatsappPhone) return null;
              const venueName =
                venues.find((v) => v.id === booking.venueId)?.name[locale]
                || booking.venueId;
              const message = locale === 'zh'
                ? `你好！你嘅 SPACO 預訂 (${venueName} · ${booking.date} ${booking.startTime}) 嘅門鎖密碼係：\n\n🔑 ${existing.passcode}#\n\n請喺活動當日到場時，喺鎖嘅鍵盤輸入呢組密碼即可進場。如有任何問題請隨時 WhatsApp 我哋。`
                : `Hi! Your SPACO booking (${venueName} · ${booking.date} ${booking.startTime}) lock passcode:\n\n🔑 ${existing.passcode}#\n\nOn arrival, enter this code on the lock keypad to unlock. WhatsApp us anytime if you run into trouble.`;
              const waLink = buildWhatsAppLink(booking.whatsappPhone, message);
              return (
                <a
                  href={waLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#25D366] text-white text-sm font-medium hover:opacity-90"
                >
                  <MessageCircle size={14} /> {locale === 'zh' ? '經 WhatsApp 發送' : 'Send via WhatsApp'}
                </a>
              );
            })()}
          </div>
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

/** Add-on editor for PACKAGE bookings — the normal editor is disabled
 *  (flat price, no per-head recompute). Supports early-setup hours +
 *  catering via /api/admin/package-addons, which prices ADDITIVELY and
 *  rewrites the setup blocked_slot with a conflict check. */
function PackageAddOnsEditor({ booking, locale }: { booking: BookingRecord; locale: 'zh' | 'en' }) {
  const storedSetup = Math.max(0, Math.floor(booking.earlySetupHours
    ?? booking.addOns?.find((a) => a.id === 'early-setup')?.quantity ?? 0));
  const storedCatering = booking.addOns?.find((a) => a.id === 'catering')?.options;
  const [setupHours, setSetupHours] = useState<number>(storedSetup);
  const [catering, setCatering] = useState<CateringSelection | null>((storedCatering as CateringSelection) ?? null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const setupPrice = earlySetupPriceByVenue[booking.venueId] || 500;
  const setupDiff = setupPrice * (setupHours - storedSetup);
  const cateringDiff = (catering ? calcCateringTotal(catering) : 0)
    - (storedCatering ? calcCateringTotal(storedCatering) : 0);
  const totalDiff = setupDiff + cateringDiff;
  const dirty = setupHours !== storedSetup
    || JSON.stringify(catering ?? null) !== JSON.stringify((storedCatering as CateringSelection) ?? null);

  async function handleSave() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await adminApiFetch('/api/admin/package-addons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId: booking.id,
          earlySetupHours: setupHours,
          catering: catering,
        }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string; addDiff?: number; newBalanceDue?: number };
      if (!res.ok) {
        if (data.error === 'SLOT_CONFLICT') {
          setMsg(locale === 'zh'
            ? '❌ 提早入場佈置時段同上一個預訂撞咗（需預留 1 小時清潔），加唔到。'
            : '❌ Early setup window conflicts with the previous booking (1-hr cleaning buffer).');
        } else {
          setMsg((locale === 'zh' ? '❌ 儲存失敗：' : '❌ Save failed: ') + (data.error || res.status));
        }
        setSaving(false);
        return;
      }
      setMsg(locale === 'zh'
        ? `✓ 已儲存。差價 HK$${(data.addDiff || 0).toLocaleString()}，新尾數 HK$${(data.newBalanceDue || 0).toLocaleString()}。`
        : `✓ Saved. Diff HK$${(data.addDiff || 0).toLocaleString()}, new balance HK$${(data.newBalanceDue || 0).toLocaleString()}.`);
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      setMsg((locale === 'zh' ? '❌ 儲存失敗：' : '❌ Save failed: ') + (err instanceof Error ? err.message : 'unknown'));
      setSaving(false);
    }
  }

  return (
    <div className="pt-4 mt-2 border-t border-charcoal/10 space-y-3">
      <h3 className="font-semibold text-sm flex items-center gap-1.5">
        <Package size={14} className="text-accent" />
        {locale === 'zh' ? '套餐附加服務' : 'Package Add-ons'}
      </h3>
      <p className="text-xs text-ink-soft -mt-1">
        {locale === 'zh'
          ? '套餐價固定不變；差價會直接加入附加服務小計同尾數。'
          : 'Flat package price untouched; diffs add onto the add-on subtotal and balance.'}
      </p>

      {/* Early setup hours */}
      <div className="flex items-center justify-between rounded-lg border border-charcoal/10 bg-white px-3 py-2">
        <div>
          <p className="text-xs font-semibold">{locale === 'zh' ? '提早入場佈置' : 'Early Setup'}</p>
          <p className="text-[11px] text-ink-soft">${setupPrice.toLocaleString()}/{locale === 'zh' ? '小時' : 'hr'}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setSetupHours(Math.max(0, setupHours - 1))}
            disabled={setupHours <= 0}
            className="w-7 h-7 rounded-full border border-charcoal/15 flex items-center justify-center disabled:opacity-30 text-sm">−</button>
          <span className="w-10 text-center text-sm font-bold">{setupHours}{locale === 'zh' ? '小時' : 'h'}</span>
          <button type="button" onClick={() => setSetupHours(Math.min(3, setupHours + 1))}
            disabled={setupHours >= 3}
            className="w-7 h-7 rounded-full border border-charcoal/15 flex items-center justify-center disabled:opacity-30 text-sm">+</button>
        </div>
      </div>

      {/* Catering */}
      <div className="flex items-center justify-between rounded-lg border border-charcoal/10 bg-white px-3 py-2">
        <div>
          <p className="text-xs font-semibold">{locale === 'zh' ? '美食到會服務' : 'Catering'}</p>
          <p className="text-[11px] text-ink-soft">
            {catering
              ? (locale === 'zh'
                  ? `已揀 ${(catering.dishCodes || []).length} 盤 · HK$${calcCateringTotal(catering).toLocaleString()}`
                  : `${(catering.dishCodes || []).length} portions · HK$${calcCateringTotal(catering).toLocaleString()}`)
              : (locale === 'zh' ? '未有' : 'None')}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className={`px-3 py-1.5 rounded-pill text-xs font-bold ${catering ? 'bg-pink text-white' : 'bg-pink/10 text-pink hover:bg-pink/20'}`}
          >
            {catering ? (locale === 'zh' ? '編輯' : 'Edit') : (locale === 'zh' ? '揀餐單' : 'Pick menu')}
          </button>
        </div>
      </div>

      {dirty && (
        <p className="text-xs font-semibold text-ink">
          {locale === 'zh' ? '差價：' : 'Diff: '}
          <span className={totalDiff >= 0 ? 'text-emerald-700' : 'text-rose-700'}>
            {totalDiff >= 0 ? '+' : '−'}HK${Math.abs(totalDiff).toLocaleString()}
          </span>
        </p>
      )}
      {msg && <p className="text-xs">{msg}</p>}
      <button
        type="button"
        onClick={handleSave}
        disabled={!dirty || saving}
        className="w-full py-2 rounded-lg bg-gradient-pink text-white text-sm font-bold disabled:opacity-40"
      >
        {saving
          ? (locale === 'zh' ? '儲存緊…' : 'Saving…')
          : (locale === 'zh' ? '儲存套餐附加服務' : 'Save package add-ons')}
      </button>

      <CateringPickerModal
        open={modalOpen}
        initial={catering ?? undefined}
        locale={locale}
        bookingDate={booking.date}
        bookingStartTime={booking.startTime}
        bookingEndTime={booking.endTime}
        onClose={() => setModalOpen(false)}
        onSave={(sel) => { setCatering(sel); setModalOpen(false); }}
        onRemove={() => { setCatering(null); setModalOpen(false); }}
      />
    </div>
  );
}
