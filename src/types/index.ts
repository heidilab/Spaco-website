export interface Venue {
  id: string;
  slug: string;
  name: { zh: string; en: string };
  subtitle: { zh: string; en: string };
  description: { zh: string; en: string };
  /** Full street address — used in booking confirmation emails and the
   *  door-passcode email so guests know exactly where to go. */
  address: { zh: string; en: string };
  branch: string;
  capacity: { min: number; max: number };
  size: string;
  vibes: string[];
  amenities: string[];
  images: string[];
  pricing: {
    weekday: PricingTier;
    weekend: PricingTier;
  };
  minHours: { weekday: number; weekend: number };
  minGuests: { weekday: number; weekend: number };

  // ── Dynamic-venue fields (Firestore venues collection; 分店管理) ──
  /** false = 落架 — hidden from the site, no new bookings; history kept.
   *  Absent (legacy/static) = active. */
  active?: boolean;
  /** Display order on the homepage collection (ascending). */
  sortOrder?: number;
  /** Shared-space group key (e.g. 'sw-physical'). Venues carrying the
   *  same non-empty group block each other's timeslots — the 上環
   *  Room A / B / 全層 structure, configurable per venue. */
  spaceGroup?: string;
  /** Within a spaceGroup: ids whose bookings block THIS venue. The
   *  venue itself is always implied. E.g. sw-a → ['sw-ab']. */
  conflictsWith?: string[];
  /** Venue capability flags — replaces the hard-coded venue-id lists
   *  (noBBQVenues / freeDrinksVenues / earlySetupPriceByVenue). */
  bbqAvailable?: boolean;
  /** Venue includes unlimited non-alcoholic drinks in the base rate. */
  drinksIncluded?: boolean;
  /** 提早入場佈置 per-hour price (HK$). */
  earlySetupPricePerHour?: number;
  /** BBQ standard package per-head price override for this venue. */
  bbqStandardPrice?: number;
  /** Google Calendar id for the per-venue sync (optional — sync off
   *  until filled). */
  gcalCalendarId?: string;
  /** TTLock lock id for automatic door passcodes (optional). */
  ttlockLockId?: string;
  /** Free-text facilities list shown on the branch page (one per line).
   *  Migrated from 內容管理/分店資料 2026-08. */
  amenitiesText?: { zh?: string; en?: string };
  /** Switch games list, one per line. */
  switchGames?: { zh?: string; en?: string };
  /** Board games list, one per line. */
  boardGames?: { zh?: string; en?: string };
  /** 分店 grouping key — venues (分拆場地/rooms) sharing this key are
   *  ONE branch, managed together in 分店管理 and sharing one Google
   *  Calendar ID + address. Single-space branches: branchKey === id. */
  branchKey?: string;
  /** Branch display name (shared across the branch's rooms). */
  branchName?: { zh: string; en: string };
  /** Room label within a multi-room branch (e.g. Room A / 全層 A+B). */
  roomLabel?: { zh?: string; en?: string };
}

export interface PricingTier {
  perHead: number;
  roomCharge?: number;
}

export interface AddOn {
  id: string;
  name: { zh: string; en: string };
  pricePerUnit: number;
  unit: 'person' | 'flat' | 'item';
  maxQuantity?: number;
  description?: { zh: string; en: string };
  /** Optional named variants — used by add-ons like Shisha where each
   *  unit has a sub-selection (flavor). The category is for grouping
   *  in the UI dropdown. */
  variants?: { id: string; name: { zh: string; en: string }; category?: string }[];
}

/** Per-add-on user-chosen extras. Currently only used by Shisha. Stored
 *  alongside `quantity` on each addOns entry so the pricing calc + display
 *  surfaces can resolve flavors and setup option without a parallel field.
 *
 *  Shisha pricing model:
 *    1 pipe + 1 head  = $390   (base, single)
 *    2 pipes + 2 heads = $750  (base, double)
 *    Each extra head  = +$250  (heads beyond pipes count, used for swapping
 *                                a fresh head onto a pipe mid-session)
 *  Each venue allows max 2 pipes simultaneously. Heads must be ≥ pipes
 *  (every pipe needs at least one head to start). On the addOns entry we
 *  store `quantity = total head count` so the existing display surfaces
 *  (×N suffix) keep working; `pipes` lives on options. */
export interface AddOnOptions {
  /** How many shisha pipes (1 or 2). Constrained by venue (max 2). */
  pipes?: number;
  /** Flavor variant ids picked, one per head (so length === quantity). */
  flavors?: string[];
  /** Whether the customer wants staff setup (+$180 flat). */
  staffSetup?: boolean;
  /** HH:mm slot customer wants the shisha setup done. Required when
   *  staffSetup is true so the supplier can dispatch a staffer on
   *  time. Must fall within the booking session. Heidi 2026-06-22. */
  staffSetupTime?: string;
  /** Admin-defined name for custom add-on entries (id starts with
   *  `custom-`). Customers can't add these; admin enters their own
   *  description here. Shown on the booking detail page + Google
   *  Calendar description + receipts. */
  customName?: string;
  /** Admin-defined flat price in HK$ for custom add-on entries. */
  customPrice?: number;
  // ── Catering add-on (id === 'catering') ──
  /** Pricing tier id from CATERING_TIERS (e.g. 'tier-10'). */
  tierId?: string;
  /** Catering item codes selected (e.g. ['101', '142', 'A1']). */
  dishCodes?: string[];
  /** Delivery zone id from CATERING_DELIVERY_ZONES. */
  deliveryZoneId?: string;
  /** Door-to-door delivery (+$150). Defaults to lobby pickup (free). */
  doorstepDelivery?: boolean;
  /** Skip cutlery for −$10/order. */
  noCutlery?: boolean;
  /** Additional cutlery sets beyond the included one (+$3 each). */
  extraCutlerySets?: number;
  /** Additional food tongs beyond the included one (+$9 each). */
  extraFoodTongs?: number;
  /** Customer-chosen delivery time slot HH:mm. Must fall within the
   *  booking's [startTime, endTime] so the customer is on-site to
   *  accept the supplier's delivery directly. */
  deliveryTime?: string;
}

export interface BookingState {
  venueId: string;
  date: string;
  startTime: string;
  endTime: string;
  guestCount: number;
  adultCount?: number;
  childCount?: number;
  addOns: { id: string; quantity: number; options?: AddOnOptions }[];
}

export interface FilterState {
  capacity: string | null;
  vibe: string | null;
  amenities: string[];
}

export type DepositTier = {
  threshold: number;
  deposit: number;
};

// ============ Firebase Types ============

/** Where to send the post-event security-deposit refund. Captured during
 *  the booking flow because the deposit is refunded by FPS / bank transfer
 *  (not via Stripe), so we need destination details upfront. */
export interface RefundDetails {
  method: 'fps' | 'bank';
  /** FPS phone / FPS ID / email — whichever the customer registered. */
  fpsIdentifier?: string;
  /** Bank name (e.g. "BEA Bank", "HSBC"). */
  bankName?: string;
  /** Account holder English name (must match bank record). */
  accountHolderName?: string;
  /** Bank account number including branch code. */
  accountNumber?: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  phone: string;
  /** WhatsApp contact number (HK format). Required for booking confirmation
   *  so admin / CS can message the customer directly. */
  whatsappPhone?: string;
  loyaltyPoints: number;
  /** Marketing channel selected at first booking. Persisted on the user
   *  so subsequent bookings auto-tag as "Loyalty Member" without
   *  re-asking. One of MarketingChannel ids. */
  firstBookingChannel?: MarketingChannel | (string & {});
  /** Free-text detail when firstBookingChannel === 'other'. */
  firstBookingChannelOther?: string;
  createdAt: unknown;
  lastLogin: unknown;
}

export type MarketingChannel = 'google' | 'instagram' | 'facebook' | 'xiaohongshu' | 'referral' | 'other';

export const MARKETING_CHANNEL_LABELS: Record<MarketingChannel, { zh: string; en: string }> = {
  google:      { zh: 'Google',          en: 'Google' },
  instagram:   { zh: 'Instagram',       en: 'Instagram' },
  facebook:    { zh: 'Facebook',        en: 'Facebook' },
  xiaohongshu: { zh: '小紅書',          en: '小紅書 (RED)' },
  referral:    { zh: '朋友介紹',        en: 'Friend referral' },
  other:       { zh: '其他',            en: 'Other' },
};

export interface BookingRecord {
  id: string;
  userId: string;
  /** Customer's WhatsApp number captured at booking time. Stored on the
   *  booking record so admin / CS can contact the customer even if the
   *  user later updates their profile. */
  whatsappPhone?: string;
  venueId: string;
  branchSlug: string;
  date: string;
  startTime: string;
  endTime: string;
  /** End date when the booking spans midnight (e.g. start 19:00 on
   *  May 20, end 02:00 on May 21 → date='2026-05-20', endDate='2026-05-21').
   *  When absent or equal to `date`, the booking ends on the same day. */
  endDate?: string;
  hours: number;
  /** Total head count = adultCount + childCount. Kept for backward
   *  compatibility with bookings created before the adult/child split. */
  guestCount: number;
  /** Number of adults (10+ years old). When unset on legacy bookings,
   *  treat the full guestCount as adults. */
  adultCount?: number;
  /** Number of children aged 1–9. They count as 0.5 adult-equivalent
   *  for minimum-charge calculation and pay half on per-head charges
   *  (venue rental, BBQ, hotpot, drinks). */
  childCount?: number;
  isWeekend: boolean;
  addOns: { id: string; quantity: number; options?: AddOnOptions }[];
  hasBYOFood: boolean;
  /** Hours of early setup access (提早入場佈置) booked before startTime.
   *  Mirrors the 'early-setup' add-on quantity; the setup window
   *  (startTime − N hrs → startTime) is locked via a 'setup'
   *  blocked_slot. */
  earlySetupHours?: number;
  pricing: {
    baseCharge: number;
    addOnTotal: number;
    /** Rental subtotal: baseCharge + addOnTotal (excludes 按金). */
    subtotal: number;
    /** Refundable security deposit (按金) — refunded after event. Tiered
     *  against subtotal: 1000 / 2000 / 4000.  Optional for backwards
     *  compatibility with bookings created before this field existed. */
    securityDeposit?: number;
    /** Amount due upfront to confirm: full grandTotal if ≤ HK$10k, else 50%. */
    deposit: number;
  };
  /** Audit log of payments captured for this booking — original deposit,
   *  balance payment, and any admin-recorded top-ups (e.g. WhatsApp FPS
   *  for an overnight extension). Each entry is append-only. Rental and
   *  deposit splits let downstream code (loyalty credit, deposit refund)
   *  attribute the money to the right bucket. */
  payments?: Array<{
    /** HK$ portion paid against venue rental (場租, baseCharge). */
    rentalAmount: number;
    /** HK$ portion paid against add-ons (附加項目). Optional for
     *  backwards compatibility — legacy entries (before the three-way
     *  split) lumped this in with rentalAmount. */
    addOnAmount?: number;
    /** HK$ portion paid into the refundable security deposit (按金). */
    depositAmount: number;
    /** Total = rentalAmount + addOnAmount + depositAmount, stored for
     *  convenience. */
    amount: number;
    method: 'kpay' | 'stripe' | 'fps' | 'bank' | 'cash' | 'other';
    note?: string | null;
    /** Optional tag describing what this payment is for — used to
     *  distinguish the first deposit from a later balance payment from
     *  an admin top-up. Keeps the audit log readable. */
    kind?: 'initial' | 'balance' | 'topup';
    recordedBy: string;     // admin uid OR 'stripe-webhook' for automated
    recordedAt: unknown;    // Firestore Timestamp / ISO string
    /** HK$ card-network surcharge the CUSTOMER paid on top of `amount`
     *  (KPay card/Apple Pay/Google Pay +1.5%). Not part of the booking's
     *  own math — `amount` is already the base credited to the booking. */
    cardSurcharge?: number;
  }>;
  /** Pending card surcharges keyed by KPay managedOutTradeNo — written
   *  at checkout, consumed by the KPay webhook to split base vs
   *  surcharge on the resulting payment entry. */
  kpaySurcharges?: Record<string, number>;
  /** Audit log of KPay refunds issued against this booking's card/QR
   *  payments (via /api/kpay/refund → KPay /v1/refund). Recorded by the
   *  REFUND webhook; does not affect balanceDue/status. */
  kpayRefunds?: Array<{
    /** Refunded amount in HKD. */
    amount: number;
    /** KPay business state: 2=success 3=failed. */
    state: number;
    stateDesc?: string | null;
    /** KPay's refund order number. */
    kpayOrderNo?: string;
    /** KPay's refund transaction number (idempotency key). */
    kpayTransactionNo?: string;
    /** Our refund merchant trade number (R<bookingId>_<epoch>). */
    refundOutTradeNo?: string;
    recordedAt: unknown;
  }>;
  /** Marketing channel snapshot — captured on the customer's FIRST
   *  booking (mandatory question). Repeat customers auto-tag as
   *  'loyalty_member' (a sentinel that's not a real MarketingChannel).
   *  Stored on every booking so /admin/finance can break down monthly
   *  acquisition without joining the user table. */
  /** Admin-flagged test booking — excluded from ALL finance reports
   *  (aggregation, Excel export, monthly close). Set from the booking
   *  detail Status card. Heidi 2026-09: 5 paid CWB test bookings were
   *  inflating the August sales record. */
  isTest?: boolean;
  /** Channel id — a built-in MarketingChannel, 'loyalty_member' (auto
   *  repeat-customer tag), or an admin-configured custom id from
   *  內容管理 → 系統設定 → 來源渠道選項. */
  marketingChannel?: MarketingChannel | 'loyalty_member' | (string & {});
  /** Display label snapshotted at checkout for custom channel ids, so
   *  reports stay readable even after the admin edits the option list. */
  marketingChannelLabel?: string;
  /** Free-text detail when marketingChannel === 'other'. */
  marketingChannelOther?: string;
  /** Promo code applied at checkout (entered by customer on the
   *  confirm page). Optional. The discount applies to the subtotal
   *  before any loyalty redemption — see Ship C in repo docs. */
  promoCode?: string;
  /** PromoCode document id, kept so the webhook can increment usage. */
  promoCodeId?: string;
  /** HK$ value of the promo discount (already factored into deposit). */
  promoDiscount?: number;
  /** When the customer redeems a "free drinks" promo, the drinks add-on
   *  is set to free in the breakdown — store the original drinks cost
   *  here so admin can audit. */
  promoFreeDrinksCost?: number;
  /** Set when the webhook successfully increments the promo's usage
   *  count (idempotency guard for retries). */
  promoRedeemedAt?: unknown;
  /** Loyalty points used to reduce the upfront amount. 100 pts = HK$1.
   *  Validated at booking creation; deducted from the user balance when
   *  payment is confirmed (Stripe webhook / admin offline confirm). */
  pointsUsed?: number;
  /** HK$ value of the points redemption (= floor(pointsUsed / 100)).
   *  Subtracted from `pricing.deposit` when computing the actual amount
   *  charged at checkout. Stored separately so admin can audit. */
  pointsDiscount?: number;
  /** Set by the payment-confirmation handler once the points have been
   *  taken out of the user's balance. Used to make the deduction
   *  idempotent across retries. */
  pointsRedeemedAt?: unknown;
  /** Actual amount deducted (capped at the customer's balance at the
   *  time of deduction; may be < pointsUsed under concurrent race). */
  pointsActuallyDeducted?: number;
  /** Set when loyalty points have been credited to the customer for
   *  THIS booking. Idempotency guard — prevents double-crediting if
   *  admin re-clicks settle, or clicks the "補加積分" recovery button
   *  on a booking that already credited correctly. */
  pointsCreditedAt?: unknown;
  /** HK$ amount of loyalty points credited. 1 HK$ = 1 pt.
   *  Computed as `subtotal + forfeited security deposit` (per product
   *  spec: refundable amount doesn't earn points, only what SPACO
   *  actually pocketed does). */
  pointsActuallyCredited?: number;
  /**
   * Booking lifecycle:
   *   awaiting_payment      — customer picked payment method, slot blocked,
   *                           awaiting actual payment / receipt upload.
   *   awaiting_review       — customer uploaded FPS receipt, admin to verify.
   *   confirmed             — admin verified or Stripe webhook fired.
   *   completed             — event date has passed.
   *   cancelled             — admin or customer cancelled.
   *   payment_not_completed — offline-payment customer didn't upload a
   *                           receipt within the 30-min window. Slots are
   *                           released so the time is re-bookable; the record
   *                           is kept for CS follow-up.
   *
   * `pending` is legacy: prior to the 2026-05 rewrite, bookings were written
   * to Firestore on "繼續預訂" before the customer picked a payment method.
   * No new bookings should enter this state — the customer flow now buffers
   * the draft in sessionStorage and only writes after method selection.
   */
  status:
    | 'pending'
    | 'awaiting_payment'
    | 'awaiting_review'
    | 'confirmed'
    | 'completed'
    | 'cancelled'
    | 'payment_not_completed';
  paymentMethod: 'fps' | 'kpay' | 'stripe' | 'bank' | null;
  receiptUrl: string | null;
  /** When the customer uploaded their offline-payment receipt screenshot.
   *  null means not yet uploaded. */
  paymentReceiptUploadedAt?: unknown;
  /** When admin verified the offline payment and flipped status to confirmed. */
  paymentVerifiedAt?: unknown;
  /** ms-since-epoch deadline for `pending` bookings to be paid before the
   *  cron auto-cancels them and frees the slot. Default: createdAt + 30 min. */
  pendingExpiresAt?: number;
  /** Audit log for cancellations — who cancelled and when. Captured at
   *  the moment admin clicks 取消 so we can trace mis-clicks back to
   *  the staff member (Heidi's 2026-05-23 spec). */
  cancelledBy?: string;       // staff uid; 'cron' / 'customer' for non-admin paths
  cancelledByEmail?: string;
  cancelledByName?: string;
  cancelledAt?: unknown;
  /** Customer-provided refund destination for the security-deposit refund
   *  processed after the event ends. Captured on the confirmation page. */
  refundDetails?: RefundDetails;
  /** Outstanding balance (HK$). 0 ⇒ fully paid. Used for high-value
   *  bookings where the customer paid only the 50% deposit upfront and
   *  must clear the balance ≥ 2 days before the event. */
  balanceDue?: number;
  /** Date by which the balance must be cleared (typically T−2 days).
   *  Stored as YYYY-MM-DD for display + comparison. */
  balanceDueDate?: string;
  /** Set by admin when the balance payment lands. Triggers immediate
   *  TTLock passcode generation if the booking is within the lock window. */
  balancePaidAt?: unknown;
  /** Last time we sent the customer a "please pay your balance" email.
   *  Used by the cron to avoid spamming the same reminder daily. */
  balanceReminderSentAt?: unknown;
  /** TTLock smart-lock passcode generated for this booking. The cron
   *  generates it automatically once: (a) booking is fully paid, AND
   *  (b) booking date is within 2 days. Cleared to undefined if the
   *  booking is cancelled (passcode is also deleted on the lock). */
  lockPasscode?: {
    /** The actual passcode the customer types into the lock (4-9 digits) */
    passcode: string;
    /** TTLock-side passcode id — needed for delete / lookup. Absent for
     *  manual-entry passcodes on venues without a TTLock. */
    ttlockPwdId?: number;
    /** Lock id this was generated for — venues can be remapped, this is the
     *  ground truth at generation time. Absent for manual passcodes. */
    lockId?: number;
    /** Where this passcode came from. Legacy records (no field) are
     *  treated as 'ttlock'. */
    source?: 'ttlock' | 'manual';
    /** Unix ms — passcode becomes valid (= booking start − 1 hour) */
    validFrom: number;
    /** Unix ms — passcode expires (= booking end) */
    validTo: number;
    /** Server timestamp the passcode was created */
    generatedAt: unknown;
    /** Server timestamp the customer email was sent. null = email pending. */
    emailSentAt: unknown | null;
  };
  /** Package booking only — chosen free decoration style.
   *  Optional so existing à-la-carte bookings stay valid. */
  decorationStyle?: 'blue' | 'pink' | 'khaki';
  /** Slug of the EventPackage if this is a package booking (e.g. 'birthday-cwb'). */
  packageSlug?: string;
  /** ID of the BookingDraft this booking was claimed from (transition workflow). */
  draftId?: string;
  /** Google Calendar event id once this booking has been pushed (sync direction A). */
  googleEventId?: string;
  createdAt: unknown;
  updatedAt: unknown;
  depositRefund: {
    amount: number;
    deductions: { label: string; amount: number }[];
    refundedAt: unknown;
  } | null;
}

// ============ BookingDraft (staff-initiated) ============
//
// CS / admin pre-fills a booking on behalf of a customer still on the
// WhatsApp workflow. The draft has a unique URL — customer opens it,
// logs in, reviews, and confirms; at that moment a real BookingRecord
// is created and the draft marked `claimed`.
export interface BookingDraft {
  id: string;
  createdBy: string;          // staff uid
  createdAt: unknown;
  expiresAt: unknown;         // 7 days from creation by default

  claimedBy: string | null;   // customer uid after claim
  claimedAt: unknown | null;
  bookingId: string | null;   // bookings/{id} created at claim
  status: 'pending' | 'claimed' | 'expired' | 'cancelled';

  // Booking content (mirrors BookingRecord)
  venueId: string;
  branchSlug: string;
  date: string;               // YYYY-MM-DD
  startTime: string;          // HH:mm
  endTime: string;
  /** End date when the booking spans midnight. Same semantics as
   *  BookingRecord.endDate — absent or equal to `date` means same-day. */
  endDate?: string;
  hours: number;
  /** Total head count = adultCount + childCount. Kept for backward
   *  compatibility with bookings created before the adult/child split. */
  guestCount: number;
  /** Number of adults (10+ years old). When unset on legacy bookings,
   *  treat the full guestCount as adults. */
  adultCount?: number;
  /** Number of children aged 1–9. They count as 0.5 adult-equivalent
   *  for minimum-charge calculation and pay half on per-head charges
   *  (venue rental, BBQ, hotpot, drinks). */
  childCount?: number;
  isWeekend: boolean;
  addOns: { id: string; quantity: number; options?: AddOnOptions }[];
  hasBYOFood: boolean;
  pricing: {
    baseCharge: number;
    addOnTotal: number;
    subtotal: number;
    securityDeposit?: number;
    deposit: number;
  };

  // Customer hint
  customerName?: string;
  customerWhatsapp?: string;  // E.164
  customerEmail?: string;
  notes?: string;

  // Optional staff-preset extras — carried through to the booking on claim.
  /** Promo code already validated by staff. The claim flow copies it
   *  straight onto the booking so the customer doesn't have to re-enter. */
  promoCode?: string;
  promoCodeId?: string;
  promoDiscount?: number;
  promoFreeDrinksCost?: number;
  /** When set, the claim flow creates a package booking (fixed price,
   *  fixed duration). The admin form locks venue + duration + price to
   *  the chosen package — see /lib/packages.ts. */
  packageSlug?: string;
}

export interface BlockedSlot {
  id: string;
  venueId: string;
  date: string;
  startTime: string;
  endTime: string;
  /** 'gcal' = mirrored from a Google Calendar event we synced down. */
  reason: 'booking' | 'cleaning' | 'setup' | 'admin_block' | 'gcal';
  bookingId: string | null;
  /** When `reason === 'gcal'`, identifies the source Google Calendar event so
   *  the periodic sync can update / remove it cleanly. */
  googleEventId?: string;
  /** Calendar ID that hosted the source event ('cwb' | 'wc' | 'sw' | 'tst'). */
  googleCalendarKey?: string;
  /** Original event title from Google Calendar (only for reason='gcal'). */
  googleEventTitle?: string;
  /** Original event description from Google Calendar (only for reason='gcal'). */
  googleEventDescription?: string;
}

// Informational events that admin/CS schedule (e.g. site visits, deliveries)
// for staff coordination. Unlike BlockedSlot, these do NOT prevent customer
// bookings — if a customer books over a site_visit, admin reschedules the
// site visit, not the booking.
//
// Pushed to Google Calendar so cleaners/staff see them in their normal
// workflow. English-only labels because cleaners don't read Chinese.
export type CalendarEventType = 'site_visit' | 'delivery';

export interface CalendarEvent {
  id: string;
  type: CalendarEventType;
  venueId: string;
  date: string;
  startTime: string;
  endTime: string;
  notes?: string;
  /** Google Calendar event id (set after push). null = not yet synced. */
  googleEventId?: string | null;
  createdAt: unknown;
  updatedAt?: unknown;
}

// ============ Promo Codes ============

/** Four supported promo code types:
 *   • percent — e.g. "88 折" (12% off subtotal)
 *   • cash    — fixed HK$ amount off (optional minimum subtotal)
 *   • free_drinks — Drinks add-on becomes free (other surcharges unchanged)
 *   • per_pax — fixed HK$ off per adult-equivalent
 */
export type PromoCodeType = 'percent' | 'cash' | 'free_drinks' | 'per_pax';

export interface PromoCode {
  id: string;
  /** Customer-typed code (case-insensitive but stored upper-cased). */
  code: string;
  type: PromoCodeType;
  /** For 'percent': discount percent 0-100. e.g. 12 means 12% off. */
  percent?: number;
  /** For 'cash' + 'per_pax': HK$ amount. */
  amount?: number;
  /** For 'cash': customer's subtotal must be ≥ this to qualify. 0/null = no min. */
  minSubtotal?: number;
  /** Inclusive start date (YYYY-MM-DD). Null = active immediately. */
  startDate?: string | null;
  /** Inclusive end date (YYYY-MM-DD). Null = no expiry. */
  endDate?: string | null;
  /** Total number of times the code can be redeemed across all customers.
   *  Null = unlimited. */
  totalUsageLimit?: number | null;
  /** How many bookings have used this code so far. Auto-incremented at
   *  booking-confirmation time. */
  totalUsageCount: number;
  /** How many times each user can use the code. Default 1. Null = unlimited. */
  perUserLimit?: number | null;
  /** Whether the code is enabled. Disabled codes won't validate at checkout. */
  enabled: boolean;
  /** Optional human-friendly description shown in the admin list. */
  description?: string;
  /** Campaign name for batch-generated single-use vouchers (活動現金券).
   *  Codes sharing a campaign are grouped in the admin list. */
  campaign?: string;
  /** Free-text remark per code — which customer it was sent to (member
   *  or not; admin types whatever identifies them). */
  note?: string;
  /** Venue ids the code is valid for. Empty / undefined = all branches. */
  venueIds?: string[];
  /** Orthogonal "also make the drinks add-on free" flag — combines with
   *  any monetary `type` (percent / cash / per_pax). Legacy codes with
   *  type='free_drinks' behave as if this is true regardless. */
  freeDrinks?: boolean;
  createdAt: unknown;
  updatedAt?: unknown;
}

// ============ CMS Types ============

export type StaffRole = 'admin' | 'cs' | 'cleaner' | 'marketing';

export interface StaffMember {
  uid: string;
  role: StaffRole;
  displayName: string;
  email: string;
  addedAt: unknown;
  addedBy: string;
}

export interface SiteImage {
  id: string;
  key: string;
  url: string;
  alt: string;
  section: string;
  // Display order within a section. Lower = earlier. Optional for legacy
  // single-slot images (hero, branch hero cards) where order is meaningless.
  order?: number;
  // Optional click-through URL — used by the homepage promo section so each
  // promo card can deep-link to a package / branch / custom page. Plain
  // images (branch photos, hero) leave this undefined.
  linkUrl?: string;
  uploadedAt: unknown;
}

export interface SiteContentSection {
  [key: string]: { zh: string; en: string };
}

export interface SiteContent {
  id: string;
  sections: SiteContentSection;
  updatedAt: unknown;
  updatedBy: string;
}

// ============ Documents (Quotation / Invoice / Receipt) ============

export type DocumentType = 'quotation' | 'invoice' | 'receipt';
export type DocumentStatus = 'draft' | 'issued' | 'paid' | 'void';

export interface DocumentLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface DocumentRevision {
  timestamp: unknown;
  editedBy: string;
  editedByEmail?: string;
  changeSummary?: string;
}

export interface BusinessDocument {
  id: string;
  number: string;          // e.g. QUO-2026-0001
  type: DocumentType;
  status: DocumentStatus;

  // Customer
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerAddress: string;

  // Optional link to a booking
  bookingId: string | null;
  venueId: string | null;

  // Line items + totals (HKD)
  items: DocumentLineItem[];
  subtotal: number;
  discount: number;
  discountType: 'amount' | 'percent';
  tax: number;            // typically 0 in HK
  total: number;

  // Dates (YYYY-MM-DD)
  issueDate: string;
  dueDate: string;
  paidDate: string | null;

  // Free text
  notes: string;
  terms: string;

  // Audit
  createdAt: unknown;
  createdBy: string;
  createdByEmail?: string;
  updatedAt: unknown;
  updatedBy: string;
  updatedByEmail?: string;
  revisions: DocumentRevision[];
}

// Role permissions
export const ROLE_PERMISSIONS: Record<StaffRole, string[]> = {
  admin: ['content', 'seo', 'gcal', 'members', 'bookings', 'calendar', 'deposit', 'staff', 'documents', 'faq'],
  cs: ['members', 'bookings', 'calendar', 'deposit', 'documents'],
  cleaner: ['calendar'],
  marketing: ['content', 'seo', 'faq', 'calendar'],
};

// ============ SEO ============

export interface SeoEntry {
  // Per-page (or `_default`) doc in `site_seo` Firestore collection.
  title?: { zh: string; en: string };
  description?: { zh: string; en: string };
  keywords?: { zh: string; en: string };  // comma-separated
  ogImage?: string;                        // absolute URL
  noindex?: boolean;
}

export interface SeoDefaults extends SeoEntry {
  siteName?: { zh: string; en: string };
  twitterHandle?: string;
  themeColor?: string;
  // Optional: org JSON-LD bits
  orgUrl?: string;
  orgPhone?: string;
}

// ============ ARTICLES (Blog / Content Sharing) ============

/** A content article shown under /articles. Authored by admin, optionally
 *  smart-formatted + translated via Claude. Content is Markdown; inline
 *  images live in the markdown as standard `![alt](url)` references. */
export interface Article {
  id: string;
  /** URL slug (kebab-case). Unique. Used for /articles/[slug]. */
  slug: string;
  /** Display title. zh required; en optional (LLM auto-translate fills it). */
  title: { zh: string; en?: string };
  /** Optional one-line summary shown on the list card + meta description. */
  excerpt?: { zh?: string; en?: string };
  /** Hero image URL (Firebase Storage). Used on the list card + article header. */
  heroImage?: string;
  /** Optional alt text for hero image, per locale. */
  heroAlt?: { zh?: string; en?: string };
  /** Article body — Markdown. zh required; en optional. */
  content: { zh: string; en?: string };
  /** Optional tags for filtering / future related-posts feature. */
  tags?: string[];
  /** draft = hidden from public; published = visible on /articles. */
  status: 'draft' | 'published';
  /** Auto-set on first publish; useful for sorting. */
  publishedAt?: unknown;
  createdAt: unknown;
  updatedAt: unknown;
  /** UID of the staff member who last edited. */
  authorUid?: string;
  authorName?: string;
  // ── Per-article SEO overrides (admin-editable) ──
  /** Custom <title> for the article page. Falls back to article.title. */
  seoTitle?: { zh?: string; en?: string };
  /** Custom <meta description>. Falls back to excerpt. */
  seoDescription?: { zh?: string; en?: string };
  /** Comma-separated keywords for <meta keywords>. */
  seoKeywords?: { zh?: string; en?: string };
  /** Override Open Graph image URL (defaults to heroImage). */
  ogImage?: string;
  /** Block search engines from indexing this article. */
  noindex?: boolean;
}
