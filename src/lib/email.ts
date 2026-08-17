// Email helper using Resend REST API directly (no heavy SDK)

import type { BookingRecord, AddOnOptions } from '@/types';
import { discountedSubtotal } from './bookingMoney';
import { calcShishaPrice } from './pricing';
import { getDecorationById } from './decorations';
import {
  CATERING_ITEMS,
  CATERING_TIERS,
  CATERING_DELIVERY_ZONES,
} from './cateringMenu';

interface EmailParams {
  to: string;
  subject: string;
  html: string;
}

/**
 * Strip HTML to a readable plain-text alt body. Gmail / Outlook /
 * Yahoo's spam filters give a slight ranking boost when the email is
 * multipart (HTML + text) — single-part HTML is a weak spam signal
 * even when the content itself is clean. Conversion is intentionally
 * simple: drop the head/scripts/styles, turn block tags into line
 * breaks, decode the most common HTML entities, then collapse
 * whitespace. Good enough for transactional emails — we own the
 * source HTML so no edge cases need handling.
 */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|td|th|section|article)\s*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function sendEmail({ to, subject, html }: EmailParams) {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'noreply@spacohk.com';
  // Reply-To routes customer replies to a humans-actually-read address.
  // Without this, a customer hitting reply just spams noreply@ which
  // nobody monitors. Defaults to the support inbox; can be overridden
  // via env if Heidi moves to a different inbox later.
  const replyTo = process.env.RESEND_REPLY_TO || 'spacohk@gmail.com';

  if (!apiKey || apiKey === 're_YOUR_KEY_HERE') {
    console.log('[Email] Skipping send (no API key configured):', { to, subject });
    return { id: 'skipped' };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: `SPACO <${fromEmail}>`,
      to: [to],
      // Reply-To so customer replies reach a real inbox; gives the
      // email a "this is a real business, here's a way to reach us"
      // signal to spam filters too.
      reply_to: replyTo,
      subject,
      html,
      // Multipart alternative — Gmail / Outlook spam scoring treats
      // HTML-only emails as marginally more suspicious. Auto-derived
      // from the HTML body so every email is multipart without each
      // template needing a hand-rolled plain-text version.
      text: htmlToPlainText(html),
      // Custom List-Unsubscribe-style headers aren't required for
      // pure transactional mail but Resend will inject them when
      // they're warranted. We keep the body strictly transactional.
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Email send failed:', error);
    throw new Error(`Email failed: ${error}`);
  }

  return response.json();
}

// ─────────────────────────────────────────────────────────────
// Shared design tokens — keep colours/fonts in lockstep with the
// website (pink gradient + cream background) so emails feel native.
// ─────────────────────────────────────────────────────────────
const EMAIL_BG    = '#FAF7F4';
const EMAIL_INK   = '#1A1A1A';
const EMAIL_PINK  = '#FF6B9D';
const EMAIL_PEACH = '#FFB088';
const EMAIL_FONT  = '"Helvetica Neue", Arial, sans-serif';

function emailHeader(subtitle: string): string {
  return `
    <div style="background: linear-gradient(135deg, ${EMAIL_PINK} 0%, ${EMAIL_PEACH} 100%); padding: 36px 24px; border-radius: 20px; text-align: center; margin-bottom: 20px;">
      <h1 style="margin: 0; font-size: 32px; font-weight: 800; color: white; letter-spacing: 0.02em;">SPACO</h1>
      <p style="margin: 6px 0 0; color: rgba(255,255,255,0.92); font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase;">${subtitle}</p>
    </div>
  `;
}

function emailFooter(): string {
  return `
    <p style="text-align: center; color: #999; font-size: 12px; margin-top: 24px;">
      © SPACO · <a href="https://spacohk.com" style="color: ${EMAIL_PINK}; text-decoration: none;">spacohk.com</a> ·
      <a href="https://instagram.com/spacohk" style="color: ${EMAIL_PINK}; text-decoration: none;">@spacohk</a>
    </p>
  `;
}

/** Render "HH:mm – HH:mm" with a "(翌日 YYYY-MM-DD)" suffix when the booking
 *  ends on a different date. Customers occasionally book past midnight and
 *  need to see the end date explicitly so they don't misread "02:00" as
 *  the same afternoon. */
function formatTimeRange(startTime: string, endTime: string, date: string, endDate?: string): string {
  const overnight = !!endDate && endDate !== date;
  return overnight
    ? `${startTime} – ${endTime}（翌日 ${endDate}）`
    : `${startTime} – ${endTime}`;
}

// ─────────────────────────────────────────────────────────────
// Welcome email — sent on first sign-up.
// ─────────────────────────────────────────────────────────────
export function buildWelcomeEmail(params: { customerName: string }) {
  return {
    subject: `歡迎加入 SPACO 🎉 Welcome aboard`,
    html: `
      <div style="font-family: ${EMAIL_FONT}; max-width: 600px; margin: 0 auto; background: ${EMAIL_BG}; padding: 40px 20px;">
        ${emailHeader('歡迎加入 · WELCOME')}
        <div style="background: white; padding: 32px; border-radius: 20px; margin-bottom: 16px;">
          <p style="margin: 0 0 16px; font-size: 16px; color: ${EMAIL_INK};">Hi ${params.customerName},</p>
          <p style="margin: 0 0 16px; color: #666; line-height: 1.7;">
            多謝你註冊成為 <strong>SPACO</strong> 會員！我哋有 4 間獨立 Party Room（銅鑼灣、灣仔、上環、尖沙咀），你可以隨時上網預約最啱嘅場地。
          </p>
          <div style="background: #FFF0F5; border-radius: 14px; padding: 18px 20px; margin: 20px 0;">
            <p style="margin: 0 0 6px; font-size: 13px; color: ${EMAIL_PINK}; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;">會員福利</p>
            <ul style="margin: 0; padding-left: 18px; color: #444; font-size: 14px; line-height: 1.8;">
              <li>每次預約自動賺取積分（HK$1 = 1 分）</li>
              <li>下次預訂可即時抵扣現金</li>
              <li>生日月份限定優惠</li>
              <li>會員專屬優先預約時段</li>
            </ul>
          </div>
          <div style="text-align: center; margin: 24px 0 8px;">
            <a href="https://spacohk.com" style="display: inline-block; background: ${EMAIL_INK}; color: white; padding: 12px 28px; border-radius: 999px; text-decoration: none; font-weight: 600; font-size: 14px;">
              立即預約 Book now →
            </a>
          </div>
        </div>
        ${emailFooter()}
      </div>
    `,
  };
}

// ─────────────────────────────────────────────────────────────
// Offline-payment pending email — sent when customer picks FPS / bank.
// Includes payment instructions + 30-min hold + WhatsApp deeplink.
// ─────────────────────────────────────────────────────────────
export function buildOfflinePaymentPendingEmail(params: {
  customerName: string;
  venueName: string;
  date: string;
  startTime: string;
  endTime: string;
  endDate?: string;
  amountDue: number;
  fpsNumber: string;
  bankName: string;
  bankAccount: string;
  bankHolder: string;
  bookingId: string;
  whatsappLink: string;
}) {
  return {
    subject: `⏰ SPACO 待付款提示 — 請於 30 分鐘內完成付款`,
    html: `
      <div style="font-family: ${EMAIL_FONT}; max-width: 600px; margin: 0 auto; background: ${EMAIL_BG}; padding: 40px 20px;">
        ${emailHeader('待付款 · PAYMENT PENDING')}
        <div style="background: white; padding: 32px; border-radius: 20px; margin-bottom: 16px;">
          <p style="margin: 0 0 16px;">Hi ${params.customerName},</p>
          <p style="margin: 0 0 18px; color: #666; line-height: 1.7;">
            多謝你預約 <strong>${params.venueName}</strong>。請於 <strong>30 分鐘內</strong> 完成付款並 WhatsApp 上傳入數紙截圖，否則此預約會自動取消（系統暫未為閣下預留場地，以收到款項時間為準）。
          </p>

          <div style="background: linear-gradient(135deg, #FFF0F5 0%, #FFF5EB 100%); border-radius: 16px; padding: 20px; margin-bottom: 18px;">
            <p style="margin: 0 0 4px; font-size: 11px; color: ${EMAIL_PINK}; letter-spacing: 0.1em; text-transform: uppercase; font-weight: 700;">應付金額</p>
            <p style="margin: 0; font-size: 32px; font-weight: 800; color: ${EMAIL_INK}; font-family: 'Courier New', monospace;">
              HK$${params.amountDue.toLocaleString()}
            </p>
          </div>

          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #999;">場地</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right; font-weight: 600;">${params.venueName}</td></tr>
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #999;">日期</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right; font-weight: 600;">${params.date}</td></tr>
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #999;">時段</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right; font-weight: 600;">${formatTimeRange(params.startTime, params.endTime, params.date, params.endDate)}</td></tr>
            <tr><td style="padding: 8px 0; color: #999;">預訂編號</td><td style="padding: 8px 0; text-align: right; font-family: 'Courier New', monospace; font-size: 12px;">${params.bookingId}</td></tr>
          </table>

          <div style="background: #F8F8F8; border-radius: 14px; padding: 18px 20px; margin: 20px 0 0; font-size: 14px;">
            <p style="margin: 0 0 8px; font-weight: 700; color: ${EMAIL_INK};">💸 付款方式</p>
            <p style="margin: 4px 0; color: #444;">FPS 轉數快：<strong>${params.fpsNumber}</strong></p>
            <p style="margin: 4px 0; color: #444;">銀行：<strong>${params.bankName}</strong></p>
            <p style="margin: 4px 0; color: #444;">戶口：<strong>${params.bankAccount}</strong> (${params.bankHolder})</p>
          </div>

          <div style="text-align: center; margin: 24px 0 4px;">
            <a href="${params.whatsappLink}" style="display: inline-block; background: #25D366; color: white; padding: 12px 28px; border-radius: 999px; text-decoration: none; font-weight: 600; font-size: 14px;">
              💬 WhatsApp 上傳入數紙
            </a>
          </div>
        </div>
        ${emailFooter()}
      </div>
    `,
  };
}

// ─────────────────────────────────────────────────────────────
// Post-event email — sent ~3 days after the event ends.
// Surfaces loyalty point balance + nudges customer to follow IG.
// ─────────────────────────────────────────────────────────────
export function buildPostEventEmail(params: {
  customerName: string;
  venueName: string;
  date: string;
  pointsEarned: number;
  pointsBalance: number;
}) {
  return {
    subject: `🎈 多謝你選擇 SPACO — 你已賺取 ${params.pointsEarned} 積分`,
    html: `
      <div style="font-family: ${EMAIL_FONT}; max-width: 600px; margin: 0 auto; background: ${EMAIL_BG}; padding: 40px 20px;">
        ${emailHeader('THANK YOU · 多謝你嘅光臨')}
        <div style="background: white; padding: 32px; border-radius: 20px; margin-bottom: 16px;">
          <p style="margin: 0 0 14px;">Hi ${params.customerName},</p>
          <p style="margin: 0 0 18px; color: #666; line-height: 1.7;">
            希望你 ${params.date} 喺 <strong>${params.venueName}</strong> 嘅活動順利！多謝信任 SPACO，下次再見 💕
          </p>

          <div style="background: linear-gradient(135deg, ${EMAIL_PINK} 0%, ${EMAIL_PEACH} 100%); border-radius: 16px; padding: 22px; color: white; text-align: center; margin: 20px 0;">
            <p style="margin: 0 0 6px; font-size: 12px; opacity: 0.9; letter-spacing: 0.1em; text-transform: uppercase;">是次活動賺取</p>
            <p style="margin: 0 0 12px; font-size: 36px; font-weight: 800; font-family: 'Courier New', monospace;">+${params.pointsEarned}</p>
            <div style="border-top: 1px solid rgba(255,255,255,0.4); padding-top: 12px; font-size: 14px;">
              累計積分結餘：<strong style="font-size: 18px;">${params.pointsBalance.toLocaleString()}</strong> 分
            </div>
            <p style="margin: 8px 0 0; font-size: 12px; opacity: 0.85;">下次預訂可直接抵扣現金</p>
          </div>

          <div style="background: #FFF0F5; border-radius: 14px; padding: 18px 20px;">
            <p style="margin: 0 0 8px; font-weight: 700; color: ${EMAIL_PINK};">📸 一齊喺 Instagram 留低</p>
            <p style="margin: 0 0 12px; color: #444; font-size: 14px; line-height: 1.6;">
              Tag <strong>@spacohk</strong> 同 #spacohk，我哋會喺 IG story repost，同你嘅朋友一齊回顧今日嘅快樂時光！
            </p>
            <a href="https://instagram.com/spacohk" style="display: inline-block; background: ${EMAIL_INK}; color: white; padding: 10px 22px; border-radius: 999px; text-decoration: none; font-weight: 600; font-size: 13px;">
              Follow @spacohk →
            </a>
          </div>
        </div>
        ${emailFooter()}
      </div>
    `,
  };
}

// ─────────────────────────────────────────────────────────────
// Birthday email — sent on first day of customer's birth month.
// ─────────────────────────────────────────────────────────────
export function buildBirthdayEmail(params: {
  customerName: string;
  promoCode?: string;
  discountText?: string;
}) {
  const code = params.promoCode || 'BIRTHDAY';
  const discount = params.discountText || '88 折';
  return {
    subject: `🎂 ${params.customerName}，SPACO 祝你生日快樂！`,
    html: `
      <div style="font-family: ${EMAIL_FONT}; max-width: 600px; margin: 0 auto; background: ${EMAIL_BG}; padding: 40px 20px;">
        ${emailHeader('HAPPY BIRTHDAY · 生日快樂')}
        <div style="background: white; padding: 32px; border-radius: 20px; margin-bottom: 16px; text-align: center;">
          <p style="font-size: 60px; margin: 0 0 4px; line-height: 1;">🎂</p>
          <p style="margin: 0 0 12px; font-size: 22px; font-weight: 700; color: ${EMAIL_INK};">Hi ${params.customerName}!</p>
          <p style="margin: 0 0 22px; color: #666; line-height: 1.7;">
            生日月份用以下優惠碼預約場地，整月慶祝都可以！
          </p>
          <div style="background: linear-gradient(135deg, ${EMAIL_PINK} 0%, ${EMAIL_PEACH} 100%); border-radius: 18px; padding: 24px; color: white; margin: 20px 0;">
            <p style="margin: 0 0 6px; font-size: 12px; opacity: 0.9; letter-spacing: 0.1em; text-transform: uppercase;">生日專屬優惠</p>
            <p style="margin: 0 0 12px; font-size: 28px; font-weight: 800;">${discount}</p>
            <div style="background: white; color: ${EMAIL_INK}; display: inline-block; padding: 10px 22px; border-radius: 999px; font-family: 'Courier New', monospace; font-weight: 700; letter-spacing: 0.15em; font-size: 18px;">
              ${code}
            </div>
            <p style="margin: 12px 0 0; font-size: 11px; opacity: 0.85;">優惠有效期至生日月底</p>
          </div>
          <a href="https://spacohk.com" style="display: inline-block; background: ${EMAIL_INK}; color: white; padding: 12px 28px; border-radius: 999px; text-decoration: none; font-weight: 600; font-size: 14px;">
            立即預約 →
          </a>
        </div>
        ${emailFooter()}
      </div>
    `,
  };
}

/** CWB lift-replacement works — notice shown on confirmation emails for
 *  Causeway Bay bookings dated within the works window (inclusive). */
const CWB_LIFT_NOTICE_START = '2026-08-17';
const CWB_LIFT_NOTICE_END = '2026-11-16';
export function cwbLiftNoticeApplies(venueId: string | undefined, date: string): boolean {
  return venueId === 'cwb' && date >= CWB_LIFT_NOTICE_START && date <= CWB_LIFT_NOTICE_END;
}

export function buildBookingConfirmationEmail(params: {
  customerName: string;
  /** Venue id (e.g. 'cwb') — enables venue-specific notices like the
   *  CWB lift-replacement banner. Optional for backward compat. */
  venueId?: string;
  venueName: string;
  /** Full street address — surfaced in the booking detail row so the
   *  customer knows exactly where to go. Optional for backward compat. */
  venueAddress?: string;
  date: string;
  startTime: string;
  endTime: string;
  endDate?: string;
  guestCount: number;
  /** Optional adult/child split. When childCount > 0, the breakdown
   *  appears in the people row. */
  adultCount?: number;
  childCount?: number;
  /** GROSS (pre-promo) consumption subtotal — the stored convention. The
   *  displayed 小計 is derived: gross − promoDiscount (#nbWTrtyG). */
  subtotal: number;
  deposit: number;
  /** Refundable security deposit — enables the 可退按金 + 總額 rows. */
  securityDeposit?: number;
  /** Promo code redeemed at checkout (e.g. "WELCOME10"). When set, a
   *  green discount line shows in the amount table. */
  promoCode?: string;
  promoDiscount?: number;
  /** Loyalty points redeemed at checkout. When > 0, a violet line shows
   *  the points used and the HK$ value subtracted from the upfront. */
  pointsUsed?: number;
  pointsDiscount?: number;
  /** Outstanding balance for high-value bookings paying 50% upfront.
   *  When > 0, a yellow notice with due date appears. */
  balanceDue?: number;
  balanceDueDate?: string;
  /** Pre-formatted add-ons line (e.g. "BBQ Standard Package ×4, ..."). */
  addOnsLine?: string;
  paymentMethod: string;
  whatsappLink: string;
  /** Optional list of human-readable change descriptions (e.g.
   *  ["日期:2026-07-15 → 2026-07-20", "人數:10 → 15"]). When provided,
   *  shows a yellow "預訂已更新" banner at the top so the customer
   *  immediately knows what changed. */
  changes?: string[];
}) {
  const peopleLine = (params.childCount ?? 0) > 0
    ? `${params.guestCount} 人 (${params.adultCount ?? params.guestCount} 成人 + ${params.childCount} 小童)`
    : `${params.guestCount} 人`;
  const addOnsRow = params.addOnsLine
    ? `<tr><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; color: #999; font-size: 13px; vertical-align: top;">附加服務</td><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; text-align: right; font-weight: 600; color: #6D28D9; max-width: 380px;">${params.addOnsLine}</td></tr>`
    : '';
  const balanceNotice = (params.balanceDue ?? 0) > 0
    ? `<div style="background: #FFF7E6; border-left: 4px solid #F59E0B; border-radius: 12px; padding: 14px 18px; margin: 0 0 18px;">
         <p style="margin: 0 0 4px; font-weight: 700; color: #92400E; font-size: 13px;">⏰ 未找清尾數 HK$${params.balanceDue!.toLocaleString()}</p>
         <p style="margin: 0; font-size: 12px; color: #78350F; line-height: 1.5;">
           請於活動前 2 日（${params.balanceDueDate || '活動前 2 日'}）找清尾數，系統先會自動發送門鎖密碼。
         </p>
       </div>`
    : '';
  // Update notice — shown when admin edits the booking and the followup
  // route detects diffs (date/time/venue/people/add-ons changed).
  const changesNotice = (params.changes && params.changes.length > 0)
    ? `<div style="background: #EFF6FF; border-left: 4px solid #3B82F6; border-radius: 12px; padding: 14px 18px; margin: 0 0 18px;">
         <p style="margin: 0 0 8px; font-weight: 700; color: #1E40AF; font-size: 13px;">🔄 你嘅預訂已更新</p>
         <p style="margin: 0 0 6px; font-size: 12px; color: #1E3A8A; line-height: 1.5;">以下項目已修改:</p>
         <ul style="margin: 0; padding-left: 18px; color: #1E3A8A; font-size: 12px; line-height: 1.7;">
           ${params.changes.map((c) => `<li>${c}</li>`).join('')}
         </ul>
       </div>`
    : '';
  // CWB lift-replacement notice (2026-08-17 → 2026-11-16).
  const liftNotice = cwbLiftNoticeApplies(params.venueId, params.date)
    ? `<div style="background: #FEF2F2; border-left: 4px solid #EF4444; border-radius: 12px; padding: 14px 18px; margin: 0 0 18px;">
         <p style="margin: 0 0 6px; font-weight: 700; color: #991B1B; font-size: 13px;">🛠️ 銅鑼灣店大廈電梯維修通告</p>
         <p style="margin: 0; font-size: 12px; color: #7F1D1D; line-height: 1.7;">
           大廈電梯於2026年8月17日至11月16日進行更換工程<br/>
           因此在此期間，只能乘搭雙數電梯上樓，並行一層樓梯到達我們的party Room<br/>
           不便之處，敬請原諒
         </p>
       </div>`
    : '';
  // Subject reflects whether this is an update vs first-time confirmation.
  const isUpdate = !!(params.changes && params.changes.length > 0);
  return {
    subject: isUpdate
      ? `🔄 SPACO 預訂已更新 — ${params.venueName} (${params.date})`
      : `🎉 SPACO 預約已確認 — ${params.venueName} (${params.date})`,
    html: `
      <div style="font-family: ${EMAIL_FONT}; max-width: 600px; margin: 0 auto; background: ${EMAIL_BG}; padding: 40px 20px;">
        ${emailHeader('預約已確認 · BOOKING CONFIRMED')}

        <div style="background: white; padding: 32px; border-radius: 20px; margin-bottom: 16px;">
          <p style="margin: 0 0 14px; font-size: 16px; color: ${EMAIL_INK};">Hi ${params.customerName},</p>
          <p style="margin: 0 0 22px; color: #666; line-height: 1.7;">
            你嘅預約已成功確認！以下係預訂詳情，請保留此電郵作日後參考。
          </p>

          <!-- Hero summary card -->
          <div style="background: linear-gradient(135deg, ${EMAIL_PINK} 0%, ${EMAIL_PEACH} 100%); border-radius: 18px; padding: 22px; color: white; margin: 0 0 22px;">
            <p style="margin: 0 0 4px; font-size: 11px; opacity: 0.92; letter-spacing: 0.12em; text-transform: uppercase; font-weight: 700;">${params.venueName}</p>
            <p style="margin: 0 0 10px; font-size: 22px; font-weight: 800; line-height: 1.25;">
              ${params.date} · ${formatTimeRange(params.startTime, params.endTime, params.date, params.endDate)}
            </p>
            <p style="margin: 0; font-size: 13px; opacity: 0.92;">${peopleLine}</p>
          </div>

          ${changesNotice}
          ${liftNotice}
          ${balanceNotice}

          <h3 style="margin: 0 0 12px; font-size: 14px; color: ${EMAIL_INK}; letter-spacing: 0.04em; text-transform: uppercase;">📋 預訂明細</h3>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 8px;">
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; color: #999; font-size: 13px;">場地</td><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; text-align: right; font-weight: 600;">${params.venueName}</td></tr>
            ${params.venueAddress ? `<tr><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; color: #999; font-size: 13px; vertical-align: top;">📍 地址</td><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; text-align: right; font-weight: 600; line-height: 1.5;">${params.venueAddress}</td></tr>` : ''}
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; color: #999; font-size: 13px;">日期</td><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; text-align: right; font-weight: 600;">${params.date}</td></tr>
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; color: #999; font-size: 13px;">時段</td><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; text-align: right; font-weight: 600;">${formatTimeRange(params.startTime, params.endTime, params.date, params.endDate)}</td></tr>
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; color: #999; font-size: 13px;">人數</td><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; text-align: right; font-weight: 600;">${peopleLine}</td></tr>
            ${addOnsRow}
          </table>

          <h3 style="margin: 22px 0 12px; font-size: 14px; color: ${EMAIL_INK}; letter-spacing: 0.04em; text-transform: uppercase;">💰 金額</h3>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            ${params.promoCode && (params.promoDiscount ?? 0) > 0 ? `<tr><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; color: #047857; font-size: 13px;">🎟️ 優惠碼 <span style="font-family: 'Courier New', monospace;">${params.promoCode}</span></td><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; text-align: right; font-weight: 600; color: #047857;">−HK$${params.promoDiscount!.toLocaleString()}</td></tr>` : ''}
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; color: #999; font-size: 13px;">小計${(params.promoDiscount ?? 0) > 0 ? '（已扣優惠）' : ''}</td><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; text-align: right; font-weight: 600;">HK$${discountedSubtotal(params.subtotal, params.promoDiscount).toLocaleString()}</td></tr>
            ${typeof params.securityDeposit === 'number' ? `<tr><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; color: #999; font-size: 13px;">可退按金（活動後退還）</td><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; text-align: right; font-weight: 600;">HK$${params.securityDeposit.toLocaleString()}</td></tr>` : ''}
            ${typeof params.securityDeposit === 'number' ? `<tr><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; color: ${EMAIL_INK}; font-size: 13px; font-weight: 700;">總額</td><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; text-align: right; font-weight: 700;">HK$${(discountedSubtotal(params.subtotal, params.promoDiscount) + params.securityDeposit).toLocaleString()}</td></tr>` : ''}
            ${(params.pointsDiscount ?? 0) > 0 ? `<tr><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; color: #6D28D9; font-size: 13px;">✨ 積分抵扣</td><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; text-align: right; font-weight: 600; color: #6D28D9;">−HK$${params.pointsDiscount!.toLocaleString()} (${(params.pointsUsed || 0).toLocaleString()} 分)</td></tr>` : ''}
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; color: #999; font-size: 13px;">已付款</td><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; text-align: right; font-weight: 600;">HK$${Math.max(0, params.deposit - (params.pointsDiscount || 0)).toLocaleString()}</td></tr>
            ${(params.balanceDue ?? 0) > 0 ? `<tr><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; color: #B45309; font-size: 13px;">⚠️ 尾數（活動前 2 日繳清）</td><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; text-align: right; font-weight: 700; color: #B45309;">HK$${params.balanceDue!.toLocaleString()}</td></tr>` : ''}
            <tr><td style="padding: 10px 0; color: #999; font-size: 13px;">付款方式</td><td style="padding: 10px 0; text-align: right; font-weight: 600;">${params.paymentMethod}</td></tr>
          </table>
        </div>

        <!-- Next steps card -->
        <div style="background: white; padding: 24px; border-radius: 20px; margin-bottom: 16px;">
          <p style="margin: 0 0 10px; font-weight: 700; color: ${EMAIL_INK}; font-size: 14px;">📅 接住點？</p>
          <ul style="margin: 0; padding-left: 18px; color: #555; font-size: 13px; line-height: 1.8;">
            <li>場地門鎖密碼會喺活動前 <strong>1–2 日</strong> 自動 email 畀你${(params.balanceDue ?? 0) > 0 ? '（前提係尾數已找清）' : ''}</li>
            <li>BBQ／火鍋／Shisha 等 add-ons 已落 order 畀供應商，活動當日會送到場</li>
            <li>有任何問題隨時 WhatsApp 我哋</li>
          </ul>
          <div style="text-align: center; margin-top: 18px;">
            <a href="${params.whatsappLink}" style="display: inline-block; background: #25D366; color: white; padding: 11px 26px; border-radius: 999px; text-decoration: none; font-weight: 600; font-size: 14px;">
              💬 WhatsApp 客服
            </a>
          </div>
        </div>

        ${emailFooter()}
      </div>
    `,
  };
}

export function buildFPSReminderEmail(params: {
  customerName: string;
  venueName: string;
  subtotal: number;
  fpsNumber: string;
  bankAccount: string;
  deadline: string;
}) {
  return {
    subject: `⏰ SPACO 付款提醒 — 請於 24 小時內完成付款`,
    html: `
      <div style="font-family: ${EMAIL_FONT}; max-width: 600px; margin: 0 auto; background: ${EMAIL_BG}; padding: 40px 20px;">
        ${emailHeader('付款提醒 · PAYMENT REMINDER')}

        <div style="background: white; padding: 32px; border-radius: 20px; margin-bottom: 16px;">
          <p style="margin: 0 0 14px; font-size: 16px; color: ${EMAIL_INK};">Hi ${params.customerName},</p>
          <p style="margin: 0 0 20px; color: #666; line-height: 1.7;">
            你嘅 <strong>${params.venueName}</strong> 預約仲未收到入數，請喺以下截止時間前完成付款並上傳入數紙截圖。
          </p>

          <div style="background: #FFF7E6; border-left: 4px solid #F59E0B; border-radius: 14px; padding: 16px 20px; margin: 0 0 20px;">
            <p style="margin: 0 0 4px; font-size: 11px; color: #92400E; letter-spacing: 0.1em; text-transform: uppercase; font-weight: 700;">截止時間</p>
            <p style="margin: 0; font-size: 16px; color: #78350F; font-weight: 700;">${params.deadline}</p>
            <p style="margin: 6px 0 0; font-size: 12px; color: #92400E;">逾時未付款將自動取消預約。</p>
          </div>

          <div style="background: linear-gradient(135deg, #FFF0F5 0%, #FFF5EB 100%); border-radius: 14px; padding: 18px 20px; margin: 0 0 18px;">
            <p style="margin: 0 0 4px; font-size: 11px; color: ${EMAIL_PINK}; letter-spacing: 0.1em; text-transform: uppercase; font-weight: 700;">應付金額</p>
            <p style="margin: 0; font-size: 28px; font-weight: 800; color: ${EMAIL_INK}; font-family: 'Courier New', monospace;">
              HK$${params.subtotal.toLocaleString()}
            </p>
          </div>

          <div style="background: #F8F8F8; border-radius: 14px; padding: 18px 20px; font-size: 14px;">
            <p style="margin: 0 0 8px; font-weight: 700; color: ${EMAIL_INK};">💸 付款方式</p>
            <p style="margin: 4px 0; color: #444;">FPS 轉數快：<strong>${params.fpsNumber}</strong></p>
            <p style="margin: 4px 0; color: #444;">銀行帳號：<strong>${params.bankAccount}</strong></p>
          </div>
        </div>

        ${emailFooter()}
      </div>
    `,
  };
}

export function generateWhatsAppLink(phone: string, message: string): string {
  const encoded = encodeURIComponent(message);
  return `https://wa.me/${phone}?text=${encoded}`;
}

// ─────────────────────────────────────────────────────────────
// Lock passcode delivery — sent ~2 days before the event once balance
// is fully cleared. Contains the door passcode + validity window.
// ─────────────────────────────────────────────────────────────

/** "YYYY-MM-DD HH:mm" formatted for HKT, used in the email templates. */
function formatHkt(unixMs: number): string {
  const d = new Date(unixMs + 8 * 60 * 60 * 1000);
  const y  = d.getUTCFullYear();
  const m  = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${y}-${m}-${dd} ${hh}:${mm}`;
}

export function buildLockPasscodeEmail(params: {
  customerName: string;
  venueName: string;
  /** Full street address — shown next to the venue name so the customer
   *  has the address handy when arriving at the door. */
  venueAddress?: string;
  date: string;
  startTime: string;
  endTime: string;
  endDate?: string;
  passcode: string;
  validFromMs: number;
  validToMs: number;
  whatsappLink: string;
  /** Cloudinary URL to a per-branch lock usage guide image. Rendered just
   *  before the warning block. Optional — omit when no guide is configured. */
  lockGuideImageUrl?: string;
}) {
  return {
    subject: `🔑 SPACO 場地門鎖密碼 — ${params.venueName} (${params.date})`,
    html: `
      <div style="font-family: ${EMAIL_FONT}; max-width: 600px; margin: 0 auto; background: ${EMAIL_BG}; padding: 40px 20px;">
        ${emailHeader('門鎖密碼 · DOOR ACCESS CODE')}

        <div style="background: white; padding: 32px; border-radius: 20px; margin-bottom: 16px;">
          <p style="margin: 0 0 14px; font-size: 16px; color: ${EMAIL_INK};">Hi ${params.customerName},</p>
          <p style="margin: 0 0 22px; color: #666; line-height: 1.7;">
            你預訂嘅活動快將開始，以下係場地嘅入門密碼。請保管好，活動當日就用呢個密碼開門。
          </p>

          <div style="background: linear-gradient(135deg, ${EMAIL_PINK} 0%, ${EMAIL_PEACH} 100%); color: white; padding: 26px 20px; border-radius: 18px; text-align: center; margin-bottom: 22px;">
            <p style="margin: 0 0 8px; font-size: 11px; opacity: 0.9; letter-spacing: 0.12em; text-transform: uppercase; font-weight: 700;">門鎖密碼 Passcode</p>
            <p style="margin: 0; font-size: 38px; font-weight: 800; letter-spacing: 0.18em; font-family: 'Courier New', monospace;">
              ${params.passcode}#
            </p>
          </div>

          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; color: #999; font-size: 13px;">場地</td><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; text-align: right; font-weight: 600;">${params.venueName}</td></tr>
            ${params.venueAddress ? `<tr><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; color: #999; font-size: 13px; vertical-align: top;">📍 地址</td><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; text-align: right; font-weight: 600; line-height: 1.5;">${params.venueAddress}</td></tr>` : ''}
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; color: #999; font-size: 13px;">活動日期</td><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; text-align: right; font-weight: 600;">${params.date}</td></tr>
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; color: #999; font-size: 13px;">活動時段</td><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; text-align: right; font-weight: 600;">${formatTimeRange(params.startTime, params.endTime, params.date, params.endDate)}</td></tr>
            <tr><td style="padding: 10px 0; color: #999; font-size: 13px; vertical-align: top;">密碼有效期</td><td style="padding: 10px 0; text-align: right; font-weight: 600;">${formatHkt(params.validFromMs)}<br><span style="font-size: 12px; color: #999; font-weight: 400;">至 ${formatHkt(params.validToMs)}</span></td></tr>
          </table>
        </div>

        ${params.lockGuideImageUrl ? `
        <div style="background: white; border-radius: 18px; padding: 20px; margin-bottom: 16px; text-align: center;">
          <p style="margin: 0 0 12px; font-size: 13px; color: ${EMAIL_INK}; letter-spacing: 0.04em; text-transform: uppercase; font-weight: 700;">🔑 門鎖使用指南</p>
          <img src="${params.lockGuideImageUrl}" alt="Lock usage guide" style="display: block; max-width: 100%; height: auto; margin: 0 auto; border-radius: 12px;" />
        </div>
        ` : ''}

        <div style="background: #FFF7E6; border-left: 4px solid #F59E0B; border-radius: 14px; padding: 16px 20px; margin-bottom: 16px;">
          <p style="margin: 0 0 8px; font-weight: 700; color: #92400E; font-size: 14px;">⚠️ 重要提醒</p>
          <ul style="margin: 0; padding-left: 18px; color: #78350F; font-size: 13px; line-height: 1.7;">
            <li><strong>🚫 唔好觸摸圓形指模掣</strong> — 系統冇登記你嘅指模，掂咗指模掣之後再入密碼會被當錯誤密碼。請<strong>直接撳數字鍵</strong>輸入密碼。</li>
            <li>密碼會喺活動結束時間自動失效</li>
            <li>請勿將密碼公開或轉發畀非預約名單上嘅人</li>
            <li>離場時請確認所有電器已關閉、門已鎖好</li>
          </ul>
        </div>

        <div style="text-align: center; margin: 0 0 20px;">
          <a href="${params.whatsappLink}" style="display: inline-block; background: #25D366; color: white; padding: 12px 28px; border-radius: 999px; text-decoration: none; font-weight: 600; font-size: 14px;">
            💬 有疑問？WhatsApp 客服
          </a>
        </div>

        ${emailFooter()}
      </div>
    `,
  };
}

// ─────────────────────────────────────────────────────────────
// Balance-due reminder — sent when a booking enters the 2-day window
// but the customer still owes the remaining balance.
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// Staff notification email — fired when a booking is confirmed
// (Stripe payment OR admin manual confirm). Recipients come from
// STAFF_NOTIFICATION_EMAILS env var (comma-separated). Includes full
// add-on detail so CS / ops can place supplier orders without opening
// the admin panel.
// ─────────────────────────────────────────────────────────────

export function buildStaffBookingNotificationEmail(params: {
  bookingId: string;
  venueName: string;
  date: string;
  startTime: string;
  endTime: string;
  endDate?: string;
  guestCount: number;
  adultCount?: number;
  childCount?: number;
  customerName: string;
  customerEmail?: string;
  whatsappPhone?: string;
  /** GROSS (pre-promo) consumption subtotal — the stored convention. The
   *  displayed 小計 is derived: gross − promoDiscount (#nbWTrtyG: a 小計
   *  line must already reflect the promo deduction). */
  subtotal: number;
  deposit: number;
  balanceDue: number;
  promoCode?: string;
  promoDiscount?: number;
  pointsDiscount?: number;
  /** Refundable security deposit — enables the 可退按金 + 總額 rows. */
  securityDeposit?: number;
  addOnsLine: string;
  hasBYOFood: boolean;
  paymentMethod: string;
  adminUrl: string;
}) {
  const balanceRow = params.balanceDue > 0
    ? `<tr><td style="padding: 8px 0; color: #991B1B; font-size: 13px;">⚠️ 尚欠尾數</td><td style="padding: 8px 0; text-align: right; font-weight: 700; color: #991B1B;">HK$${params.balanceDue.toLocaleString()}</td></tr>`
    : '';
  const addOnsRow = params.addOnsLine
    ? `<tr><td style="padding: 8px 0; color: #6D28D9; font-size: 13px;">📦 附加服務</td><td style="padding: 8px 0; text-align: right; font-weight: 600; color: #6D28D9;">${params.addOnsLine}</td></tr>`
    : '';
  const byoRow = params.hasBYOFood
    ? `<tr><td style="padding: 8px 0; color: #999; font-size: 13px;">自攜食物</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">是</td></tr>`
    : '';
  return {
    subject: `🔔 新預約確認 — ${params.venueName} ${params.date} (${params.customerName})`,
    html: `
      <div style="font-family: ${EMAIL_FONT}; max-width: 640px; margin: 0 auto; background: ${EMAIL_BG}; padding: 32px 20px;">
        ${emailHeader('內部通知 · BOOKING CONFIRMED')}
        <div style="background: white; padding: 28px; border-radius: 20px; margin-bottom: 16px;">
          <p style="margin: 0 0 8px; font-size: 14px; color: #999;">Booking ID</p>
          <p style="margin: 0 0 20px; font-family: 'Courier New', monospace; font-size: 14px; color: ${EMAIL_INK};">${params.bookingId}</p>

          <h2 style="margin: 0 0 16px; font-size: 18px; color: ${EMAIL_INK};">📋 預訂詳情</h2>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #999; font-size: 13px;">場地</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right; font-weight: 600;">${params.venueName}</td></tr>
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #999; font-size: 13px;">日期</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right; font-weight: 600;">${params.date}</td></tr>
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #999; font-size: 13px;">時段</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right; font-weight: 600;">${formatTimeRange(params.startTime, params.endTime, params.date, params.endDate)}</td></tr>
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #999; font-size: 13px;">人數</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right; font-weight: 600;">${params.guestCount} 人${(params.childCount ?? 0) > 0 ? ` (${params.adultCount ?? params.guestCount} 成人 + ${params.childCount} 小童)` : ''}</td></tr>
            ${addOnsRow}
            ${byoRow}
          </table>

          <h2 style="margin: 0 0 16px; font-size: 18px; color: ${EMAIL_INK};">💰 金額</h2>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
            ${params.promoCode && (params.promoDiscount ?? 0) > 0 ? `<tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #047857; font-size: 13px;">🎟️ 優惠碼 <span style="font-family: 'Courier New', monospace;">${params.promoCode}</span></td><td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right; font-weight: 600; color: #047857;">−HK$${params.promoDiscount!.toLocaleString()}</td></tr>` : ''}
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #999; font-size: 13px;">小計${(params.promoDiscount ?? 0) > 0 ? '（已扣優惠）' : ''}</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right; font-weight: 600;">HK$${discountedSubtotal(params.subtotal, params.promoDiscount).toLocaleString()}</td></tr>
            ${typeof params.securityDeposit === 'number' ? `<tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #999; font-size: 13px;">可退按金</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right; font-weight: 600;">HK$${params.securityDeposit.toLocaleString()}</td></tr>` : ''}
            ${typeof params.securityDeposit === 'number' ? `<tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: ${EMAIL_INK}; font-size: 13px; font-weight: 700;">總額</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right; font-weight: 700;">HK$${(discountedSubtotal(params.subtotal, params.promoDiscount) + params.securityDeposit).toLocaleString()}</td></tr>` : ''}
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #999; font-size: 13px;">已付款</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right; font-weight: 600;">HK$${Math.max(0, params.deposit - (params.pointsDiscount || 0)).toLocaleString()}</td></tr>
            ${balanceRow}
            <tr><td style="padding: 8px 0; color: #999; font-size: 13px;">付款方式</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${params.paymentMethod}</td></tr>
          </table>

          <h2 style="margin: 0 0 16px; font-size: 18px; color: ${EMAIL_INK};">👤 客戶聯絡</h2>
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #999; font-size: 13px;">姓名</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right; font-weight: 600;">${params.customerName}</td></tr>
            ${params.whatsappPhone ? `<tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #999; font-size: 13px;">WhatsApp</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right; font-weight: 600;">${params.whatsappPhone}</td></tr>` : ''}
            ${params.customerEmail ? `<tr><td style="padding: 8px 0; color: #999; font-size: 13px;">Email</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${params.customerEmail}</td></tr>` : ''}
          </table>
        </div>

        <div style="text-align: center; margin-bottom: 16px;">
          <a href="${params.adminUrl}" style="display: inline-block; background: linear-gradient(135deg, ${EMAIL_PINK} 0%, ${EMAIL_PEACH} 100%); color: white; padding: 14px 32px; border-radius: 999px; text-decoration: none; font-weight: 700; font-size: 14px;">
            打開後台 · Open Admin
          </a>
        </div>

        ${emailFooter()}
      </div>
    `,
  };
}

// ─────────────────────────────────────────────────────────────
// Supplier-order notification — sent IN ADDITION to the regular
// booking-confirmed notification when the booking contains any item
// requiring CS to place a supplier order (火鍋 / Shisha / 免費佈置
// / 代燒員 / 美食到會). Itemised so CS can copy-paste directly into
// supplier WhatsApp / email.
// ─────────────────────────────────────────────────────────────

/** Detect whether a booking has any supplier-triggering add-on. */
export function bookingNeedsSupplierOrder(booking: BookingRecord): boolean {
  const SUPPLIER_IDS = new Set(['hotpot-standard', 'hotpot-seafood', 'hotpot-extra-soup', 'shisha', 'bbq-helper', 'catering']);
  if ((booking.addOns || []).some((a) => SUPPLIER_IDS.has(a.id))) return true;
  if (booking.decorationStyle) return true;
  return false;
}

/** Render the supplier-order email. Each triggered category gets
 *  its own clearly-labelled section so CS can scan + copy the
 *  paragraph they need without rebuilding the order from scratch. */
export function buildStaffSupplierOrderEmail(params: {
  booking: BookingRecord;
  venueName: string;
  customerName: string;
  customerEmail?: string;
  adminUrl: string;
}) {
  const { booking, venueName, customerName, customerEmail, adminUrl } = params;
  const adults = booking.adultCount ?? booking.guestCount;
  const children = booking.childCount ?? 0;
  const adultEquiv = adults + 0.5 * children;
  const guestLabel = children > 0
    ? `${booking.guestCount} 人（${adults} 成人 + ${children} 小童）`
    : `${booking.guestCount} 人`;

  const sections: string[] = [];

  // ── Hotpot ──
  const hotpotStd  = booking.addOns?.find((a) => a.id === 'hotpot-standard');
  const hotpotSea  = booking.addOns?.find((a) => a.id === 'hotpot-seafood');
  const extraSoup  = booking.addOns?.find((a) => a.id === 'hotpot-extra-soup');
  if (hotpotStd || hotpotSea || extraSoup) {
    const lines: string[] = [];
    if (hotpotStd) lines.push(`• 火鍋標準套餐 × ${guestLabel}（每位 $168，總計 HK$${Math.round(168 * adultEquiv).toLocaleString()}）`);
    if (hotpotSea) lines.push(`• 海鮮火鍋套餐 × ${guestLabel}（每位 $348，總計 HK$${Math.round(348 * adultEquiv).toLocaleString()}）`);
    if (extraSoup) lines.push(`• 加購額外湯底 ×1 (HK$108)`);
    sections.push(supplierSection('🍲', '火鍋', '須最少 3 日前向供應商落單', lines));
  }

  // ── Shisha ──
  const shisha = booking.addOns?.find((a) => a.id === 'shisha');
  if (shisha) {
    const opts = (shisha.options || {}) as AddOnOptions;
    const heads = shisha.quantity;
    const pipes = Math.min(2, Math.max(1, opts.pipes ?? Math.min(2, heads)));
    const staffSetup = !!opts.staffSetup;
    const cost = calcShishaPrice(pipes, heads, staffSetup);
    const flavorList = (opts.flavors || []).filter((f) => !!f);
    const flavorLines = flavorList.length > 0
      ? flavorList.map((f, i) => `  • Head ${i + 1}: ${SHISHA_FLAVOR_NAMES[f] || f}`).join('<br>')
      : '<i style="color:#991B1B;">⚠️ 客人未揀煙頭口味,須跟進</i>';
    const staffSetupLine = staffSetup
      ? (opts.staffSetupTime
          ? `是 (+$180) · <strong style="color:#B45309;">⏰ Setup 時間：${opts.staffSetupTime}</strong>（客人會喺場地內接收,請供應商當日聯絡客人 ${booking.whatsappPhone || ''}）`
          : `是 (+$180) · <strong style="color:#991B1B;">⚠️ 客人未揀 setup 時間,須跟進</strong>`)
      : '否';
    const lines = [
      `• ${pipes} 支水煙 × ${heads} 個煙頭（HK$${cost.toLocaleString()}）`,
      `• 人手 setup：${staffSetupLine}`,
      `• 口味：<br>${flavorLines}`,
    ];
    sections.push(supplierSection('💨', 'Shisha 水煙', '須最少 2 日前向供應商落單', lines));
  }

  // ── 免費佈置 (package booking) ──
  if (booking.decorationStyle) {
    const decor = getDecorationById(booking.decorationStyle);
    sections.push(supplierSection('🎀', '免費佈置', '通知佈置 supplier 揀色', [
      `• 顏色主題：${decor?.label.zh || booking.decorationStyle}`,
      decor?.description.zh ? `• ${decor.description.zh}` : '',
      booking.packageSlug ? `• 套餐：${booking.packageSlug}` : '',
    ].filter(Boolean)));
  }

  // ── 代燒員 ──
  const helper = booking.addOns?.find((a) => a.id === 'bbq-helper');
  if (helper) {
    const n = helper.quantity;
    const cost = 300 * n * booking.hours;
    sections.push(supplierSection('🧑‍🍳', '代燒員', '須最少 7 日前安排代燒員', [
      `• 人數：${n} 位`,
      `• 時段：${booking.startTime} – ${booking.endTime}（${booking.hours} 小時）`,
      `• 收費：${n} × ${booking.hours} 小時 × $300 = HK$${cost.toLocaleString()}`,
    ]));
  }

  // ── 美食到會 ──
  const catering = booking.addOns?.find((a) => a.id === 'catering');
  if (catering) {
    const opts = (catering.options || {}) as AddOnOptions;
    const tier = CATERING_TIERS.find((t) => t.id === opts.tierId);
    const zone = CATERING_DELIVERY_ZONES.find((z) => z.id === opts.deliveryZoneId);
    // dishCodes carries one entry PER PORTION — the same code repeats when
    // the customer orders multiple 盤 of a dish. GROUP with ×N for the
    // supplier sheet; a naive .includes() dedupe here once collapsed a
    // 20-portion order into a single line.
    const codes = opts.dishCodes || [];
    const qtyByCode = new Map<string, number>();
    for (const c of codes) qtyByCode.set(c, (qtyByCode.get(c) || 0) + 1);
    const grouped = Array.from(qtyByCode.entries())
      .map(([c, qty]) => ({ item: CATERING_ITEMS.find((d) => d.code === c), qty }))
      .filter((g): g is { item: (typeof CATERING_ITEMS)[number]; qty: number } => !!g.item);
    const nonAddon = grouped.filter((g) => g.item.category !== 'addon');
    const addonDishes = grouped.filter((g) => g.item.category === 'addon');
    const nonAddonPortions = nonAddon.reduce((s, g) => s + g.qty, 0);
    const dishLinesByCategory = nonAddon.length > 0
      ? `<ul style="margin: 4px 0 0; padding-left: 18px;">${nonAddon.map((g) => `<li>[${g.item.code}] ${g.item.name.zh}${g.qty > 1 ? ` <strong>× ${g.qty} 盤</strong>` : ''}</li>`).join('')}</ul>`
      : '<i style="color:#991B1B;">⚠️ 客人未揀菜式</i>';
    const addonLines = addonDishes.length > 0
      ? `<ul style="margin: 4px 0 0; padding-left: 18px;">${addonDishes.map((g) => `<li>[${g.item.code}] ${g.item.name.zh}${g.qty > 1 ? ` <strong>× ${g.qty} 盤</strong>` : ''} ${g.item.price ? `(+HK$${g.item.price}${g.qty > 1 ? `×${g.qty}` : ''})` : ''}</li>`).join('')}</ul>`
      : '';
    const deliveryTimeLine = opts.deliveryTime
      ? `<strong style="color:#B45309;">⏰ 送貨時間：${opts.deliveryTime}</strong>（客人會喺場地內接收,請供應商當日聯絡客人 ${booking.whatsappPhone || ''}）`
      : '<strong style="color:#991B1B;">⚠️ 客人未揀送貨時間,須跟進</strong>';
    const lines = [
      `• 套餐：${tier?.paxRange.min}-${tier?.paxRange.max} 人 / 任選 ${tier?.pickCount} 盤 / HK$${tier?.price.toLocaleString()}`,
      `• 已揀 ${nonAddonPortions} 盤主菜${nonAddonPortions > (tier?.pickCount ?? 0) ? `（額外 ${nonAddonPortions - (tier?.pickCount ?? 0)} 盤 × HK$155）` : ''}：${dishLinesByCategory}`,
      addonDishes.length > 0 ? `• 追加款式：${addonLines}` : '',
      `• 送貨區：${zone?.label.zh || '—'}${zone?.fee ? ` (+HK$${zone.fee})` : ''}${opts.doorstepDelivery ? ' / 上門交收 (+$150)' : ' / 樓下交收'}`,
      `• ${deliveryTimeLine}`,
      `• 餐具：${opts.noCutlery ? '走餐具 (−$10)' : '包餐具 + 1 食物夾'}${(opts.extraCutlerySets ?? 0) > 0 ? ` / 額外 ${opts.extraCutlerySets} set` : ''}${(opts.extraFoodTongs ?? 0) > 0 ? ` / 額外 ${opts.extraFoodTongs} 食物夾` : ''}`,
    ].filter(Boolean);
    sections.push(supplierSection('🍱', '美食到會', '須最少 2 日前向供應商落單', lines));
  }

  return {
    subject: `📦 SUPPLIER ORDER · ${venueName} ${booking.date} (${customerName})`,
    html: `
      <div style="font-family: ${EMAIL_FONT}; max-width: 720px; margin: 0 auto; background: ${EMAIL_BG}; padding: 32px 20px;">
        ${emailHeader('📦 SUPPLIER ORDER REQUIRED')}

        <div style="background: #FEF3C7; border-left: 4px solid #F59E0B; border-radius: 8px; padding: 14px 16px; margin-bottom: 16px;">
          <p style="margin: 0; font-size: 13px; color: #92400E; font-weight: 600;">
            ⚠️ 呢張預約有 supplier 訂購項目，請即時聯絡相應供應商落單。
          </p>
        </div>

        <div style="background: white; padding: 24px; border-radius: 16px; margin-bottom: 16px;">
          <p style="margin: 0 0 4px; font-size: 12px; color: #999;">Booking ID</p>
          <p style="margin: 0 0 14px; font-family: 'Courier New', monospace; font-size: 13px; color: ${EMAIL_INK};">${booking.id}</p>
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 6px 0; color: #999; font-size: 12px;">場地</td><td style="padding: 6px 0; text-align: right; font-weight: 600;">${venueName}</td></tr>
            <tr><td style="padding: 6px 0; color: #999; font-size: 12px;">日期</td><td style="padding: 6px 0; text-align: right; font-weight: 600;">${booking.date}${booking.endDate && booking.endDate !== booking.date ? ` → ${booking.endDate}` : ''}</td></tr>
            <tr><td style="padding: 6px 0; color: #999; font-size: 12px;">時段</td><td style="padding: 6px 0; text-align: right; font-weight: 600;">${booking.startTime} – ${booking.endTime}（${booking.hours} 小時）</td></tr>
            <tr><td style="padding: 6px 0; color: #999; font-size: 12px;">人數</td><td style="padding: 6px 0; text-align: right; font-weight: 600;">${guestLabel}</td></tr>
            <tr><td style="padding: 6px 0; color: #999; font-size: 12px;">客人</td><td style="padding: 6px 0; text-align: right; font-weight: 600;">${customerName}${booking.whatsappPhone ? ` · ${booking.whatsappPhone}` : ''}</td></tr>
            ${customerEmail ? `<tr><td style="padding: 6px 0; color: #999; font-size: 12px;">Email</td><td style="padding: 6px 0; text-align: right; font-weight: 600;">${customerEmail}</td></tr>` : ''}
          </table>
        </div>

        ${sections.join('')}

        <div style="text-align: center; margin: 16px 0;">
          <a href="${adminUrl}" style="display: inline-block; background: linear-gradient(135deg, ${EMAIL_PINK} 0%, ${EMAIL_PEACH} 100%); color: white; padding: 14px 32px; border-radius: 999px; text-decoration: none; font-weight: 700; font-size: 14px;">
            打開後台 · Open Admin
          </a>
        </div>

        ${emailFooter()}
      </div>
    `,
  };
}

function supplierSection(emoji: string, title: string, hint: string, lines: string[]): string {
  return `
    <div style="background: white; padding: 22px 24px; border-radius: 16px; margin-bottom: 14px; border-left: 4px solid ${EMAIL_PINK};">
      <h3 style="margin: 0 0 4px; font-size: 16px; color: ${EMAIL_INK};">${emoji} ${title}</h3>
      <p style="margin: 0 0 12px; font-size: 12px; color: #B45309; font-weight: 600;">${hint}</p>
      <div style="font-size: 13px; color: ${EMAIL_INK}; line-height: 1.7;">
        ${lines.map((l) => `<div>${l}</div>`).join('')}
      </div>
    </div>
  `;
}

/** Map of shisha flavor variant ids → human-readable Chinese names.
 *  Mirrors the variants array in lib/pricing.ts (the shisha entry).
 *  Updated 2026-06-22 — keep in sync if new flavors get added. */
const SHISHA_FLAVOR_NAMES: Record<string, string> = {
  A: 'A · 芒果菠蘿檸檬綠茶',
  B: 'B · 蜜桃伯爵茶',
  C: 'C · 提子茉莉青瓜',
  D: 'D · 士多啤梨窩夫',
  E: 'E · 蜜瓜牛奶',
  F: 'F · 茉莉雞蛋花青檸',
  G: 'G · 檀香伯爵蜜桃針葉',
  H: 'H · 檀香綠茶蘋果',
};

// ─────────────────────────────────────────────────────────────
// Booking cancelled — sent when admin cancels a booking.
// ─────────────────────────────────────────────────────────────

export function buildBookingCancelledEmail(params: {
  customerName: string;
  venueName: string;
  date: string;
  startTime: string;
  endTime: string;
  endDate?: string;
  bookingId: string;
  whatsappLink: string;
}) {
  return {
    subject: `🔴 SPACO 預約已取消 — ${params.venueName} (${params.date})`,
    html: `
      <div style="font-family: ${EMAIL_FONT}; max-width: 600px; margin: 0 auto; background: ${EMAIL_BG}; padding: 40px 20px;">
        ${emailHeader('預約已取消 · BOOKING CANCELLED')}
        <div style="background: white; padding: 32px; border-radius: 20px; margin-bottom: 16px;">
          <p style="margin: 0 0 14px; font-size: 16px; color: ${EMAIL_INK};">Hi ${params.customerName},</p>
          <p style="margin: 0 0 22px; color: #666; line-height: 1.7;">
            我哋已經處理咗你嘅取消申請。以下係你已取消嘅預訂資料以作記錄。
          </p>

          <div style="background: #FEE2E2; border-left: 4px solid #EF4444; border-radius: 14px; padding: 16px 20px; margin: 0 0 22px;">
            <p style="margin: 0; font-size: 13px; color: #991B1B; font-weight: 600;">
              ⚠️ 此預訂已取消 — 場地時段已釋放
            </p>
          </div>

          <h3 style="margin: 0 0 12px; font-size: 14px; color: ${EMAIL_INK}; letter-spacing: 0.04em; text-transform: uppercase;">📋 預訂資料</h3>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 22px;">
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; color: #999; font-size: 13px;">場地</td><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; text-align: right; font-weight: 600; text-decoration: line-through; color: #999;">${params.venueName}</td></tr>
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; color: #999; font-size: 13px;">日期</td><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; text-align: right; font-weight: 600; text-decoration: line-through; color: #999;">${params.date}</td></tr>
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; color: #999; font-size: 13px;">時段</td><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; text-align: right; font-weight: 600; text-decoration: line-through; color: #999;">${formatTimeRange(params.startTime, params.endTime, params.date, params.endDate)}</td></tr>
            <tr><td style="padding: 10px 0; color: #999; font-size: 13px;">預訂編號</td><td style="padding: 10px 0; text-align: right; font-family: 'Courier New', monospace; font-size: 12px; color: #999;">${params.bookingId}</td></tr>
          </table>

          <div style="background: #F8F8F8; border-radius: 14px; padding: 16px 20px; font-size: 13px; color: #444; line-height: 1.7;">
            <p style="margin: 0 0 6px; font-weight: 700; color: ${EMAIL_INK};">💸 關於退款</p>
            <p style="margin: 0;">如有退款查詢或想重新預約，請<strong>WhatsApp 我哋</strong>，我哋會盡快回覆。</p>
          </div>

          <div style="text-align: center; margin: 24px 0 4px;">
            <a href="${params.whatsappLink}" style="display: inline-block; background: #25D366; color: white; padding: 12px 28px; border-radius: 999px; text-decoration: none; font-weight: 600; font-size: 14px;">
              💬 WhatsApp 客服
            </a>
          </div>
        </div>
        ${emailFooter()}
      </div>
    `,
  };
}

// `sendStaffBookingNotification` lives in `emailAutomations.ts` (server-only).
// We keep `email.ts` free of any firebase-admin dependency so client bundles
// (e.g. /my-bookings) can safely import the pure template helpers and
// generateWhatsAppLink from here.

// ─────────────────────────────────────────────────────────────
// Staff "receipt pending" notification — fired the moment the customer
// uploads an FPS / bank-transfer receipt so admin / CS can review it.
// ─────────────────────────────────────────────────────────────

export function buildStaffReceiptPendingEmail(params: {
  bookingId: string;
  venueName: string;
  date: string;
  startTime: string;
  endTime: string;
  endDate?: string;
  guestCount: number;
  amountDue: number;
  customerName: string;
  customerEmail?: string;
  whatsappPhone?: string;
  receiptUrl: string;
  adminUrl: string;
}) {
  return {
    subject: `🧾 待核實付款 — ${params.venueName} ${params.date} (${params.customerName})`,
    html: `
      <div style="font-family: ${EMAIL_FONT}; max-width: 640px; margin: 0 auto; background: ${EMAIL_BG}; padding: 32px 20px;">
        ${emailHeader('待核實付款 · RECEIPT PENDING REVIEW')}
        <div style="background: white; padding: 28px; border-radius: 20px; margin-bottom: 16px;">
          <p style="margin: 0 0 18px; color: #444; line-height: 1.7;">
            客人 <strong>${params.customerName}</strong> 已上傳線下付款入數紙，請去後台核實。
          </p>

          <div style="background: #FFF7E6; border-left: 4px solid #F59E0B; border-radius: 12px; padding: 14px 18px; margin: 0 0 18px;">
            <p style="margin: 0; font-size: 13px; color: #92400E;">
              ⏰ 客人預期 30 分鐘內收到審批結果，請盡快處理。
            </p>
          </div>

          <h2 style="margin: 0 0 12px; font-size: 16px; color: ${EMAIL_INK};">📋 預訂詳情</h2>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 18px; font-size: 14px;">
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #999; font-size: 13px;">Booking ID</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right; font-family: 'Courier New', monospace; font-size: 12px;">${params.bookingId}</td></tr>
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #999; font-size: 13px;">場地</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right; font-weight: 600;">${params.venueName}</td></tr>
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #999; font-size: 13px;">日期</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right; font-weight: 600;">${params.date}</td></tr>
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #999; font-size: 13px;">時段</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right; font-weight: 600;">${formatTimeRange(params.startTime, params.endTime, params.date, params.endDate)}</td></tr>
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #999; font-size: 13px;">人數</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right; font-weight: 600;">${params.guestCount} 人</td></tr>
            <tr><td style="padding: 8px 0; color: #999; font-size: 13px;">應收金額</td><td style="padding: 8px 0; text-align: right; font-weight: 700; color: ${EMAIL_PINK};">HK$${params.amountDue.toLocaleString()}</td></tr>
          </table>

          <h2 style="margin: 0 0 12px; font-size: 16px; color: ${EMAIL_INK};">👤 客戶聯絡</h2>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 18px; font-size: 14px;">
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #999; font-size: 13px;">姓名</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right; font-weight: 600;">${params.customerName}</td></tr>
            ${params.whatsappPhone ? `<tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #999; font-size: 13px;">WhatsApp</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right; font-weight: 600;">${params.whatsappPhone}</td></tr>` : ''}
            ${params.customerEmail ? `<tr><td style="padding: 8px 0; color: #999; font-size: 13px;">Email</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${params.customerEmail}</td></tr>` : ''}
          </table>

          <div style="text-align: center; margin: 0 0 12px;">
            <a href="${params.receiptUrl}" style="display: inline-block; background: white; color: ${EMAIL_INK}; border: 1px solid ${EMAIL_INK}; padding: 10px 24px; border-radius: 999px; text-decoration: none; font-weight: 600; font-size: 13px; margin: 0 6px;">
              🧾 查看入數紙
            </a>
            <a href="${params.adminUrl}" style="display: inline-block; background: linear-gradient(135deg, ${EMAIL_PINK} 0%, ${EMAIL_PEACH} 100%); color: white; padding: 10px 24px; border-radius: 999px; text-decoration: none; font-weight: 700; font-size: 13px; margin: 0 6px;">
              打開後台核實 →
            </a>
          </div>
        </div>
        ${emailFooter()}
      </div>
    `,
  };
}

export function buildBalanceDueReminderEmail(params: {
  customerName: string;
  venueName: string;
  date: string;
  startTime: string;
  endTime: string;
  endDate?: string;
  balanceDue: number;
  whatsappLink: string;
}) {
  return {
    subject: `⏰ SPACO 尾數提醒 — 請盡快找清以收取門鎖密碼`,
    html: `
      <div style="font-family: ${EMAIL_FONT}; max-width: 600px; margin: 0 auto; background: ${EMAIL_BG}; padding: 40px 20px;">
        ${emailHeader('尾數提醒 · BALANCE REMINDER')}

        <div style="background: white; padding: 32px; border-radius: 20px; margin-bottom: 16px;">
          <p style="margin: 0 0 14px; font-size: 16px; color: ${EMAIL_INK};">Hi ${params.customerName},</p>
          <p style="margin: 0 0 22px; color: #666; line-height: 1.7;">
            你嘅活動將喺 <strong>${params.date} ${params.startTime}</strong> 開始。根據條款需要喺活動前 2 日找清尾數，<strong>系統先會自動發送門鎖密碼</strong>。
          </p>

          <!-- Balance hero -->
          <div style="background: linear-gradient(135deg, #FEE2E2 0%, #FFE4E6 100%); border-left: 4px solid #EF4444; border-radius: 16px; padding: 20px 22px; margin: 0 0 22px;">
            <p style="margin: 0 0 4px; font-size: 11px; color: #991B1B; letter-spacing: 0.12em; text-transform: uppercase; font-weight: 700;">尚欠尾數</p>
            <p style="margin: 0; font-size: 32px; font-weight: 800; color: #991B1B; font-family: 'Courier New', monospace;">
              HK$${params.balanceDue.toLocaleString()}
            </p>
          </div>

          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; color: #999; font-size: 13px;">場地</td><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; text-align: right; font-weight: 600;">${params.venueName}</td></tr>
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; color: #999; font-size: 13px;">活動日期</td><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; text-align: right; font-weight: 600;">${params.date}</td></tr>
            <tr><td style="padding: 10px 0; color: #999; font-size: 13px;">活動時段</td><td style="padding: 10px 0; text-align: right; font-weight: 600;">${formatTimeRange(params.startTime, params.endTime, params.date, params.endDate)}</td></tr>
          </table>
        </div>

        <div style="background: white; padding: 24px; border-radius: 20px; text-align: center; margin-bottom: 16px;">
          <p style="margin: 0 0 14px; font-size: 14px; color: #666; line-height: 1.7;">完成付款後，請 WhatsApp 通知我哋，<br>系統會即刻發送門鎖密碼畀你 ✅</p>
          <a href="${params.whatsappLink}" style="display: inline-block; background: #25D366; color: white; padding: 12px 28px; border-radius: 999px; text-decoration: none; font-weight: 600; font-size: 14px;">
            💬 WhatsApp 通知付款
          </a>
        </div>

        ${emailFooter()}
      </div>
    `,
  };
}
