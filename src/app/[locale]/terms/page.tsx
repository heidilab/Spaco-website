'use client';

import { useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import { ArrowLeft, FileText } from 'lucide-react';

const LAST_UPDATED = '2026-05-11';

interface Section {
  number: string;
  title: { zh: string; en: string };
  body: { zh: string[]; en: string[] };
}

const SECTIONS: Section[] = [
  {
    number: '1',
    title: { zh: '一般條款', en: 'General' },
    body: {
      zh: [
        '本條款及細則適用於所有經 spacohk.com 或其他官方渠道於 SPACO（由 Cholliman Inc. 營運）下單嘅預訂。',
        '客人完成付款即表示已閱讀、明白並同意本條款。如未能同意，請勿進行任何預訂。',
        'SPACO 保留隨時修訂本條款嘅權利，新版本以網站公佈為準。',
      ],
      en: [
        'These Terms & Conditions apply to all bookings made via spacohk.com or other official SPACO channels (operated by Cholliman Inc.).',
        'By completing payment, the customer confirms that they have read, understood and accepted these terms.',
        'SPACO reserves the right to revise these terms at any time; the latest version published on the website prevails.',
      ],
    },
  },
  {
    number: '2',
    title: { zh: '預訂', en: 'Bookings' },
    body: {
      zh: [
        '系統一切預訂均屬「先到先得」，以收到全數或預付款項時間為準。系統並不為閣下預留任何時段。',
        '每個場地有最低消費人數及最低租用時數，詳情顯示於各分店頁面。',
        'BBQ／火鍋／Shisha 等附加服務必須於活動最少 2 日前預訂，逾期將無法加購。',
        '小童（1–9 歲）以半位計算最低消費；最終以「成人計價人數」計算。',
        '預訂一經確認，系統將以電郵發送預訂確認信。如未收到請即聯絡 SPACO。',
      ],
      en: [
        'All bookings are first-come-first-served and confirmed only upon receipt of payment. Slots are NOT held by the system.',
        'Each venue has a minimum head count and minimum rental duration; see the branch pages for details.',
        'BBQ / hotpot / shisha add-ons must be ordered at least 2 days before the event; late orders cannot be accepted.',
        'Children aged 1–9 count as 0.5 of an adult-equivalent for minimum-charge calculation.',
        'A confirmation email is sent once the booking is confirmed. Please contact SPACO immediately if not received.',
      ],
    },
  },
  {
    number: '3',
    title: { zh: '付款', en: 'Payment' },
    body: {
      zh: [
        'HK$10,000 以下嘅預訂，須於預訂時繳付全數。',
        'HK$10,000 或以上嘅預訂，可選擇預付 50% 訂金確認預訂，餘額須於活動前 2 日繳清，否則系統不會自動發送門鎖密碼，並可能取消預訂。',
        '接受付款方式：Stripe（信用卡 / Apple Pay / Google Pay）、FPS 轉數快、銀行轉帳。',
        '客人付款時系統將自動發送付款指示電郵；如選擇離線付款（FPS／銀行），須於 30 分鐘內完成並上載入數紙截圖，否則預訂自動取消。',
      ],
      en: [
        'For bookings under HK$10,000, full payment is required at booking time.',
        'For bookings of HK$10,000 or more, a 50% deposit confirms the booking; the balance must be settled at least 2 days before the event. Failure to pay the balance suspends door-passcode delivery and may cancel the booking.',
        'Accepted methods: Stripe (credit card / Apple Pay / Google Pay), FPS, bank transfer.',
        'Customers choosing offline payment (FPS / bank) must complete payment and upload the receipt within 30 minutes; otherwise the booking auto-cancels.',
      ],
    },
  },
  {
    number: '4',
    title: { zh: '取消及退款', en: 'Cancellation & Refunds' },
    body: {
      zh: [
        '所有訂金及付款一經繳付，恕不退還，除非 SPACO 出現嚴重服務失誤。',
        '若客人因不可抗力（如極端天氣、政府指示）而無法使用場地，SPACO 將協助安排另一日子或保留信用至下次預訂。',
        '客人可於活動開始前 24 小時，自助於「我的預訂」修改預訂（加時／加人／加附加服務）。修改後須繳付差額。少於 24 小時請 WhatsApp 客服。',
      ],
      en: [
        'All payments are non-refundable unless SPACO has materially failed to deliver the service.',
        'In force majeure situations (e.g. extreme weather, government directives), SPACO will help reschedule or hold the credit for a future booking.',
        'Customers may self-modify a booking (add time / guests / add-ons) via "My Bookings" up to 24 hours before start. The price difference must be settled. WhatsApp customer service for changes within 24 hours.',
      ],
    },
  },
  {
    number: '5',
    title: { zh: '按金', en: 'Security Deposit' },
    body: {
      zh: [
        '所有預訂均收取可退還按金。金額根據場地租金總額分級：HK$4,000 以下 HK$1,000、HK$10,000 以下 HK$2,000、HK$10,000 以上 HK$4,000。',
        '按金於活動結束後 24 小時內，以客人預訂時提供之退款方式（FPS／銀行轉帳）退還。',
        '如場地檢查發現有以下情況，將於按金中扣減相應金額：',
        '• 沒有關閉焗爐：HK$2,000\n• 沒有關閉冷氣：HK$800\n• 沒有關閉電燈：HK$500\n• 沒有清洗爐具：HK$500\n• 嘔吐物／場地髒亂：HK$800\n• 波波池飲食違規：HK$1,500',
        '其他自訂扣費（如損壞家具、丟失物品等）按實際維修或重置成本計算。',
        '若損壞金額超過按金，客人須額外賠償差額。',
      ],
      en: [
        'A refundable security deposit is charged on every booking. Tiered: under HK$4,000 → HK$1,000; under HK$10,000 → HK$2,000; HK$10,000+ → HK$4,000.',
        'The deposit is refunded within 24 hours after the event via the refund method (FPS / bank) provided at booking time.',
        'The deposit may be reduced for the following infractions:',
        '• Oven left on: HK$2,000\n• AC left on: HK$800\n• Lights left on: HK$500\n• Cookware not cleaned: HK$500\n• Vomit / mess: HK$800\n• Food in ball-pit area: HK$1,500',
        'Custom deductions (furniture damage, lost items, etc.) charged at actual repair / replacement cost.',
        'If damages exceed the deposit, the customer is liable for the shortfall.',
      ],
    },
  },
  {
    number: '6',
    title: { zh: '場地使用守則', en: 'Venue Rules' },
    body: {
      zh: [
        '客人須於活動結束前自行清理場地、關閉所有電器及鎖好大門。離場時間以預訂時段為準。',
        '禁止帶寵物入場，導盲犬除外。',
        '禁止吸煙（包括電子煙）；違者扣除按金 HK$1,000 及賠償清潔費。',
        '請尊重鄰居，控制音量；如收到投訴，SPACO 可即時要求客人停止使用音響或結束活動。',
        '波波池嚴禁飲食。',
        '場地內所有設備（音響、Switch、桌遊、廚具等）為 SPACO 財產，請小心使用；損壞按實際成本賠償。',
      ],
      en: [
        'Customers must tidy the venue, turn off all appliances and lock the door before leaving. Exit time per the booked slot.',
        'Pets are not allowed (guide dogs excepted).',
        'No smoking (including e-cigarettes). Violation: HK$1,000 deduction plus cleaning costs.',
        'Please respect neighbours and control noise. If a complaint is received, SPACO may immediately require the customer to stop using the sound system or end the event.',
        'No food or drink in the ball-pit area.',
        'All equipment (sound system, Switch, board games, cookware) is SPACO property — handle with care. Damage charged at replacement cost.',
      ],
    },
  },
  {
    number: '7',
    title: { zh: '門鎖密碼及進場', en: 'Door Access' },
    body: {
      zh: [
        '系統會於活動前 1–2 日發送一次性門鎖密碼至客人預訂電郵。密碼於活動開始前 1 小時生效，至預訂結束時間自動失效。',
        '客人不得將密碼公開或轉發予非預約名單上嘅人。如發現違規，SPACO 可即時取消密碼並要求客人結束活動。',
        '若客人需要延長時間，請於活動前透過「我的預訂」自助修改或 WhatsApp 客服。',
      ],
      en: [
        'A one-time door passcode is sent to the customer\'s booking email 1–2 days before the event. The passcode activates 1 hour before start and auto-expires at the booked end time.',
        'Customers must not share or forward the passcode outside the booking party. Violations may result in immediate passcode revocation and event termination.',
        'To extend the booking, modify it via "My Bookings" or contact us on WhatsApp.',
      ],
    },
  },
  {
    number: '8',
    title: { zh: '附加服務及供應商', en: 'Add-ons & Vendors' },
    body: {
      zh: [
        'BBQ、火鍋、Shisha 等食品及飲品由 SPACO 合作之外部供應商提供，由 SPACO 代客落單。',
        '食物份量按預訂人數計算；如客人實際出席人數多於預訂，SPACO 不保證食物份量足夠。',
        '客人對食物過敏或特殊飲食需要，必須於預訂時告知；SPACO 將通知供應商，但不保證能完全滿足要求。',
        'Shisha 由外部供應商提供。每場最多 2 支水煙，客人可自行更換煙頭（自助式）。',
      ],
      en: [
        'BBQ, hotpot, shisha and beverages are supplied by external vendors and ordered on the customer\'s behalf by SPACO.',
        'Food portions are based on the number of guests booked. If actual attendance exceeds the booking, SPACO cannot guarantee sufficient portions.',
        'Customers must declare allergies / dietary requirements at booking time. SPACO will inform the vendor but cannot guarantee full accommodation.',
        'Shisha is supplied by an external vendor. Max 2 pipes per session; customers may swap heads themselves (self-serve).',
      ],
    },
  },
  {
    number: '9',
    title: { zh: '會員積分及優惠碼', en: 'Loyalty Points & Promo Codes' },
    body: {
      zh: [
        '每次完成嘅預訂可累積會員積分。賺取率：HK$1 消費 = 1 分。「消費」指場租及附加服務嘅實際付款（不包按金），若按金有任何扣減，扣減金額亦計入消費。',
        '抵扣率：100 分 = HK$1。可於結帳時自選抵扣金額。',
        '積分不可兌換現金，不可轉讓。會員帳戶取消時所有積分將被取消。',
        '優惠碼有時限及次數限制，每張碼之條款以「我的預訂」或客服公佈為準。優惠碼不可與其他優惠同時使用（除積分外）。',
      ],
      en: [
        'Loyalty points are earned per completed booking. Earn rate: HK$1 spent = 1 point. "Spend" means actual payment for rental + add-ons (excluding security deposit); any deducted portion of the security deposit also counts as spend.',
        'Redemption rate: 100 points = HK$1. Apply at checkout.',
        'Points have no cash value and are non-transferable. All points are forfeited upon account closure.',
        'Promo codes have time / usage limits as published. Codes cannot be combined with other offers (loyalty points excepted).',
      ],
    },
  },
  {
    number: '10',
    title: { zh: '責任限制', en: 'Liability' },
    body: {
      zh: [
        'SPACO 對客人於場地內因意外、疏忽或第三方行為而造成嘅人身傷害或財物損失，概不負責。',
        '客人於活動期間隨身物品自行保管。如遺失，SPACO 不負責。',
        'SPACO 對因不可抗力（如停電、政府指示）導致嘅服務中斷不承擔責任，但會合理協助安排退款或重新安排。',
      ],
      en: [
        'SPACO is not liable for personal injury or property loss on the premises due to accident, negligence or third-party acts.',
        'Customers are responsible for their personal belongings during the event. SPACO is not liable for loss.',
        'SPACO is not liable for service interruptions due to force majeure (e.g. power outage, government directives) but will reasonably assist with refund / rescheduling.',
      ],
    },
  },
  {
    number: '11',
    title: { zh: '法律管轄', en: 'Governing Law' },
    body: {
      zh: [
        '本條款受香港特別行政區法律管轄，並按該法律詮釋。任何爭議由香港法院專屬管轄。',
      ],
      en: [
        'These terms are governed by the laws of the Hong Kong Special Administrative Region. Any dispute is subject to the exclusive jurisdiction of the Hong Kong courts.',
      ],
    },
  },
];

export default function TermsPage() {
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
              <FileText size={14} className="text-pink" />
              <span className="text-xs font-medium text-ink-soft">{locale === 'zh' ? '條款及細則' : 'Terms & Conditions'}</span>
            </div>
            <h1 className="text-heading">
              <span className="text-gradient-pink">{locale === 'zh' ? '條款及細則' : 'Terms & Conditions'}</span>
            </h1>
            <p className="text-ink-soft text-sm mt-3">
              {locale === 'zh' ? `最後更新：${LAST_UPDATED}` : `Last updated: ${LAST_UPDATED}`}
            </p>
          </div>

          <div className="space-y-6">
            {SECTIONS.map((s) => (
              <section key={s.number} className="glass-card p-7">
                <h2 className="font-bold font-display text-lg text-ink mb-3 flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-gradient-pink text-white text-xs font-bold shrink-0">
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

          <div className="mt-10 p-6 rounded-3xl bg-charcoal text-cream/90 text-sm">
            <p className="font-semibold mb-2">{locale === 'zh' ? '聯絡資料' : 'Contact'}</p>
            <p className="opacity-80">
              {locale === 'zh' ? '如對本條款有任何疑問，請聯絡：' : 'For any questions about these terms, please contact:'}
            </p>
            <p className="mt-2">📧 spacohk@gmail.com</p>
            <p>📱 +852 9282 3060 (WhatsApp)</p>
          </div>
        </div>
      </div>
    </div>
  );
}
