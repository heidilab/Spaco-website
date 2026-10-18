/**
 * Customer-facing text for every error code the booking, confirm and
 * checkout APIs can return. Unknown codes fall back to a generic line, but
 * every code thrown by src/lib/bookingSecurity.ts, /api/bookings/create,
 * /api/bookings/[id]/confirm and /api/kpay/checkout should appear here so
 * the customer learns WHY (2026-10-15 review: the confirm page showed
 * 「儲存失敗」 for PAYMENT_ALREADY_STARTED and the payment page showed
 * 「處理失敗」 for every server validation rejection).
 */
const CONTACT = ['，如有疑問請 WhatsApp 我哋。', ' Contact us on WhatsApp if you need help.'] as const;

const MESSAGES: Record<string, [string, string]> = {
  // Rewards / price
  REWARDS_UNAVAILABLE: ['積分或優惠額度已改變，請返回確認頁重新核對，或聯絡我們。', 'Reward availability changed. Review your booking or contact us.'],
  PRICE_CHANGED: ['金額已更新，請重新整理此頁確認金額後付款。', 'The amount changed. Refresh and confirm the latest amount before paying.'],
  INVALID_PROMO: ['此優惠碼無效或已停用，請移除後再試。', 'This promo code is invalid or disabled. Remove it and try again.'],
  PROMO_LIMIT: ['此優惠碼已達使用上限，請移除後再試。', 'This promo code has reached its usage limit. Remove it and try again.'],
  PROMO_NOT_APPLICABLE: ['此優惠碼不適用於所選日期、分店或套餐，請移除後再試。', 'This promo code does not apply to the chosen date, branch or package. Remove it and try again.'],
  // Payment links
  PAYMENT_ALREADY_STARTED: ['你已經開始咗付款，暫時不能再更改優惠或積分。請直接前往付款頁繼續；如要更改，請聯絡我們。', 'Payment has already started, so promo and points cannot be changed now. Continue on the payment page, or contact us to change it.'],
  PAYMENT_STATUS_UNAVAILABLE: ['暫時未能確認上一筆付款狀態，請勿重複付款，請聯絡我們核對。', 'We cannot confirm the previous payment status. Please contact us before paying again.'],
  PAYMENT_PROCESSING: ['付款連結處理中。請稍後重試；如持續出現，請聯絡我們核對，勿重複付款。', 'The payment link is being processed. Retry later or contact us to check it; do not pay twice.'],
  INVALID_CHECKOUT: ['付款請求不完整，請重新整理頁面再試。', 'The payment request was incomplete. Refresh the page and try again.'],
  // Booking state
  BOOKING_EXPIRED: ['預訂暫留已過期，請重新選擇時段或聯絡我們。', 'The booking hold expired. Select a new slot or contact us.'],
  BOOKING_NOT_PAYABLE: ['此預訂目前不能付款，請查看訂單狀態或聯絡我們。', 'This booking cannot be paid now. Check its status or contact us.'],
  BOOKING_NOT_EDITABLE: ['此預訂已經付款或已過期，不能再修改優惠或積分。', 'This booking is already paid or expired, so promo and points cannot be changed.'],
  BOOKING_NOT_FOUND: ['找不到預訂記錄，請重新整理或聯絡我們。', 'Booking not found. Refresh or contact us.'],
  FORBIDDEN: ['請用預訂時嘅帳號登入後再試。', 'Sign in with the account used for this booking and try again.'],
  DEPOSIT_ALREADY_PAID: ['訂金已付款，請到我的預訂查看尾數。', 'The deposit is already paid. View your booking for the balance.'],
  DEPOSIT_REQUIRED: ['請先完成訂金付款，之後先可以繳付尾數。', 'Pay the deposit first; the balance can be paid afterwards.'],
  SETTLEMENT_DEBT_OUTSTANDING: ['你有已完場訂單仍有未補款項（按金不足以抵扣）。請先到「我的預訂」補回欠款，之後就可以預約新訂單。', 'A past booking still has an unpaid settlement balance (the deposit did not cover the charges). Please pay it in My Bookings first; you can then make new bookings.'],
  // Slot / venue
  SLOT_CONFLICT: ['非常抱歉，此時段剛被其他人預訂。請返回選擇另一時段。', 'Sorry, this slot was just booked by someone else. Please go back and choose another time.'],
  EARLY_SETUP_BEFORE_DAY: ['提早入場佈置時間唔可以早過當日 00:00，請縮短佈置時數。', 'Early setup cannot start before 00:00 on the event day. Reduce the setup hours.'],
  VENUE_OFFLINE: ['此場地暫時停止接受預訂，請選擇其他分店。', 'This venue is not taking bookings right now. Please choose another branch.'],
  SW_FULL_FLOOR_FIRST: ['此日期上環暫時只接受全層預訂，請選擇全層或另一日期。', 'On this date Sheung Wan only accepts full-floor bookings. Choose the full floor or another date.'],
  PEAK_MIN_GUESTS: ['所選日期有最低人數要求，請增加人數或選擇另一日期。', 'This date has a minimum headcount. Increase the guest count or choose another date.'],
  PEAK_MIN_HOURS: ['所選日期有最低時數要求，請延長時段或選擇另一日期。', 'This date has a minimum duration. Extend the session or choose another date.'],
  // Input validation
  DATE_IN_PAST: ['所選時間已經過去，請重新選擇日期時間。', 'The selected time has already passed. Choose a new date and time.'],
  INVALID_DATE_TIME: ['日期或時間格式不正確，請重新選擇。', 'The date or time is not valid. Please choose again.'],
  INVALID_DURATION: ['時段長度不正確（須為 15 分鐘倍數，最長 24 小時），請重新選擇時間。', 'The session length is not valid (15-minute steps, up to 24 hours). Choose the time again.'],
  INVALID_GUESTS: ['人數不正確，請輸入整數人數。', 'The guest count is not valid. Enter a whole number.'],
  INVALID_NUMBER: ['人數或數量超出此場地／套餐容許範圍，請調整後再試。', 'A guest count or quantity is outside the allowed range for this venue or package. Adjust it and try again.'],
  INVALID_ADDONS: ['加購項目資料不正確，請返回重新選擇加購。', 'The add-on selection is not valid. Go back and reselect add-ons.'],
  INVALID_ADDON: ['有加購項目不適用於此場地或套餐，請返回重新選擇。', 'An add-on is not available for this venue or package. Go back and reselect.'],
  INVALID_QUANTITY: ['加購數量超出上限，請減少數量。', 'An add-on quantity exceeds its limit. Reduce the quantity.'],
  INVALID_OPTIONS: ['加購選項資料不正確，請返回重新設定。', 'An add-on option is not valid. Go back and set it again.'],
  // Packages / CS links
  PACKAGE_UNAVAILABLE: ['此套餐不適用於所選日期、時段或提前日數，請重新選擇。', 'This package is not available for the chosen date, time or notice period. Choose again.'],
  INVALID_PACKAGE: ['套餐資料不正確，請重新由套餐頁開始。', 'The package is not valid. Start again from the package page.'],
  INVALID_DRAFT: ['預訂連結無效，請聯絡我們重新發送。', 'The booking link is not valid. Contact us for a new one.'],
  INVALID_DRAFT_PRICE: ['預訂連結嘅價格資料不完整，請聯絡我們重新發送。', 'The booking link is missing price details. Contact us for a new one.'],
  DRAFT_NOT_FOUND: ['找不到此預訂連結，請聯絡我們重新發送。', 'Booking link not found. Contact us for a new one.'],
  DRAFT_CLAIMED: ['此預訂連結已經使用過。', 'This booking link has already been used.'],
  DRAFT_EXPIRED_OR_CLAIMED: ['此預訂連結已過期或已使用，請聯絡我們重新發送。', 'This booking link has expired or been used. Contact us for a new one.'],
  // Generic server failures
  CREATE_FAILED: ['建立預訂時發生錯誤，請稍後再試。', 'Something went wrong creating the booking. Please try again shortly.'],
  CONFIRM_FAILED: ['儲存預訂資料時發生錯誤，請稍後再試。', 'Something went wrong saving the booking. Please try again shortly.'],
};

/** True when `code` is one we have specific wording for. */
export function isKnownPaymentError(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(MESSAGES, code);
}

export function paymentErrorMessage(code: string, locale: 'zh' | 'en'): string {
  const i = locale === 'zh' ? 0 : 1;
  const specific = MESSAGES[code];
  if (specific) return specific[i];
  return ['無法建立付款連結，請重新整理或聯絡我們。', 'Unable to create a payment link. Refresh or contact us.'][i] + (code && /^[A-Z_]+$/.test(code) ? `（${code}）` : '') + (code ? CONTACT[i] : '');
}
