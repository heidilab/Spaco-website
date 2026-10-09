export function paymentErrorMessage(code: string, locale: 'zh' | 'en'): string {
  const messages: Record<string, [string, string]> = {
    PRICE_CHANGED: ['金額已更新，請重新整理此頁確認金額後付款。', 'The amount changed. Refresh and confirm the latest amount before paying.'],
    PAYMENT_ALREADY_STARTED: ['已有付款連結。請選回原本付款方式繼續；如要更改，請聯絡我們。', 'A payment link already exists. Use the original payment method or contact us to change it.'],
    PAYMENT_PROCESSING: ['付款連結處理中。請稍後重試；如持續出現，請聯絡我們核對，勿重複付款。', 'The payment link is being processed. Retry later or contact us to check it; do not pay twice.'],
    BOOKING_EXPIRED: ['預訂暫留已過期，請重新選擇時段或聯絡我們。', 'The booking hold expired. Select a new slot or contact us.'],
    BOOKING_NOT_PAYABLE: ['此預訂目前不能付款，請查看訂單狀態或聯絡我們。', 'This booking cannot be paid now. Check its status or contact us.'],
    DEPOSIT_ALREADY_PAID: ['訂金已付款，請到我的預訂查看尾數。', 'The deposit is already paid. View your booking for the balance.'],
  };
  return (messages[code] || ['無法建立付款連結，請重新整理或聯絡我們。', 'Unable to create a payment link. Refresh or contact us.'])[locale === 'zh' ? 0 : 1];
}
