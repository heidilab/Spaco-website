import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './firebaseAdmin';
import { finalizeConfirmedBooking } from './finalizeBooking';
import { MAX_FINALIZATION_ATTEMPTS, nextJobState, remainingSteps, type FinalizeStep } from './finalizationSteps';
export { MAX_FINALIZATION_ATTEMPTS, nextJobState, remainingSteps };
import { getStaffNotificationRecipients } from './emailAutomations';
import { sendEmail } from './email';

interface JobDoc {
  bookingId: string;
  isBalancePayment: boolean;
  status: 'pending' | 'done' | 'failed';
  leaseUntil: number;
  attempts?: number;
  steps?: Partial<Record<FinalizeStep, boolean>>;
  alertSentAt?: number;
  token?: string;
}

/**
 * Durable work with a lease. External services are at-least-once, never a
 * second money credit. Each step that completes is recorded on the job,
 * so a retry only repeats what failed (no second confirmation or
 * supplier email); after MAX_FINALIZATION_ATTEMPTS the job is marked
 * failed, the booking carries `finalizationFailed`, and staff get one
 * email saying what is left to do by hand.
 */
export async function runPaymentFinalization(id: string, origin: string) {
  const ref = adminDb.collection('_payment_finalizations').doc(id);
  const token = randomUUID();
  const job = await adminDb.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const data = snap.data() as JobDoc | undefined;
    if (!data || data.status === 'done' || data.status === 'failed' || data.leaseUntil > Date.now()) return null;
    tx.update(ref, { token, leaseUntil: Date.now() + 120000, attempts: (data.attempts || 0) + 1 });
    return { ...data, attempts: (data.attempts || 0) + 1 };
  });
  if (!job) return;
  let result: { done: Record<FinalizeStep, boolean>; failures: Partial<Record<FinalizeStep, string>> } = {
    done: { ...(job.steps || {}) } as Record<FinalizeStep, boolean>, failures: { slots: 'not run' },
  };
  try {
    result = await finalizeConfirmedBooking(job.bookingId, {
      isBalancePayment: job.isBalancePayment, paymentMethodLabel: 'KPay', origin, done: job.steps || {}, throwOnFailure: false,
    });
  } catch (err) {
    result.failures = { slots: err instanceof Error ? err.message : String(err) };
  }
  const failed = Object.keys(result.failures) as FinalizeStep[];
  const state = nextJobState(job.attempts, failed);
  await adminDb.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (snap.data()?.token !== token) return;
    tx.update(ref, {
      status: state, steps: result.done, lastFailures: result.failures, leaseUntil: 0, updatedAt: Date.now(),
      ...(state === 'failed' ? { failedAt: Date.now() } : {}),
    });
  });
  if (state === 'failed') {
    try {
      await adminDb.collection('bookings').doc(job.bookingId).update({
        finalizationFailed: { steps: failed, at: FieldValue.serverTimestamp() }, updatedAt: FieldValue.serverTimestamp(),
      });
    } catch (err) { console.error('[paymentFinalization] could not mark booking:', err); }
    if (!job.alertSentAt) {
      try {
        const to = await getStaffNotificationRecipients();
        const names: Record<FinalizeStep, string> = { slots: '時段重建', email: '客人確認電郵', lock: '門鎖密碼', staff: 'Staff／供應商通知', gcal: 'Google 日曆' };
        const lines = failed.map((s) => `• ${names[s]}：${result.failures[s] || ''}`).join('<br>');
        const adminUrl = `${origin}/zh/admin/bookings/${job.bookingId}`;
        await Promise.all(to.map((addr) => sendEmail({
          to: addr,
          subject: `⚠️ 付款後續工作未完成 #${String(job.bookingId).slice(0, 8)}`,
          html: `<p>訂單 <a href="${adminUrl}">#${job.bookingId}</a> 已收款並確認，但以下後續工作試咗 ${job.attempts} 次都做唔到，系統已停止重試，請人手處理：</p><p>${lines}</p><p>其他步驟已經完成，唔會重發。</p>`,
        })));
        await ref.update({ alertSentAt: Date.now() });
      } catch (err) { console.error('[paymentFinalization] staff alert failed:', err); }
    }
  } else if (state === 'done' && job.alertSentAt === undefined) {
    // Nothing to tell staff.
  }
  if (state !== 'done') throw new Error('Payment side effects incomplete');
}
