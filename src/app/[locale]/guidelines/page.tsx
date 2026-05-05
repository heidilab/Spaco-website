'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { motion } from 'framer-motion';
import { getSiteContent } from '@/lib/content';
import { SiteContentSection } from '@/types';
import {
  ClipboardList, CreditCard, ShieldCheck, CalendarX,
  Baby, CloudRain, Camera, Flame, Paintbrush, AlertTriangle,
  ChevronDown
} from 'lucide-react';

interface GuidelineSection {
  icon: typeof ClipboardList;
  titleKey: string;
  defaultTitle: { zh: string; en: string };
  defaultContent: { zh: string; en: string };
}

const sections: GuidelineSection[] = [
  {
    icon: ClipboardList,
    titleKey: 'booking_flow',
    defaultTitle: { zh: '預約流程', en: 'Booking Process' },
    defaultContent: {
      zh: `1. 於網站選擇想預約的日期、時段、人數及場地\n2. 系統會自動計算訂單總額及所需按金\n3. 完成付款後，我們會發送預約確認信息\n4. 活動前 1-2 天會提供場地一次性密碼\n\n本公司為全自助式場地，沒有職員駐場。場地已備有所有設施的使用指南。\n\n按金計算：\n• 基本按金：HK$1,000\n• 訂單總額 >$4,000：按金 HK$2,000\n• 訂單總額 >$10,000：按金 HK$4,000\n• 訂單總額 >$20,000：按金 HK$8,000\n\n訂單金額超過 $10,000 可選擇先付 50% 確認預訂，餘額於活動前 2 天付清。\n\n重要提示：預約付款確認後，所有查詢或更改只會與付款人溝通，恕不接受其他人士代為查詢。`,
      en: `1. Select your preferred date, time, guest count and venue on our website\n2. The system will automatically calculate the total and required deposit\n3. Upon payment completion, we will send a booking confirmation\n4. A one-time venue access code will be provided 1-2 days before the event\n\nSPACO is a fully self-service venue with no on-site staff. Usage guides for all facilities are provided on-site.\n\nDeposit calculation:\n• Base deposit: HK$1,000\n• Orders >$4,000: HK$2,000 deposit\n• Orders >$10,000: HK$4,000 deposit\n• Orders >$20,000: HK$8,000 deposit\n\nOrders exceeding $10,000 may opt to pay 50% upfront, with the balance due 2 days before the event.\n\nImportant: After booking confirmation, all enquiries and changes will only be handled with the person who made the payment.`,
    },
  },
  {
    icon: AlertTriangle,
    titleKey: 'booking_rules',
    defaultTitle: { zh: '預約須知', en: 'Booking Terms' },
    defaultContent: {
      zh: `• 場地不設口頭預留，預約以提交付款證明並確認收取款項為準\n• 請於訂單發出後 24 小時內支付款項，逾時將視為放棄預約\n• 如當日人數增加，可補付人頭收費，所有入場者不論逗留時間長短均一收費\n• 如當日人數或時數減少，仍需支付原訂人數及時數金額，不設退還\n• 客人請準時到達場地，任何情況下遲到均不設補時\n• 遲到超過 60 分鐘且未通知，預約將自動取消，所有款項不予退還\n• 不設代收貨及物資存放服務\n• 完場時必須帶走所有私人物品，遺留物品將於翌日清潔時棄掉`,
      en: `• Bookings are confirmed by payment only — no verbal reservations\n• Payment must be made within 24 hours of order, otherwise the booking is forfeited\n• Additional guests on the day can be added at per-head rate — all attendees are charged equally regardless of duration\n• Reductions in guest count or hours are non-refundable — book based on confirmed attendees\n• Please arrive on time — late arrivals will not receive time extensions\n• No-shows exceeding 60 minutes without notice will result in automatic cancellation with no refund\n• No package receiving or storage services available\n• All personal belongings must be removed upon departure — items left behind will be disposed of the following day`,
    },
  },
  {
    icon: CreditCard,
    titleKey: 'deposit',
    defaultTitle: { zh: '按金安排', en: 'Deposit Arrangement' },
    defaultContent: {
      zh: `• 按金不計算於場地租用收費內\n• 按金用以確保使用者愛惜場地物品及保持清潔\n• 所有垃圾請放進垃圾桶\n• 歡迎自攜飲品及食物\n• 如有使用場地餐具或爐具，請於完場前清洗乾淨\n\n按金扣除標準：\n• 沒有關閉焗爐：-$2,000\n• 沒有關閉冷氣：-$800\n• 沒有關閉電燈或其他電器：-$500\n• 沒有清洗已使用的餐具/爐具：-$500\n• 場地髒亂清潔費 / 嘔吐物：-$800\n• 於波波池飲食或嘔吐：-$1,500\n• 其他損毀按物品價值賠償\n\n如無以上情況，按金將於退場後 24 小時內以轉帳/FPS 全數退還。`,
      en: `• The deposit is separate from the venue rental fee\n• The deposit ensures guests take care of facilities and maintain cleanliness\n• Please dispose of all rubbish in the bins provided\n• You are welcome to bring your own food and drinks\n• Please wash all cookware and utensils before leaving\n\nDeposit deduction schedule:\n• Oven not turned off: -$2,000\n• AC not turned off: -$800\n• Lights or appliances not turned off: -$500\n• Cookware/utensils not cleaned: -$500\n• Venue mess / vomit cleanup: -$800\n• Food or vomit in ball pit: -$1,500\n• Other damage: charged at item value\n\nIf none of the above applies, the full deposit will be refunded within 24 hours via bank transfer/FPS.`,
    },
  },
  {
    icon: CalendarX,
    titleKey: 'cancellation',
    defaultTitle: { zh: '預約取消與更改', en: 'Cancellation & Changes' },
    defaultContent: {
      zh: `所有預約一經確認，本公司即為客人預留指定日期及時間，恕不接受任何形式的預約更改。\n\n如因特殊情況需要改期，須符合以下條件：\n• 須支付 HK$1,000 改期手續費\n• 新日期須為未來一個月內仍有檔期之日子\n• 由平日改至週末按週末價錢收費；由週末改至平日照付週末價錢\n• 所有改期安排以本公司最終確認為準\n\n如客人取消聚會或未能提前通知，所有已繳付款項將不予退還。\n\n敬請於預約前審慎確認日期、時間及相關安排。`,
      en: `All confirmed bookings are final — the venue is reserved exclusively for your date and time, and modifications are generally not accepted.\n\nIn exceptional circumstances, rescheduling may be considered subject to:\n• A HK$1,000 rescheduling fee\n• The new date must be within one month and subject to availability\n• Weekday-to-weekend changes are charged at weekend rates; weekend-to-weekday bookings retain weekend pricing\n• All rescheduling is subject to final confirmation by SPACO\n\nCancellations or no-shows will result in forfeiture of all payments made.\n\nPlease confirm your date, time and arrangements carefully before booking.`,
    },
  },
  {
    icon: Baby,
    titleKey: 'ballpit',
    defaultTitle: { zh: '波波池及兒童設施', en: 'Ball Pit & Kids Facilities' },
    defaultContent: {
      zh: `• 嚴禁於波波池內飲食\n• 嚴禁穿著任何鞋進入波波池範圍（小童可穿著一次性防滑襪）\n• 成人請勿攀爬兒童設施，以免意外或損毀\n• 來賓請自行看管同行小童，本公司不承擔因疏忽照顧而導致的損傷責任`,
      en: `• No food or drinks allowed in the ball pit\n• No shoes in the ball pit area (children may wear disposable non-slip socks)\n• Adults must not climb on children's equipment to prevent accidents and damage\n• Guests are responsible for supervising all accompanying children — SPACO assumes no liability for injuries due to inadequate supervision`,
    },
  },
  {
    icon: CloudRain,
    titleKey: 'weather',
    defaultTitle: { zh: '惡劣天氣安排', en: 'Adverse Weather Policy' },
    defaultContent: {
      zh: `黑雨警告或八號烈風信號期間：\n• 受影響時段內的預約可延期一次，可選擇原定日期起計 7 日內的日子\n• 訊號除下後 1 小時重開\n• 如客戶選擇如期進行，需自行承擔風險，其後不可取消或更改，款項不予退還\n• SPACO 保留改期安排的最終決定權`,
      en: `During Black Rainstorm Warning or Typhoon Signal No. 8:\n• Affected bookings may be rescheduled once, within 7 days of the original date\n• Venue reopens 1 hour after the signal is lowered\n• If guests choose to proceed as planned, they assume all risk — no subsequent cancellations or refunds\n• SPACO reserves the right to make final decisions on rescheduling`,
    },
  },
  {
    icon: Camera,
    titleKey: 'cctv',
    defaultTitle: { zh: '閉路電視及錄影', en: 'CCTV & Recording' },
    defaultContent: {
      zh: `場地設有閉路電視及錄影設備。禁止擅自截斷電源或遮蔽鏡頭。\n\n如任何人士違反場地規則、作出危險或違法行為，SPACO 保留權利拒絕其進入或要求其離開，且毋須退款或作出賠償。`,
      en: `The venue is equipped with CCTV and recording equipment. Tampering with power supply or obstructing cameras is strictly prohibited.\n\nSPACO reserves the right to refuse entry or require any person to leave if they violate venue rules or engage in dangerous or illegal behaviour, without refund or compensation.`,
    },
  },
  {
    icon: Flame,
    titleKey: 'bbq',
    defaultTitle: { zh: 'BBQ 燒烤', en: 'BBQ & Barbecue' },
    defaultContent: {
      zh: `• 天氣為不可抗力因素，客人需自行承擔活動當日天氣影響\n• 已付款預訂的燒烤套餐不可取消或退款\n• 如需聘請代燒員，可 WhatsApp 查詢`,
      en: `• Weather is a force majeure factor — guests assume responsibility for weather conditions on the event day\n• Paid BBQ packages are non-cancellable and non-refundable\n• Professional BBQ assistance available upon request via WhatsApp`,
    },
  },
  {
    icon: Paintbrush,
    titleKey: 'decoration',
    defaultTitle: { zh: '自行佈置', en: 'Decoration & Setup' },
    defaultContent: {
      zh: `• 歡迎自行佈置場地，但不能損毀設施及牆壁\n• 如需粘貼佈置於牆壁上，請先於牆壁上貼上皺紋膠紙\n• 客人需自行清理所有佈置，否則收取 $500 清潔費\n\n提早入場佈置收費：\n• 灣仔 / 中環：每小時 $500\n• 尖沙咀 / 觀塘：每小時 $800\n• 銅鑼灣：每小時 $1,000\n• 上環 Room A：每小時 $800\n• 上環 Room B：每小時 $1,200\n• 上環全場：每小時 $2,000`,
      en: `• You are welcome to decorate the venue, but please do not damage facilities or walls\n• If attaching decorations to walls, please apply masking tape first\n• All decorations must be removed before leaving — a $500 cleaning fee applies otherwise\n\nEarly setup access fees:\n• Wan Chai / Central: $500/hour\n• TST / Kwun Tong: $800/hour\n• Causeway Bay: $1,000/hour\n• Sheung Wan Room A: $800/hour\n• Sheung Wan Room B: $1,200/hour\n• Sheung Wan Full Floor: $2,000/hour`,
    },
  },
  {
    icon: ShieldCheck,
    titleKey: 'others',
    defaultTitle: { zh: '其他事項', en: 'Other Information' },
    defaultContent: {
      zh: `• 場內部份設備不適合幼兒使用，請家長或監護人留意\n• 場地恕不招待寵物\n• 室內場地嚴禁吸煙\n• 場內發生的任何意外或財物損失與本公司無關\n• SPACO 保留更改以上條款之權利\n• 如有任何爭議，SPACO 保留最終決定權`,
      en: `• Some facilities may not be suitable for young children — parents and guardians please take note\n• Pets are not permitted at our venues\n• Smoking is strictly prohibited indoors\n• SPACO assumes no liability for accidents or property loss occurring on premises\n• SPACO reserves the right to amend these terms at any time\n• In case of any dispute, SPACO reserves the right of final decision`,
    },
  },
];

// Cycle through gradient colors for visual energy
const gradientCycle = [
  'bg-gradient-pink',
  'bg-gradient-warm',
  'bg-gradient-cool',
  'bg-gradient-sunset',
];

function AccordionBlock({
  icon: Icon,
  title,
  content,
  isOpen,
  onClick,
  index,
}: {
  icon: typeof ClipboardList;
  title: string;
  content: string;
  isOpen: boolean;
  onClick: () => void;
  index: number;
}) {
  const gradient = gradientCycle[index % gradientCycle.length];
  return (
    <div className={`glass-card overflow-hidden transition-all ${isOpen ? 'shadow-glass-lg' : ''}`}>
      <button
        onClick={onClick}
        className="w-full flex items-center gap-4 p-5 md:p-6 text-left group"
      >
        <div className={`w-11 h-11 rounded-2xl ${gradient} flex items-center justify-center flex-shrink-0 text-white shadow-glow`}>
          <Icon size={20} />
        </div>
        <span className={`text-lg font-bold font-display flex-1 transition-colors ${isOpen ? 'text-pink' : 'text-ink group-hover:text-pink'}`}>
          {title}
        </span>
        <span
          className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-all ${
            isOpen
              ? 'bg-gradient-pink text-white shadow-glow'
              : 'bg-white/60 text-ink-soft group-hover:bg-white'
          }`}
        >
          <ChevronDown size={16} className={`transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {isOpen && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          className="px-5 md:px-6 pb-6"
        >
          <div className="pl-[60px] text-sm text-ink-soft leading-relaxed whitespace-pre-line">
            {content}
          </div>
        </motion.div>
      )}
    </div>
  );
}

export default function GuidelinesPage() {
  const locale = useLocale() as 'zh' | 'en';
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const [cmsContent, setCmsContent] = useState<SiteContentSection | null>(null);

  useEffect(() => {
    getSiteContent('guidelines').then((data) => {
      if (data) setCmsContent(data);
    });
  }, []);

  const getContent = (section: GuidelineSection, field: 'title' | 'content') => {
    if (cmsContent && cmsContent[`${section.titleKey}_${field}`]) {
      return cmsContent[`${section.titleKey}_${field}`][locale];
    }
    return field === 'title' ? section.defaultTitle[locale] : section.defaultContent[locale];
  };

  return (
    <div className="pt-28 min-h-screen relative overflow-hidden">
      {/* Decorative orbs */}
      <div className="orb orb-lavender animate-float-slow" style={{ width: 280, height: 280, top: '-60px', right: '-60px', opacity: 0.45 }} />
      <div className="orb orb-pink animate-float-medium" style={{ width: 200, height: 200, top: '50%', left: '-60px', opacity: 0.4 }} />
      <div className="orb orb-coral animate-float-fast" style={{ width: 130, height: 130, bottom: '20%', right: '20%', opacity: 0.4 }} />

      <section className="section-padding relative z-10">
        <div className="max-content mx-auto max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-12"
          >
            <span className="chip mb-4 mx-auto">
              <ShieldCheck size={12} className="text-lavender" />
              {locale === 'zh' ? '預訂條款' : 'Booking terms'}
            </span>
            <h1 className="text-heading font-display mb-3">
              <span className="text-ink">{locale === 'zh' ? '客人預訂' : 'Guest Booking'}</span>
              <span>{'\u00A0'}</span>
              <span className="text-gradient-pink">{locale === 'zh' ? '須知' : 'Guidelines'}</span>
            </h1>
            <p className="text-ink-soft">
              {locale === 'zh'
                ? '完成付款預訂後，即表示明白同意及會遵守以下規則。'
                : 'By completing your booking payment, you agree to the following terms and conditions.'}
            </p>
          </motion.div>

          <div className="space-y-3">
            {sections.map((section, i) => (
              <motion.div
                key={section.titleKey}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
              >
                <AccordionBlock
                  icon={section.icon}
                  title={getContent(section, 'title')}
                  content={getContent(section, 'content')}
                  isOpen={openIndex === i}
                  onClick={() => setOpenIndex(openIndex === i ? null : i)}
                  index={i}
                />
              </motion.div>
            ))}
          </div>

          {/* Disclaimer */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="mt-12 text-center text-xs text-ink-soft"
          >
            <p>
              {locale === 'zh'
                ? '© SPACO. 本公司保留更改以上條款之權利。如有任何爭議，SPACO 保留最終決定權。'
                : '© SPACO. We reserve the right to amend these terms. In case of any dispute, SPACO holds the right of final decision.'}
            </p>
          </motion.div>
        </div>
      </section>
    </div>
  );
}
