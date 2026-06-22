import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  arrayUnion,
} from 'firebase/firestore';
import { db } from './firebase';
import { BookingRecord, BlockedSlot, BusinessDocument, DocumentType, DocumentRevision, CalendarEvent, AddOnOptions } from '@/types';
import { venuesSharingSpace, getVenueById } from './venues';
import { calculatePricing, calculateDeposit, freeDrinksVenues } from './pricing';
import { getHoliday } from './hkHolidays';

// ============ BOOKINGS ============

export async function createBooking(data: Omit<BookingRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
  // Server-side conflict check — without this two bookings can stack
  // with no cleaning gap. UI dropdown shows the static 8AM-11:45PM
  // list with no filtering, so the only enforcement is here.
  // (#mjtp9UKB 13:00-16:00 + #IXSLT0Aw 16:00-21:00 both went through
  // because this check was missing; assertNoSlotConflict catches the
  // cleaning-buffer overlap correctly when called.)
  // Pass a synthetic excludeBookingId so nothing matches as "own".
  await assertNoSlotConflict({
    venueId: data.venueId,
    date: data.date,
    endDate: data.endDate,
    startTime: data.startTime,
    endTime: data.endTime,
    excludeBookingId: '__new_booking__',
  });

  const ref = await addDoc(collection(db, 'bookings'), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Sync the customer's whatsappPhone back to their user profile so
  // admin sees it in 會員管理 immediately (Heidi's 2026-05-23 spec —
  // customers were entering phone at booking time but it never landed
  // on the profile). Best-effort: a profile-write failure shouldn't
  // block the booking creation.
  if (data.userId && data.whatsappPhone) {
    updateDoc(doc(db, 'users', data.userId), { phone: data.whatsappPhone })
      .catch((err) => console.warn('[createBooking] phone sync failed:', err));
  }

  const overnight = !!data.endDate && data.endDate !== data.date;
  const endDate = overnight ? (data.endDate as string) : data.date;

  // Cleaning buffer: 1 hour after end time. Buffer sits on `endDate` so
  // overnight bookings clean up on day 2.
  const [endH, endM] = data.endTime.split(':').map(Number);
  const bufferEndH = endH + 1;
  const bufferEnd = bufferEndH >= 24
    ? '23:59'
    : `${String(bufferEndH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

  // Write the blocked_slot ONLY for the actual booked venue. Earlier
  // versions also wrote a copy for every venue sharing the same
  // physical space (sw-a / sw-b / sw-ab), but the conflict CHECKS
  // already expand via venuesSharingSpace — doing it on writes too
  // produces phantom slots that wrongly block sibling venues (a sw-b
  // booking created an sw-ab phantom, which then made sw-a appear
  // unbookable via the assertNoSlotConflict broad query). Heidi 2026-06.
  const vid = data.venueId;
  if (overnight) {
    // Day 1: start → 23:59
    await createBlockedSlot({
      venueId: vid, date: data.date,
      startTime: data.startTime, endTime: '23:59',
      reason: 'booking', bookingId: ref.id,
    });
    // Day 2: 00:00 → end, plus cleaning buffer after.
    await createBlockedSlot({
      venueId: vid, date: endDate,
      startTime: '00:00', endTime: data.endTime,
      reason: 'booking', bookingId: ref.id,
    });
    await createBlockedSlot({
      venueId: vid, date: endDate,
      startTime: data.endTime, endTime: bufferEnd,
      reason: 'cleaning', bookingId: ref.id,
    });
  } else {
    await createBlockedSlot({
      venueId: vid,
      date: data.date,
      startTime: data.startTime,
      endTime: data.endTime,
      reason: 'booking',
      bookingId: ref.id,
    });
    await createBlockedSlot({
      venueId: vid,
      date: data.date,
      startTime: data.endTime,
      endTime: bufferEnd,
      reason: 'cleaning',
      bookingId: ref.id,
    });
  }

  return ref.id;
}

export async function getBooking(id: string): Promise<BookingRecord | null> {
  const snap = await getDoc(doc(db, 'bookings', id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as BookingRecord;
}

export async function getUserBookings(userId: string): Promise<BookingRecord[]> {
  // Sort client-side to avoid requiring a (userId, createdAt) composite index.
  const q = query(
    collection(db, 'bookings'),
    where('userId', '==', userId)
  );
  const snap = await getDocs(q);
  const items = snap.docs.map((d) => ({ id: d.id, ...d.data() } as BookingRecord));
  return items.sort((a, b) => {
    const ta = (a.createdAt as { toMillis?: () => number } | null)?.toMillis?.() ?? 0;
    const tb = (b.createdAt as { toMillis?: () => number } | null)?.toMillis?.() ?? 0;
    return tb - ta;
  });
}

export async function getAllBookings(status?: string): Promise<BookingRecord[]> {
  // We sort client-side so a (status, createdAt) composite index is never
  // required. Without this, hitting any sub-page that filters by status
  // would silently fail when the index is missing.
  const q = status
    ? query(collection(db, 'bookings'), where('status', '==', status))
    : query(collection(db, 'bookings'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  const items = snap.docs.map((d) => ({ id: d.id, ...d.data() } as BookingRecord));
  if (status) {
    items.sort((a, b) => {
      const ta = (a.createdAt as { toMillis?: () => number } | null)?.toMillis?.() ?? 0;
      const tb = (b.createdAt as { toMillis?: () => number } | null)?.toMillis?.() ?? 0;
      return tb - ta;
    });
  }
  return items;
}

export async function updateBookingStatus(id: string, status: string) {
  await updateDoc(doc(db, 'bookings', id), {
    status,
    updatedAt: serverTimestamp(),
  });
}

/** Admin updates a member's phone — writes to the user profile AND
 *  cascades to every booking's whatsappPhone so the bookings list /
 *  detail / pay-balance flow all show the corrected number.
 *  Returns the number of bookings updated. */
export async function updateMemberPhoneEverywhere(
  userId: string,
  newPhone: string,
): Promise<number> {
  const trimmed = newPhone.trim();
  await updateDoc(doc(db, 'users', userId), { phone: trimmed });
  // Cascade to all bookings owned by this user. Pre-existing
  // whatsappPhone values (even mismatched ones) are overwritten —
  // admin's correction wins.
  const q = query(collection(db, 'bookings'), where('userId', '==', userId));
  const snap = await getDocs(q);
  let count = 0;
  for (const docSnap of snap.docs) {
    await updateDoc(docSnap.ref, {
      whatsappPhone: trimmed,
      updatedAt: serverTimestamp(),
    });
    count++;
  }
  return count;
}

/** Admin/CS: edit a booking's date / time / guest count. Updates the
 *  blocked_slots that were created for the booking so the schedule stays
 *  consistent. Caller must validate availability before invoking.
 *
 *  Cross-midnight support: when `endDate` is set and differs from `date`,
 *  two booking blocks are created (date → 23:59 + endDate 00:00 → endTime).
 *  Cleaning buffer (1hr) is placed after the actual end on whichever day
 *  the booking concludes. */
/**
 * Throws a SLOT_CONFLICT error (so the admin UI can show a red warning)
 * if any existing blocked_slot on the target venue (or any venue sharing
 * the same physical space) overlaps the proposed time window — EXCLUDING
 * blocks owned by `excludeBookingId` itself, so editing a booking's own
 * time doesn't fight with its own slots.
 *
 * Used by updateBookingDateTime when admin is changing the venue on a
 * booking (e.g. moving a customer from CWB to TST due to a leak / clash).
 */
async function assertNoSlotConflict(opts: {
  venueId: string;
  date: string;
  endDate?: string;
  startTime: string;
  endTime: string;
  excludeBookingId: string;
  /** Also skip blocked_slots whose googleEventId matches — when SPACO
   *  pushes a booking to gcal, the SW calendar sync writes 3 phantom
   *  slots back (sw-a + sw-b + sw-ab) with bookingId=null, so we can't
   *  exclude them via bookingId alone. */
  excludeGoogleEventId?: string;
}): Promise<void> {
  const startMin = (h: string) => {
    const [hh, mm] = h.split(':').map(Number);
    return hh * 60 + (mm || 0);
  };
  const overnight = !!opts.endDate && opts.endDate !== opts.date;
  const windows = overnight
    ? [
        { date: opts.date, start: startMin(opts.startTime), end: 24 * 60 },
        { date: opts.endDate as string, start: 0, end: startMin(opts.endTime) },
      ]
    : [{ date: opts.date, start: startMin(opts.startTime), end: startMin(opts.endTime) }];

  for (const vid of venuesSharingSpace(opts.venueId)) {
    for (const w of windows) {
      const snap = await getDocs(query(
        collection(db, 'blocked_slots'),
        where('venueId', '==', vid),
        where('date', '==', w.date),
      ));
      for (const docSnap of snap.docs) {
        const data = docSnap.data() as {
          bookingId?: string;
          startTime: string;
          endTime: string;
          googleEventId?: string;
        };
        if (data.bookingId === opts.excludeBookingId) continue;
        if (opts.excludeGoogleEventId && data.googleEventId === opts.excludeGoogleEventId) continue;
        const bStart = startMin(data.startTime);
        const bEnd = startMin(data.endTime);
        if (w.start < bEnd && bStart < w.end) {
          // Include conflicting bookingId in the message so the admin UI
          // can render a "已被預訂 #abc123" hint.
          const ref = data.bookingId ? ` #${data.bookingId.slice(0, 8)}` : '';
          throw new Error(`SLOT_CONFLICT:${vid}${ref}`);
        }
      }
    }
  }
}

export async function updateBookingDateTime(
  bookingId: string,
  next: {
    date: string;
    startTime: string;
    endTime: string;
    endDate?: string;
    guestCount?: number;
    /** Adult / child split. When present, used for both per-head pricing
     *  recompute and to update the stored counts (children at 0.5 rate). */
    adultCount?: number;
    childCount?: number;
    /** Optional venue change — when present and different from the
     *  booking's current venueId, blocked_slots are migrated to the new
     *  venue (and its shared-space siblings) after a conflict check
     *  against the new venue's existing blocks. googleEventId is cleared
     *  on venue change so the followup route can create a fresh event
     *  on the new venue's calendar. */
    venueId?: string;
    branchSlug?: string;
    /** Replacement add-ons list. When provided, pricing.* fields are
     *  recomputed via calculatePricing() and balanceDue is adjusted to
     *  reflect the difference against what the customer has already paid
     *  — so admin can add a BBQ package after the customer already paid
     *  the original deposit and the booking now correctly shows an
     *  outstanding balance. */
    addOns?: { id: string; quantity: number; options?: AddOnOptions }[];
    hasBYOFood?: boolean;
    /** Manual override for pricing.securityDeposit (HK$). Takes
     *  precedence over both the auto-tier formula AND the sticky-
     *  preserve fallback. Use when admin wants to (a) bump deposit
     *  because add-ons crossed a tier threshold and the customer
     *  agreed to pay more refundable, or (b) repair a booking whose
     *  deposit was auto-bumped before the sticky rule shipped. Pass
     *  the desired final securityDeposit amount, NOT a delta. */
    securityDepositOverride?: number;
    /** Manual override for the consumption subtotal (HK$). Bypasses
     *  the calculatePricing() formula entirely. Use when the venue
     *  formula doesn't match what the customer was actually charged
     *  (e.g. legacy data corruption, manual price agreement, or a
     *  promo applied off-system). Affects loyalty-point credit,
     *  receipt totals, and balanceDue math. */
    subtotalOverride?: number;
  }
) {
  const bookingRef = doc(db, 'bookings', bookingId);
  const bookingSnap = await getDoc(bookingRef);
  if (!bookingSnap.exists()) throw new Error('Booking not found');
  const booking = bookingSnap.data() as BookingRecord;

  const endDate = next.endDate && next.endDate !== next.date ? next.endDate : next.date;
  const overnight = endDate !== next.date;
  const targetVenueId = next.venueId || booking.venueId;
  const venueChanged = next.venueId !== undefined && next.venueId !== booking.venueId;

  // Conflict check on the TARGET venue (and its shared-space siblings)
  // before touching anything. We do this BEFORE deleting the old slots
  // so a failed conflict check leaves the booking exactly as it was.
  // Pass googleEventId so the booking's own gcal-mirror slots (which
  // gcal-sync writes WITHOUT a bookingId, often for all 3 SW sub-rooms)
  // don't self-conflict against the very booking we're editing.
  await assertNoSlotConflict({
    venueId: targetVenueId,
    date: next.date,
    endDate: overnight ? endDate : undefined,
    startTime: next.startTime,
    endTime: next.endTime,
    excludeBookingId: bookingId,
    excludeGoogleEventId: (booking as { googleEventId?: string }).googleEventId,
  });

  const [endH, endM] = next.endTime.split(':').map(Number);
  // Cleaning buffer: 1 hr after end. If end is past 23:00, buffer pushes
  // further forward but stays on endDate (which already handled the
  // midnight crossing).
  const bufferEndH = endH + 1;
  const bufferEnd = bufferEndH >= 24
    ? '23:59'      // cap at end of day; rare and admin can extend manually
    : `${String(bufferEndH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

  // Replace the blocked_slots tied to this booking. Single venueId per
  // slot (no shared-space expansion) — the conflict-check side already
  // expands via venuesSharingSpace; expanding writes too would create
  // phantom slots that wrongly block sibling venues. See createBooking
  // for the same fix and the Heidi 2026-06 incident notes.
  const blockedSnap = await getDocs(
    query(collection(db, 'blocked_slots'), where('bookingId', '==', bookingId))
  );
  for (const b of blockedSnap.docs) {
    await deleteDoc(b.ref);
  }
  const vid = targetVenueId;
  if (overnight) {
    // Day 1: from start → 23:59
    await createBlockedSlot({
      venueId: vid, date: next.date,
      startTime: next.startTime, endTime: '23:59',
      reason: 'booking', bookingId,
    });
    // Day 2: 00:00 → end + cleaning
    await createBlockedSlot({
      venueId: vid, date: endDate,
      startTime: '00:00', endTime: next.endTime,
      reason: 'booking', bookingId,
    });
    await createBlockedSlot({
      venueId: vid, date: endDate,
      startTime: next.endTime, endTime: bufferEnd,
      reason: 'cleaning', bookingId,
    });
  } else {
    // Same-day booking — original behaviour
    await createBlockedSlot({
      venueId: vid, date: next.date,
      startTime: next.startTime, endTime: next.endTime,
      reason: 'booking', bookingId,
    });
    await createBlockedSlot({
      venueId: vid, date: next.date,
      startTime: next.endTime, endTime: bufferEnd,
      reason: 'cleaning', bookingId,
    });
  }

  // Recompute hours from the actual start/end timestamps so cross-midnight
  // bookings get the right rental duration.
  const startMs = new Date(`${next.date}T${next.startTime}:00+08:00`).getTime();
  const endMs = new Date(`${endDate}T${next.endTime}:00+08:00`).getTime();
  const hours = Math.max(1, Math.round((endMs - startMs) / 3600000));

  const patch: Record<string, unknown> = {
    date: next.date,
    startTime: next.startTime,
    endTime: next.endTime,
    endDate: overnight ? endDate : null,
    hours,
    updatedAt: serverTimestamp(),
  };
  if (typeof next.guestCount === 'number') patch.guestCount = next.guestCount;
  if (typeof next.adultCount === 'number') patch.adultCount = next.adultCount;
  if (typeof next.childCount === 'number') patch.childCount = next.childCount;
  // Keep adultCount in sync with guestCount when caller only updates
  // guestCount. Otherwise admin bumping pax from 7 → 12 leaves
  // adultCount=7 stale (#jMW2skDl), which downstream
  // breakdown-displayers like "7 adults + 0 kids" render incoherently
  // and the confirm-page promo formula picks the stale adultCount as
  // the basis for free_drinks promo (charging the customer the diff).
  if (typeof next.guestCount === 'number' && typeof next.adultCount !== 'number') {
    const childrenForSync = typeof next.childCount === 'number'
      ? next.childCount
      : (booking.childCount ?? 0);
    patch.adultCount = Math.max(0, next.guestCount - childrenForSync);
  }
  if (typeof next.hasBYOFood === 'boolean') patch.hasBYOFood = next.hasBYOFood;
  if (next.addOns) patch.addOns = next.addOns;
  if (venueChanged) {
    patch.venueId = next.venueId;
    if (next.branchSlug) patch.branchSlug = next.branchSlug;
    // Old Google Calendar event lives on the old venue's calendar — clear
    // the id so the followup route creates a fresh event on the new
    // venue's calendar via pushBookingToCalendar. The orphan on the old
    // calendar should be cleaned up by admin manually (or future cleanup
    // cron) — it's not in our way otherwise.
    patch.googleEventId = null;
  }

  // ── Pricing recompute ─────────────────────────────────────────────
  // When add-ons, guest split, hours, or date change, the per-head rate
  // and add-on totals shift — recompute the full pricing block via the
  // same calculatePricing() the customer flow uses, so the booking
  // reflects what the customer should now owe.
  //
  // We DON'T auto-recompute for package bookings — packages are flat
  // priced and have their own basePax / extraPaxPrice logic that the
  // package booking page handles. Admin can still record a payment
  // top-up via the modal for package-booking adjustments.
  const pricingInputsChanged =
    next.addOns !== undefined
    || typeof next.guestCount === 'number'
    || typeof next.adultCount === 'number'
    || typeof next.childCount === 'number'
    || next.date !== booking.date
    || venueChanged
    || hours !== booking.hours;

  if (pricingInputsChanged && !booking.packageSlug) {
    const venueForPricing = getVenueById(targetVenueId);
    if (venueForPricing) {
      // Recompute isWeekend from the new date — Fri / Sat / public
      // holiday / eve-of-public-holiday. Matches the rule used in
      // calendar booking forms so admin edits don't drift.
      const day = new Date(next.date).getDay();
      const holiday = getHoliday(next.date);
      const nextDayStr = (() => {
        const d = new Date(`${next.date}T00:00:00`);
        d.setDate(d.getDate() + 1);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${dd}`;
      })();
      const eveHoliday = getHoliday(nextDayStr);
      const isWeekend =
        day === 5
        || day === 6
        || holiday?.type === 'public'
        || eveHoliday?.type === 'public';
      patch.isWeekend = isWeekend;

      const guests = typeof next.guestCount === 'number' ? next.guestCount : booking.guestCount;
      const adults = typeof next.adultCount === 'number'
        ? next.adultCount
        : (booking.adultCount ?? booking.guestCount);
      const children = typeof next.childCount === 'number'
        ? next.childCount
        : (booking.childCount ?? 0);
      const addOns = next.addOns ?? booking.addOns ?? [];
      const computed = calculatePricing(
        venueForPricing,
        isWeekend,
        hours,
        guests,
        addOns,
        children,
      );

      // Preserve any promo discount the customer had applied. We re-apply
      // it on top of the freshly computed subtotal so the customer
      // doesn't lose their discount when admin tweaks an add-on.
      // `subtotalOverride` bypasses the formula entirely — use case:
      // legacy bookings whose stored subtotal got corrupted, or
      // off-system price agreements that the venue × pax × hours
      // formula can't replicate.
      //
      // EXCEPTION — free_drinks promos. These cover the drinks line
      // item exactly ($25 × adultEquiv), so when pax changes the
      // discount amount MUST scale with it. #jMW2skDl: admin bumped 7
      // → 12 pax, drinks recalc'd to $300, but promoDiscount stuck at
      // the original $175 (7-pax worth) → customer charged $125 for
      // what should be "free" drinks. Recompute when free_drinks is in
      // play AND the booking still has drinks in addOns. Other promo
      // types (cash / per_pax / percent) keep the stored value since
      // their amount was already locked when the customer applied.
      let promoDiscount = booking.promoDiscount || 0;
      const isFreeDrinksPromo =
        typeof booking.promoFreeDrinksCost === 'number' && booking.promoFreeDrinksCost > 0;
      const hasDrinksAddOn = (addOns || []).some((a) => a.id === 'drinks');
      if (isFreeDrinksPromo && hasDrinksAddOn) {
        // adultEquiv MUST match pricing.ts adultEquivalent exactly,
        // which derives adults from (guests − childCount) not from the
        // stored booking.adultCount field. Otherwise admin's
        // guestCount-only edit (e.g. #jMW2skDl 12 → 13 pax) computes
        // promo against the STALE adultCount snapshot, giving 12 ×
        // $25 = \$300 promo while drinks line shows 13 × \$25 = \$325
        // — back to the same convention-drift bug.
        const promoAdults = Math.max(0, guests - children);
        const adultEquiv = promoAdults + 0.5 * children;
        const newDrinksCost = freeDrinksVenues.includes(targetVenueId)
          ? 0
          : Math.round(25 * adultEquiv);
        promoDiscount = newDrinksCost;
        patch.promoDiscount = newDrinksCost;
        patch.promoFreeDrinksCost = newDrinksCost;
      }
      const baseSubtotal = typeof next.subtotalOverride === 'number'
        ? Math.max(0, next.subtotalOverride)
        : computed.subtotal;
      const effectiveSubtotal = Math.max(0, baseSubtotal - promoDiscount);

      // Refundable security deposit resolution, in priority order:
      //   1. Explicit `securityDepositOverride` from admin — used both
      //      for opt-in tier bumps and for repairing legacy bookings
      //      whose deposit was wrongly auto-bumped.
      //   2. Sticky preserve — already-paid bookings keep their
      //      existing securityDeposit untouched (admin edits don't
      //      auto-bump).
      //   3. Tier formula — brand-new bookings still get the
      //      $1k/$2k/$4k auto-tier against the fresh subtotal.
      const wasPaid =
        booking.status === 'confirmed'
        || booking.status === 'completed'
        || !!booking.paymentVerifiedAt;
      const stickyDeposit =
        typeof next.securityDepositOverride === 'number'
          ? Math.max(0, next.securityDepositOverride)
          : wasPaid && typeof booking.pricing.securityDeposit === 'number'
            ? booking.pricing.securityDeposit
            : computed.securityDeposit;
      const effectiveGrandTotal = effectiveSubtotal + stickyDeposit;
      const effectiveDeposit = calculateDeposit(effectiveGrandTotal);

      // How much the customer has already paid against this booking.
      // Confirmed/completed bookings: grandTotal − balanceDue (the old
      // pricing already reflects past payments via the followup route's
      // pricing.* mutations). Otherwise sum the logged payments[].
      // payments[] is the SINGLE SOURCE OF TRUTH for what the customer
      // has paid. Every Stripe webhook charge, every offline receipt
      // approval, every admin top-up writes an entry here, and the
      // 2026-05 batch-freeze migrated all legacy synth rows into
      // permanent entries — so for any booking in the system, the sum
      // of payments[] reflects reality.
      //
      // The previous formula derived paidSoFar from `oldGrandTotal −
      // oldBalanceDue`, which compounded past errors: a wrong subtotal
      // save left a wrong balanceDue, and that pair got baked into the
      // next save's paidSoFar (the $4 phantom on #hlJJh9K5). Switched
      // to loggedSum so that pricing edits no longer move "what was
      // paid" — that number lives in payments[] and only changes when
      // a new payment is recorded (via Stripe webhook or the
      // 「已於線下付款」 admin action).
      const paidSoFar = (booking.payments || []).reduce((s, p) => s + (p.amount || 0), 0);

      patch['pricing.baseCharge'] = computed.baseCharge;
      patch['pricing.addOnTotal'] = computed.addOnTotal;
      patch['pricing.subtotal'] = effectiveSubtotal;
      patch['pricing.securityDeposit'] = stickyDeposit;
      patch['pricing.deposit'] = effectiveDeposit;
      // balanceDue = what the customer still owes after past payments.
      // Clamp to 0 when customer overpaid (admin handles any refund out
      // of band — we don't auto-issue refunds from a booking edit).
      patch.balanceDue = Math.max(0, effectiveGrandTotal - paidSoFar);
    }
  }

  await updateDoc(bookingRef, patch);
}

/** Set the outstanding balance for a booking (50%-deposit case). Use 0 to
 *  mark as fully paid; any positive number to record a remaining balance. */
export async function updateBookingBalance(id: string, balanceDue: number, balanceDueDate?: string) {
  const patch: Record<string, unknown> = {
    balanceDue,
    updatedAt: serverTimestamp(),
  };
  if (balanceDueDate) patch.balanceDueDate = balanceDueDate;
  if (balanceDue === 0) patch.balancePaidAt = serverTimestamp();
  await updateDoc(doc(db, 'bookings', id), patch);
}

export async function updateBookingDepositRefund(
  id: string,
  refundData: {
    amount: number;
    deductions: { label: string; amount: number }[];
    /** When deductions exceed the security deposit, this is the
     *  amount the customer still owes (e.g. +HK$250 for an
     *  un-deposited overtime charge). When > 0 we keep status as
     *  'confirmed' + set balanceDue so the booking re-enters the
     *  "needs follow-up payment" workflow; admin records the
     *  customer's offline payment via 已於線下付款 → balance hits
     *  0 → endpoint auto-flips to 'completed'. */
    overflowAmount?: number;
  }
) {
  const overflow = Math.max(0, refundData.overflowAmount || 0);
  const patch: Record<string, unknown> = {
    depositRefund: {
      amount: refundData.amount,
      deductions: refundData.deductions,
      refundedAt: serverTimestamp(),
    },
    updatedAt: serverTimestamp(),
  };
  if (overflow > 0) {
    patch.balanceDue = overflow;
    patch.status = 'confirmed';
  } else {
    patch.balanceDue = 0;
    patch.status = 'completed';
  }
  await updateDoc(doc(db, 'bookings', id), patch);
}

// ============ BLOCKED SLOTS ============

export async function createBlockedSlot(
  data: Omit<BlockedSlot, 'id'>
): Promise<string> {
  const ref = await addDoc(collection(db, 'blocked_slots'), data);
  return ref.id;
}

/**
 * Create a blocked slot for an admin manual block. Earlier versions
 * propagated copies to every venue sharing the same physical space
 * (Sheung Wan A / B / A+B), but conflict CHECKS already expand via
 * venuesSharingSpace — propagating writes too produced phantom slots
 * that wrongly blocked sibling venues (Heidi 2026-06 incident: sw-b
 * booking phantom-blocked sw-a). Now a single write; reads still
 * correctly catch cross-room blocks via the expanding query.
 */
export async function createSharedBlockedSlot(
  data: Omit<BlockedSlot, 'id'>
): Promise<string> {
  return await createBlockedSlot(data);
}

export async function getBlockedSlots(
  venueId: string,
  date: string
): Promise<BlockedSlot[]> {
  const q = query(
    collection(db, 'blocked_slots'),
    where('venueId', '==', venueId),
    where('date', '==', date)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as BlockedSlot));
}

export async function getBlockedSlotsForMonth(
  venueId: string,
  yearMonth: string // "2024-03"
): Promise<BlockedSlot[]> {
  const startDate = `${yearMonth}-01`;
  const endDate = `${yearMonth}-31`;
  // Avoid the (venueId == X, date range) composite index requirement by
  // querying the date range only and filtering venueId on the client.
  const q = query(
    collection(db, 'blocked_slots'),
    where('date', '>=', startDate),
    where('date', '<=', endDate)
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as BlockedSlot))
    .filter((s) => s.venueId === venueId);
}

export async function deleteBlockedSlot(id: string) {
  await deleteDoc(doc(db, 'blocked_slots', id));
}

// ============ CALENDAR EVENTS (site visits, deliveries) ============

export async function getCalendarEventsForMonth(
  yearMonth: string,
): Promise<CalendarEvent[]> {
  const startDate = `${yearMonth}-01`;
  const endDate = `${yearMonth}-31`;
  const q = query(
    collection(db, 'calendar_events'),
    where('date', '>=', startDate),
    where('date', '<=', endDate),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as CalendarEvent));
}

export async function deleteBlockedSlotsByBooking(bookingId: string) {
  const q = query(
    collection(db, 'blocked_slots'),
    where('bookingId', '==', bookingId)
  );
  const snap = await getDocs(q);
  for (const d of snap.docs) {
    await deleteDoc(d.ref);
  }
}

// ============ ADMIN ============

export async function getBookingsForDate(date: string): Promise<BookingRecord[]> {
  const q = query(
    collection(db, 'bookings'),
    where('date', '==', date)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as BookingRecord));
}

export async function getBookingsForMonth(yearMonth: string): Promise<BookingRecord[]> {
  const startDate = `${yearMonth}-01`;
  const endDate = `${yearMonth}-31`;
  const q = query(
    collection(db, 'bookings'),
    where('date', '>=', startDate),
    where('date', '<=', endDate)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as BookingRecord));
}

// ============ USERS (Admin) ============

export async function getAllUsers() {
  const snap = await getDocs(collection(db, 'users'));
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}

export async function getUserProfile(uid: string) {
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return null;
  return { uid: snap.id, ...snap.data() };
}

/**
 * Save a customer's WhatsApp number to their user profile so the next
 * booking can prefill it. Call on every booking submission.
 */
export async function updateUserWhatsapp(uid: string, whatsappPhone: string) {
  await updateDoc(doc(db, 'users', uid), {
    whatsappPhone,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Patch arbitrary editable fields on the user profile (account page).
 * Caller is responsible for restricting which fields are exposed in the UI.
 */
export async function updateUserProfile(
  uid: string,
  patch: Partial<{ displayName: string; phone: string; whatsappPhone: string }>
) {
  await updateDoc(doc(db, 'users', uid), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

// ============ BOOKING — payment & refund updates (client SDK) ============

/** Persist refund destination collected on the booking confirmation page. */
export async function updateBookingRefundDetails(
  bookingId: string,
  refundDetails: import('@/types').RefundDetails
) {
  await updateDoc(doc(db, 'bookings', bookingId), {
    refundDetails,
    updatedAt: serverTimestamp(),
  });
}

/** Set the customer-chosen payment method (online/offline) on the booking. */
export async function updateBookingPaymentMethod(
  bookingId: string,
  paymentMethod: 'fps' | 'stripe' | 'bank'
) {
  const status = paymentMethod === 'stripe' ? 'awaiting_payment' : 'awaiting_payment';
  await updateDoc(doc(db, 'bookings', bookingId), {
    paymentMethod,
    status,
    updatedAt: serverTimestamp(),
  });
}

/** Save uploaded offline-payment receipt URL + flip status to awaiting_review. */
export async function updateBookingReceiptUploaded(
  bookingId: string,
  receiptUrl: string
) {
  await updateDoc(doc(db, 'bookings', bookingId), {
    receiptUrl,
    paymentReceiptUploadedAt: serverTimestamp(),
    status: 'awaiting_review',
    updatedAt: serverTimestamp(),
  });
}

// ============ LOYALTY POINTS ============

/** Credit N loyalty points to a user. 100 pts = HK$1 (rate set per
 *  product spec: $1 spent = 1 point). Caller is responsible for
 *  computing the correct amount — typically:
 *      subtotal (rental + add-ons, excludes security deposit)
 *      + any portion of the security deposit that was forfeited
 *        (kept by SPACO as cleaning/damage deduction)
 *  Returns the actual amount credited. */
export async function creditLoyaltyPoints(userId: string, points: number): Promise<number> {
  const pointsToAdd = Math.floor(points);
  if (pointsToAdd <= 0) return 0;

  const userRef = doc(db, 'users', userId);
  const snap = await getDoc(userRef);
  if (!snap.exists()) return 0;

  const currentPoints = snap.data().loyaltyPoints || 0;
  await updateDoc(userRef, {
    loyaltyPoints: currentPoints + pointsToAdd,
  });

  return pointsToAdd;
}

export async function redeemLoyaltyPoints(userId: string, pointsToUse: number): Promise<boolean> {
  const userRef = doc(db, 'users', userId);
  const snap = await getDoc(userRef);
  if (!snap.exists()) return false;

  const currentPoints = snap.data().loyaltyPoints || 0;
  if (currentPoints < pointsToUse) return false;

  await updateDoc(userRef, {
    loyaltyPoints: currentPoints - pointsToUse,
  });
  return true;
}

/** Loyalty redemption helpers shared between checkout UI + admin display. */
export const POINTS_PER_HKD = 100; // 100 pts = HK$1

/** Convert points to HK$ value (floor). */
export function pointsToHkd(points: number): number {
  return Math.floor(points / POINTS_PER_HKD);
}

/** Convert HK$ to points (× 100). */
export function hkdToPoints(hkd: number): number {
  return Math.max(0, Math.floor(hkd) * POINTS_PER_HKD);
}

// ============ RECEIPT UPLOAD ============

export async function updateBookingReceipt(bookingId: string, receiptUrl: string) {
  await updateDoc(doc(db, 'bookings', bookingId), {
    receiptUrl,
    status: 'awaiting_payment',
    updatedAt: serverTimestamp(),
  });
}

// ============ BUSINESS DOCUMENTS (Quotation / Invoice / Receipt) ============

const DOC_PREFIX: Record<DocumentType, string> = {
  quotation: 'QUO',
  invoice: 'INV',
  receipt: 'RCP',
};

/**
 * Generate the next sequential document number for a given type and year.
 * Format: {PREFIX}-{YEAR}-{0001+}
 * Example: QUO-2026-0001
 *
 * Uses a single-field query (type == X) and computes the max sequence on
 * the client to avoid requiring a Firestore composite index.
 */
export async function generateDocumentNumber(type: DocumentType): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = DOC_PREFIX[type];
  const yearPrefix = `${prefix}-${year}-`;

  const q = query(collection(db, 'documents'), where('type', '==', type));
  const snap = await getDocs(q);

  let maxSeq = 0;
  for (const d of snap.docs) {
    const data = d.data() as BusinessDocument;
    if (!data.number?.startsWith(yearPrefix)) continue;
    const seq = parseInt(data.number.substring(yearPrefix.length), 10);
    if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
  }

  return `${yearPrefix}${String(maxSeq + 1).padStart(4, '0')}`;
}

export async function createDocument(
  data: Omit<BusinessDocument, 'id' | 'number' | 'createdAt' | 'updatedAt' | 'revisions'>,
  staff: { uid: string; email?: string }
): Promise<string> {
  const number = await generateDocumentNumber(data.type);
  const ref = await addDoc(collection(db, 'documents'), {
    ...data,
    number,
    createdAt: serverTimestamp(),
    createdBy: staff.uid,
    createdByEmail: staff.email || '',
    updatedAt: serverTimestamp(),
    updatedBy: staff.uid,
    updatedByEmail: staff.email || '',
    revisions: [],
  });
  return ref.id;
}

export async function updateDocument(
  id: string,
  data: Partial<BusinessDocument>,
  staff: { uid: string; email?: string },
  changeSummary?: string
) {
  // Push a revision entry so we keep an audit trail
  const revision: DocumentRevision = {
    timestamp: new Date(),
    editedBy: staff.uid,
    editedByEmail: staff.email || '',
    changeSummary: changeSummary || 'Updated',
  };
  await updateDoc(doc(db, 'documents', id), {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: staff.uid,
    updatedByEmail: staff.email || '',
    revisions: arrayUnion(revision),
  });
}

export async function getDocument(id: string): Promise<BusinessDocument | null> {
  const snap = await getDoc(doc(db, 'documents', id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as BusinessDocument;
}

export async function getAllDocuments(typeFilter?: DocumentType): Promise<BusinessDocument[]> {
  // Avoid composite index by sorting client-side
  const q = typeFilter
    ? query(collection(db, 'documents'), where('type', '==', typeFilter))
    : query(collection(db, 'documents'));
  const snap = await getDocs(q);
  const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as BusinessDocument);
  // Sort newest first — handles Firestore Timestamp objects + missing values
  docs.sort((a, b) => {
    const at = (a.createdAt as { seconds?: number } | null)?.seconds || 0;
    const bt = (b.createdAt as { seconds?: number } | null)?.seconds || 0;
    return bt - at;
  });
  return docs;
}

export async function deleteDocument(id: string) {
  await deleteDoc(doc(db, 'documents', id));
}

