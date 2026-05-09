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
  /** Optional adult/child split. When childCount > 0, the breakdown
   *  appears in the people row. */
  adultCount?: number;
  childCount?: number;
  subtotal: number;
  deposit: number;
  /** Outstanding balance for high-value bookings paying 50% upfront.
   *  When > 0, a yellow notice with due date appears. */
  balanceDue?: number;
  balanceDueDate?: string;
  /** Pre-formatted add-ons line (e.g. "BBQ Standard Package ×4, ..."). */
  addOnsLine?: string;
  paymentMethod: string;
  whatsappLink: string;
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
  return {
    subject: `🎉 SPACO 預約已確認 — ${params.venueName} (${params.date})`,
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
              ${params.date} · ${params.startTime}–${params.endTime}
            </p>
            <p style="margin: 0; font-size: 13px; opacity: 0.92;">${peopleLine}</p>
          </div>

          ${balanceNotice}

          <h3 style="margin: 0 0 12px; font-size: 14px; color: ${EMAIL_INK}; letter-spacing: 0.04em; text-transform: uppercase;">📋 預訂明細</h3>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 8px;">
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; color: #999; font-size: 13px;">場地</td><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; text-align: right; font-weight: 600;">${params.venueName}</td></tr>
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; color: #999; font-size: 13px;">日期</td><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; text-align: right; font-weight: 600;">${params.date}</td></tr>
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; color: #999; font-size: 13px;">時段</td><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; text-align: right; font-weight: 600;">${params.startTime} – ${params.endTime}</td></tr>
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; color: #999; font-size: 13px;">人數</td><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; text-align: right; font-weight: 600;">${peopleLine}</td></tr>
            ${addOnsRow}
          </table>

          <h3 style="margin: 22px 0 12px; font-size: 14px; color: ${EMAIL_INK}; letter-spacing: 0.04em; text-transform: uppercase;">💰 金額</h3>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; color: #999; font-size: 13px;">小計</td><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; text-align: right; font-weight: 600;">HK$${params.subtotal.toLocaleString()}</td></tr>
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; color: #999; font-size: 13px;">已收</td><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; text-align: right; font-weight: 600;">HK$${params.deposit.toLocaleString()}</td></tr>
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
              ${params.passcode}
            </p>
          </div>

          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; color: #999; font-size: 13px;">場地</td><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; text-align: right; font-weight: 600;">${params.venueName}</td></tr>
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; color: #999; font-size: 13px;">活動日期</td><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; text-align: right; font-weight: 600;">${params.date}</td></tr>
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; color: #999; font-size: 13px;">活動時段</td><td style="padding: 10px 0; border-bottom: 1px solid #F0E8E1; text-align: right; font-weight: 600;">${params.startTime} – ${params.endTime}</td></tr>
            <tr><td style="padding: 10px 0; color: #999; font-size: 13px; vertical-align: top;">密碼有效期</td><td style="padding: 10px 0; text-align: right; font-weight: 600;">${formatHkt(params.validFromMs)}<br><span style="font-size: 12px; color: #999; font-weight: 400;">至 ${formatHkt(params.validToMs)}</span></td></tr>
          </table>
        </div>

        <div style="background: #FFF7E6; border-left: 4px solid #F59E0B; border-radius: 14px; padding: 16px 20px; margin-bottom: 16px;">
          <p style="margin: 0 0 8px; font-weight: 700; color: #92400E; font-size: 14px;">⚠️ 重要提醒</p>
          <ul style="margin: 0; padding-left: 18px; color: #78350F; font-size: 13px; line-height: 1.7;">
            <li>密碼於活動開始前 <strong>1 小時</strong> 開始生效，方便你提早到場準備</li>
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
  guestCount: number;
  adultCount?: number;
  childCount?: number;
  customerName: string;
  customerEmail?: string;
  whatsappPhone?: string;
  subtotal: number;
  deposit: number;
  balanceDue: number;
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
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #999; font-size: 13px;">時段</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right; font-weight: 600;">${params.startTime} – ${params.endTime}</td></tr>
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #999; font-size: 13px;">人數</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right; font-weight: 600;">${params.guestCount} 人${(params.childCount ?? 0) > 0 ? ` (${params.adultCount ?? params.guestCount} 成人 + ${params.childCount} 小童)` : ''}</td></tr>
            ${addOnsRow}
            ${byoRow}
          </table>

          <h2 style="margin: 0 0 16px; font-size: 18px; color: ${EMAIL_INK};">💰 金額</h2>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #999; font-size: 13px;">小計</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right; font-weight: 600;">HK$${params.subtotal.toLocaleString()}</td></tr>
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #999; font-size: 13px;">已收按金</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right; font-weight: 600;">HK$${params.deposit.toLocaleString()}</td></tr>
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

/** Send the staff notification to all configured recipients. Reads
 *  STAFF_NOTIFICATION_EMAILS (comma-separated) and falls back to
 *  spacohk@gmail.com if unset. Honours the email-automation toggle
 *  so admins can pause it from /admin/email-automation. Errors are
 *  caught per-recipient so one bad address can't break the others. */
export async function sendStaffBookingNotification(
  params: Parameters<typeof buildStaffBookingNotificationEmail>[0],
): Promise<void> {
  // Lazy-import to avoid a circular module load during sendEmail itself.
  const { isEmailAutomationEnabled } = await import('./emailAutomations');
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
            <tr><td style="padding: 10px 0; color: #999; font-size: 13px;">活動時段</td><td style="padding: 10px 0; text-align: right; font-weight: 600;">${params.startTime} – ${params.endTime}</td></tr>
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
