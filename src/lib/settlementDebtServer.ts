import { adminDb } from './firebaseAdmin';
import { BookingInputError } from './bookingSecurity';
import { outstandingDebts, type DebtBooking, type OutstandingDebt } from './settlementDebt';

/** Unpaid post-settlement debts for a customer (single-field query, no
 *  composite index needed). */
export async function getOutstandingDebts(uid: string): Promise<OutstandingDebt[]> {
  const snap = await adminDb.collection('bookings').where('userId', '==', uid).get();
  // Preview deployments stamp every booking isTest, so count them there.
  return outstandingDebts(snap.docs.map((d) => ({ ...(d.data() as Omit<DebtBooking, 'id'>), id: d.id })),
    { includeTest: process.env.VERCEL_ENV !== 'production' });
}

/** Server-side gate for every new customer booking (self-booking and CS
 *  links): refuse while any settlement debt is unpaid (Heidi 2026-10-18). */
export async function assertNoSettlementDebt(uid: string): Promise<void> {
  if ((await getOutstandingDebts(uid)).length) throw new BookingInputError('SETTLEMENT_DEBT_OUTSTANDING');
}
