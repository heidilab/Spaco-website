/**
 * Default Q&A lists for the public FAQ page.
 * Used as the fallback when no Firestore CMS overrides exist, and as the
 * starting point for the admin FAQ editor.
 */

export interface FaqEntry {
  /** Stable id so re-ordering / editing one entry doesn't shuffle keys */
  id: string;
  zh: { q: string; a: string };
  en: { q: string; a: string };
}

export interface FaqContent {
  guestRules: FaqEntry[];
  faqItems: FaqEntry[];
}

export const DEFAULT_FAQ: FaqContent = {
  guestRules: [
    {
      id: 'gr-venue-usage',
      zh: {
        q: '場地使用規則',
        a: '請保持場地整潔，活動結束前請關閉所有電器設備（冷氣、焗爐、電燈）。如有違反將從按金中扣除相關費用。',
      },
      en: {
        q: 'Venue Usage Rules',
        a: 'Please keep the venue clean and turn off all appliances (AC, oven, lights) before leaving. Failure to comply will result in deposit deductions.',
      },
    },
    {
      id: 'gr-food-drinks',
      zh: {
        q: '食物及飲品規則',
        a: '歡迎自攜食物（需租用 BBQ 爐）或選購我們的 BBQ 套餐。波波池範圍嚴禁飲食，違者將扣款 $1,500。',
      },
      en: {
        q: 'Food & Drinks Rules',
        a: 'You may bring your own food (BBQ grill rental required) or order our BBQ packages. Strictly no food or drinks in the ball pit area — violations incur a $1,500 deduction.',
      },
    },
    {
      id: 'gr-door-code',
      zh: {
        q: '大門密碼',
        a: '場地大門一次性密碼將於活動前 24-48 小時透過短訊發送。請勿將密碼轉發給非出席者。',
      },
      en: {
        q: 'Door Access Code',
        a: 'A one-time door code will be sent via SMS 24-48 hours before your event. Please do not share with non-attendees.',
      },
    },
    {
      id: 'gr-cancellation',
      zh: {
        q: '取消及更改政策',
        a: '活動 7 天前可免費取消或更改；3-7 天前取消將扣除 50% 按金；3 天內取消恕不退款。',
      },
      en: {
        q: 'Cancellation & Changes',
        a: 'Free cancellation or changes 7+ days before; 50% deposit deducted for cancellations 3-7 days prior; no refund within 3 days.',
      },
    },
  ],
  faqItems: [
    {
      id: 'faq-how-to-book',
      zh: {
        q: '如何預訂場地？',
        a: '透過本網站選擇分店及時段，完成付款後即可確認預訂。我們支援 FPS、銀行轉帳及線上付款。',
      },
      en: {
        q: 'How do I book a venue?',
        a: 'Select your branch and time slot on our website, complete payment to confirm. We accept FPS, bank transfer and online payment.',
      },
    },
    {
      id: 'faq-deposit-refund',
      zh: {
        q: '按金如何退還？',
        a: '活動結束後，管理員將進行場地檢查。如無損壞或違規，按金將於 7 個工作天內全數退還。',
      },
      en: {
        q: 'How is the deposit refunded?',
        a: 'After the event, our staff inspect the venue. With no damage or violations, the full deposit is refunded within 7 working days.',
      },
    },
    {
      id: 'faq-pets',
      zh: {
        q: '可以帶寵物嗎？',
        a: '抱歉，為確保所有客人的衛生及安全，我們的場地暫不接受寵物進入。',
      },
      en: {
        q: 'Can I bring pets?',
        a: 'Sorry — to maintain hygiene and safety, pets are not allowed at our venues.',
      },
    },
    {
      id: 'faq-parking',
      zh: {
        q: '有停車位嗎？',
        a: '各分店附近均有公眾停車場，請參考各分店頁面的地址資訊。',
      },
      en: {
        q: 'Is parking available?',
        a: 'Public parking is available near every branch — see the branch page for addresses.',
      },
    },
    {
      id: 'faq-extend-time',
      zh: {
        q: '可以延長使用時間嗎？',
        a: '如下一時段無其他預訂，可於現場申請延長。加時費用為原定每位每小時費率，於按金中扣除。',
      },
      en: {
        q: 'Can I extend the booking time?',
        a: 'If no following booking exists, you may request an extension on-site. The hourly per-head rate applies, deducted from your deposit.',
      },
    },
    {
      id: 'faq-loyalty-points',
      zh: {
        q: '積分制度如何運作？',
        a: '會員消費 $1 = 1 分（不計按金），每 100 分可抵 $1 現金。積分於活動結束並完成按金退還後入帳。',
      },
      en: {
        q: 'How does the loyalty program work?',
        a: 'Members earn 1 point per HK$1 spent (excl. deposit). 100 points = HK$1 redeemable. Points credited after deposit refund.',
      },
    },
  ],
};
