'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import { useAuth } from '@/contexts/AuthContext';
import { venues, getVenueBySlug } from '@/lib/venues';
import {
  addOns as ALL_ADDONS,
  calculatePricing,
  calculateDeposit,
  calculateSecurityDeposit,
  SHISHA_MAX_PIPES,
  SHISHA_STAFF_SETUP_FEE,
  getShishaFlavorLabel,
  freeDrinksVenues,
  calcShishaPrice,
} from '@/lib/pricing';
import { ALL_PACKAGES, getPackageBySlug, CATEGORY_LABEL } from '@/lib/packages';
import { createBookingDraft, buildClaimUrl } from '@/lib/bookingDrafts';
import { getHoliday } from '@/lib/hkHolidays';
import { normalizeHkPhone, isValidHkPhone, formatHkPhone } from '@/lib/whatsapp';
import {
  Calendar, Clock, Users, Plus, Minus, Link as LinkIcon, Copy, Check, ArrowLeft, MessageCircle,
  Loader2, AlertCircle, Tag, Package as PackageIcon, X as XIcon,
} from 'lucide-react';

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}
function toHHMM(min: number): string {
  // Wrap around 24h so overnight bookings (e.g. 22:00 + 5h) produce "03:00"
  // rather than "27:00". Day rollover is tracked separately via endDate.
  const wrapped = ((min % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function addDays(yyyyMmDd: string, n: number): string {
  // Reassemble from local components — toISOString() goes to UTC and would
  // land on the previous day for HKT (UTC+8) users.
  const d = new Date(`${yyyyMmDd}T00:00:00`);
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function AdminNewBookingPage() {
  const locale = useLocale() as 'zh' | 'en';
  const { user, hasPermission } = useAuth();

  // ── Booking content ───────────────────────────
  const [venueId, setVenueId] = useState<string>('cwb');
  const [date, setDate] = useState<string>('');
  const [startTime, setStartTime] = useState<string>('14:00');
  const [hours, setHours] = useState<number>(4);
  const [adultCount, setAdultCount] = useState<number>(15);
  const [childCount, setChildCount] = useState<number>(0);
  const guestCount = adultCount + childCount;
  const adultEquiv = adultCount + 0.5 * childCount;
  const [addOnQty, setAddOnQty] = useState<Record<string, number>>({});
  // Admin-defined custom add-ons (name + price). Same shape as on the
  // booking-edit page; entries get a `custom-<timestamp>` id and the
  // customName + customPrice live on options. Customers never see
  // these — staff use them for ad-hoc charges like 「4位代燒員」.
  const [customAddOns, setCustomAddOns] = useState<Array<{ id: string; name: string; price: number }>>([]);
  const [hasBYOFood, setHasBYOFood] = useState<boolean>(false);

  // Shisha-specific options — flavors are picked per head; pipes are
  // capped by SHISHA_MAX_PIPES (currently 2). Admin can leave this
  // empty when issuing the link; the customer / admin can fill in
  // flavors later from /admin/bookings/[id] without invalidating the
  // booking.
  const [shishaOptions, setShishaOptions] = useState<{
    pipes: number;
    flavors: string[];
    staffSetup: boolean;
  }>({ pipes: 1, flavors: [], staffSetup: false });

  // ── Package selector ───────────────────────────
  // null = à-la-carte (default). When set to a slug, venue + hours lock
  // to the package and the pricing card replaces the per-hour subtotal
  // with the fixed package fee.
  const [packageSlug, setPackageSlug] = useState<string | null>(null);

  // ── Promo code (validated via /api/promo/validate) ────────────────
  const [promoInput, setPromoInput] = useState('');
  const [promoChecking, setPromoChecking] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [promo, setPromo] = useState<{
    codeId: string;
    code: string;
    type: 'percent' | 'cash' | 'free_drinks' | 'per_pax';
    amount: number;
    freeDrinks: boolean;
  } | null>(null);

  // ── Customer info ───────────────────────────
  const [customerName, setCustomerName] = useState('');
  const [customerWhatsapp, setCustomerWhatsapp] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [notes, setNotes] = useState('');

  // ── Submit state ───────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Default the date to tomorrow on mount (avoids past-date submission)
  useEffect(() => {
    if (!date) {
      const t = new Date();
      t.setDate(t.getDate() + 1);
      setDate(t.toISOString().split('T')[0]);
    }
  }, [date]);

  // Permission gate
  if (!hasPermission('bookings')) {
    return (
      <div className="text-center py-20 text-ink-soft">
        {locale === 'zh' ? '無權限存取' : 'Access Denied'}
      </div>
    );
  }

  const venue = venues.find((v) => v.id === venueId);
  // Match the customer-side rule (book/[branchSlug]/page.tsx) EXACTLY:
  // Fri / Sat / public holiday / eve-of-public-holiday → weekend rate
  // ($58/pax/hr). Sun + Mon–Thu remain weekday ($50). The eve check
  // assembles next day from LOCAL date components (not toISOString,
  // which can roll back to UTC and miss the holiday by one day) — so
  // e.g. 2026-06-30 correctly resolves to 2026-07-01 (HKSAR Day,
  // public holiday) and lands on the weekend tier.
  const isWeekend = useMemo(() => {
    if (!date) return false;
    const day = new Date(`${date}T00:00:00`).getDay();
    if (day === 5 || day === 6) return true;
    if (getHoliday(date)?.type === 'public') return true;
    const next = new Date(`${date}T00:00:00`);
    next.setDate(next.getDate() + 1);
    const nextStr = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
    if (getHoliday(nextStr)?.type === 'public') return true;
    return false;
  }, [date]);

  // Human-readable reason for the peak chip (PH name / "eve of PH" /
  // Fri-Sat). Mirrors the customer-side `peakReason` so the admin
  // sees the same justification that gets surfaced to the customer.
  const peakReason = useMemo<
    null | { kind: 'friday' | 'saturday' | 'holiday' | 'holiday-eve'; holidayName?: string }
  >(() => {
    if (!date) return null;
    const day = new Date(`${date}T00:00:00`).getDay();
    if (day === 5) return { kind: 'friday' };
    if (day === 6) return { kind: 'saturday' };
    const todayH = getHoliday(date);
    if (todayH?.type === 'public') return { kind: 'holiday', holidayName: todayH.name[locale] };
    const next = new Date(`${date}T00:00:00`);
    next.setDate(next.getDate() + 1);
    const nextStr = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
    const nextH = getHoliday(nextStr);
    if (nextH?.type === 'public') return { kind: 'holiday-eve', holidayName: nextH.name[locale] };
    return null;
  }, [date, locale]);

  // Sync shisha flavor array length with the chosen head count so
  // adding/removing a head doesn't leave a dangling entry.
  const shishaHeads = addOnQty['shisha'] || 0;
  useEffect(() => {
    if (shishaHeads === 0) return;
    setShishaOptions((prev) => {
      const flavors = Array.from({ length: shishaHeads }, (_, i) => prev.flavors[i] || '');
      const pipes = Math.min(SHISHA_MAX_PIPES, Math.max(1, Math.min(prev.pipes, shishaHeads)));
      return { ...prev, pipes, flavors };
    });
  }, [shishaHeads]);

  // Pricing — for the shisha add-on we attach the per-head flavor /
  // pipe / staff-setup options so calculatePricing applies the right
  // tier and the resulting BookingRecord can render full breakdowns
  // later. Flavor strings can be empty (admin postpones the pick);
  // empty entries are dropped from the saved options array so the
  // booking detail page can show a clean "awaiting flavors" hint.
  const selectedAddOnList = [
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

  // Resolve the picked package (if any) so the venue + hours lock-ins
  // and the override pricing logic share a single source of truth.
  const selectedPackage = useMemo(
    () => (packageSlug ? getPackageBySlug(packageSlug) : null),
    [packageSlug],
  );

  // When a package is picked, force the booking to its locked venue + duration.
  useEffect(() => {
    if (!selectedPackage) return;
    if (venueId !== selectedPackage.venueId) setVenueId(selectedPackage.venueId);
    if (hours !== selectedPackage.durationHours) setHours(selectedPackage.durationHours);
  }, [selectedPackage, venueId, hours]);

  const pricing = venue
    ? calculatePricing(venue, isWeekend, hours, guestCount, selectedAddOnList, childCount)
    : null;

  // Mirror the customer-facing pricing flow exactly so admin-issued
  // links match what the customer sees on the confirm page.
  //   subtotal       = rental + add-ons (+ package fee + extra-pax)
  //   securityDeposit = tiered ($1k/2k/4k) — package overrides with its
  //                    own deposit field (e.g. corporate-tst = $2k)
  //   grandTotal     = subtotal + securityDeposit
  //   deposit        = full grandTotal if ≤ $10k, else 50% (upfront pay-now)
  const extraPaxCharge = (selectedPackage?.basePax != null && selectedPackage?.extraPaxPrice != null)
    ? Math.max(0, guestCount - selectedPackage.basePax) * selectedPackage.extraPaxPrice
    : 0;
  const subtotalAfterPackage = pricing
    ? (selectedPackage
        ? selectedPackage.price + extraPaxCharge + pricing.addOnTotal
        : pricing.subtotal)
    : 0;
  const effectiveSubtotal = Math.max(0, subtotalAfterPackage - (promo?.amount || 0));
  // Deposit tier is keyed off the PRE-promo rental cost (subtotalAfterPackage),
  // not the post-promo effective subtotal. Otherwise a $250 promo on a $4,250
  // booking drops the effective subtotal to exactly $4,000, which falls back
  // into the lower $1k tier per the "> 4000" threshold — even though the
  // actual venue/add-on cost still warrants the $2k tier. The promo is a
  // discount on what the customer PAYS, not on the rental risk we hold.
  const securityDeposit = selectedPackage?.deposit ?? calculateSecurityDeposit(subtotalAfterPackage);
  const grandTotal = effectiveSubtotal + securityDeposit;
  const deposit = calculateDeposit(grandTotal);
  const balanceDue = Math.max(0, grandTotal - deposit);

  const endTime = useMemo(() => {
    if (!startTime) return '';
    return toHHMM(toMinutes(startTime) + hours * 60);
  }, [startTime, hours]);

  // Day rollover when (start + hours) crosses midnight. Tracked separately
  // from endTime so the backend can split blocked_slots correctly.
  const endDate = useMemo(() => {
    if (!startTime || !date) return undefined;
    const totalMin = toMinutes(startTime) + hours * 60;
    const dayOffset = Math.floor(totalMin / (24 * 60));
    return dayOffset > 0 ? addDays(date, dayOffset) : undefined;
  }, [startTime, hours, date]);

  const branchSlug = useMemo(() => {
    return venue?.slug || '';
  }, [venue]);

  // Validation
  const whatsappValid = !customerWhatsapp || isValidHkPhone(customerWhatsapp);
  const canSubmit = !!user && !!date && !!startTime && hours > 0 && guestCount > 0 && !!venue && !!pricing && whatsappValid && !submitting;

  async function handleApplyPromo() {
    const code = promoInput.trim().toUpperCase();
    if (!code) return;
    setPromoChecking(true);
    setPromoError(null);
    try {
      // For free-drinks promos we tell the server to project the drinks cost
      // even if the cart doesn't include drinks — admin can pre-apply the
      // benefit and the customer claim flow will add drinks automatically.
      const drinksInCart = selectedAddOnList.some((a) => a.id === 'drinks');
      const projectedDrinksCost = drinksInCart ? 0 : Math.round(25 * adultEquiv);
      const res = await fetch('/api/promo/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          subtotal: subtotalAfterPackage,
          adultEquiv: adultEquiv || 1,
          drinksCost: drinksInCart ? Math.round(25 * adultEquiv) : projectedDrinksCost,
          venueId,
          // No userId here — admin is creating, not the customer.
        }),
      });
      const data = await res.json();
      if (!data.valid) {
        setPromo(null);
        setPromoError(
          data.reason === 'not_found'   ? (locale === 'zh' ? '優惠碼不存在' : 'Code not found')
          : data.reason === 'disabled'  ? (locale === 'zh' ? '優惠碼已暫停' : 'Code disabled')
          : data.reason === 'expired'   ? (locale === 'zh' ? '優惠碼已過期' : 'Code expired')
          : data.reason === 'not_started' ? (locale === 'zh' ? `優惠由 ${data.startDate} 開始` : `Starts ${data.startDate}`)
          : data.reason === 'wrong_venue' ? (locale === 'zh' ? '此優惠碼唔適用於依間分店' : 'Code not valid at this branch')
          : data.reason === 'sold_out'  ? (locale === 'zh' ? '優惠碼已用完' : 'Code sold out')
          : data.reason === 'min_subtotal' ? (locale === 'zh' ? `需滿 HK$${data.minSubtotal}` : `Min subtotal HK$${data.minSubtotal}`)
          : (locale === 'zh' ? `優惠碼無效（${data.reason || 'unknown'}）` : `Invalid code (${data.reason || 'unknown'})`)
        );
        return;
      }
      setPromo({
        codeId: data.codeId,
        code: data.code,
        type: data.type,
        amount: data.amount,
        freeDrinks: data.freeDrinks,
      });
      // free_drinks promo → auto-tick the drinks add-on so the saved
      // draft includes it. Mirrors the customer confirm page: when the
      // promo grants free drinks, the drinks add-on is added to the
      // cart at zero net cost (cost goes into pricing.addOnTotal, then
      // the promo's discount of equal value cancels it). Skipped for
      // venues that already bundle drinks (TST) — no add-on to add.
      if (data.freeDrinks
        && !drinksInCart
        && !freeDrinksVenues.includes(venueId)
      ) {
        setAddOnQty((prev) => ({ ...prev, drinks: 1 }));
      }
    } catch (err) {
      setPromoError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setPromoChecking(false);
    }
  }

  const handleSubmit = async () => {
    if (!canSubmit || !user || !venue || !pricing) return;
    setSubmitting(true);
    try {
      const id = await createBookingDraft({
        createdBy: user.uid,
        venueId,
        branchSlug,
        date,
        startTime,
        endTime,
        ...(endDate ? { endDate } : {}),
        hours,
        guestCount,
        adultCount,
        childCount,
        isWeekend,
        addOns: selectedAddOnList,
        hasBYOFood,
        pricing: {
          baseCharge: pricing.baseCharge,
          addOnTotal: pricing.addOnTotal,
          // PRE-promo subtotal (baseCharge + addOnTotal + package extras).
          // This is the convention every other flow uses: venue page
          // (customer self-booking), updateBookingDateTime, claim page,
          // confirm page all subtract `promoDiscount` from the stored
          // subtotal at display / deposit-calc time. Storing POST-promo
          // here (commit c2e617a) caused #QotleDvT to undercharge by the
          // promo amount: claim+confirm pages subtracted promo a SECOND
          // time, so pricing.deposit was computed as $7,550 instead of
          // $7,800 and Stripe charged $250 short. Display formatting for
          // 小計 happens in admin/bookings/[id] which now subtracts promo
          // at render time — same as the customer-facing breakdown.
          subtotal: subtotalAfterPackage,
          securityDeposit,
          deposit,
        },
        ...(customerName ? { customerName } : {}),
        ...(customerWhatsapp ? { customerWhatsapp: normalizeHkPhone(customerWhatsapp) || customerWhatsapp } : {}),
        ...(customerEmail ? { customerEmail } : {}),
        ...(notes ? { notes } : {}),
        ...(packageSlug ? { packageSlug } : {}),
        ...(promo
          ? {
              promoCode: promo.code,
              promoCodeId: promo.codeId,
              promoDiscount: promo.amount,
              ...(promo.freeDrinks ? { promoFreeDrinksCost: promo.amount } : {}),
            }
          : {}),
      });
      setDraftId(id);
    } catch (err) {
      alert((locale === 'zh' ? '建立預訂失敗：' : 'Failed to create draft: ') + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSubmitting(false);
    }
  };

  const claimUrl = draftId ? buildClaimUrl(draftId, locale) : '';

  const handleCopy = async () => {
    if (!claimUrl) return;
    try {
      await navigator.clipboard.writeText(claimUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Fallback
      window.prompt(locale === 'zh' ? '複製此連結' : 'Copy this link', claimUrl);
    }
  };

  const whatsappPrefilled = useMemo(() => {
    if (!claimUrl) return '';
    const customerLabel = customerName || (locale === 'zh' ? '你' : 'you');
    const message =
      locale === 'zh'
        ? `Hi ${customerLabel}！我哋幫你預備好咗 SPACO 嘅預訂，請撳呢條 link 確認同付款：\n${claimUrl}\n\n⚠️ 重要事項：\n• 連結於 8 小時後失效\n• 本店不設任何留位形式，一切以付款作確認，先到先得\n• 如所訂之日子時間已被其他客人預訂，連結會即時失效\n\n如有問題請隨時 WhatsApp 我哋。`
        : `Hi ${customerLabel}! We've prepared your SPACO booking. Please tap this link to confirm and pay:\n${claimUrl}\n\n⚠️ Important:\n• This link expires in 8 hours\n• We do not hold slots — first to pay confirms the booking\n• If someone else books this slot first, the link will be invalidated immediately\n\nLet us know if you have any questions.`;
    if (customerWhatsapp && isValidHkPhone(customerWhatsapp)) {
      const e164 = normalizeHkPhone(customerWhatsapp) || customerWhatsapp;
      const num = e164.replace(/^\+/, '');
      return `https://wa.me/${num}?text=${encodeURIComponent(message)}`;
    }
    return `https://wa.me/?text=${encodeURIComponent(message)}`;
  }, [claimUrl, customerName, customerWhatsapp, locale]);

  // ───────────────────────────────────────
  // Success view (draft created)
  // ───────────────────────────────────────
  if (draftId) {
    return (
      <div className="max-w-2xl">
        <div className="mb-6">
          <Link href="/admin/bookings" className="inline-flex items-center gap-2 text-sm text-ink-soft hover:text-pink">
            <ArrowLeft size={16} />
            {locale === 'zh' ? '返回預訂列表' : 'Back to bookings'}
          </Link>
        </div>

        <div className="glass-card p-7 md:p-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-pink flex items-center justify-center text-white shadow-glow mb-5">
            <Check size={26} />
          </div>
          <h1 className="text-2xl font-bold font-display text-ink mb-2">
            {locale === 'zh' ? '預訂連結已產生' : 'Booking link created'}
          </h1>
          <p className="text-ink-soft mb-3">
            {locale === 'zh'
              ? '將條 link 經 WhatsApp 發畀客人，佢撳完登入就可以確認 + 付款。'
              : 'Send this link to the customer via WhatsApp. They tap, log in, confirm, and pay.'}
          </p>
          <div className="mb-6 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-1">
            <p className="font-bold">⚠️ {locale === 'zh' ? '客人會睇到以下警示：' : 'Customer will see this warning:'}</p>
            <p>• {locale === 'zh' ? '連結於 8 小時後失效' : 'Link expires in 8 hours'}</p>
            <p>• {locale === 'zh' ? '本店不設任何留位形式，一切以付款作確認，先到先得' : 'No slot reservation — first to pay confirms'}</p>
            <p>• {locale === 'zh' ? '如所訂之日子時間已被其他客人預訂，連結會即時失效' : 'Link invalidates immediately if the slot is booked by someone else'}</p>
          </div>

          <label className="text-xs uppercase tracking-wider font-bold text-ink-soft mb-2 block">
            {locale === 'zh' ? '客人專屬連結' : 'Customer link'}
          </label>
          <div className="flex flex-col sm:flex-row gap-2 mb-6">
            <input
              type="text"
              readOnly
              value={claimUrl}
              className="flex-1 px-3 py-2.5 rounded-xl border border-charcoal/15 text-sm font-mono bg-white/80 select-all"
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              onClick={handleCopy}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-accent text-white text-sm font-semibold hover:bg-accent/90"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? (locale === 'zh' ? '已複製' : 'Copied') : (locale === 'zh' ? '複製' : 'Copy')}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <a
              href={whatsappPrefilled}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-emerald-500 text-white font-semibold hover:bg-emerald-600 transition-colors"
            >
              <MessageCircle size={16} />
              {locale === 'zh' ? '經 WhatsApp 發送' : 'Send via WhatsApp'}
            </a>
            <button
              onClick={() => {
                setDraftId(null);
                setCopied(false);
              }}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-white/80 border-2 border-charcoal/15 text-ink font-semibold hover:bg-white"
            >
              <Plus size={16} />
              {locale === 'zh' ? '建立另一個' : 'Create another'}
            </button>
          </div>

          {/* Summary recap */}
          <div className="mt-6 pt-5 border-t border-charcoal/10 text-sm text-ink-soft space-y-1">
            <p><strong className="text-ink">{venue?.name[locale]}</strong></p>
            <p>{date} · {startTime}–{endTime} ({hours}h) · {guestCount} {locale === 'zh' ? '人' : 'pax'}</p>
            {customerName && <p>{locale === 'zh' ? '客人：' : 'Customer: '}{customerName}{customerWhatsapp ? ` · ${formatHkPhone(customerWhatsapp)}` : ''}</p>}
            <p className="text-ink font-semibold pt-1">
              HK${effectiveSubtotal.toLocaleString()} + HK${securityDeposit.toLocaleString()} {locale === 'zh' ? '可退按金' : 'refundable deposit'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ───────────────────────────────────────
  // Form view
  // ───────────────────────────────────────
  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <Link href="/admin/bookings" className="inline-flex items-center gap-2 text-sm text-ink-soft hover:text-pink">
          <ArrowLeft size={16} />
          {locale === 'zh' ? '返回預訂列表' : 'Back to bookings'}
        </Link>
      </div>

      <div className="mb-6">
        <span className="chip mb-3"><LinkIcon size={12} className="text-pink" /> {locale === 'zh' ? '替客人建立預訂' : 'Staff-initiated booking'}</span>
        <h1 className="text-heading font-display">
          <span className="text-ink">{locale === 'zh' ? '新增 ' : 'New '}</span>
          <span className="text-gradient-pink">{locale === 'zh' ? '預訂連結' : 'Booking Link'}</span>
        </h1>
        <p className="text-ink-soft mt-3 max-w-2xl">
          {locale === 'zh'
            ? '幫 WhatsApp 客人預先填好預訂內容，產生條獨立 link 畀佢確認 + 付款。客人撳 link 之後會自動綁定佢個會員 account。'
            : 'Pre-fill a booking for a WhatsApp customer. Generates a unique link they tap to confirm and pay — automatically bound to their member account.'}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Package selector. À-la-carte default; picking a package locks
              the venue + duration and replaces the per-hour subtotal with
              the fixed package fee. */}
          <div className="glass-card p-6">
            <h3 className="text-base font-bold mb-3 text-ink flex items-center gap-2">
              <PackageIcon size={16} className="text-pink" />
              {locale === 'zh' ? '套餐（可選）' : 'Package (optional)'}
            </h3>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setPackageSlug(null)}
                className={`px-3 py-2 rounded-xl text-sm font-medium transition-all border-2 ${
                  !packageSlug
                    ? 'bg-gradient-pink text-white border-transparent shadow-glow'
                    : 'bg-white/85 text-ink border-charcoal/15 hover:border-pink/60'
                }`}
              >
                {locale === 'zh' ? '自訂預訂（à la carte）' : 'Custom (à la carte)'}
              </button>
              {ALL_PACKAGES.map((p) => (
                <button
                  key={p.slug}
                  type="button"
                  onClick={() => setPackageSlug(p.slug)}
                  className={`px-3 py-2 rounded-xl text-sm font-medium transition-all border-2 ${
                    packageSlug === p.slug
                      ? 'bg-gradient-pink text-white border-transparent shadow-glow'
                      : 'bg-white/85 text-ink border-charcoal/15 hover:border-pink/60'
                  }`}
                >
                  {p.name[locale]}
                  <span className="ml-2 text-[10px] opacity-80">${p.price.toLocaleString()}</span>
                </button>
              ))}
            </div>
            {selectedPackage && (
              <p className="text-xs text-ink-soft mt-3">
                {locale === 'zh'
                  ? `已鎖定：${selectedPackage.name.zh}．${selectedPackage.durationHours} 小時．場地 ${venue?.name.zh}`
                  : `Locked: ${selectedPackage.name.en} · ${selectedPackage.durationHours}h · ${venue?.name.en}`}
              </p>
            )}
          </div>

          {/* Venue */}
          <div className="glass-card p-6">
            <h3 className="text-base font-bold mb-4 text-ink">
              {locale === 'zh' ? '揀場地' : 'Venue'}
              {selectedPackage && (
                <span className="ml-2 text-xs font-normal text-ink-soft">
                  {locale === 'zh' ? '（套餐已鎖定）' : '(locked by package)'}
                </span>
              )}
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {venues.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  disabled={!!selectedPackage}
                  onClick={() => setVenueId(v.id)}
                  className={`px-3 py-2.5 rounded-xl text-sm font-semibold transition-all border-2 ${
                    venueId === v.id
                      ? 'bg-gradient-pink text-white border-transparent shadow-glow'
                      : 'bg-white/85 text-ink border-charcoal/15 hover:border-pink/60'
                  } disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  {v.name[locale]}
                </button>
              ))}
            </div>
          </div>

          {/* Date / time */}
          <div className="glass-card p-6 space-y-4">
            <h3 className="text-base font-bold text-ink flex items-center gap-2">
              <Calendar size={16} className="text-pink" />
              {locale === 'zh' ? '日期 + 時間' : 'Date + time'}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-ink-soft mb-1 block">{locale === 'zh' ? '日期' : 'Date'}</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white/85"
                />
              </div>
              <div>
                <label className="text-xs text-ink-soft mb-1 block">{locale === 'zh' ? '開始時間' : 'Start time'}</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  step={1800}
                  className="w-full px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white/85"
                />
              </div>
              <div>
                <label className="text-xs text-ink-soft mb-1 block">{locale === 'zh' ? '時數' : 'Hours'}</label>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => setHours(Math.max(1, hours - 1))} className="p-2 rounded-lg bg-white/85 border-2 border-charcoal/15"><Minus size={14} /></button>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={hours}
                    onChange={(e) => setHours(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full px-2 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white/85 text-center"
                  />
                  <button type="button" onClick={() => setHours(Math.min(12, hours + 1))} className="p-2 rounded-lg bg-white/85 border-2 border-charcoal/15"><Plus size={14} /></button>
                </div>
              </div>
            </div>
            {endTime && (
              <p className="text-xs text-ink-soft">
                {locale === 'zh' ? '時段：' : 'Session: '}<span className="font-bold text-ink">{startTime}–{endTime}{endDate ? (locale === 'zh' ? `（翌日 ${endDate}）` : ` (next day ${endDate})`) : ''}</span>
                {isWeekend && <span className="ml-2 chip text-[10px]">{locale === 'zh' ? '週末/假日價 $58/位/h' : 'Weekend rate $58/pax/h'}</span>}
              </p>
            )}
            {/* Surface WHY this date is on weekend rate — esp. for the
             *  non-obvious cases like 2026-06-30 (Tue, eve of HKSAR Day)
             *  where admin might otherwise expect the $50 weekday rate. */}
            {peakReason && peakReason.kind === 'holiday' && (
              <p className="mt-2 text-xs text-rose-600 font-medium">
                {locale === 'zh' ? `📅 公眾假期：${peakReason.holidayName}` : `📅 Public Holiday: ${peakReason.holidayName}`}
              </p>
            )}
            {peakReason && peakReason.kind === 'holiday-eve' && (
              <p className="mt-2 text-xs text-rose-600 font-medium">
                {locale === 'zh' ? `🎉 假期前夕：明日為${peakReason.holidayName}` : `🎉 Holiday Eve: Tomorrow is ${peakReason.holidayName}`}
              </p>
            )}
          </div>

          {/* Guests — adults + children split */}
          <div className="glass-card p-6">
            <h3 className="text-base font-bold mb-4 text-ink flex items-center gap-2">
              <Users size={16} className="text-pink" />
              {locale === 'zh' ? '人數' : 'Guests'}
            </h3>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">{locale === 'zh' ? '成人' : 'Adults'}</p>
                  <p className="text-[11px] text-ink-soft">{locale === 'zh' ? '10 歲或以上' : 'Age 10+'}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => setAdultCount(Math.max(0, adultCount - 1))} className="p-1.5 rounded-md bg-white/80 border border-charcoal/15"><Minus size={12} /></button>
                  <input
                    type="number"
                    min={0}
                    value={adultCount}
                    onChange={(e) => setAdultCount(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-16 px-2 py-1.5 rounded-md border border-charcoal/15 text-sm bg-white/80 text-center font-bold"
                  />
                  <button type="button" onClick={() => setAdultCount(adultCount + 1)} className="p-1.5 rounded-md bg-white/80 border border-charcoal/15"><Plus size={12} /></button>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-white/40 pt-3">
                <div>
                  <p className="text-sm font-semibold">{locale === 'zh' ? '小童' : 'Children'}</p>
                  <p className="text-[11px] text-ink-soft">{locale === 'zh' ? '1-9 歲（半價）' : 'Age 1–9 (half price)'}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => setChildCount(Math.max(0, childCount - 1))} className="p-1.5 rounded-md bg-white/80 border border-charcoal/15"><Minus size={12} /></button>
                  <input
                    type="number"
                    min={0}
                    value={childCount}
                    onChange={(e) => setChildCount(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-16 px-2 py-1.5 rounded-md border border-charcoal/15 text-sm bg-white/80 text-center font-bold"
                  />
                  <button type="button" onClick={() => setChildCount(childCount + 1)} className="p-1.5 rounded-md bg-white/80 border border-charcoal/15"><Plus size={12} /></button>
                </div>
              </div>
            </div>

            <div className="mt-3 text-xs text-ink-soft flex items-center justify-between">
              <span>{locale === 'zh' ? `總人數 ${guestCount}` : `Total ${guestCount}`}</span>
              <span>{locale === 'zh' ? `計價 ${adultEquiv} 人` : `Charged ${adultEquiv}`}</span>
            </div>
            {venue && adultEquiv < venue.capacity.min && (
              <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                <AlertCircle size={12} />
                {locale === 'zh'
                  ? `此場地最低消費為 ${venue.capacity.min} 人計價（小童 ½）`
                  : `Min charge ${venue.capacity.min} adult-equiv (kids ½)`}
              </p>
            )}
          </div>

          {/* Add-ons */}
          <div className="glass-card p-6">
            <h3 className="text-base font-bold mb-4 text-ink">{locale === 'zh' ? '加購項目（可選）' : 'Add-ons (optional)'}</h3>
            <div className="space-y-2">
              {ALL_ADDONS.map((a) => {
                const qty = addOnQty[a.id] || 0;
                const max = a.maxQuantity ?? (a.unit === 'person' ? 1 : 5);
                const isShisha = a.id === 'shisha';
                // Per-head add-ons (BBQ packages / hotpot packages /
                // drinks) MUST charge against the full guest count —
                // calculatePricing already multiplies by adultEquiv, so
                // the stored quantity is just a presence flag. Render
                // them as a checkbox to remove the misleading "×N"
                // affordance. Shisha is unit:'item' but uses its own
                // custom pipes/flavors UI below, so keep it on the
                // qty stepper branch.
                const isPerHead = a.unit === 'person';
                return (
                  <div key={a.id} className="rounded-xl bg-white/40 border border-white/60 overflow-hidden">
                    <div className="flex items-center gap-3 p-3">
                      <div className="flex-1">
                        <p className="font-semibold text-sm text-ink">{a.name[locale]}</p>
                        <p className="text-xs text-ink-soft">{a.description?.[locale] || ''}</p>
                      </div>
                      {isPerHead ? (
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={qty > 0}
                            onChange={(e) =>
                              setAddOnQty({ ...addOnQty, [a.id]: e.target.checked ? 1 : 0 })
                            }
                            className="w-4 h-4 accent-accent"
                          />
                          <span className="text-xs text-ink-soft">
                            {qty > 0
                              ? (locale === 'zh' ? `全部 ${guestCount} 人` : `All ${guestCount} guests`)
                              : (locale === 'zh' ? '勾選即按人數' : 'Tick to apply per-head')}
                          </span>
                        </label>
                      ) : (
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={() => setAddOnQty({ ...addOnQty, [a.id]: Math.max(0, qty - 1) })} className="p-1.5 rounded-md bg-white/80 border border-charcoal/15"><Minus size={12} /></button>
                          <span className="w-7 text-center text-sm font-bold">{qty}</span>
                          <button type="button" onClick={() => setAddOnQty({ ...addOnQty, [a.id]: Math.min(max, qty + 1) })} className="p-1.5 rounded-md bg-white/80 border border-charcoal/15"><Plus size={12} /></button>
                        </div>
                      )}
                    </div>

                    {/* Shisha sub-options: pipes (1 or 2) + per-head flavor +
                     *  staff setup. Mirrors the customer booking page so
                     *  admin-issued links produce identical pricing breakdown
                     *  + Booking record. Leaving flavors empty is OK — admin
                     *  can postpone the choice and fill it in later from
                     *  /admin/bookings/[id]. */}
                    {isShisha && qty > 0 && a.variants && (
                      <div className="border-t border-white/60 p-3 space-y-3 bg-white/30">
                        <div className="flex items-center gap-3 text-xs">
                          <span className="text-ink-soft font-semibold uppercase tracking-wider">
                            {locale === 'zh' ? '水煙支數' : 'Pipes'}
                          </span>
                          <div className="flex gap-1">
                            {[1, 2].slice(0, SHISHA_MAX_PIPES).map((p) => (
                              <button
                                key={p}
                                type="button"
                                onClick={() =>
                                  setShishaOptions((prev) => ({
                                    ...prev,
                                    pipes: Math.min(p, qty),
                                  }))
                                }
                                className={`px-3 py-1 rounded-md text-xs font-semibold border transition ${
                                  shishaOptions.pipes === Math.min(p, qty)
                                    ? 'bg-accent/15 border-accent text-accent'
                                    : 'bg-white border-charcoal/15 text-ink-soft hover:bg-cream'
                                }`}
                                disabled={p > qty}
                              >
                                {p}
                              </button>
                            ))}
                          </div>
                          <span className="text-[11px] text-ink-soft">
                            {locale === 'zh'
                              ? `${qty} 個煙頭（自助 DIY 換頭）`
                              : `${qty} head${qty > 1 ? 's' : ''} (DIY swap)`}
                          </span>
                        </div>

                        <div>
                          <p className="text-xs text-ink-soft font-semibold uppercase tracking-wider mb-1.5">
                            {locale === 'zh' ? '揀煙頭口味（每個頭一款）' : 'Flavor per head'}
                            <span className="text-[10px] font-normal normal-case text-ink-soft/70 ml-2">
                              {locale === 'zh' ? '可留空，之後喺預訂管理補加' : 'Optional — can fill in later'}
                            </span>
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                            {Array.from({ length: qty }).map((_, headIndex) => (
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
                                    {locale === 'zh' ? '— 未揀（之後補）—' : '— Not picked —'}
                                  </option>
                                  {a.variants!.map((v) => (
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
                              ? `人手 setup +HK$${SHISHA_STAFF_SETUP_FEE}`
                              : `Staff setup +HK$${SHISHA_STAFF_SETUP_FEE}`}
                          </span>
                        </label>

                        {/* Live shisha subtotal — same formula as the
                         *  customer booking page so admin sees the exact
                         *  number ($390 / $640 / $750 / +180 setup, etc.)
                         *  the customer will pay before saving. */}
                        <div className="flex items-center justify-between pt-2 border-t border-charcoal/10 text-xs">
                          <span className="text-ink-soft">
                            {locale === 'zh' ? 'Shisha 小計' : 'Shisha subtotal'}
                          </span>
                          <span className="font-bold text-ink">
                            HK${calcShishaPrice(
                              shishaOptions.pipes,
                              qty,
                              shishaOptions.staffSetup,
                            ).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Custom add-ons — admin-defined name + flat price. Each
             *  entry gets a `custom-<timestamp>-<idx>` id. customName +
             *  customPrice are stored on options; pricing.ts handles
             *  them via the `custom-` prefix branch. */}
            <div className="mt-4 pt-3 border-t border-dashed border-charcoal/15">
              <div className="flex items-center justify-between mb-2">
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
                    : 'No custom items. Click "Add" to define one.'}
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
                        placeholder={locale === 'zh' ? '項目名稱（例：4位代燒員）' : 'Item name'}
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
                      {/* 「免費」 toggle — sets price to 0 in one click,
                       *  so CS can mark a comp without typing 0 manually
                       *  (Heidi 2026-06-22: CS promised customer some
                       *  freebies and needed an explicit "免費" option). */}
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

            <label className="flex items-center gap-2 mt-4 text-sm cursor-pointer">
              <input type="checkbox" checked={hasBYOFood} onChange={(e) => setHasBYOFood(e.target.checked)} className="w-4 h-4" />
              <span className="text-ink-soft">{locale === 'zh' ? '客人會自攜食物（BYO）' : 'Customer is bringing their own food (BYO)'}</span>
            </label>
          </div>

          {/* Promo code — validated against /api/promo/validate just like
              the customer confirm page. Applied promo persists to the draft
              so the customer sees it pre-applied at claim time. */}
          <div className="glass-card p-6 space-y-3">
            <h3 className="text-base font-bold text-ink flex items-center gap-2">
              <Tag size={16} className="text-pink" />
              {locale === 'zh' ? '優惠碼（可選）' : 'Promo code (optional)'}
            </h3>
            {promo ? (
              <div className="flex items-start justify-between gap-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                <div className="text-sm">
                  <p className="font-bold text-emerald-900 font-mono">{promo.code}</p>
                  <p className="text-xs text-emerald-700 mt-0.5">
                    {locale === 'zh' ? `折扣：HK$${promo.amount.toLocaleString()}` : `Discount: HK$${promo.amount.toLocaleString()}`}
                    {promo.freeDrinks ? (locale === 'zh' ? '．免費飲品' : ' · free drinks') : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => { setPromo(null); setPromoInput(''); setPromoError(null); }}
                  className="p-1 rounded-md text-ink-soft hover:bg-white"
                  aria-label="Clear promo"
                >
                  <XIcon size={14} />
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  value={promoInput}
                  onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                  placeholder={locale === 'zh' ? '輸入優惠碼' : 'Enter code'}
                  className="flex-1 px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white/85 font-mono tracking-wider"
                />
                <button
                  type="button"
                  onClick={handleApplyPromo}
                  disabled={promoChecking || !promoInput.trim()}
                  className="px-4 py-2 rounded-xl bg-gradient-pink text-white text-sm font-semibold disabled:opacity-40"
                >
                  {promoChecking ? <Loader2 size={14} className="animate-spin" /> : (locale === 'zh' ? '應用' : 'Apply')}
                </button>
              </div>
            )}
            {promoError && <p className="text-xs text-rose-500">{promoError}</p>}
          </div>

          {/* Customer info */}
          <div className="glass-card p-6 space-y-3">
            <h3 className="text-base font-bold text-ink">{locale === 'zh' ? '客人資料（選填）' : 'Customer info (optional)'}</h3>
            <p className="text-xs text-ink-soft -mt-2">
              {locale === 'zh' ? '只係畀 staff 內部記錄。客人撳 link 登入時，佢會用自己嘅電話 / email。' : 'For internal staff record only. Customer enters their own contact when they sign in.'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder={locale === 'zh' ? '客人姓名' : 'Customer name'} className="px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white/85" />
              <input value={customerWhatsapp} onChange={(e) => setCustomerWhatsapp(e.target.value)} placeholder={locale === 'zh' ? 'WhatsApp（用嚟發 link）' : 'WhatsApp (to send link)'} className={`px-3 py-2 rounded-xl border-2 text-sm bg-white/85 ${customerWhatsapp && !whatsappValid ? 'border-rose-300' : 'border-charcoal/15'}`} />
              <input value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder="Email" type="email" className="px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white/85 sm:col-span-2" />
            </div>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={locale === 'zh' ? '備註（會喺客人 claim 頁顯示）' : 'Notes (shown on the customer claim page)'} rows={3} className="w-full px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white/85 resize-none" />
          </div>
        </div>

        {/* Sticky pricing summary */}
        <div className="lg:col-span-1">
          <div className="glass-strong rounded-3xl p-6 lg:sticky lg:top-28">
            <h3 className="text-base font-bold mb-3 text-ink">{locale === 'zh' ? '費用摘要' : 'Price summary'}</h3>
            {pricing ? (
              <>
                <div className="space-y-1.5 text-sm mb-4">
                  {selectedPackage ? (
                    <>
                      <div className="flex justify-between gap-2">
                        <span className="text-ink-soft">
                          {selectedPackage.name[locale]}
                          {selectedPackage.basePax != null && (
                            <span className="text-xs text-ink-soft opacity-70 ml-1">
                              ({locale === 'zh' ? `包含 ${selectedPackage.basePax} 人` : `${selectedPackage.basePax} pax included`})
                            </span>
                          )}
                        </span>
                        <span className="font-medium text-ink">${selectedPackage.price.toLocaleString()}</span>
                      </div>
                      {extraPaxCharge > 0 && (
                        <div className="flex justify-between gap-2 text-ink-soft text-xs">
                          <span>
                            {locale === 'zh'
                              ? `額外 ${guestCount - (selectedPackage.basePax || 0)} 人 × $${selectedPackage.extraPaxPrice}`
                              : `+${guestCount - (selectedPackage.basePax || 0)} pax × $${selectedPackage.extraPaxPrice}`}
                          </span>
                          <span>+${extraPaxCharge.toLocaleString()}</span>
                        </div>
                      )}
                    </>
                  ) : (
                    pricing.breakdown.map((b, i) => (
                      <div key={i} className="flex justify-between gap-2">
                        <span className="text-ink-soft">{b.label[locale]}</span>
                        <span className="font-medium text-ink">${b.amount.toLocaleString()}</span>
                      </div>
                    ))
                  )}
                  {selectedPackage && pricing.addOnTotal > 0 && (
                    <div className="flex justify-between gap-2 text-ink-soft text-xs">
                      <span>{locale === 'zh' ? '額外加購' : 'Extra add-ons'}</span>
                      <span>+${pricing.addOnTotal.toLocaleString()}</span>
                    </div>
                  )}
                  {promo && (
                    <div className="flex justify-between gap-2 text-emerald-600">
                      <span>{locale === 'zh' ? `優惠 ${promo.code}` : `Promo ${promo.code}`}</span>
                      <span>−${promo.amount.toLocaleString()}</span>
                    </div>
                  )}
                </div>
                <div className="border-t border-white/60 pt-3 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-ink-soft">{locale === 'zh' ? '小計' : 'Subtotal'}</span>
                    <span className="font-bold text-ink">HK${effectiveSubtotal.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-soft">{locale === 'zh' ? '可退按金' : 'Refundable deposit'}</span>
                    <span className="font-medium text-ink">HK${securityDeposit.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between border-t border-white/60 pt-2">
                    <span className="text-ink-soft">{locale === 'zh' ? '總計' : 'Grand total'}</span>
                    <span className="font-bold text-ink">HK${grandTotal.toLocaleString()}</span>
                  </div>
                  {balanceDue > 0 && (
                    <div className="flex justify-between text-xs">
                      <span className="text-ink-soft">{locale === 'zh' ? '尾數（活動前 2 日找清）' : 'Balance (due 2d before)'}</span>
                      <span className="text-ink-soft">HK${balanceDue.toLocaleString()}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-base pt-2 border-t border-white/60">
                    <span className="text-ink-soft">{locale === 'zh' ? '客人首期' : 'Customer pays now'}</span>
                    <span className="font-bold font-display text-gradient-pink">HK${deposit.toLocaleString()}</span>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-ink-soft">{locale === 'zh' ? '揀好所有資料先見到價錢' : 'Fill in details to see pricing'}</p>
            )}

            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="btn-primary w-full justify-center mt-6 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <LinkIcon size={16} />}
              {submitting ? (locale === 'zh' ? '建立中…' : 'Creating…') : (locale === 'zh' ? '產生連結' : 'Generate link')}
              {!submitting && <Clock size={14} className="opacity-70" />}
            </button>
            <p className="text-[11px] text-ink-soft mt-2 text-center">
              {locale === 'zh' ? '連結 8 小時內有效；不設留位，先付款先得' : 'Link valid 8h; no slot hold, first to pay confirms'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
