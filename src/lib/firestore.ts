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
import { BookingRecord, BlockedSlot, BusinessDocument, DocumentType, DocumentRevision, CalendarEvent } from '@/types';
import { venuesSharingSpace } from './venues';

// ============ BOOKINGS ============

export async function createBooking(data: Omit<BookingRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
  const ref = await addDoc(collection(db, 'bookings'), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Cleaning buffer: 1 hour after end time
  const [endH] = data.endTime.split(':').map(Number);
  const bufferEnd = `${String(endH + 1).padStart(2, '0')}:00`;

  // Block this venue AND every venue sharing the same physical space.
  // (e.g. booking sheung-wan-a also blocks sheung-wan-ab.)
  const venuesToBlock = venuesSharingSpace(data.venueId);
  for (const vid of venuesToBlock) {
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
  let q;
  if (status) {
    q = query(
      collection(db, 'bookings'),
      where('status', '==', status),
      orderBy('createdAt', 'desc')
    );
  } else {
    q = query(collection(db, 'bookings'), orderBy('createdAt', 'desc'));
  }
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as BookingRecord));
}

export async function updateBookingStatus(id: string, status: string) {
  await updateDoc(doc(db, 'bookings', id), {
    status,
    updatedAt: serverTimestamp(),
  });
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
  }
) {
  await updateDoc(doc(db, 'bookings', id), {
    depositRefund: {
      ...refundData,
      refundedAt: serverTimestamp(),
    },
    status: 'completed',
    updatedAt: serverTimestamp(),
  });
}

// ============ BLOCKED SLOTS ============

export async function createBlockedSlot(
  data: Omit<BlockedSlot, 'id'>
): Promise<string> {
  const ref = await addDoc(collection(db, 'blocked_slots'), data);
  return ref.id;
}

/**
 * Create a blocked slot AND propagate to every venue sharing the same
 * physical space (Sheung Wan A / B / A+B). Use this for any admin manual
 * block — booking flows already iterate explicitly.
 *
 * Returns the id of the primary block (for the requested venueId).
 */
export async function createSharedBlockedSlot(
  data: Omit<BlockedSlot, 'id'>
): Promise<string> {
  const ids = venuesSharingSpace(data.venueId);
  let primaryId = '';
  for (const vid of ids) {
    const id = await createBlockedSlot({ ...data, venueId: vid });
    if (vid === data.venueId) primaryId = id;
  }
  return primaryId;
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

// ============ LOYALTY POINTS ============

export async function creditLoyaltyPoints(userId: string, bookingTotal: number, deposit: number) {
  // Points = total minus deposit, $1 = 1 point
  const pointsToAdd = Math.floor(bookingTotal - deposit);
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

