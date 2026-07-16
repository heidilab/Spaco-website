import {
  collection, doc, addDoc, getDoc, getDocs,
  query, where, orderBy,
  serverTimestamp, Timestamp, updateDoc,
} from 'firebase/firestore';
import { db, auth } from './firebase';
import { BookingDraft, BookingRecord } from '@/types';

// Booking links must be acted on quickly — 8 hours mirrors the "first to pay"
// policy ("不設留位，先到先得"). After 8h the link auto-expires; CS can
// recreate a fresh one if the customer is still interested.
export const DRAFT_TTL_HOURS = 8;

// ────────────────────────────────────────────────────────────
// Staff: create a draft
// ────────────────────────────────────────────────────────────

export async function createBookingDraft(
  data: Omit<BookingDraft, 'id' | 'createdAt' | 'expiresAt' | 'claimedBy' | 'claimedAt' | 'bookingId' | 'status'>,
): Promise<string> {
  const expiresAt = Timestamp.fromMillis(Date.now() + DRAFT_TTL_HOURS * 60 * 60 * 1000);
  const ref = await addDoc(collection(db, 'booking_drafts'), {
    ...data,
    createdAt: serverTimestamp(),
    expiresAt,
    claimedBy: null,
    claimedAt: null,
    bookingId: null,
    status: 'pending' as const,
  });
  return ref.id;
}

// ────────────────────────────────────────────────────────────
// Reads
// ────────────────────────────────────────────────────────────

export async function getBookingDraft(id: string): Promise<BookingDraft | null> {
  const snap = await getDoc(doc(db, 'booking_drafts', id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as BookingDraft;
}

export async function listBookingDrafts(): Promise<BookingDraft[]> {
  const snap = await getDocs(
    query(collection(db, 'booking_drafts'), orderBy('createdAt', 'desc')),
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as BookingDraft));
}

export async function listPendingDraftsForCustomer(uid: string): Promise<BookingDraft[]> {
  // Customer self-service: see only drafts they've claimed.
  const snap = await getDocs(
    query(
      collection(db, 'booking_drafts'),
      where('claimedBy', '==', uid),
      orderBy('createdAt', 'desc'),
    ),
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as BookingDraft));
}

// ────────────────────────────────────────────────────────────
// Validation helpers
// ────────────────────────────────────────────────────────────

/** Convert Firestore Timestamp / millis / Date / unknown to JS Date or null. */
function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (v instanceof Timestamp) return v.toDate();
  if (typeof v === 'object' && v !== null) {
    const obj = v as { toDate?: () => Date; seconds?: number };
    if (typeof obj.toDate === 'function') return obj.toDate();
    if (typeof obj.seconds === 'number') return new Date(obj.seconds * 1000);
  }
  if (typeof v === 'number') return new Date(v);
  return null;
}

export function isDraftExpired(draft: BookingDraft): boolean {
  const expiresAt = toDate(draft.expiresAt);
  if (!expiresAt) return false;
  return expiresAt.getTime() <= Date.now();
}

export function isDraftActionable(draft: BookingDraft): boolean {
  // "Pending" status AND not yet expired AND not yet claimed.
  return draft.status === 'pending' && !draft.claimedBy && !isDraftExpired(draft);
}

// ────────────────────────────────────────────────────────────
// Customer: claim → creates a real booking
// ────────────────────────────────────────────────────────────

/** Claim a draft on behalf of the signed-in customer.
 *  Creates a `bookings` doc and links the draft to it.
 *  Returns the new booking id. */
export async function claimBookingDraft(
  draft: BookingDraft,
  customerUid: string,
  customerWhatsapp: string,
): Promise<string> {
  if (draft.claimedBy) throw new Error('This booking link has already been claimed.');
  if (draft.status !== 'pending') throw new Error('This booking link is no longer valid.');
  if (isDraftExpired(draft)) throw new Error('This booking link has expired.');

  // Delegate to the server-side atomic route which:
  //   • checks for slot conflicts inside a Firestore transaction
  //   • creates the booking + blocked_slots atomically
  //   • marks the draft as claimed — all in one transaction
  // This replaces the previous hasSlotConflict() + createBooking() two-step
  // which had a race window between the read and the write.
  // /api/bookings/create now requires the caller's Firebase ID token and
  // forces userId to the token's uid.
  const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : '';
  if (!idToken) throw new Error('Not signed in.');
  const res = await fetch('/api/bookings/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      draftId: draft.id,
      userId: customerUid,
      whatsappPhone: customerWhatsapp || draft.customerWhatsapp,
      venueId: draft.venueId,
      branchSlug: draft.branchSlug,
      date: draft.date,
      startTime: draft.startTime,
      endTime: draft.endTime,
      hours: draft.hours,
      guestCount: draft.guestCount,
      adultCount: draft.adultCount,
      childCount: draft.childCount,
      isWeekend: draft.isWeekend,
      addOns: draft.addOns,
      hasBYOFood: draft.hasBYOFood,
      pricing: draft.pricing,
      status: 'awaiting_payment',
      paymentMethod: null,
      receiptUrl: null,
      depositRefund: null,
      // draftId stored on the booking record (link back to the draft).
      // Named differently from the top-level `draftId` param (which tells
      // the route to claim the draft) to avoid collision in destructuring.
      draftIdField: draft.id,
      ...(draft.endDate ? { endDate: draft.endDate } : {}),
      ...(draft.promoCode ? { promoCode: draft.promoCode } : {}),
      ...(draft.promoCodeId ? { promoCodeId: draft.promoCodeId } : {}),
      ...(typeof draft.promoDiscount === 'number' ? { promoDiscount: draft.promoDiscount } : {}),
      ...(typeof draft.promoFreeDrinksCost === 'number' ? { promoFreeDrinksCost: draft.promoFreeDrinksCost } : {}),
      ...(draft.packageSlug ? { packageSlug: draft.packageSlug } : {}),
    }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({})) as { error?: string };
    if (errData.error === 'SLOT_CONFLICT' || errData.error === 'DRAFT_CLAIMED') {
      try { await updateDoc(doc(db, 'booking_drafts', draft.id), { status: 'cancelled' }); }
      catch { /* non-blocking */ }
      throw new Error('SLOT_TAKEN');
    }
    throw new Error(errData.error || 'CREATE_FAILED');
  }

  const { bookingId } = await res.json() as { bookingId: string };
  return bookingId;
}

// ────────────────────────────────────────────────────────────
// Staff: cancel / recreate a draft
// ────────────────────────────────────────────────────────────

export async function cancelBookingDraft(id: string) {
  await updateDoc(doc(db, 'booking_drafts', id), { status: 'cancelled' });
}

/** Clone a draft into a fresh one (new ID, new 8-hour expiry). Useful after
 *  a draft expires or is cancelled but the customer is still interested. */
export async function recreateBookingDraft(
  oldDraft: BookingDraft,
  staffUid: string,
): Promise<string> {
  return createBookingDraft({
    createdBy: staffUid,
    venueId: oldDraft.venueId,
    branchSlug: oldDraft.branchSlug,
    date: oldDraft.date,
    startTime: oldDraft.startTime,
    endTime: oldDraft.endTime,
    ...(oldDraft.endDate ? { endDate: oldDraft.endDate } : {}),
    hours: oldDraft.hours,
    guestCount: oldDraft.guestCount,
    adultCount: oldDraft.adultCount,
    childCount: oldDraft.childCount,
    isWeekend: oldDraft.isWeekend,
    addOns: oldDraft.addOns,
    hasBYOFood: oldDraft.hasBYOFood,
    pricing: oldDraft.pricing,
    ...(oldDraft.customerName ? { customerName: oldDraft.customerName } : {}),
    ...(oldDraft.customerWhatsapp ? { customerWhatsapp: oldDraft.customerWhatsapp } : {}),
    ...(oldDraft.customerEmail ? { customerEmail: oldDraft.customerEmail } : {}),
    ...(oldDraft.notes ? { notes: oldDraft.notes } : {}),
    ...(oldDraft.promoCode ? { promoCode: oldDraft.promoCode } : {}),
    ...(oldDraft.promoCodeId ? { promoCodeId: oldDraft.promoCodeId } : {}),
    ...(typeof oldDraft.promoDiscount === 'number' ? { promoDiscount: oldDraft.promoDiscount } : {}),
    ...(typeof oldDraft.promoFreeDrinksCost === 'number' ? { promoFreeDrinksCost: oldDraft.promoFreeDrinksCost } : {}),
    ...(oldDraft.packageSlug ? { packageSlug: oldDraft.packageSlug } : {}),
  });
}

// ────────────────────────────────────────────────────────────
// URL helper
// ────────────────────────────────────────────────────────────

const SITE_URL =
  typeof window !== 'undefined'
    ? window.location.origin
    : (process.env.NEXT_PUBLIC_APP_URL || 'https://spacohk.com');

export function buildClaimUrl(draftId: string, locale: 'zh' | 'en' = 'zh'): string {
  return `${SITE_URL}/${locale}/book/claim/${draftId}`;
}
