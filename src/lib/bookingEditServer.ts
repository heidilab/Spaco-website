// Staff edit of a booking — ON THE SERVER, in one transaction (site
// review 2026-11-13, phase 5; the last flow that still wrote step by step
// from the browser: lib/firestore.updateBookingDateTime + the
// booking-edit-followup route).
//
// updateBookingServer: validate the times, check the promo still applies,
// then in ONE Firestore transaction — conflict-check the new window
// (blocked_slots AND the bookings themselves, the booking's own cleaning
// buffer included), swap the blocked_slots, recompute the price exactly
// as before (add-ons keep the price they were sold at, promo rescaled,
// sticky deposit, overrides), adjust balanceDue, and reconcile the
// loyalty points of a settled booking. A cancelled / dead booking keeps
// no slots (#18).
//
// followUpAfterEdit: the passcode re-issued for the new time, the
// customer's 「預訂已更新」 email with the diff, the Google Calendar event
// updated (or created). Used by the edit route and the follow-up route.

import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './firebaseAdmin';
import { loadAllVenuesServer, venuesSharingSpaceServer } from './venueRegistryServer';
import { getVenueById, venues as staticVenues } from './venues';
import {
  calculatePricing, calculateDeposit, fixedRentOf, venueDrinksIncluded, stampAddOnPrices, subtractHours, formatAddOnsForStaff,
} from './pricing';
import { adminDiscountAmount } from './bookingMoney';
import { resolvePeakRule } from './peakDayRules';
import { calcPromoDiscount } from './promoCodes';
import { promoEligibilityReason } from './promoEligibility';
import { getHoliday } from './hkHolidays';
import { bookingWindows, editStaysWithinReservation, overlappingBookings, windowsOverlap, type OverlapBooking, type OverlapWindow } from './bookingOverlap';
import { settlementPlan } from './settlementPlan';
import { refreshPasscodeAfterTimeChange } from './lockPasscode';
import { buildBookingConfirmationEmail, generateWhatsAppLink } from './email';
import { sendAutomatedEmail } from './emailAutomations';
import { updateBookingOnCalendar, pushBookingToCalendar } from './googleCalendar';
import type { AddOnOptions, BookingRecord, PeakDayConfig, PromoCode, UserProfile, Venue } from '@/types';

export class BookingEditError extends Error {}

export interface BookingEditInput {
  date: string;
  startTime: string;
  endTime: string;
  endDate?: string;
  guestCount?: number;
  adultCount?: number;
  childCount?: number;
  venueId?: string;
  branchSlug?: string;
  addOns?: { id: string; quantity: number; options?: AddOnOptions }[];
  hasBYOFood?: boolean;
  securityDepositOverride?: number;
  subtotalOverride?: number;
}

export interface BookingEditSnapshot {
  date: string; startTime: string; endTime: string; endDate: string | null;
  venueId: string; guestCount: number; adultCount?: number; childCount?: number; addOnsLine: string;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
const DEAD = new Set(['cancelled', 'payment_not_completed']);

function physicalSpaceLockKey(venueId: string): string {
  return new Set(['sw-a', 'sw-b', 'sw-ab']).has(venueId) ? 'sw-physical' : venueId;
}

/** The booking as it stands, for the diff in the update email. */
export function editSnapshot(b: BookingRecord): BookingEditSnapshot {
  return {
    date: b.date, startTime: b.startTime, endTime: b.endTime, endDate: b.endDate || null,
    venueId: b.venueId, guestCount: b.guestCount, adultCount: b.adultCount, childCount: b.childCount,
    addOnsLine: formatAddOnsForStaff(b.addOns, 'zh'),
  };
}

export async function updateBookingServer(
  bookingId: string,
  next: BookingEditInput,
  opts: { actorUid?: string } = {},
): Promise<{ ok: true; before: BookingEditSnapshot; status: string; balanceDue?: number; pointsApplied: number; pointsShortfall: number; slotsRebuilt: boolean }> {
  // ── input ──
  if (!YMD.test(next.date) || !HHMM.test(next.startTime) || !HHMM.test(next.endTime) || (next.endDate && !YMD.test(next.endDate))) {
    throw new BookingEditError('INVALID_DATE_TIME');
  }
  const endDate = next.endDate && next.endDate !== next.date ? next.endDate : next.date;
  const overnight = endDate !== next.date;
  if (overnight && endDate < next.date) throw new BookingEditError('INVALID_DATE_TIME');
  const startMs = Date.parse(`${next.date}T${next.startTime}:00+08:00`);
  const endMs = Date.parse(`${endDate}T${next.endTime}:00+08:00`);
  if (!(endMs > startMs) || endMs - startMs > 48 * 3600000) throw new BookingEditError('INVALID_DURATION');
  for (const k of ['guestCount', 'adultCount', 'childCount'] as const) {
    const v = next[k];
    if (v !== undefined && (!Number.isInteger(v) || v < 0 || v > 500)) throw new BookingEditError('INVALID_NUMBER');
  }
  for (const k of ['securityDepositOverride', 'subtotalOverride'] as const) {
    const v = next[k];
    if (v !== undefined && (!Number.isFinite(v) || v < 0 || v > 10_000_000)) throw new BookingEditError('INVALID_NUMBER');
  }
  if (next.addOns !== undefined && (!Array.isArray(next.addOns) || next.addOns.length > 30)) throw new BookingEditError('INVALID_ADDONS');

  const bookingRef = adminDb.collection('bookings').doc(bookingId);
  const first = await bookingRef.get();
  if (!first.exists) throw new BookingEditError('BOOKING_NOT_FOUND');
  const booking0 = { ...(first.data() as BookingRecord), id: bookingId };
  const before = editSnapshot(booking0);

  const targetVenueId = next.venueId || booking0.venueId;
  const venueChanged = next.venueId !== undefined && next.venueId !== booking0.venueId;
  const registry = await loadAllVenuesServer();
  const venueForPricing: Venue | undefined = registry.find((v) => v.id === targetVenueId) ?? getVenueById(targetVenueId) ?? staticVenues.find((v) => v.id === targetVenueId);
  if (!venueForPricing && !booking0.packageSlug) throw new BookingEditError(`VENUE_NOT_FOUND:${targetVenueId}`);

  // The promo must still apply to the new date / branch.
  let promoDoc: PromoCode | null = null;
  if (booking0.promoCodeId) {
    const ps = await adminDb.collection('promo_codes').doc(booking0.promoCodeId).get();
    promoDoc = ps.exists ? ({ ...(ps.data() as PromoCode), id: ps.id }) : null;
    if (promoDoc && (venueChanged || next.date !== booking0.date || endDate !== (booking0.endDate || booking0.date))
      && promoEligibilityReason(promoDoc, { venueId: targetVenueId, date: next.date, endDate, packageSlug: booking0.packageSlug })) {
      throw new BookingEditError('PROMO_NOT_APPLICABLE');
    }
  }
  const peakSnap = await adminDb.collection('peak_days').doc(next.date).get();
  const peakCfg = peakSnap.exists ? (peakSnap.data() as PeakDayConfig) : null;

  // ── windows ──
  const effAddOns = next.addOns ?? booking0.addOns ?? [];
  const earlySetupHours = Math.max(0, Math.min(3, Math.floor(effAddOns.find((a) => a.id === 'early-setup')?.quantity || 0)));
  if (earlySetupHours > 0 && toMin(next.startTime) - earlySetupHours * 60 < 0) throw new BookingEditError('EARLY_SETUP_BEFORE_DAY');
  const setupStart = earlySetupHours > 0 ? subtractHours(next.startTime, earlySetupHours) : null;
  const [endH, endM] = next.endTime.split(':').map(Number);
  const bufferEnd = endH + 1 >= 24 ? '23:59' : `${String(endH + 1).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
  const requested: OverlapWindow[] = overnight
    ? [{ date: next.date, startTime: next.startTime, endTime: '23:59' }, { date: endDate, startTime: '00:00', endTime: next.endTime }]
    : [{ date: next.date, startTime: next.startTime, endTime: next.endTime }];
  // The booking's own cleaning buffer must be free too (review #15).
  requested.push({ date: endDate, startTime: next.endTime, endTime: bufferEnd });
  if (setupStart) requested.push({ date: next.date, startTime: setupStart, endTime: next.startTime });
  const staysWithin = !venueChanged && editStaysWithinReservation(
    { venueId: booking0.venueId, date: booking0.date, endDate: booking0.endDate, startTime: booking0.startTime, endTime: booking0.endTime,
      earlySetupHours: booking0.earlySetupHours ?? booking0.addOns?.find((a) => a.id === 'early-setup')?.quantity ?? 0 },
    { venueId: targetVenueId, date: next.date, endDate, startTime: next.startTime, endTime: next.endTime, earlySetupHours },
  );
  const sharedVenues = await venuesSharingSpaceServer(targetVenueId).catch(() => [targetVenueId]);
  const lockKey = venueForPricing?.spaceGroup ?? physicalSpaceLockKey(targetVenueId);
  const dates = Array.from(new Set([next.date, endDate]));
  const production = process.env.VERCEL_ENV === 'production';
  const hours = Math.max(1, Math.round(((endMs - startMs) / 3600000) * 2) / 2);

  const result = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(bookingRef);
    if (!snap.exists) throw new BookingEditError('BOOKING_NOT_FOUND');
    const booking = { ...(snap.data() as BookingRecord), id: bookingId };
    const keepSlots = !DEAD.has(booking.status);

    // Reads first: locks, the shared space's slots, candidate bookings,
    // this booking's own slots, the customer (points).
    for (const d of dates) await tx.get(adminDb.collection('_venue_booking_locks').doc(`${lockKey}_${d}`));
    const slotDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    const candidateDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    if (keepSlots && !staysWithin) {
      for (const vid of sharedVenues) {
        for (const d of dates) {
          slotDocs.push(...(await tx.get(adminDb.collection('blocked_slots').where('venueId', '==', vid).where('date', '==', d))).docs);
          for (const field of ['date', 'endDate'] as const) {
            candidateDocs.push(...(await tx.get(adminDb.collection('bookings').where('venueId', '==', vid).where(field, '==', d))).docs);
          }
        }
      }
    }
    const ownSlots = (await tx.get(adminDb.collection('blocked_slots').where('bookingId', '==', bookingId))).docs;
    const userRef = booking.userId ? adminDb.collection('users').doc(booking.userId) : null;
    const userSnap = userRef ? await tx.get(userRef) : null;

    // ── conflict check ──
    if (keepSlots && !staysWithin) {
      for (const docSnap of slotDocs) {
        const s = docSnap.data() as { date: string; startTime: string; endTime: string; bookingId?: string | null; googleEventId?: string; isTest?: boolean };
        if (s.bookingId === bookingId) continue;
        if (booking.googleEventId && s.googleEventId === booking.googleEventId) continue;
        if (s.isTest && production) continue;
        if (requested.some((w) => windowsOverlap(w, { date: s.date, startTime: s.startTime, endTime: s.endTime }))) {
          throw new BookingEditError(`SLOT_CONFLICT:${targetVenueId}${s.bookingId ? ` #${s.bookingId.slice(0, 8)}` : ''}`);
        }
      }
      const seen = new Set<string>();
      const clashes = overlappingBookings(requested,
        candidateDocs.filter((d) => !seen.has(d.id) && seen.add(d.id)).map((d) => ({ id: d.id, ...(d.data() as Omit<OverlapBooking, 'id'>) })),
        { production, excludeId: bookingId });
      if (clashes.length) throw new BookingEditError(`SLOT_CONFLICT:${targetVenueId} #${clashes[0].id?.slice(0, 8)}`);
    }

    // ── the patch ──
    const patch: Record<string, unknown> = {
      date: next.date, startTime: next.startTime, endTime: next.endTime, endDate: overnight ? endDate : null, hours,
      earlySetupHours, updatedAt: FieldValue.serverTimestamp(),
      ...(opts.actorUid ? { lastEditedBy: opts.actorUid, lastEditedAt: FieldValue.serverTimestamp() } : {}),
    };
    if (typeof next.guestCount === 'number') patch.guestCount = next.guestCount;
    if (typeof next.adultCount === 'number') patch.adultCount = next.adultCount;
    if (typeof next.childCount === 'number') patch.childCount = next.childCount;
    if (typeof next.guestCount === 'number' && typeof next.adultCount !== 'number') {
      const kids = typeof next.childCount === 'number' ? next.childCount : (booking.childCount ?? 0);
      patch.adultCount = Math.max(0, next.guestCount - kids);
    }
    if (typeof next.hasBYOFood === 'boolean') patch.hasBYOFood = next.hasBYOFood;
    if (next.addOns) patch.addOns = next.addOns;
    if (venueChanged) {
      patch.venueId = next.venueId;
      if (next.branchSlug) patch.branchSlug = next.branchSlug;
      patch.googleEventId = null;
    }

    const pricingInputsChanged = next.addOns !== undefined || typeof next.guestCount === 'number' || typeof next.adultCount === 'number'
      || typeof next.childCount === 'number' || next.date !== booking.date || venueChanged || hours !== booking.hours
      || typeof next.securityDepositOverride === 'number' || typeof next.subtotalOverride === 'number';
    let pointsApplied = 0;
    let pointsShortfall = 0;
    let balanceDue: number | undefined;

    if (pricingInputsChanged && !booking.packageSlug && venueForPricing) {
      const day = new Date(`${next.date}T12:00:00+08:00`).getUTCDay();
      const holiday = getHoliday(next.date);
      const nextDayStr = new Date(Date.parse(`${next.date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
      const eveHoliday = getHoliday(nextDayStr);
      let isWeekend = day === 5 || day === 6 || holiday?.type === 'public' || eveHoliday?.type === 'public';
      const guests = typeof next.guestCount === 'number' ? next.guestCount : booking.guestCount;
      const children = typeof next.childCount === 'number' ? next.childCount : (booking.childCount ?? 0);
      const incoming = next.addOns ?? booking.addOns ?? [];
      const addOns = stampAddOnPrices(
        venueChanged ? incoming.map((a) => { if (typeof a.options?.unitPrice !== 'number') return a; const o = { ...a.options }; delete o.unitPrice; return { ...a, options: o }; }) : incoming,
        venueForPricing, venueChanged ? null : booking.addOns,
      );
      if (next.addOns) patch.addOns = addOns;
      const peakRule = resolvePeakRule(peakCfg, targetVenueId);
      if (peakRule?.forceWeekendRate && !isWeekend) isWeekend = true;
      patch.isWeekend = isWeekend;
      const computed = calculatePricing(venueForPricing, isWeekend, hours, guests, addOns, children, peakRule?.surchargePerHead || 0, booking.peakSurchargeOverride, fixedRentOf(booking));

      // Promo rescaled against the new bill (per_pax / percent / free_drinks).
      let promoDiscount = booking.promoDiscount || 0;
      const isFreeDrinksPromo = typeof booking.promoFreeDrinksCost === 'number' && booking.promoFreeDrinksCost > 0;
      const hasDrinksAddOn = addOns.some((a) => a.id === 'drinks');
      const promoAdults = Math.max(0, guests - children);
      const promoAdultEquiv = promoAdults + 0.5 * children;
      const drinksCost = hasDrinksAddOn && !venueDrinksIncluded(venueForPricing, targetVenueId) ? Math.round(25 * promoAdultEquiv) : 0;
      let promoRecomputed = false;
      if (promoDiscount > 0 && promoDoc) {
        const pcForRescale = { ...promoDoc, enabled: true, startDate: undefined, endDate: undefined, venueIds: undefined, minSubtotal: undefined, excludedDateRanges: undefined, packageScope: 'all', appliesToStandardBookings: true } as PromoCode;
        const d = calcPromoDiscount(pcForRescale, {
          subtotal: typeof next.subtotalOverride === 'number' ? Math.max(0, next.subtotalOverride) : computed.subtotal,
          baseCharge: computed.baseCharge, adultEquiv: promoAdultEquiv, drinksCost, venueId: targetVenueId,
        });
        if (d) { promoDiscount = d.amount; patch.promoDiscount = d.amount; patch.promoFreeDrinksCost = d.freeDrinks ? drinksCost : 0; promoRecomputed = true; }
      }
      if (!promoRecomputed && isFreeDrinksPromo) {
        promoDiscount = hasDrinksAddOn ? drinksCost : 0;
        patch.promoDiscount = promoDiscount;
        patch.promoFreeDrinksCost = promoDiscount;
      }
      const pointsDiscount = booking.pointsDiscount || 0;
      const baseSubtotal = typeof next.subtotalOverride === 'number' ? Math.max(0, next.subtotalOverride) : computed.subtotal;
      const newAddOnTotal = computed.addOnTotal;
      const newBaseCharge = typeof next.subtotalOverride === 'number' ? Math.max(0, baseSubtotal - newAddOnTotal) : computed.baseCharge;
      const wasPaid = booking.status === 'confirmed' || booking.status === 'completed' || !!booking.paymentVerifiedAt;
      const stickyDeposit = typeof next.securityDepositOverride === 'number'
        ? Math.max(0, next.securityDepositOverride)
        : (wasPaid || booking.isCommercial) && typeof booking.pricing.securityDeposit === 'number' ? booking.pricing.securityDeposit : computed.securityDeposit;
      const adminDisc = adminDiscountAmount({ pricing: { baseCharge: newBaseCharge, addOnTotal: newAddOnTotal, subtotal: baseSubtotal, deposit: 0 }, adminDiscount: booking.adminDiscount });
      const effectiveGrandTotal = Math.max(0, baseSubtotal - promoDiscount - pointsDiscount - adminDisc) + stickyDeposit;
      const paidSoFar = (booking.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
      patch['pricing.baseCharge'] = newBaseCharge;
      patch['pricing.addOnTotal'] = newAddOnTotal;
      patch['pricing.subtotal'] = baseSubtotal;
      patch['pricing.securityDeposit'] = stickyDeposit;
      patch['pricing.deposit'] = calculateDeposit(effectiveGrandTotal, next.date);
      balanceDue = Math.max(0, effectiveGrandTotal - paidSoFar);
      patch.balanceDue = balanceDue;
      if (balanceDue > 0 && booking.status === 'completed') patch.status = 'confirmed';

      // A settled booking's points follow the new bill (the recalc used to
      // do this from the browser in a second step).
      if (booking.pointsCreditedAt && userRef && userSnap?.exists) {
        const stored = (booking.depositRefund as { deductions?: Array<{ label: string; amount: number }> } | null)?.deductions || [];
        const plan = settlementPlan({
          ...booking,
          pricing: { ...booking.pricing, baseCharge: newBaseCharge, addOnTotal: newAddOnTotal, subtotal: baseSubtotal, securityDeposit: stickyDeposit },
          promoDiscount, pointsDiscount,
        }, stored);
        if (plan.pointsDelta !== 0) {
          const current = (userSnap.data() as UserProfile).loyaltyPoints || 0;
          pointsApplied = plan.pointsDelta > 0 ? plan.pointsDelta : -Math.min(current, -plan.pointsDelta);
          pointsShortfall = plan.pointsDelta < 0 ? (-plan.pointsDelta) - (-pointsApplied) : 0;
          tx.update(userRef, { loyaltyPoints: current + pointsApplied });
          patch.pointsActuallyCredited = (booking.pointsActuallyCredited || 0) + pointsApplied;
        }
      }
    }

    // ── slots ──
    for (const s of ownSlots) tx.delete(s.ref);
    let slotsRebuilt = false;
    if (keepSlots) {
      const stamp = booking.isTest ? { isTest: true } : {};
      const add = (data: object) => tx.create(adminDb.collection('blocked_slots').doc(), { ...data, ...stamp });
      const vid = targetVenueId;
      if (overnight) {
        add({ venueId: vid, date: next.date, startTime: next.startTime, endTime: '23:59', reason: 'booking', bookingId });
        add({ venueId: vid, date: endDate, startTime: '00:00', endTime: next.endTime, reason: 'booking', bookingId });
        add({ venueId: vid, date: endDate, startTime: next.endTime, endTime: bufferEnd, reason: 'cleaning', bookingId });
      } else {
        add({ venueId: vid, date: next.date, startTime: next.startTime, endTime: next.endTime, reason: 'booking', bookingId });
        add({ venueId: vid, date: next.date, startTime: next.endTime, endTime: bufferEnd, reason: 'cleaning', bookingId });
      }
      if (setupStart) add({ venueId: vid, date: next.date, startTime: setupStart, endTime: next.startTime, reason: 'setup', bookingId });
      for (const d of dates) tx.set(adminDb.collection('_venue_booking_locks').doc(`${lockKey}_${d}`), { lastBookingAt: FieldValue.serverTimestamp() }, { merge: true });
      slotsRebuilt = true;
    }
    tx.update(bookingRef, patch);
    return { status: (patch.status as string) || booking.status, balanceDue, pointsApplied, pointsShortfall, slotsRebuilt };
  });
  return { ok: true, before, ...result };
}

/**
 * After an edit: passcode re-issued for the new time, the customer's
 * update email (with what changed), the Google Calendar event updated —
 * or created, if it has none and the booking is paid. Each step is best
 * effort and reported; nothing here changes the booking's money.
 */
export async function followUpAfterEdit(
  bookingId: string,
  origin: string,
  opts: { previousSnapshot?: Partial<BookingEditSnapshot>; email: boolean; resend?: boolean; updatedBalance?: number | null },
): Promise<{ effects: Record<string, 'done' | 'skipped' | 'failed'>; errors: Record<string, string> }> {
  const effects: Record<string, 'done' | 'skipped' | 'failed'> = {};
  const errors: Record<string, string> = {};
  const run = async (key: string, fn: () => Promise<'done' | 'skipped' | void>) => {
    try { effects[key] = (await fn()) || 'done'; }
    catch (err) { effects[key] = 'failed'; errors[key] = (err instanceof Error ? err.message : String(err)).slice(0, 300); console.error(`[bookingEdit] ${key} failed:`, err); }
  };
  const bookingRef = adminDb.collection('bookings').doc(bookingId);
  const freshData = (await bookingRef.get()).data() as BookingRecord | undefined;
  if (!freshData) return { effects: { booking: 'failed' }, errors: { booking: 'BOOKING_NOT_FOUND' } };
  const fresh: BookingRecord = { ...freshData, id: bookingId };

  await run('lock', async () => { const r = await refreshPasscodeAfterTimeChange(bookingId); return r.refreshed ? 'done' : 'skipped'; });

  const userSnap = fresh.userId ? await adminDb.collection('users').doc(fresh.userId).get() : null;
  const profile = userSnap?.exists ? (userSnap.data() as UserProfile) : null;
  const customerEmail = profile?.email || fresh.customerEmail || undefined;
  const registryVenues = await loadAllVenuesServer();
  const findVenue = (id: string) => registryVenues.find((v) => v.id === id) ?? staticVenues.find((v) => v.id === id);
  const venue = findVenue(fresh.venueId);
  const venueName = venue?.name.zh || fresh.branchSlug;

  await run('email', async () => {
    if (!opts.email || !customerEmail) return 'skipped';
    const changes: string[] = [];
    const prev = opts.previousSnapshot;
    if (prev) {
      const venueLabel = (id?: string) => (id ? (findVenue(id)?.name.zh || id) : '');
      if (prev.date && prev.date !== fresh.date) changes.push(`日期: ${prev.date} → ${fresh.date}`);
      const newRange = `${fresh.startTime}-${fresh.endTime}`;
      const oldRange = `${prev.startTime || ''}-${prev.endTime || ''}`;
      if ((prev.startTime || prev.endTime) && newRange !== oldRange) changes.push(`時段: ${oldRange} → ${newRange}`);
      if (prev.venueId && prev.venueId !== fresh.venueId) changes.push(`場地: ${venueLabel(prev.venueId)} → ${venueLabel(fresh.venueId)}`);
      if (typeof prev.guestCount === 'number' && prev.guestCount !== fresh.guestCount) changes.push(`人數: ${prev.guestCount} 人 → ${fresh.guestCount} 人`);
      const newAddOnsLine = formatAddOnsForStaff(fresh.addOns, 'zh');
      if (prev.addOnsLine !== undefined && prev.addOnsLine !== newAddOnsLine) changes.push(`附加服務: ${prev.addOnsLine || '(無)'} → ${newAddOnsLine || '(無)'}`);
    }
    if (!opts.resend && prev && changes.length === 0) return 'skipped';
    const whatsappNumber = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || '85292823060';
    const tpl = buildBookingConfirmationEmail({
      customerName: profile?.displayName || fresh.customerName || (customerEmail ? customerEmail.split('@')[0] : '客人'),
      venueId: fresh.venueId, venueName, venueAddress: venue?.address.zh,
      date: fresh.date, startTime: fresh.startTime, endTime: fresh.endTime, endDate: fresh.endDate,
      guestCount: fresh.guestCount, adultCount: fresh.adultCount, childCount: fresh.childCount,
      subtotal: fresh.pricing.subtotal, deposit: fresh.pricing.deposit, securityDeposit: fresh.pricing.securityDeposit,
      promoCode: fresh.promoCode, promoDiscount: fresh.promoDiscount, adminDiscount: adminDiscountAmount(fresh as never),
      pointsUsed: fresh.pointsUsed, pointsDiscount: fresh.pointsDiscount,
      balanceDue: opts.updatedBalance ?? fresh.balanceDue, balanceDueDate: fresh.balanceDueDate,
      addOnsLine: formatAddOnsForStaff(fresh.addOns, 'zh'), paymentMethod: fresh.paymentMethod || 'Online',
      whatsappLink: generateWhatsAppLink(whatsappNumber, `你好，我嘅預訂編號：${bookingId}\n場地：${venueName}\n日期：${fresh.date}`),
      changes: changes.length > 0 ? changes : undefined,
    });
    const r = await sendAutomatedEmail({ automationKey: 'booking_confirmation', to: customerEmail, subject: tpl.subject, html: tpl.html });
    return r.sent ? 'done' : 'skipped';
  });

  await run('gcal', async () => {
    const redirectUri = `${origin}/api/google/callback`;
    if (fresh.googleEventId) { await updateBookingOnCalendar(redirectUri, { booking: fresh, customerName: profile?.displayName }); return 'done'; }
    const id = await pushBookingToCalendar(redirectUri, { booking: fresh, customerName: profile?.displayName });
    if (!id) return 'skipped';
    await bookingRef.update({ googleEventId: id, updatedAt: FieldValue.serverTimestamp() });
  });
  return { effects, errors };
}

/** Re-export for routes that only need the windows. */
export { bookingWindows };
