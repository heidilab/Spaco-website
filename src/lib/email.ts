// Email helper using Resend REST API directly (no heavy SDK)

interface EmailParams {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail({ to, subject, html }: EmailParams) {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'noreply@spaco.hk';

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
      subject,
      html,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Email send failed:', error);
    throw new Error(`Email failed: ${error}`);
  }

  return response.json();
}

export function buildBookingConfirmationEmail(params: {
  customerName: string;
  venueName: string;
  date: string;
  startTime: string;
  endTime: string;
  guestCount: number;
  subtotal: number;
  deposit: number;
  paymentMethod: string;
  whatsappLink: string;
}) {
  return {
    subject: `SPACO 預約確認 — ${params.venueName} (${params.date})`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #F5F5F0; padding: 40px 20px;">
        <div style="background: #1A1A1A; color: #F5F5F0; padding: 30px; border-radius: 16px; text-align: center; margin-bottom: 24px;">
          <h1 style="margin: 0; font-size: 28px; font-weight: 800;">SPACO</h1>
          <p style="margin: 8px 0 0; opacity: 0.7; font-size: 14px;">預約確認信 Booking Confirmation</p>
        </div>
        <div style="background: white; padding: 30px; border-radius: 16px; margin-bottom: 16px;">
          <p style="margin: 0 0 20px; font-size: 16px;">Hi ${params.customerName},</p>
          <p style="margin: 0 0 20px; color: #666;">你的預約已確認！以下是你的預訂詳情：</p>
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #eee; color: #999; font-size: 14px;">場地</td><td style="padding: 10px 0; border-bottom: 1px solid #eee; text-align: right; font-weight: 600;">${params.venueName}</td></tr>
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #eee; color: #999; font-size: 14px;">日期</td><td style="padding: 10px 0; border-bottom: 1px solid #eee; text-align: right; font-weight: 600;">${params.date}</td></tr>
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #eee; color: #999; font-size: 14px;">時間</td><td style="padding: 10px 0; border-bottom: 1px solid #eee; text-align: right; font-weight: 600;">${params.startTime} - ${params.endTime}</td></tr>
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #eee; color: #999; font-size: 14px;">人數</td><td style="padding: 10px 0; border-bottom: 1px solid #eee; text-align: right; font-weight: 600;">${params.guestCount} 人</td></tr>
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #eee; color: #999; font-size: 14px;">總額</td><td style="padding: 10px 0; border-bottom: 1px solid #eee; text-align: right; font-weight: 600;">HK$${params.subtotal.toLocaleString()}</td></tr>
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #eee; color: #999; font-size: 14px;">按金</td><td style="padding: 10px 0; border-bottom: 1px solid #eee; text-align: right; font-weight: 600;">HK$${params.deposit.toLocaleString()}</td></tr>
            <tr><td style="padding: 10px 0; color: #999; font-size: 14px;">付款方式</td><td style="padding: 10px 0; text-align: right; font-weight: 600;">${params.paymentMethod}</td></tr>
          </table>
        </div>
        <div style="background: #C8A97E; color: white; padding: 20px; border-radius: 16px; text-align: center; margin-bottom: 16px;">
          <p style="margin: 0 0 8px; font-size: 14px;">場地密碼將於活動前 1-2 天發送</p>
          <a href="${params.whatsappLink}" style="color: white; font-weight: 600;">WhatsApp 聯繫我們</a>
        </div>
        <p style="text-align: center; color: #999; font-size: 12px;">© SPACO. All rights reserved.</p>
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
    subject: `SPACO 付款提醒 — 請於 24 小時內完成付款`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #F5F5F0; padding: 40px 20px;">
        <div style="background: #1A1A1A; color: #F5F5F0; padding: 30px; border-radius: 16px; text-align: center; margin-bottom: 24px;">
          <h1 style="margin: 0; font-size: 28px; font-weight: 800;">SPACO</h1>
          <p style="margin: 8px 0 0; opacity: 0.7; font-size: 14px;">付款提醒 Payment Reminder</p>
        </div>
        <div style="background: white; padding: 30px; border-radius: 16px;">
          <p style="margin: 0 0 20px;">Hi ${params.customerName},</p>
          <p style="margin: 0 0 20px; color: #666;">請於以下截止時間前完成付款及上傳入數紙截圖：</p>
          <div style="background: #FEF3C7; padding: 16px; border-radius: 12px; text-align: center; margin-bottom: 20px;">
            <p style="margin: 0; font-size: 14px; color: #92400E;">截止時間: ${params.deadline}</p>
          </div>
          <p style="margin: 0 0 8px; font-size: 14px; color: #666;">FPS 轉數快：<strong>${params.fpsNumber}</strong></p>
          <p style="margin: 0 0 8px; font-size: 14px; color: #666;">銀行帳號：<strong>${params.bankAccount}</strong></p>
          <p style="margin: 0 0 8px; font-size: 14px; color: #666;">應付金額：<strong>HK$${params.subtotal.toLocaleString()}</strong></p>
          <p style="margin: 20px 0 0; font-size: 12px; color: #999;">逾時未付款將自動取消預約。</p>
        </div>
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
  date: string;
  startTime: string;
  endTime: string;
  passcode: string;
  validFromMs: number;
  validToMs: number;
  whatsappLink: string;
}) {
  return {
    subject: `🔑 SPACO 場地門鎖密碼 — ${params.venueName} (${params.date})`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #F5F5F0; padding: 40px 20px;">
        <div style="background: #1A1A1A; color: #F5F5F0; padding: 30px; border-radius: 16px; text-align: center; margin-bottom: 24px;">
          <h1 style="margin: 0; font-size: 28px; font-weight: 800;">SPACO</h1>
          <p style="margin: 8px 0 0; opacity: 0.7; font-size: 14px;">門鎖密碼 Door Access Code</p>
        </div>

        <div style="background: white; padding: 30px; border-radius: 16px; margin-bottom: 16px;">
          <p style="margin: 0 0 16px; font-size: 16px;">Hi ${params.customerName},</p>
          <p style="margin: 0 0 24px; color: #666;">你預訂嘅活動快將開始，以下係場地嘅入門密碼：</p>

          <div style="background: linear-gradient(135deg, #FF6B9D 0%, #FFB088 100%); color: white; padding: 24px; border-radius: 16px; text-align: center; margin-bottom: 24px;">
            <p style="margin: 0 0 8px; font-size: 12px; opacity: 0.9; letter-spacing: 0.1em; text-transform: uppercase;">門鎖密碼 Passcode</p>
            <p style="margin: 0; font-size: 36px; font-weight: 800; letter-spacing: 0.15em; font-family: 'Courier New', monospace;">
              ${params.passcode}
            </p>
          </div>

          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #eee; color: #999; font-size: 14px;">場地</td><td style="padding: 10px 0; border-bottom: 1px solid #eee; text-align: right; font-weight: 600;">${params.venueName}</td></tr>
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #eee; color: #999; font-size: 14px;">活動日期</td><td style="padding: 10px 0; border-bottom: 1px solid #eee; text-align: right; font-weight: 600;">${params.date}</td></tr>
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #eee; color: #999; font-size: 14px;">活動時段</td><td style="padding: 10px 0; border-bottom: 1px solid #eee; text-align: right; font-weight: 600;">${params.startTime} – ${params.endTime}</td></tr>
            <tr><td style="padding: 10px 0; color: #999; font-size: 14px;">密碼生效</td><td style="padding: 10px 0; text-align: right; font-weight: 600;">${formatHkt(params.validFromMs)}<br><span style="font-size: 12px; color: #999; font-weight: 400;">至 ${formatHkt(params.validToMs)}</span></td></tr>
          </table>
        </div>

        <div style="background: #FEF3C7; border-left: 4px solid #F59E0B; padding: 16px 20px; border-radius: 12px; margin-bottom: 16px;">
          <p style="margin: 0 0 8px; font-weight: 600; color: #92400E; font-size: 14px;">⚠️ 重要提醒</p>
          <ul style="margin: 0; padding-left: 18px; color: #92400E; font-size: 13px; line-height: 1.6;">
            <li>密碼於活動開始前 <strong>1 小時</strong> 開始生效，方便提早到場</li>
            <li>密碼會喺活動結束時間自動失效</li>
            <li>請勿將密碼公開或轉發畀非預約名單上嘅人</li>
            <li>離場時請確認所有電器已關閉、門已鎖好</li>
          </ul>
        </div>

        <div style="background: #1A1A1A; color: white; padding: 20px; border-radius: 16px; text-align: center; margin-bottom: 16px;">
          <p style="margin: 0 0 12px; font-size: 14px; opacity: 0.8;">有疑問？隨時聯絡我哋</p>
          <a href="${params.whatsappLink}" style="display: inline-block; background: #25D366; color: white; padding: 10px 24px; border-radius: 999px; text-decoration: none; font-weight: 600; font-size: 14px;">
            💬 WhatsApp 客服
          </a>
        </div>

        <p style="text-align: center; color: #999; font-size: 12px;">© SPACO. All rights reserved.</p>
      </div>
    `,
  };
}

// ─────────────────────────────────────────────────────────────
// Balance-due reminder — sent when a booking enters the 2-day window
// but the customer still owes the remaining balance.
// ─────────────────────────────────────────────────────────────

export function buildBalanceDueReminderEmail(params: {
  customerName: string;
  venueName: string;
  date: string;
  startTime: string;
  endTime: string;
  balanceDue: number;
  whatsappLink: string;
}) {
  return {
    subject: `⏰ SPACO 餘額提醒 — 請盡快找清尾數以收取門鎖密碼`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #F5F5F0; padding: 40px 20px;">
        <div style="background: #1A1A1A; color: #F5F5F0; padding: 30px; border-radius: 16px; text-align: center; margin-bottom: 24px;">
          <h1 style="margin: 0; font-size: 28px; font-weight: 800;">SPACO</h1>
          <p style="margin: 8px 0 0; opacity: 0.7; font-size: 14px;">尾數提醒 Balance Reminder</p>
        </div>

        <div style="background: white; padding: 30px; border-radius: 16px; margin-bottom: 16px;">
          <p style="margin: 0 0 16px; font-size: 16px;">Hi ${params.customerName},</p>
          <p style="margin: 0 0 20px; color: #666;">
            你嘅活動將喺 <strong>${params.date} ${params.startTime}</strong> 開始，<br>
            根據條款需要喺活動前 2 日找清尾數，<strong>系統先會自動發送門鎖密碼</strong>。
          </p>

          <div style="background: #FEE2E2; border-left: 4px solid #EF4444; padding: 16px 20px; border-radius: 12px; margin-bottom: 24px;">
            <p style="margin: 0 0 4px; font-size: 12px; color: #991B1B; letter-spacing: 0.1em; text-transform: uppercase;">尚欠尾數</p>
            <p style="margin: 0; font-size: 32px; font-weight: 800; color: #991B1B; font-family: 'Courier New', monospace;">
              HK$${params.balanceDue.toLocaleString()}
            </p>
          </div>

          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #eee; color: #999; font-size: 14px;">場地</td><td style="padding: 10px 0; border-bottom: 1px solid #eee; text-align: right; font-weight: 600;">${params.venueName}</td></tr>
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #eee; color: #999; font-size: 14px;">活動日期</td><td style="padding: 10px 0; border-bottom: 1px solid #eee; text-align: right; font-weight: 600;">${params.date}</td></tr>
            <tr><td style="padding: 10px 0; color: #999; font-size: 14px;">活動時段</td><td style="padding: 10px 0; text-align: right; font-weight: 600;">${params.startTime} – ${params.endTime}</td></tr>
          </table>
        </div>

        <div style="background: #1A1A1A; color: white; padding: 24px; border-radius: 16px; text-align: center; margin-bottom: 16px;">
          <p style="margin: 0 0 12px; font-size: 14px; opacity: 0.85;">完成付款後，請 WhatsApp 我哋確認，<br>系統會即刻發送門鎖密碼畀你 ✅</p>
          <a href="${params.whatsappLink}" style="display: inline-block; background: #25D366; color: white; padding: 12px 28px; border-radius: 999px; text-decoration: none; font-weight: 600; font-size: 14px; margin-top: 8px;">
            💬 WhatsApp 通知付款
          </a>
        </div>

        <p style="text-align: center; color: #999; font-size: 12px;">© SPACO. All rights reserved.</p>
      </div>
    `,
  };
}
