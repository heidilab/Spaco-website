import { randomUUID } from 'node:crypto';
import { adminDb } from './firebaseAdmin';
import { finalizeConfirmedBooking } from './finalizeBooking';

/** Durable work with a lease. External services are at-least-once, never a second money credit. */
export async function runPaymentFinalization(id: string, origin: string) {
  const ref = adminDb.collection('_payment_finalizations').doc(id);
  const token = randomUUID();
  const job = await adminDb.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const data = snap.data();
    if (!data || data.status === 'done' || data.leaseUntil > Date.now()) return null;
    tx.update(ref, { token, leaseUntil: Date.now() + 120000, attempts: (data.attempts || 0) + 1 });
    return data;
  });
  if (!job) return;
  let succeeded = false;
  try {
    await finalizeConfirmedBooking(job.bookingId, { isBalancePayment: job.isBalancePayment, paymentMethodLabel: 'KPay', origin });
    succeeded = true;
  } finally {
    await adminDb.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (snap.data()?.token !== token) return;
      tx.update(ref, { status: succeeded ? 'done' : 'pending', leaseUntil: 0, updatedAt: Date.now() });
    });
  }
}
