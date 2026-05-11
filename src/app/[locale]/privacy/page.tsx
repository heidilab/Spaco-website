'use client';

import { useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import { ArrowLeft, Lock } from 'lucide-react';

const LAST_UPDATED = '2026-05-11';

interface Section {
  number: string;
  title: { zh: string; en: string };
  body: { zh: string[]; en: string[] };
}

const SECTIONS: Section[] = [
  {
    number: '1',
    title: { zh: '引言', en: 'Introduction' },
    body: {
      zh: [
        'Cholliman Inc.（「SPACO」、「我哋」）尊重每位用戶嘅個人私隱。本政策說明我哋收集、使用及保護你個人資料嘅方式，並符合《香港個人資料（私隱）條例》（Cap. 486）。',
        '使用 spacohk.com 或我哋任何服務，即表示你已閱讀並同意本私隱政策。',
      ],
      en: [
        'Cholliman Inc. ("SPACO", "we") respects user privacy. This policy explains how we collect, use and protect your personal data, in line with the Hong Kong Personal Data (Privacy) Ordinance (Cap. 486).',
        'By using spacohk.com or any of our services, you accept this Privacy Policy.',
      ],
    },
  },
  {
    number: '2',
    title: { zh: '我哋收集嘅資料', en: 'Data We Collect' },
    body: {
      zh: [
        '當你註冊會員、預訂場地或聯絡我哋時，我哋會收集：',
        '• 個人識別資料：姓名、電郵地址、香港 WhatsApp 電話號碼。\n• 付款資料：信用卡 / 銀行轉帳 / FPS 嘅交易記錄。注意：完整信用卡號碼由 Stripe 直接處理，SPACO 唔會儲存。\n• 預訂資料：場地、日期時間、人數、附加服務、特別要求、活動性質。\n• 退款資料：退按金 FPS ID 或銀行戶口資料。\n• 推廣渠道：你首次預訂時填寫嘅「邊度知道我哋」答案。\n• 使用紀錄：瀏覽嘅頁面、Cookie、設備、IP 地址（用以分析網站使用情況）。',
      ],
      en: [
        'When you register, book, or contact us, we collect:',
        '• Identifiers: name, email, HK WhatsApp number.\n• Payment records: transaction logs for credit card / bank / FPS. Note: full card numbers are handled by Stripe; SPACO does not store them.\n• Booking details: venue, date, time, head count, add-ons, special requests, event nature.\n• Refund info: FPS ID or bank account for security-deposit refunds.\n• Marketing channel: how you first heard about us.\n• Usage logs: pages viewed, cookies, device, IP (for site analytics).',
      ],
    },
  },
  {
    number: '3',
    title: { zh: '使用目的', en: 'How We Use Your Data' },
    body: {
      zh: [
        '我哋會將你嘅個人資料用於：',
        '• 確認並完成你嘅預訂（包括發送門鎖密碼、預訂確認信、提醒）。\n• 處理付款及按金退款。\n• 客戶服務、查詢回覆、解決爭議。\n• 改善服務質素及網站體驗（網站分析）。\n• 推廣決策（統計各市場渠道嘅成效，以調整 marketing budget）。\n• 法律及合規要求（如稅務記錄）。',
        '我哋並不會將你嘅資料用於並非披露目的之用途，除非另有取得你同意。',
      ],
      en: [
        'We use your data to:',
        '• Confirm and complete bookings (door passcodes, confirmation emails, reminders).\n• Process payments and deposit refunds.\n• Customer support, enquiry responses, dispute resolution.\n• Improve service quality and site experience (analytics).\n• Marketing decisions (channel attribution, budget allocation).\n• Legal and tax compliance.',
        'We do not use your data for purposes outside those disclosed without obtaining your additional consent.',
      ],
    },
  },
  {
    number: '4',
    title: { zh: '直接促銷', en: 'Direct Marketing' },
    body: {
      zh: [
        '我哋會以電郵發送預訂相關信息（確認、提醒、付款）。呢類交易性電郵唔屬於直接促銷。',
        '若你係會員，我哋可能會以電郵向你發送以下促銷信息：',
        '• 場地新優惠、季節性折扣\n• 生日優惠碼\n• 活動後感謝信及積分通知',
        '你隨時可以透過電郵內嘅取消訂閱連結，或聯絡 spacohk@gmail.com 拒絕收取促銷信息。',
      ],
      en: [
        'We send transactional emails (confirmation, reminders, payment) that are not considered direct marketing.',
        'If you are a member, we may also send marketing emails:',
        '• New offers and seasonal promos\n• Birthday promo codes\n• Post-event thank-you + points notifications',
        'You may opt out anytime via the unsubscribe link in any email, or by contacting spacohk@gmail.com.',
      ],
    },
  },
  {
    number: '5',
    title: { zh: '第三方分享', en: 'Sharing with Third Parties' },
    body: {
      zh: [
        '我哋只會將你嘅個人資料披露予以下第三方，並僅限於提供服務所必需：',
        '• 付款處理商（Stripe）— 處理信用卡付款。\n• 電郵服務提供商（Resend）— 寄送預訂相關電郵。\n• 雲端基建（Google Firebase、Vercel）— 儲存資料及運行網站。\n• Google Calendar — 同步預訂行程予分店員工。\n• 食物及 Shisha 供應商 — 為你嘅預訂落單；僅分享必要資料如預訂日期、人數、配料喜好。\n• TTLock — 為你嘅預訂生成一次性門鎖密碼。\n• 香港稅務機關或執法部門 — 如法律要求。',
        '我哋唔會將你嘅個人資料賣給任何第三方作市場推廣用途。',
      ],
      en: [
        'We share your data only with the following third parties as needed:',
        '• Payment processor (Stripe) — credit-card processing.\n• Email service (Resend) — booking emails.\n• Cloud infrastructure (Google Firebase, Vercel) — data storage and site hosting.\n• Google Calendar — schedule sync for branch staff.\n• Food and shisha vendors — order placement; only date, head count and preferences shared.\n• TTLock — one-time door passcode generation.\n• HK tax / law enforcement authorities — as legally required.',
        'We do not sell your personal data to any third party for marketing.',
      ],
    },
  },
  {
    number: '6',
    title: { zh: '資料儲存期限', en: 'Data Retention' },
    body: {
      zh: [
        '預訂記錄及付款記錄：自最後一次活動起 7 年（用以稅務及審計用途）。',
        '會員帳戶資料：直至你要求刪除為止。如帳戶 24 個月沒有活動，我哋可能會以電郵通知後永久刪除。',
        '網站分析數據（Cookie 等）：最多 14 個月。',
        '退款資料（FPS / 銀行戶口）：退款完成後 1 年內刪除，除非需保留作審計。',
      ],
      en: [
        'Booking + payment records: 7 years from the last event (for tax / audit).',
        'Member account data: until you request deletion. Inactive accounts (>24 months) may be deleted after email notice.',
        'Site analytics (cookies): up to 14 months.',
        'Refund info (FPS / bank): deleted within 1 year of refund completion unless retention is needed for audit.',
      ],
    },
  },
  {
    number: '7',
    title: { zh: '安全措施', en: 'Security' },
    body: {
      zh: [
        '我哋採取合理嘅技術及行政措施保護你嘅個人資料，包括：',
        '• HTTPS / TLS 加密傳輸\n• Firebase Authentication 保護登入\n• 角色權限控制（admin / CS / cleaner / marketing 各有不同存取權限）\n• 付款資料完全交由 Stripe 處理（PCI-DSS 合規）\n• 定期備份\n• 員工須遵守保密守則',
        '但網絡傳輸本身不能 100% 保證安全；我哋不保證絕對防範黑客或其他安全事件。',
      ],
      en: [
        'We apply reasonable technical and administrative measures, including:',
        '• HTTPS / TLS encryption in transit\n• Firebase Authentication for sign-in\n• Role-based access control (admin / CS / cleaner / marketing)\n• Payment data handled fully by Stripe (PCI-DSS compliant)\n• Regular backups\n• Staff confidentiality policy',
        'However, no online transmission is 100% secure; we cannot guarantee absolute protection against hackers or other incidents.',
      ],
    },
  },
  {
    number: '8',
    title: { zh: '你嘅權利', en: 'Your Rights' },
    body: {
      zh: [
        '根據《個人資料（私隱）條例》，你有以下權利：',
        '• 查閱你嘅個人資料（可於「我的帳戶」自助查看）\n• 要求更正不準確嘅資料\n• 要求刪除帳戶及相關個人資料（受第 6 條保留期限約束）\n• 拒絕直接促銷\n• 投訴及查詢',
        '如要行使以上權利，請電郵 spacohk@gmail.com，我哋會於 40 個工作日內回覆。',
      ],
      en: [
        'Under the PDPO you have the right to:',
        '• Access your data (self-service via "My Account")\n• Correct inaccurate data\n• Request deletion of your account and associated data (subject to Section 6 retention)\n• Opt out of direct marketing\n• File a complaint or enquiry',
        'Email spacohk@gmail.com to exercise these rights; we respond within 40 working days.',
      ],
    },
  },
  {
    number: '9',
    title: { zh: 'Cookies', en: 'Cookies' },
    body: {
      zh: [
        '我哋使用 cookies 同類似技術用於：',
        '• 保持你嘅登入狀態（必要 cookies）\n• 記住你嘅語言喜好（必要 cookies）\n• 網站使用分析（Google Tag Manager / Google Analytics）— 統計訪客數量、瀏覽行為。所有資料均匿名處理。',
        '你可以喺瀏覽器設定中停用 cookies，但部分功能（例如登入、預訂）可能會失效。',
      ],
      en: [
        'We use cookies and similar technologies for:',
        '• Keeping you signed in (essential)\n• Remembering your language preference (essential)\n• Site analytics (Google Tag Manager / GA) — visitor counts and behaviour. All data is anonymised.',
        'You may disable cookies in your browser, but some features (sign-in, booking) may stop working.',
      ],
    },
  },
  {
    number: '10',
    title: { zh: '政策更新', en: 'Policy Updates' },
    body: {
      zh: [
        '我哋可能會不時更新本政策。重大改動會於網站發出通知或以電郵通知會員。「最後更新」日期會反映最新版本。建議你定期查閱。',
      ],
      en: [
        'We may update this policy from time to time. Material changes will be announced on the site or via email to members. The "Last updated" date reflects the latest version. Please review periodically.',
      ],
    },
  },
  {
    number: '11',
    title: { zh: '聯絡', en: 'Contact' },
    body: {
      zh: [
        '如對本私隱政策有疑問、行使你嘅權利或提出投訴：',
        '電郵：spacohk@gmail.com\n電話 / WhatsApp：+852 9282 3060\n資料保護主任：Cholliman Inc.',
      ],
      en: [
        'For questions, rights requests or complaints regarding this Privacy Policy:',
        'Email: spacohk@gmail.com\nPhone / WhatsApp: +852 9282 3060\nData Protection Officer: Cholliman Inc.',
      ],
    },
  },
];

export default function PrivacyPage() {
  const locale = useLocale() as 'zh' | 'en';
  return (
    <div className="pt-28 pb-20 relative overflow-hidden">
      <div className="orb orb-pink animate-float-slow" style={{ width: 280, height: 280, top: '-60px', right: '-60px', opacity: 0.3 }} />
      <div className="orb orb-lavender animate-float-medium" style={{ width: 200, height: 200, top: '40%', left: '-60px', opacity: 0.3 }} />

      <div className="max-content mx-auto px-6 md:px-12 lg:px-20 relative z-10">
        <div className="max-w-3xl mx-auto">
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-ink-soft hover:text-pink mb-6">
            <ArrowLeft size={14} /> {locale === 'zh' ? '返回首頁' : 'Back to home'}
          </Link>

          <div className="mb-10">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-pill bg-white/60 border border-charcoal/10 mb-4">
              <Lock size={14} className="text-pink" />
              <span className="text-xs font-medium text-ink-soft">{locale === 'zh' ? '私隱政策' : 'Privacy Policy'}</span>
            </div>
            <h1 className="text-heading">
              <span className="text-gradient-pink">{locale === 'zh' ? '私隱政策' : 'Privacy Policy'}</span>
            </h1>
            <p className="text-ink-soft text-sm mt-3">
              {locale === 'zh' ? `最後更新：${LAST_UPDATED}` : `Last updated: ${LAST_UPDATED}`}
            </p>
          </div>

          <div className="space-y-6">
            {SECTIONS.map((s) => (
              <section key={s.number} className="glass-card p-7">
                <h2 className="font-bold font-display text-lg text-ink mb-3 flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-gradient-warm text-white text-xs font-bold shrink-0">
                    {s.number}
                  </span>
                  {s.title[locale]}
                </h2>
                <div className="space-y-2.5 text-sm text-ink leading-relaxed pl-9">
                  {s.body[locale].map((p, i) => (
                    <p key={i} className="whitespace-pre-line">{p}</p>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
