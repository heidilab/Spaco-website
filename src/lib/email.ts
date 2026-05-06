// Email helper using Resend REST API directly (no heavy SDK)

interface EmailParams {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail({ to, subject, html }: EmailParams) {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'noreply@spacohk.com';

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
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #999;">時段</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right; font-weight: 600;">${params.startTime} – ${params.endTime}</td></tr>
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
