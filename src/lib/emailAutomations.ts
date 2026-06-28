// Email automation registry + on/off toggle store.
//
// Every automated email type is declared here so admins can see the full
// list in one place (admin/email-automation) and switch any of them off
// without code changes. The toggle state lives in Firestore at
// `system/email_automations` as a plain object: { [key]: { enabled: boolean } }.
//
// Code sites that fire automated emails wrap their sendEmail() call with
// `sendAutomatedEmail()` which checks the toggle first.

import { adminDb } from './firebaseAdmin';
import { sendEmail, buildStaffBookingNotificationEmail, buildStaffReceiptPendingEmail, buildStaffSupplierOrderEmail, bookingNeedsSupplierOrder } from './email';
import type { BookingRecord } from '@/types';

export type EmailAutomationKey =
  | 'booking_confirmation'
  | 'booking_cancelled'
  | 'staff_booking_notification'
  | 'staff_supplier_order'
  | 'staff_receipt_pending'
  | 'offline_payment_pending'
  | 'fps_reminder'
  | 'balance_due_reminder'
  | 'lock_passcode'
  | 'post_event'
  | 'birthday'
  | 'welcome';

export interface EmailAutomationDef {
  key: EmailAutomationKey;
  /** Short, human-friendly name shown in the admin list. */
  name: { zh: string; en: string };
  /** What this email contains. */
  description: { zh: string; en: string };
  /** When the system fires it (one short sentence). */
  trigger: { zh: string; en: string };
  /** Audience — customer / staff / vip etc. (icon-friendly tag). */
  audience: 'customer' | 'staff';
}

export const EMAIL_AUTOMATIONS: EmailAutomationDef[] = [
  {
    key: 'booking_confirmation',
    name: { zh: '預約確認信', en: 'Booking Confirmation' },
    description: {
      zh: '客人付款成功後即時寄出，包括預訂明細、附加服務、餘款提示。',
      en: 'Sent to customer right after payment. Booking detail, add-ons, balance.',
    },
    trigger: {
      zh: 'Stripe 付款成功 / Admin 手動 confirm offline 付款',
      en: 'Stripe payment success / Admin confirms offline payment',
    },
    audience: 'customer',
  },
  {
    key: 'booking_cancelled',
    name: { zh: '預約取消通知', en: 'Booking Cancellation' },
    description: {
      zh: '當 admin 喺後台取消 booking 時自動寄畀客人，講明預訂已取消 + 退款指引。',
      en: 'Auto-fires when an admin cancels a booking. Tells the customer their booking is cancelled and how to ask about refunds.',
    },
    trigger: {
      zh: 'Admin 喺後台將 booking status 改做「已取消」',
      en: 'Admin flips booking status to "cancelled"',
    },
    audience: 'customer',
  },
  {
    key: 'staff_booking_notification',
    name: { zh: '內部新預約通知', en: 'Staff Booking Notification' },
    description: {
      zh: '寄畀 STAFF_NOTIFICATION_EMAILS 收件人，列明所有 add-ons 等資料以方便落 supplier order。',
      en: 'Sent to STAFF_NOTIFICATION_EMAILS recipients with full booking + add-on detail.',
    },
    trigger: {
      zh: 'Stripe 付款成功 / Admin 手動 confirm booking',
      en: 'Stripe payment success / Admin confirms booking',
    },
    audience: 'staff',
  },
  {
    key: 'staff_supplier_order',
    name: { zh: '內部 Supplier 訂購通知', en: 'Staff Supplier-Order Notice' },
    description: {
      zh: '當預訂含火鍋 / Shisha / 免費佈置 / 代燒員 / 美食到會,額外寄一封詳細通知 admin 即時聯絡供應商落單。',
      en: 'Extra email sent when the booking has hotpot / shisha / free decoration / BBQ chef / catering — itemised so admin can order from suppliers right away.',
    },
    trigger: {
      zh: '同 staff_booking_notification 同步觸發(只在含 supplier 項目時)',
      en: 'Fired alongside staff_booking_notification (only when supplier items present)',
    },
    audience: 'staff',
  },
  {
    key: 'staff_receipt_pending',
    name: { zh: '內部入數待核實通知', en: 'Staff Receipt Pending' },
    description: {
      zh: '客人上載線下入數紙後即時寄出，提示 admin/CS 入後台核實。',
      en: 'Fired the moment a customer uploads an offline-payment receipt — nudges admin/CS to review it.',
    },
    trigger: {
      zh: '客人喺 /pay-offline 或 my-bookings 上載入數紙',
      en: 'Customer uploads receipt on the offline-payment page',
    },
    audience: 'staff',
  },
  {
    key: 'offline_payment_pending',
    name: { zh: '待付款提示（offline）', en: 'Offline Payment Pending' },
    description: {
      zh: '客人揀 FPS / 銀行轉帳時寄出，包括付款資料 + 30 分鐘 hold 提示。',
      en: 'Sent when customer picks offline payment. Includes payment info + 30-min hold note.',
    },
    trigger: {
      zh: '客人喺 confirm 頁揀 FPS / 銀行付款',
      en: 'Customer picks offline payment on confirm page',
    },
    audience: 'customer',
  },
  {
    key: 'fps_reminder',
    name: { zh: '付款提醒（24 小時）', en: 'Payment Reminder (24h)' },
    description: {
      zh: '24 小時都未收到入數時自動催繳。',
      en: 'Auto-reminder when no payment received within 24h.',
    },
    trigger: {
      zh: 'Cron — 每 15 分鐘 check 一次',
      en: 'Cron — every 15 min',
    },
    audience: 'customer',
  },
  {
    key: 'balance_due_reminder',
    name: { zh: '尾數提醒', en: 'Balance Due Reminder' },
    description: {
      zh: '高金額 booking（>HK$10k）剩 2 日未找清尾數時催繳。',
      en: 'For high-value bookings paying 50% upfront. T-2d reminder if balance unpaid.',
    },
    trigger: {
      zh: 'Cron — 每日 03:00 HKT',
      en: 'Cron — daily at 03:00 HKT',
    },
    audience: 'customer',
  },
  {
    key: 'lock_passcode',
    name: { zh: '門鎖密碼', en: 'Door Passcode' },
    description: {
      zh: '活動前 1-2 日，當尾數已找清，自動發送門鎖密碼。',
      en: 'T-1/2 days before event when balance is fully paid. Sends door access passcode.',
    },
    trigger: {
      zh: 'Cron — 每日 01:00 HKT',
      en: 'Cron — daily at 01:00 HKT',
    },
    audience: 'customer',
  },
  {
    key: 'post_event',
    name: { zh: '活動後感謝信 + 積分', en: 'Post-Event Thank-You + Points' },
    description: {
      zh: '活動結束 ~3 日後寄出，告知客人賺取嘅積分 + nudge IG follow。',
      en: 'Sent ~3 days after event. Loyalty points earned + Instagram nudge.',
    },
    trigger: {
      zh: 'Cron — 每日 03:00 HKT',
      en: 'Cron — daily at 03:00 HKT',
    },
    audience: 'customer',
  },
  {
    key: 'birthday',
    name: { zh: '生日優惠', en: 'Birthday Promo' },
    description: {
      zh: '客人生日月份頭一日寄出，附專屬優惠碼。',
      en: 'Sent on the 1st of the customer\'s birth month with promo code.',
    },
    trigger: {
      zh: 'Cron（暫未啟用 — 待 birth date 收集）',
      en: 'Cron (currently disabled — pending birth date collection)',
    },
    audience: 'customer',
  },
  {
    key: 'welcome',
    name: { zh: '註冊歡迎信', en: 'Welcome Email' },
    description: {
      zh: '新會員首次註冊時寄出，介紹 SPACO + 引導第一次預約。',
      en: 'Sent on first signup. Introduces SPACO + nudges first booking.',
    },
    trigger: {
      zh: '客人註冊新會員',
      en: 'New user signup',
    },
    audience: 'customer',
  },
];

const TOGGLE_DOC = 'system/email_automations';

interface AutomationToggleMap {
  [key: string]: { enabled: boolean };
}

/** Check whether a specific email automation is currently enabled.
 *  Defaults to true if no toggle has ever been written. */
export async function isEmailAutomationEnabled(key: EmailAutomationKey): Promise<boolean> {
  try {
    const snap = await adminDb.doc(TOGGLE_DOC).get();
    if (!snap.exists) return true;
    const data = snap.data() as AutomationToggleMap;
    return data[key]?.enabled !== false;
  } catch {
    // Firestore unreachable — fail open so transactional emails still ship.
    return true;
  }
}

/** Read all toggle states (for the admin UI). */
export async function getAllEmailAutomationToggles(): Promise<AutomationToggleMap> {
  const snap = await adminDb.doc(TOGGLE_DOC).get();
  return snap.exists ? (snap.data() as AutomationToggleMap) : {};
}

/** Update a single toggle. */
export async function setEmailAutomationToggle(key: EmailAutomationKey, enabled: boolean): Promise<void> {
  await adminDb.doc(TOGGLE_DOC).set({ [key]: { enabled } }, { merge: true });
}

/** Wrapper around sendEmail that checks the automation toggle first. If
 *  the automation is disabled, the email is silently dropped (logged for
 *  visibility). Use this instead of sendEmail() for any automated email. */
export async function sendAutomatedEmail(params: {
  automationKey: EmailAutomationKey;
  to: string;
  subject: string;
  html: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const enabled = await isEmailAutomationEnabled(params.automationKey);
  if (!enabled) {
    console.log(`[email-automation] skipped ${params.automationKey} (disabled): ${params.to}`);
    return { sent: false, reason: 'disabled' };
  }
  await sendEmail({ to: params.to, subject: params.subject, html: params.html });
  return { sent: true };
}

/** Send the staff booking notification to all configured recipients. Reads
 *  STAFF_NOTIFICATION_EMAILS (comma-separated) and falls back to
 *  spacohk@gmail.com if unset. Honours the email-automation toggle so
 *  admins can pause it from /admin/email-automation. Errors are caught
 *  per-recipient so one bad address can't break the others.
 *
 *  Lives here (not in email.ts) so client bundles importing pure
 *  template helpers from email.ts don't pull in firebase-admin. */
export async function sendStaffBookingNotification(
  params: Parameters<typeof buildStaffBookingNotificationEmail>[0],
): Promise<void> {
  if (!(await isEmailAutomationEnabled('staff_booking_notification'))) {
    console.log('[staff-notify] skipped (automation disabled)');
    return;
  }
  const list = (process.env.STAFF_NOTIFICATION_EMAILS || 'spacohk@gmail.com')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length === 0) return;
  const tpl = buildStaffBookingNotificationEmail(params);
  await Promise.all(list.map((to) =>
    sendEmail({ to, subject: tpl.subject, html: tpl.html })
      .catch((err) => console.warn(`[staff-notify] send to ${to} failed:`, err)),
  ));
}

/** Send the supplier-order email — only when the booking actually
 *  contains supplier-trigger items (火鍋 / Shisha / 免費佈置 /
 *  代燒員 / 美食到會). No-op otherwise so callers can fire-and-
 *  forget without first checking the booking shape. */
export async function sendStaffSupplierOrderNotification(params: {
  booking: BookingRecord;
  venueName: string;
  customerName: string;
  customerEmail?: string;
  adminUrl: string;
}): Promise<void> {
  if (!bookingNeedsSupplierOrder(params.booking)) return;
  if (!(await isEmailAutomationEnabled('staff_supplier_order'))) {
    console.log('[staff-supplier] skipped (automation disabled)');
    return;
  }
  const list = (process.env.STAFF_NOTIFICATION_EMAILS || 'spacohk@gmail.com')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length === 0) return;
  const tpl = buildStaffSupplierOrderEmail(params);
  await Promise.all(list.map((to) =>
    sendEmail({ to, subject: tpl.subject, html: tpl.html })
      .catch((err) => console.warn(`[staff-supplier] send to ${to} failed:`, err)),
  ));
}

/** Send the "receipt pending review" notification to staff. Same recipient
 *  list + per-recipient error handling as the booking-confirmed notification. */
export async function sendStaffReceiptPendingNotification(
  params: Parameters<typeof buildStaffReceiptPendingEmail>[0],
): Promise<void> {
  if (!(await isEmailAutomationEnabled('staff_receipt_pending'))) {
    console.log('[staff-receipt-pending] skipped (automation disabled)');
    return;
  }
  const list = (process.env.STAFF_NOTIFICATION_EMAILS || 'spacohk@gmail.com')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length === 0) return;
  const tpl = buildStaffReceiptPendingEmail(params);
  await Promise.all(list.map((to) =>
    sendEmail({ to, subject: tpl.subject, html: tpl.html })
      .catch((err) => console.warn(`[staff-receipt-pending] send to ${to} failed:`, err)),
  ));
}
