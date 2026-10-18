import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebaseAdmin';
import { requireCronSecret } from '@/lib/adminAuth';
import { buildSettlementDebtReminderEmail, generateWhatsAppLink } from '@/lib/email';
import { sendAutomatedEmail } from '@/lib/emailAutomations';
import { getVenueById } from '@/lib/venues';
import { debtReminderStage, settlementDebt, type DebtBooking } from '@/lib/settlementDebt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Daily (10:00 HKT): email customers whose post-event settlement left an
 * unpaid shortfall — once on day 14 and once on day 30 after settlement,
 * then never again (Heidi 2026-10-18). Idempotent via
 * settlementDebtReminder14SentAt / settlementDebtReminder30SentAt.
 *
 * Settlement with a shortfall keeps the booking 'confirmed' (paying it
 * flips it to 'completed'), so a single-field status query finds every
 * candidate without a composite index.
 */
export async function GET(req: NextRequest) {
  const gate = requireCronSecret(req);
  if (gate) return gate;

  const now = Date.now();
  const snap = await adminDb.collection('bookings').where('status', '==', 'confirmed').get();
  const results: Array<{ bookingId: string; stage: number; sent: boolean; reason?: string }> = [];

  for (const doc of snap.docs) {
    const b = { ...(doc.data() as Omit<DebtBooking, 'id'>), id: doc.id } as DebtBooking & {
      customerEmail?: string; customerName?: string;
    };
    const opts = { includeTest: process.env.VERCEL_ENV !== 'production' };
    const stage = debtReminderStage(b, now, opts);
    if (!stage) continue;

    let email = b.customerEmail;
    let name = b.customerName;
    if (b.userId) {
      const user = (await adminDb.collection('users').doc(b.userId).get()).data() as { email?: string; displayName?: string } | undefined;
      email = user?.email || email;
      name = user?.displayName || name;
    }
    const mark = stage === 30
      ? { settlementDebtReminder30SentAt: FieldValue.serverTimestamp(), ...(b.settlementDebtReminder14SentAt ? {} : { settlementDebtReminder14SentAt: FieldValue.serverTimestamp() }) }
      : { settlementDebtReminder14SentAt: FieldValue.serverTimestamp() };
    if (!email) {
      // Nothing to send to; mark so the stage is not retried daily.
      await doc.ref.update({ ...mark, settlementDebtReminderSkipped: 'no-email' });
      results.push({ bookingId: doc.id, stage, sent: false, reason: 'no-email' });
      continue;
    }
    const venue = b.venueId ? getVenueById(b.venueId) : undefined;
    const tpl = buildSettlementDebtReminderEmail({
      customerName: name || email.split('@')[0],
      venueName: venue?.name.zh || b.branchSlug || '',
      date: b.date,
      bookingId: doc.id,
      amountDue: settlementDebt(b, opts),
      stage,
      payUrl: b.userId && b.branchSlug
        ? `https://spacohk.com/zh/book/${encodeURIComponent(b.branchSlug)}/pay-balance/${encodeURIComponent(doc.id)}`
        : undefined,
      whatsappLink: generateWhatsAppLink(process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || '85292823060',
        `你好，我想補回預訂 #${doc.id.slice(0, 8)} 嘅尚欠款項。`),
    });
    try {
      const out = await sendAutomatedEmail({ automationKey: 'settlement_debt_reminder', to: email, subject: tpl.subject, html: tpl.html });
      // A disabled automation is not marked, so turning it back on resumes.
      if (!out.sent) {
        results.push({ bookingId: doc.id, stage, sent: false, reason: 'automation-disabled' });
        continue;
      }
      await doc.ref.update(mark);
      results.push({ bookingId: doc.id, stage, sent: true });
    } catch (err) {
      results.push({ bookingId: doc.id, stage, sent: false, reason: err instanceof Error ? err.message : 'send-failed' });
    }
  }
  console.log('[cron/settlement-debt-reminders]', { scanned: snap.size, results });
  return NextResponse.json({ scanned: snap.size, results });
}
