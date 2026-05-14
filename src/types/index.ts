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
  firstBookingChannel?: MarketingChannel;
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
    /** HK$ portion paid against rental + add-ons (subtotal). */
    rentalAmount: number;
    /** HK$ portion paid into the refundable security deposit. */
    depositAmount: number;
    /** Total = rentalAmount + depositAmount, stored for convenience. */
    amount: number;
    method: 'stripe' | 'fps' | 'bank' | 'cash' | 'other';
    note?: string | null;
    recordedBy: string;     // admin uid
    recordedAt: unknown;    // Firestore Timestamp / ISO string
  }>;
  /** Marketing channel snapshot — captured on the customer's FIRST
   *  booking (mandatory question). Repeat customers auto-tag as
   *  'loyalty_member' (a sentinel that's not a real MarketingChannel).
   *  Stored on every booking so /admin/finance can break down monthly
   *  acquisition without joining the user table. */
  marketingChannel?: MarketingChannel | 'loyalty_member';
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
  status: 'pending' | 'awaiting_payment' | 'awaiting_review' | 'confirmed' | 'completed' | 'cancelled';
  paymentMethod: 'fps' | 'stripe' | 'bank' | null;
  receiptUrl: string | null;
  /** When the customer uploaded their offline-payment receipt screenshot.
   *  null means not yet uploaded. */
  paymentReceiptUploadedAt?: unknown;
  /** When admin verified the offline payment and flipped status to confirmed. */
  paymentVerifiedAt?: unknown;
  /** ms-since-epoch deadline for `pending` bookings to be paid before the
   *  cron auto-cancels them and frees the slot. Default: createdAt + 30 min. */
  pendingExpiresAt?: number;
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
  reason: 'booking' | 'cleaning' | 'admin_block' | 'gcal';
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
