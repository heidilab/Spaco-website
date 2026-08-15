'use client';

// Customer-facing booking modification — D2 (add add-ons).
//
// Lets the customer ADD add-ons to a confirmed booking (no removal,
// no quantity decrease). Computes the price diff vs the original
// booking and pushes that into balanceDue so the existing pay-balance
// flow handles the actual payment (Stripe + offline both supported).
//
// Hard rules:
//   • Modify deadline: ≥ 24 hrs before booking start
//   • Food / shisha add-ons: ≥ 48 hrs before booking start (existing
//     2-day-advance rule from the original booking flow)
//   • Existing add-on qty cannot be decreased

import { useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { useParams } from 'next/navigation';
import { useRouter, Link } from '@/i18n/routing';
import { useAuth } from '@/contexts/AuthContext';
import { getBooking, getBlockedSlots } from '@/lib/firestore';
import { getVenueById, venuesSharingSpace } from '@/lib/venues';
import {
  addOns as addOnCatalog, calculatePricing, noBBQVenues, freeDrinksVenues,
} from '@/lib/pricing';
import { BookingRecord, AddOnOptions } from '@/types';
import {
  ArrowLeft, Plus, Minus, Check, AlertCircle, Loader2, Info, Clock,
} from 'lucide-react';

const CLEANING_BUFFER_MIN = 60;
function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}

interface CartEntry { id: string; quantity: number; options?: AddOnOptions }

export default function ModifyBookingPage() {
  const locale = useLocale() as 'zh' | 'en';
  const params = useParams();
  const router = useRouter();
  const bookingId = params.id as string;
  const { user, loading: authLoading } = useAuth();

  const [booking, setBooking] = useState<BookingRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /** Cart starts identical to the booking. Customer can only ADD. */
  const [cart, setCart] = useState<CartEntry[]>([]);
  /** Original quantities for guard rails — cart entry can't go below these. */
  const [floor, setFloor] = useState<Record<string, number>>({});
  /** Original guest counts as floors — customer can only increase. */
  const [adultCount, setAdultCount] = useState<number>(0);
  const [childCount, setChildCount] = useState<number>(0);
  const [adultFloor, setAdultFloor] = useState<number>(0);
  const [childFloor, setChildFloor] = useState<number>(0);
  /** Time fields. Start can only move EARLIER, end can only move LATER. */
  const [startTime, setStartTime] = useState<string>('');
  const [endTime, setEndTime] = useState<string>('');
  const [startFloor, setStartFloor] = useState<string>('');
  const [endFloor, setEndFloor] = useState<string>('');
  const [timeConflict, setTimeConflict] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push('/'); return; }
    getBooking(bookingId)
      .then((b) => {
        if (!b) {
          setError(locale === 'zh' ? '找不到預訂' : 'Booking not found');
        } else if (b.userId !== user.uid) {
          setError(locale === 'zh' ? '無權修改此預訂' : 'Not authorized');
        } else {
          setBooking(b);
          setCart((b.addOns || []).map((a) => ({ ...a })));
          const f: Record<string, number> = {};
          for (const a of (b.addOns || [])) f[a.id] = a.quantity;
          setFloor(f);
          // Adult/child floors come from the booking. Legacy bookings
          // without a split fall back to all-adults.
          const adults = b.adultCount ?? b.guestCount ?? 0;
          const kids = b.childCount ?? 0;
          setAdultCount(adults);
          setChildCount(kids);
          setAdultFloor(adults);
          setChildFloor(kids);
          setStartTime(b.startTime);
          setEndTime(b.endTime);
          setStartFloor(b.startTime);
          setEndFloor(b.endTime);
        }
      })
      .finally(() => setLoading(false));
  }, [bookingId, user, authLoading, router, locale]);

  const venue = booking ? getVenueById(booking.venueId) : null;

  const startMs = booking ? new Date(`${booking.date}T${booking.startTime}:00+08:00`).getTime() : 0;
  const hoursUntilStart = booking ? (startMs - Date.now()) / 3600000 : Infinity;
  const canModify = !!booking && (booking.status === 'confirmed' || booking.status === 'awaiting_payment') && hoursUntilStart >= 24;
  const canAddFood = hoursUntilStart >= 48;

  // Add-ons currently visible (filter out shisha — out of D2 scope —
  // and venue-incompatible items).
  const visibleAddOns = useMemo(() => {
    if (!venue) return [];
    return addOnCatalog.filter((a) => {
      if (a.id === 'shisha') return false; // D2 skip
      if ((a.id === 'bbq-standard' || a.id === 'bbq-premium' || a.id === 'bbq-grill') && noBBQVenues.includes(venue.id)) return false;
      if (a.id === 'drinks' && freeDrinksVenues.includes(venue.id)) return false;
      return true;
    });
  }, [venue]);

  // Diff calculation — full pricing recalc with new cart, compared
  // to the original. Use the booking's own subtotal as baseline so
  // we don't have to round-trip the venue rate / hours / pax.
  const newGuestCount = adultCount + childCount;
  // Booking is overnight when the original record carried an endDate
  // distinct from date. Modify is "extend only" so the overnight flag
  // never changes here — we just need it to compute hours correctly.
  const isOvernight = !!booking?.endDate && booking.endDate !== booking.date;
  const newHours = useMemo(() => {
    if (!startTime || !endTime) return booking?.hours ?? 0;
    const endMin = toMin(endTime) + (isOvernight ? 24 * 60 : 0);
    return Math.max(0, (endMin - toMin(startTime)) / 60);
  }, [startTime, endTime, booking?.hours, isOvernight]);
  const newPricing = useMemo(() => {
    if (!venue || !booking) return null;
    return calculatePricing(
      venue,
      booking.isWeekend,
      newHours,
      newGuestCount,
      cart,
      childCount,
    );
  }, [venue, booking, cart, newGuestCount, childCount, newHours]);

  const subtotalDiff = newPricing && booking ? Math.max(0, newPricing.subtotal - booking.pricing.subtotal) : 0;
  const guestsChanged = adultCount !== adultFloor || childCount !== childFloor;
  const timeChanged = startTime !== startFloor || endTime !== endFloor;

  // Live time conflict check — runs whenever time changes.
  // Compares the proposed window (incl. 1-hr cleaning buffer) against
  // every other booking / cleaning / admin block on the same date for
  // the venue (or any venue sharing physical space).
  const setupQty = cart.find((c) => c.id === 'early-setup')?.quantity || 0;
  const setupQtyChanged = setupQty !== (floor['early-setup'] || 0);

  useEffect(() => {
    if (!booking || !venue || (!timeChanged && !setupQtyChanged)) {
      setTimeConflict(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const overnight = isOvernight;
        const endDate = overnight && booking.endDate ? booking.endDate : booking.date;
        // Build the windows to check. Overnight bookings split into Day 1
        // (start → 23:59) and Day 2 (00:00 → end + cleaning buffer).
        const windows: { date: string; start: number; end: number }[] = overnight
          ? [
              { date: booking.date, start: toMin(startTime), end: 24 * 60 },
              { date: endDate, start: 0, end: toMin(endTime) + CLEANING_BUFFER_MIN },
            ]
          : [{ date: booking.date, start: toMin(startTime), end: toMin(endTime) + CLEANING_BUFFER_MIN }];
        // Early setup window — locked BEFORE start; also collides with
        // the previous booking's cleaning buffer.
        if (setupQty > 0) {
          windows.push({
            date: booking.date,
            start: Math.max(0, toMin(startTime) - setupQty * 60),
            end: toMin(startTime),
          });
        }

        const venueIds = venuesSharingSpace(booking.venueId);
        for (const vid of venueIds) {
          for (const w of windows) {
            const blocks = await getBlockedSlots(vid, w.date);
            for (const b of blocks) {
              if (b.bookingId === booking.id) continue;  // skip our own
              const bStart = toMin(b.startTime);
              const bEnd = toMin(b.endTime);
              if (w.start < bEnd && bStart < w.end) {
                if (cancelled) return;
                const isSetupWindow = setupQty > 0 && w.end === toMin(startTime) && w.start < toMin(startTime);
                setTimeConflict(isSetupWindow && !timeChanged
                  ? (locale === 'zh'
                      ? `提早入場佈置時段同上一個預訂撞咗時間（${b.startTime}–${b.endTime}，需預留 1 小時清潔），不能加。`
                      : `Early setup window conflicts with the previous booking (${b.startTime}–${b.endTime}, 1-hr cleaning buffer required).`)
                  : (locale === 'zh'
                      ? `撞到其他預訂（${b.startTime}–${b.endTime}），請揀其他時間。`
                      : `Conflicts with another booking (${b.startTime}–${b.endTime}).`));
                return;
              }
            }
          }
        }
        if (!cancelled) setTimeConflict(null);
      } catch {
        if (!cancelled) setTimeConflict(null);
      }
    })();
    return () => { cancelled = true; };
  }, [startTime, endTime, booking, venue, timeChanged, setupQtyChanged, setupQty, isOvernight, locale]);

  const FOOD_IDS = new Set(['bbq-standard', 'bbq-premium', 'bbq-grill', 'hotpot-standard', 'hotpot-seafood', 'hotpot-extra-soup']);

  function getQty(id: string): number {
    return cart.find((c) => c.id === id)?.quantity || 0;
  }
  function isFloor(id: string, qty: number): boolean {
    return qty <= (floor[id] || 0);
  }

  /** Add or increase quantity. Mirrors the mutual-exclusivity rules
   *  from the booking page (BBQ standard ↔ premium, BYO + grill).
   *  We only let the customer ADD here; existing items at floor cannot
   *  be removed. */
  function inc(id: string) {
    setCart((prev) => {
      const existing = prev.find((c) => c.id === id);
      // BBQ mutex: adding bbq-standard with bbq-premium present is OK
      // only if premium isn't already in the original. Same for premium.
      // For modify, simplest: no mutex enforcement here — the customer
      // already chose at booking time. Just allow stacking.
      if (existing) {
        return prev.map((c) => c.id === id ? { ...c, quantity: c.quantity + 1 } : c);
      }
      return [...prev, { id, quantity: 1 }];
    });
  }
  function dec(id: string) {
    setCart((prev) => {
      const existing = prev.find((c) => c.id === id);
      if (!existing) return prev;
      const newQty = existing.quantity - 1;
      const min = floor[id] || 0;
      if (newQty < min) return prev; // can't go below original
      if (newQty === 0) return prev.filter((c) => c.id !== id);
      return prev.map((c) => c.id === id ? { ...c, quantity: newQty } : c);
    });
  }

  async function handleSave() {
    if (!booking || subtotalDiff <= 0 || !newPricing) return;
    if (timeConflict) return;
    if (!user) { setError(locale === 'zh' ? '請先登入' : 'Please sign in'); return; }
    setSubmitting(true);
    try {
      // All customer edits (add-ons, guests, AND time) now go through the
      // server route. It re-verifies ownership + the add-only policy,
      // recomputes pricing/balanceDue with the canonical GROSS formula, and
      // — for time changes — rewrites the venue's blocked_slots atomically
      // (which the Firestore rules only allow staff to touch). The customer
      // never writes pricing/balanceDue directly, so the rules can freeze
      // those fields on owner writes (Batch A2).
      const idToken = await user.getIdToken();
      const res = await fetch(`/api/bookings/${booking.id}/modify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          addOns: cart,
          ...(guestsChanged ? { adultCount, childCount } : {}),
          ...(timeChanged ? { startTime, endTime } : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        if (data.error === 'SLOT_CONFLICT') {
          const setupAdded = (cart.find((c) => c.id === 'early-setup')?.quantity || 0)
            > (floor['early-setup'] || 0);
          setError(setupAdded
            ? (locale === 'zh'
                ? '提早入場佈置時段同上一個預訂撞咗時間（上一個預訂完場後需預留 1 小時清潔），未能加入。'
                : 'The early setup window conflicts with the previous booking (1-hr cleaning buffer required), so it cannot be added.')
            : (locale === 'zh'
                ? '你揀嘅時段啱啱俾人訂咗，請返回揀過其他時間。'
                : 'That time slot was just taken — please pick another time.'));
        } else if (data.error === 'deadline-passed') {
          setError(locale === 'zh'
            ? '距離活動少於 24 小時，已唔可以自助修改，請 WhatsApp 我哋。'
            : 'Less than 24 hours to start — please WhatsApp us.');
        } else if (data.error === 'food-deadline-passed') {
          setError(locale === 'zh'
            ? '距離活動少於 48 小時，BBQ／火鍋等唔可以後加。'
            : 'Food add-ons can no longer be added within 48 hours.');
        } else {
          setError((locale === 'zh' ? '儲存失敗：' : 'Save failed: ') + (data.error || 'unknown'));
        }
        setSubmitting(false);
        return;
      }
      router.push(`/book/${booking.branchSlug}/pay-balance/${booking.id}`);
    } catch (err) {
      setError((locale === 'zh' ? '儲存失敗：' : 'Save failed: ') + (err instanceof Error ? err.message : 'unknown'));
      setSubmitting(false);
    }
  }

  if (authLoading || loading) {
    return <div className="pt-28 min-h-screen flex items-center justify-center"><div className="animate-pulse text-ink-soft">Loading…</div></div>;
  }
  if (error || !booking) {
    return (
      <div className="pt-28 min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-rose-500 mb-4">{error || 'Error'}</p>
          <Link href="/my-bookings" className="text-sm text-pink hover:underline">{locale === 'zh' ? '← 返回' : '← Back'}</Link>
        </div>
      </div>
    );
  }

  if (!canModify) {
    return (
      <div className="pt-28 min-h-screen flex items-center justify-center">
        <div className="glass-card p-8 max-w-md text-center">
          <AlertCircle size={32} className="mx-auto mb-3 text-amber-500" />
          <h1 className="text-xl font-bold mb-2">{locale === 'zh' ? '已過修改期限' : 'Modification Closed'}</h1>
          <p className="text-sm text-ink-soft mb-4">
            {locale === 'zh'
              ? '預約開始前 24 小時內已唔可以自助修改。如有需要請 WhatsApp 我哋。'
              : 'Self-service modifications are closed within 24 hours of start. Please WhatsApp us instead.'}
          </p>
          <Link href={`/my-bookings/${booking.id}`} className="text-sm text-pink hover:underline">
            {locale === 'zh' ? '← 返回詳情' : '← Back to detail'}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-28 pb-20">
      <div className="max-content mx-auto px-6 md:px-12 lg:px-20">
        <div className="max-w-2xl mx-auto space-y-5">
          <Link href={`/my-bookings/${booking.id}`} className="inline-flex items-center gap-2 text-sm text-ink-soft hover:text-pink">
            <ArrowLeft size={14} /> {locale === 'zh' ? '返回詳情' : 'Back to detail'}
          </Link>

          <div>
            <h1 className="text-heading">
              <span className="text-gradient-pink">{locale === 'zh' ? '修改預訂' : 'Modify Booking'}</span>
            </h1>
            <p className="text-ink-soft mt-2 text-sm">
              {venue?.name[locale]} · {booking.date} {booking.startTime}–{booking.endTime}{isOvernight ? (locale === 'zh' ? `（翌日 ${booking.endDate}）` : ` (next day ${booking.endDate})`) : ''}
            </p>
            <p className="text-xs text-ink-soft mt-1">
              {locale === 'zh' ? '只可以加（人數／附加服務），唔可以減；確認後系統會將差額加入尾數，跳去付款頁。' : 'Add-only (guests / add-ons) — saving recomputes the balance and redirects to pay-balance.'}
            </p>
          </div>

          {!canAddFood && (
            <div className="rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-start gap-2.5">
              <AlertCircle size={16} className="text-amber-600 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-800 leading-relaxed">
                {locale === 'zh'
                  ? '距離活動少於 48 小時，BBQ／火鍋等需要供應商準備嘅 add-ons 已經唔可以後加。其他項目（如場地租用爐）仲可以加。'
                  : 'Less than 48 hours from start — BBQ / hotpot add-ons can no longer be added. Other items (like grill rental) are still available.'}
              </p>
            </div>
          )}

          {/* Time modify (D4) — start can only move earlier, end only later */}
          <div className="glass-card p-5">
            <div className="flex items-center gap-2 mb-3">
              <Clock size={16} className="text-pink" />
              <p className="font-semibold">{locale === 'zh' ? '預約時段' : 'Booking Time'}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-ink-soft mb-1">
                  {locale === 'zh' ? '開始時間（只可提早）' : 'Start (only earlier)'}
                </label>
                <select
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white/85"
                >
                  {Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`)
                    .filter((t) => toMin(t) <= toMin(startFloor))
                    .map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-ink-soft mb-1">
                  {locale === 'zh' ? '結束時間（只可延遲）' : 'End (only later)'}
                </label>
                <select
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white/85"
                >
                  {Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`)
                    .filter((t) => toMin(t) >= toMin(endFloor))
                    .map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                </select>
              </div>
            </div>
            <p className="text-[11px] text-ink-soft mt-2">
              {locale === 'zh'
                ? `已預訂 ${startFloor}–${endFloor}（共 ${booking.hours} 小時）。延長後系統會自動 check 撞時間 + 預留 1 小時清潔。`
                : `Booked: ${startFloor}–${endFloor} (${booking.hours} hrs). Extending will auto-check conflicts + 1-hr cleaning buffer.`}
            </p>
            {timeConflict && (
              <div className="mt-3 rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700 flex items-start gap-1.5">
                <AlertCircle size={12} className="mt-0.5 shrink-0" />
                {timeConflict}
              </div>
            )}
            {timeChanged && !timeConflict && (
              <p className="text-xs text-emerald-700 mt-2">
                {locale === 'zh' ? `✓ 時段可用（新時段 ${newHours} 小時）` : `✓ Available (${newHours} hrs)`}
              </p>
            )}
          </div>

          {/* Guest count modify (D3) — only +, floors locked */}
          <div className="glass-card p-5">
            <p className="font-semibold mb-3">{locale === 'zh' ? '預約人數' : 'Guests'}</p>

            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm font-semibold">{locale === 'zh' ? '成人' : 'Adults'}</p>
                <p className="text-[11px] text-ink-soft">
                  {locale === 'zh' ? `已預訂 ${adultFloor}（不可減少）` : `Booked: ${adultFloor} (locked)`}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setAdultCount(Math.max(adultFloor, adultCount - 1))}
                  disabled={adultCount <= adultFloor}
                  className="w-8 h-8 rounded-full border border-charcoal/15 flex items-center justify-center hover:bg-white disabled:opacity-30"
                >
                  <Minus size={14} />
                </button>
                <span className="w-6 text-center font-semibold">{adultCount}</span>
                <button
                  type="button"
                  onClick={() => setAdultCount(adultCount + 1)}
                  className="w-8 h-8 rounded-full border border-charcoal/15 flex items-center justify-center hover:bg-white"
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-white/40 pt-3">
              <div>
                <p className="text-sm font-semibold">{locale === 'zh' ? '小童 (1–9 歲)' : 'Children (1–9)'}</p>
                <p className="text-[11px] text-ink-soft">
                  {locale === 'zh'
                    ? `已預訂 ${childFloor}（不可減少；半價）`
                    : `Booked: ${childFloor} (locked; half price)`}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setChildCount(Math.max(childFloor, childCount - 1))}
                  disabled={childCount <= childFloor}
                  className="w-8 h-8 rounded-full border border-charcoal/15 flex items-center justify-center hover:bg-white disabled:opacity-30"
                >
                  <Minus size={14} />
                </button>
                <span className="w-6 text-center font-semibold">{childCount}</span>
                <button
                  type="button"
                  onClick={() => setChildCount(childCount + 1)}
                  className="w-8 h-8 rounded-full border border-charcoal/15 flex items-center justify-center hover:bg-white"
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>

            {guestsChanged && (
              <p className="text-xs text-emerald-700 mt-3">
                {locale === 'zh'
                  ? `+${(adultCount - adultFloor) + (childCount - childFloor)} 人（場地租用 / BBQ / 火鍋 / 飲品按計價人數重新計）`
                  : `+${(adultCount - adultFloor) + (childCount - childFloor)} pax (rental / BBQ / hotpot / drinks recompute)`}
              </p>
            )}
          </div>

          <div className="space-y-3">
            {visibleAddOns.map((a) => {
              const qty = getQty(a.id);
              const atFloor = isFloor(a.id, qty);
              const isFood = FOOD_IDS.has(a.id);
              const lockedFood = isFood && !canAddFood && qty === floor[a.id];
              return (
                <div key={a.id} className={`glass-card p-5 ${qty > (floor[a.id] || 0) ? 'border-accent/40 bg-accent/5' : ''} ${lockedFood ? 'opacity-50' : ''}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold">{a.name[locale]}</p>
                      <p className="text-xs text-muted mt-1">{a.description?.[locale]}</p>
                      {(floor[a.id] || 0) > 0 && (
                        <p className="text-[11px] text-emerald-700 mt-1">
                          {locale === 'zh' ? `已預訂 × ${floor[a.id]}（不可減少）` : `Already booked × ${floor[a.id]} (locked)`}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => dec(a.id)}
                        disabled={atFloor}
                        className="w-8 h-8 rounded-full border border-charcoal/15 flex items-center justify-center hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Minus size={14} />
                      </button>
                      <span className="w-6 text-center font-semibold">{qty}</span>
                      <button
                        type="button"
                        onClick={() => inc(a.id)}
                        disabled={lockedFood}
                        className="w-8 h-8 rounded-full border border-charcoal/15 flex items-center justify-center hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Sticky diff summary */}
          <div className="glass-card p-6 sticky bottom-4 mt-6">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-ink-soft">{locale === 'zh' ? '原小計' : 'Original subtotal'}</span>
              <span className="text-sm">HK${booking.pricing.subtotal.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-ink-soft">{locale === 'zh' ? '新小計' : 'New subtotal'}</span>
              <span className="text-sm font-semibold">HK${(newPricing?.subtotal || 0).toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between mb-4 pt-3 border-t border-white/40">
              <span className="font-bold">{locale === 'zh' ? '需補付' : 'Top-up'}</span>
              <span className="font-bold text-2xl text-gradient-pink">HK${subtotalDiff.toLocaleString()}</span>
            </div>
            {(booking.balanceDue ?? 0) > 0 && subtotalDiff > 0 && (
              <p className="text-xs text-ink-soft mb-3 flex items-start gap-1.5">
                <Info size={12} className="mt-0.5 shrink-0" />
                {locale === 'zh'
                  ? `加上現有未繳尾數 HK$${(booking.balanceDue || 0).toLocaleString()}，共需付 HK$${((booking.balanceDue || 0) + subtotalDiff).toLocaleString()}。`
                  : `Plus existing balance HK$${(booking.balanceDue || 0).toLocaleString()} = HK$${((booking.balanceDue || 0) + subtotalDiff).toLocaleString()} total.`}
              </p>
            )}
            <button
              onClick={handleSave}
              disabled={subtotalDiff <= 0 || submitting || !!timeConflict}
              className="w-full py-3 rounded-xl bg-gradient-pink text-white font-bold text-base disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
              {subtotalDiff <= 0
                ? (locale === 'zh' ? '請先加項目' : 'Add items to continue')
                : timeConflict
                  ? (locale === 'zh' ? '請先解決時間衝突' : 'Resolve time conflict first')
                  : (locale === 'zh' ? '確認並付款' : 'Save & Pay')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
