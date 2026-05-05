/**
 * Default Guidelines page content (bilingual). Shared by:
 *  - The public /guidelines page (fallback when CMS is empty)
 *  - The admin /content text editor (pre-filled values so admins see what's
 *    on the live site and can edit / override).
 *
 * Keys here MUST match the field keys defined in
 * src/app/[locale]/admin/content/page.tsx (textPages → guidelines.fields).
 */

export const GUIDELINES_DEFAULTS: Record<string, { zh: string; en: string }> = {
  booking_flow_title: {
    zh: '預約流程',
    en: 'Booking Process',
  },
  booking_flow_content: {
    zh: `1. 於網站選擇想預約的日期、時段、人數及場地
2. 系統會自動計算訂單總額及所需按金
3. 完成付款後，我們會發送預約確認信息
4. 活動前 1-2 天會提供場地一次性密碼

本公司為全自助式場地，沒有職員駐場。場地已備有所有設施的使用指南。

按金計算：
• 基本按金：HK$1,000
• 訂單總額 >$4,000：按金 HK$2,000
• 訂單總額 >$10,000：按金 HK$4,000
• 訂單總額 >$20,000：按金 HK$8,000

訂單金額超過 $10,000 可選擇先付 50% 確認預訂，餘額於活動前 2 天付清。

重要提示：預約付款確認後，所有查詢或更改只會與付款人溝通，恕不接受其他人士代為查詢。`,
    en: `1. Select your preferred date, time, guest count and venue on our website
2. The system will automatically calculate the total and required deposit
3. Upon payment completion, we will send a booking confirmation
4. A one-time venue access code will be provided 1-2 days before the event

SPACO is a fully self-service venue with no on-site staff. Usage guides for all facilities are provided on-site.

Deposit calculation:
• Base deposit: HK$1,000
• Orders >$4,000: HK$2,000 deposit
• Orders >$10,000: HK$4,000 deposit
• Orders >$20,000: HK$8,000 deposit

Orders exceeding $10,000 may opt to pay 50% upfront, with the balance due 2 days before the event.

Important: After booking confirmation, all enquiries and changes will only be handled with the person who made the payment.`,
  },
  booking_rules_title: { zh: '預約須知', en: 'Booking Terms' },
  booking_rules_content: {
    zh: `• 場地不設口頭預留，預約以提交付款證明並確認收取款項為準
• 請於訂單發出後 24 小時內支付款項，逾時將視為放棄預約
• 如當日人數增加，可補付人頭收費，所有入場者不論逗留時間長短均一收費
• 如當日人數或時數減少，仍需支付原訂人數及時數金額，不設退還
• 客人請準時到達場地，任何情況下遲到均不設補時
• 遲到超過 60 分鐘且未通知，預約將自動取消，所有款項不予退還
• 不設代收貨及物資存放服務
• 完場時必須帶走所有私人物品，遺留物品將於翌日清潔時棄掉`,
    en: `• Bookings are confirmed by payment only — no verbal reservations
• Payment must be made within 24 hours of order, otherwise the booking is forfeited
• Additional guests on the day can be added at per-head rate — all attendees are charged equally regardless of duration
• Reductions in guest count or hours are non-refundable — book based on confirmed attendees
• Please arrive on time — late arrivals will not receive time extensions
• No-shows exceeding 60 minutes without notice will result in automatic cancellation with no refund
• No package receiving or storage services available
• All personal belongings must be removed upon departure — items left behind will be disposed of the following day`,
  },
  deposit_title: { zh: '按金安排', en: 'Deposit Arrangement' },
  deposit_content: {
    zh: `• 按金不計算於場地租用收費內
• 按金用以確保使用者愛惜場地物品及保持清潔
• 所有垃圾請放進垃圾桶
• 歡迎自攜飲品及食物
• 如有使用場地餐具或爐具，請於完場前清洗乾淨

按金扣除標準：
• 沒有關閉焗爐：-$2,000
• 沒有關閉冷氣：-$800
• 沒有關閉電燈或其他電器：-$500
• 沒有清洗已使用的餐具/爐具：-$500
• 場地髒亂清潔費 / 嘔吐物：-$800
• 於波波池飲食或嘔吐：-$1,500
• 其他損毀按物品價值賠償

如無以上情況，按金將於退場後 24 小時內以轉帳/FPS 全數退還。`,
    en: `• The deposit is separate from the venue rental fee
• The deposit ensures guests take care of facilities and maintain cleanliness
• Please dispose of all rubbish in the bins provided
• You are welcome to bring your own food and drinks
• Please wash all cookware and utensils before leaving

Deposit deduction schedule:
• Oven not turned off: -$2,000
• AC not turned off: -$800
• Lights or appliances not turned off: -$500
• Cookware/utensils not cleaned: -$500
• Venue mess / vomit cleanup: -$800
• Food or vomit in ball pit: -$1,500
• Other damage: charged at item value

If none of the above applies, the full deposit will be refunded within 24 hours via bank transfer/FPS.`,
  },
  cancellation_title: { zh: '預約取消與更改', en: 'Cancellation & Changes' },
  cancellation_content: {
    zh: `所有預約一經確認，本公司即為客人預留指定日期及時間，恕不接受任何形式的預約更改。

如因特殊情況需要改期，須符合以下條件：
• 須支付 HK$1,000 改期手續費
• 新日期須為未來一個月內仍有檔期之日子
• 由平日改至週末按週末價錢收費；由週末改至平日照付週末價錢
• 所有改期安排以本公司最終確認為準

如客人取消聚會或未能提前通知，所有已繳付款項將不予退還。

敬請於預約前審慎確認日期、時間及相關安排。`,
    en: `All confirmed bookings are final — the venue is reserved exclusively for your date and time, and modifications are generally not accepted.

In exceptional circumstances, rescheduling may be considered subject to:
• A HK$1,000 rescheduling fee
• The new date must be within one month and subject to availability
• Weekday-to-weekend changes are charged at weekend rates; weekend-to-weekday bookings retain weekend pricing
• All rescheduling is subject to final confirmation by SPACO

Cancellations or no-shows will result in forfeiture of all payments made.

Please confirm your date, time and arrangements carefully before booking.`,
  },
  ballpit_title: { zh: '波波池及兒童設施', en: 'Ball Pit & Kids Facilities' },
  ballpit_content: {
    zh: `• 嚴禁於波波池內飲食
• 嚴禁穿著任何鞋進入波波池範圍（小童可穿著一次性防滑襪）
• 成人請勿攀爬兒童設施，以免意外或損毀
• 來賓請自行看管同行小童，本公司不承擔因疏忽照顧而導致的損傷責任`,
    en: `• No food or drinks allowed in the ball pit
• No shoes in the ball pit area (children may wear disposable non-slip socks)
• Adults must not climb on children's equipment to prevent accidents and damage
• Guests are responsible for supervising all accompanying children — SPACO assumes no liability for injuries due to inadequate supervision`,
  },
  weather_title: { zh: '惡劣天氣安排', en: 'Adverse Weather Policy' },
  weather_content: {
    zh: `黑雨警告或八號烈風信號期間：
• 受影響時段內的預約可延期一次，可選擇原定日期起計 7 日內的日子
• 訊號除下後 1 小時重開
• 如客戶選擇如期進行，需自行承擔風險，其後不可取消或更改，款項不予退還
• SPACO 保留改期安排的最終決定權`,
    en: `During Black Rainstorm Warning or Typhoon Signal No. 8:
• Affected bookings may be rescheduled once, within 7 days of the original date
• Venue reopens 1 hour after the signal is lowered
• If guests choose to proceed as planned, they assume all risk — no subsequent cancellations or refunds
• SPACO reserves the right to make final decisions on rescheduling`,
  },
  bbq_title: { zh: 'BBQ 燒烤', en: 'BBQ & Barbecue' },
  bbq_content: {
    zh: `• 天氣為不可抗力因素，客人需自行承擔活動當日天氣影響
• 已付款預訂的燒烤套餐不可取消或退款
• 如需聘請代燒員，可 WhatsApp 查詢`,
    en: `• Weather is a force majeure factor — guests assume responsibility for weather conditions on the event day
• Paid BBQ packages are non-cancellable and non-refundable
• Professional BBQ assistance available upon request via WhatsApp`,
  },
  decoration_title: { zh: '自行佈置', en: 'Decoration & Setup' },
  decoration_content: {
    zh: `• 歡迎自行佈置場地，但不能損毀設施及牆壁
• 如需粘貼佈置於牆壁上，請先於牆壁上貼上皺紋膠紙
• 客人需自行清理所有佈置，否則收取 $500 清潔費

提早入場佈置收費：
• 灣仔 / 中環：每小時 $500
• 尖沙咀 / 觀塘：每小時 $800
• 銅鑼灣：每小時 $1,000
• 上環 Room A：每小時 $800
• 上環 Room B：每小時 $1,200
• 上環全場：每小時 $2,000`,
    en: `• You are welcome to decorate the venue, but please do not damage facilities or walls
• If attaching decorations to walls, please apply masking tape first
• All decorations must be removed before leaving — a $500 cleaning fee applies otherwise

Early setup access fees:
• Wan Chai / Central: $500/hour
• TST / Kwun Tong: $800/hour
• Causeway Bay: $1,000/hour
• Sheung Wan Room A: $800/hour
• Sheung Wan Room B: $1,200/hour
• Sheung Wan Full Floor: $2,000/hour`,
  },
};
