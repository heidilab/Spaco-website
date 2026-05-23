/**
 * Preset line items, payment terms and standard notes for SPACO documents.
 * Bilingual descriptions so a single document covers ZH + EN customers.
 */
import { DocumentLineItem } from '@/types';

export interface PresetItem {
  /** stable key for the picker */
  key: string;
  /** Short label in the picker */
  label: { zh: string; en: string };
  /** Builds the actual line item; some items expose extra fields the user fills */
  build: () => DocumentLineItem;
  /** True if this item expects the user to fill in placeholders before sending */
  hasPlaceholders?: boolean;
}

export const PRESET_ITEMS: PresetItem[] = [
  {
    key: 'venue-rental',
    label: { zh: 'A · 場地租用 Venue Rental', en: 'A · Venue Rental Fee' },
    hasPlaceholders: true,
    build: () => ({
      description:
        'Venue Rental Fee 場地租用費\n' +
        'Place 場地: ____________\n' +
        'Date 日期: ____________\n' +
        'Time 時間: ____________\n' +
        'No. of People 人數: ____________',
      quantity: 1,
      unitPrice: 0,
      amount: 0,
    }),
  },
  {
    key: 'deposit',
    label: { zh: 'B · 場地按金 Deposit', en: 'B · Advance Deposit' },
    build: () => ({
      description: 'Refundable Venue Deposit 可退場地按金',
      quantity: 1,
      unitPrice: 0,
      amount: 0,
    }),
  },
  {
    key: 'bbq-package',
    label: { zh: 'C · BBQ 套餐', en: 'C · BBQ Package' },
    build: () => ({
      description: 'BBQ Package BBQ 套餐\n(specify menu / 註明餐單)',
      quantity: 1,
      unitPrice: 0,
      amount: 0,
    }),
  },
  {
    key: 'hotpot-package',
    label: { zh: 'D · 火鍋套餐 Hotpot', en: 'D · Hotpot Package' },
    build: () => ({
      description: 'Hotpot Package 火鍋套餐\n(specify menu / 註明餐單)',
      quantity: 1,
      unitPrice: 0,
      amount: 0,
    }),
  },
  {
    key: 'shisha-package',
    label: { zh: 'E · Shisha 套餐', en: 'E · Shisha Package' },
    build: () => ({
      description: 'Shisha Package 水煙套餐',
      quantity: 1,
      unitPrice: 0,
      amount: 0,
    }),
  },
  {
    key: 'food-catering',
    label: { zh: 'F · 餐飲到會 Catering', en: 'F · Food Catering Order' },
    build: () => ({
      description: 'Food Catering Order 餐飲到會\n(specify items / 註明項目)',
      quantity: 1,
      unitPrice: 0,
      amount: 0,
    }),
  },
  {
    key: 'bbq-stove',
    label: { zh: 'G · BBQ 爐租用', en: 'G · BBQ Stove Rental' },
    build: () => ({
      description: 'BBQ Stove Rental BBQ 爐租用',
      quantity: 1,
      unitPrice: 0,
      amount: 0,
    }),
  },
];

// ===== Standard payment method (always shown in notes) =====
export const PAYMENT_METHOD = `Payment Method 付款方式
Bank Name: Cholliman Incorporation Limited
Bank Account: 015-266-68001768 (BEA)
FPS: +852-9282 3060
OR Online Website Credit Card Payment 網上信用卡付款`;

// ===== Two payment terms options =====
export const PAYMENT_TERMS = {
  full: {
    key: 'full',
    label: { zh: '方案 A — 全數付款 (< $10,000)', en: 'Option A — Full payment (< $10,000)' },
    text: `Payment Terms 付款條款
If total amount is below HK$10,000, 100% payment is needed for booking confirmation.
若總金額 HK$10,000 以下，須全數付款方可確認預訂。`,
  },
  half: {
    key: 'half',
    label: { zh: '方案 B — 50% 訂金 (≥ $10,000)', en: 'Option B — 50% deposit (≥ $10,000)' },
    text: `Payment Terms 付款條款
If total amount is HK$10,000 or above, 50% payment is needed for booking confirmation, the balance should be paid 2 days prior to the booking date.
若總金額 HK$10,000 或以上，可先付 50% 確認預訂，餘額須於預訂日期前 2 日繳清。`,
  },
} as const;

export type PaymentTermKey = keyof typeof PAYMENT_TERMS;

// Compose default notes from selected payment terms
export function buildDefaultNotes(termKey: PaymentTermKey): string {
  return `${PAYMENT_METHOD}\n\n${PAYMENT_TERMS[termKey].text}`;
}

// ===== Receipt-only thank-you note =====
// Receipts are issued AFTER the customer has paid in full and the
// booking has been completed, so the payment terms / "請喺 X 日付清"
// language is irrelevant — replace the entire notes block with a
// short bilingual thank-you (Heidi's 2026-05-23 spec).
export const RECEIPT_THANK_YOU = `We've received your payment, thank you!
我哋已收到你嘅付款，多謝惠顧！`;

// ===== Standard terms & conditions =====
export const STANDARD_TERMS = `Kindly provide payment record and WhatsApp to us at +852 9282 3060 for booking confirmation.
請將付款紀錄 WhatsApp 至 +852 9282 3060 以確認預訂。

Kindly note that we don't make any reservation at this stage. We only confirm booking once we've received payment successfully, first come first served.
請注意此階段並未為閣下保留場地，款項收妥後方確認預訂，先到先得。

All products are provided by outside supplier.
所有產品由外部供應商提供。`;
