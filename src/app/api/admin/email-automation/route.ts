import { NextRequest, NextResponse } from 'next/server';
import {
  EMAIL_AUTOMATIONS, EmailAutomationKey,
  getAllEmailAutomationToggles, setEmailAutomationToggle,
} from '@/lib/emailAutomations';
import {
  buildBookingConfirmationEmail, buildOfflinePaymentPendingEmail,
  buildFPSReminderEmail, buildBalanceDueReminderEmail,
  buildLockPasscodeEmail, buildPostEventEmail, buildBirthdayEmail,
  buildWelcomeEmail, buildStaffBookingNotificationEmail,
  buildStaffReceiptPendingEmail, buildStaffSupplierOrderEmail,
  buildBookingCancelledEmail, sendEmail,
} from '@/lib/email';
import type { BookingRecord } from '@/types';

export const runtime = 'nodejs';

// Build a rendered preview email for a given automation key, using
// realistic sample data. Returns { subject, html }.
function buildPreview(key: EmailAutomationKey): { subject: string; html: string } {
  const SAMPLE = {
    customerName: '陳大文',
    venueName: '銅鑼灣店',
    venueAddress: '銅鑼灣禮頓道26號凱基商業大廈5樓全層',
    date: '2026-06-15',
    startTime: '14:00',
    endTime: '19:00',
    bookingId: 'SAMPLE_BOOKING_ID_PREVIEW',
    whatsappLink: 'https://wa.me/85292823060?text=Hello',
  };

  switch (key) {
    case 'booking_confirmation':
      return buildBookingConfirmationEmail({
        ...SAMPLE,
        guestCount: 18,
        adultCount: 12,
        childCount: 6,
        subtotal: 8400,
        deposit: 4200,
        balanceDue: 4200,
        balanceDueDate: '2026-06-13',
        addOnsLine: 'BBQ Standard Package ×15, Drinks Package ×15, Shisha 水煙 ×2 (A·芒果×1, C·提子×1, +人手setup)',
        paymentMethod: 'Stripe',
      });
    case 'booking_cancelled':
      return buildBookingCancelledEmail({
        customerName: SAMPLE.customerName,
        venueName:    SAMPLE.venueName,
        date:         SAMPLE.date,
        startTime:    SAMPLE.startTime,
        endTime:      SAMPLE.endTime,
        bookingId:    SAMPLE.bookingId,
        whatsappLink: SAMPLE.whatsappLink,
      });
    case 'staff_receipt_pending':
      return buildStaffReceiptPendingEmail({
        bookingId: SAMPLE.bookingId,
        venueName: SAMPLE.venueName,
        date: SAMPLE.date,
        startTime: SAMPLE.startTime,
        endTime: SAMPLE.endTime,
        guestCount: 18,
        amountDue: 4200,
        customerName: SAMPLE.customerName,
        customerEmail: 'sample@example.com',
        whatsappPhone: '+852 9123 4966',
        receiptUrl: 'https://example.com/receipt.jpg',
        adminUrl: 'https://spacohk.com/zh/admin/receipts',
      });
    case 'staff_booking_notification':
      return buildStaffBookingNotificationEmail({
        ...SAMPLE,
        guestCount: 18,
        adultCount: 12,
        childCount: 6,
        customerEmail: 'sample@example.com',
        whatsappPhone: '+852 9123 4966',
        subtotal: 8400,
        deposit: 4200,
        balanceDue: 4200,
        addOnsLine: 'BBQ Standard Package ×15, Drinks Package ×15',
        hasBYOFood: false,
        paymentMethod: 'Stripe',
        adminUrl: 'https://spacohk.com/zh/admin/bookings/SAMPLE',
      });
    case 'offline_payment_pending':
      return buildOfflinePaymentPendingEmail({
        ...SAMPLE,
        amountDue: 4200,
        fpsNumber: '92823060',
        bankName: 'HSBC',
        bankAccount: '123-456789-001',
        bankHolder: 'Cholliman Inc.',
      });
    case 'fps_reminder':
      return buildFPSReminderEmail({
        customerName: SAMPLE.customerName,
        venueName: SAMPLE.venueName,
        subtotal: 4200,
        fpsNumber: '92823060',
        bankAccount: '123-456789-001',
        deadline: '2026-06-14 23:59',
      });
    case 'balance_due_reminder':
      return buildBalanceDueReminderEmail({
        customerName: SAMPLE.customerName,
        venueName: SAMPLE.venueName,
        date: SAMPLE.date,
        startTime: SAMPLE.startTime,
        endTime: SAMPLE.endTime,
        balanceDue: 4200,
        whatsappLink: SAMPLE.whatsappLink,
      });
    case 'lock_passcode':
      return buildLockPasscodeEmail({
        ...SAMPLE,
        passcode: '385204',
        validFromMs: Date.now() + 24 * 3600 * 1000,
        validToMs: Date.now() + 28 * 3600 * 1000,
      });
    case 'post_event':
      return buildPostEventEmail({
        customerName: SAMPLE.customerName,
        venueName: SAMPLE.venueName,
        date: SAMPLE.date,
        pointsEarned: 4200,
        pointsBalance: 12800,
      });
    case 'birthday':
      return buildBirthdayEmail({ customerName: SAMPLE.customerName });
    case 'welcome':
      return buildWelcomeEmail({ customerName: SAMPLE.customerName });
    case 'staff_supplier_order': {
      // Synthetic booking with every supplier-trigger item present so
      // the preview shows the full layout.
      const sample = {
        id: SAMPLE.bookingId,
        userId: 'preview',
        whatsappPhone: '+852 9123 4966',
        venueId: 'cwb',
        branchSlug: 'causeway-bay',
        date: SAMPLE.date,
        startTime: SAMPLE.startTime,
        endTime: SAMPLE.endTime,
        hours: 5,
        guestCount: 18,
        adultCount: 14,
        childCount: 4,
        isWeekend: false,
        hasBYOFood: false,
        addOns: [
          { id: 'hotpot-standard', quantity: 1 },
          { id: 'hotpot-extra-soup', quantity: 1 },
          { id: 'shisha', quantity: 2, options: { pipes: 2, flavors: ['A', 'D'], staffSetup: true, staffSetupTime: '16:00' } },
          { id: 'bbq-helper', quantity: 2 },
          { id: 'catering', quantity: 1, options: {
            tierId: 'tier-17',
            dishCodes: ['101', '122', '143', '170', 'A1'],
            deliveryZoneId: 'kowloon-hkisland',
            doorstepDelivery: true,
            noCutlery: false,
            extraCutlerySets: 2,
            extraFoodTongs: 1,
            deliveryTime: '15:30',
          } },
        ],
        decorationStyle: 'pink',
        packageSlug: 'birthday-cwb',
        pricing: { baseCharge: 6800, addOnTotal: 5500, subtotal: 12300, securityDeposit: 2000, deposit: 14300 },
        status: 'confirmed',
        paymentMethod: 'stripe',
        receiptUrl: null,
        depositRefund: null,
        refundDetails: { method: 'fps', fpsIdentifier: '+852 9123 4966' },
        balanceDue: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as BookingRecord;
      return buildStaffSupplierOrderEmail({
        booking: sample,
        venueName: SAMPLE.venueName,
        customerName: SAMPLE.customerName,
        customerEmail: 'sample@example.com',
        adminUrl: 'https://spacohk.com/zh/admin/bookings/SAMPLE',
      });
    }
  }
}

// GET — list all automations + toggle states.
export async function GET() {
  try {
    const toggles = await getAllEmailAutomationToggles();
    const automations = EMAIL_AUTOMATIONS.map((def) => ({
      ...def,
      enabled: toggles[def.key]?.enabled !== false, // default true
    }));
    return NextResponse.json({ automations });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'List failed' },
      { status: 500 },
    );
  }
}

// POST — actions: toggle | preview | test
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action: 'toggle' | 'preview' | 'test' = body.action;
    const key = body.key as EmailAutomationKey;
    if (!action || !key) {
      return NextResponse.json({ error: 'action + key required' }, { status: 400 });
    }
    if (!EMAIL_AUTOMATIONS.some((a) => a.key === key)) {
      return NextResponse.json({ error: 'unknown automation key' }, { status: 400 });
    }

    if (action === 'toggle') {
      const enabled = !!body.enabled;
      await setEmailAutomationToggle(key, enabled);
      return NextResponse.json({ ok: true, enabled });
    }

    if (action === 'preview') {
      const tpl = buildPreview(key);
      return NextResponse.json({ subject: tpl.subject, html: tpl.html });
    }

    if (action === 'test') {
      const to = (body.to as string) || 'spacohk@gmail.com';
      const tpl = buildPreview(key);
      // Test sends bypass the toggle (admin explicitly requested it)
      // and prefix the subject so test emails are obvious in the inbox.
      await sendEmail({ to, subject: `[TEST] ${tpl.subject}`, html: tpl.html });
      return NextResponse.json({ ok: true, sentTo: to });
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Action failed' },
      { status: 500 },
    );
  }
}
