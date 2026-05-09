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
import { sendEmail } from './email';

export type EmailAutomationKey =
  | 'booking_confirmation'
  | 'staff_booking_notification'
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
