/**
 * Tab-scoped sessionStorage buffer for an in-progress booking.
 *
 * The customer fills the booking form (/book/{slug} or /book/package/{slug}),
 * clicks "繼續預訂", and we redirect to /book/{slug}/confirm/new — but we
 * deliberately DO NOT write anything to Firestore yet. The form payload
 * lives here in sessionStorage until the customer picks a payment method
 * on the confirm page, at which point the booking + blocked_slots are
 * written atomically. This prevents the pre-payment "pending" rows that
 * used to pollute /admin/bookings and confuse staff (see commit history
 * around the #Ebthocjl phantom-payment issue).
 *
 * sessionStorage scope: one tab, cleared when tab closes — so the draft
 * is isolated per checkout attempt. If the customer comes back later in
 * a fresh tab, they restart the form (the same UX as today).
 */

import type { BookingRecord, AddOnOptions, RefundDetails, MarketingChannel } from '@/types';

const STORAGE_KEY = 'spaco.bookingCheckoutDraft';
// Stale drafts (older than 1h) are discarded — the customer's selected
// time slot may no longer be reasonable and pricing tiers/promos may
// have shifted. Forcing a redo is safer than honouring a stale form.
const MAX_AGE_MS = 60 * 60 * 1000;

/**
 * Everything we need from the booking form to call createBooking() on
 * the confirm page. Mirrors the Omit<BookingRecord, …> shape used by
 * lib/firestore.ts createBooking + the package flow, minus the fields
 * that get filled in on the confirm page (refund details, payment
 * method, status, promo code, etc.).
 */
export interface BookingCheckoutDraft {
  /** ms-since-epoch when the draft was created — used for stale detection. */
  createdAtMs: number;
  /** Source page that wrote the draft, for analytics / debugging only. */
  source: 'venue' | 'package';

  // Venue + time
  branchSlug: string;
  venueId: string;
  date: string;
  startTime: string;
  endTime: string;
  endDate?: string;
  hours: number;

  // Guests
  guestCount: number;
  adultCount: number;
  childCount: number;
  isWeekend: boolean;

  // Add-ons
  addOns: { id: string; quantity: number; options?: AddOnOptions }[];
  hasBYOFood: boolean;

  // Pricing snapshot — frozen at form submission so confirm page reflects
  // the price the customer agreed to even if rules change mid-flight.
  pricing: BookingRecord['pricing'];

  /** Set when this is a package booking; drives the confirm page to
   *  skip à-la-carte controls (promo / loyalty / drinks auto-add). */
  packageSlug?: string;
  decorationStyle?: 'blue' | 'pink' | 'khaki';

  /** Pre-validated WhatsApp E.164 — saved here so the confirm page can
   *  pre-fill it onto the booking and update the user profile. */
  whatsappPhone?: string;

  // ─── Confirm-page additions (set after the customer completes
  //     /confirm/new — promo, points, refund details, marketing). The
  //     payment page reads these and writes them onto the real booking
  //     at createBooking() time. None of them touch Firestore in draft
  //     mode — pure client state until the customer commits.
  refundDetails?: RefundDetails;
  promoCode?: string;
  promoCodeId?: string;
  promoDiscount?: number;
  promoFreeDrinksCost?: number;
  pointsUsed?: number;
  pointsDiscount?: number;
  marketingChannel?: MarketingChannel | 'loyalty_member';
  marketingChannelOther?: string;
  /** Final upfront amount the customer agreed to pay (HK$) — already
   *  net of promo/points. Mirrors the booking record's pricing.deposit
   *  so /payment/new can charge the right amount. */
  effectiveDeposit?: number;
  /** Outstanding balance (HK$) — what the customer owes after the
   *  upfront deposit lands. Matches BookingRecord.balanceDue. */
  effectiveBalanceDue?: number;
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && !!window.sessionStorage;
}

export function saveBookingCheckoutDraft(
  draft: Omit<BookingCheckoutDraft, 'createdAtMs'>,
): void {
  if (!isBrowser()) return;
  const payload: BookingCheckoutDraft = { ...draft, createdAtMs: Date.now() };
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota / private-mode failures are non-fatal — confirm page will
    // detect the missing draft and bounce the customer back to the form.
  }
}

export function loadBookingCheckoutDraft(): BookingCheckoutDraft | null {
  if (!isBrowser()) return null;
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as BookingCheckoutDraft;
    if (!parsed.createdAtMs || Date.now() - parsed.createdAtMs > MAX_AGE_MS) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    sessionStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function clearBookingCheckoutDraft(): void {
  if (!isBrowser()) return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* non-blocking */
  }
}
