import { describe, expect, it } from 'vitest';
import { isKnownPaymentError, paymentErrorMessage } from './paymentErrors';

// Every code the customer-facing APIs can return. If a new BookingInputError
// code is added server-side, add it here and in paymentErrors.ts so the
// customer never sees the generic fallback for a known situation.
const SERVER_CODES = [
  'REWARDS_UNAVAILABLE', 'PRICE_CHANGED', 'INVALID_PROMO', 'PROMO_LIMIT', 'PROMO_NOT_APPLICABLE',
  'PAYMENT_ALREADY_STARTED', 'PAYMENT_STATUS_UNAVAILABLE', 'PAYMENT_PROCESSING', 'INVALID_CHECKOUT',
  'BOOKING_EXPIRED', 'BOOKING_NOT_PAYABLE', 'BOOKING_NOT_EDITABLE', 'BOOKING_NOT_FOUND', 'FORBIDDEN',
  'DEPOSIT_ALREADY_PAID', 'DEPOSIT_REQUIRED',
  'SLOT_CONFLICT', 'EARLY_SETUP_BEFORE_DAY', 'VENUE_OFFLINE', 'SW_FULL_FLOOR_FIRST', 'PEAK_MIN_GUESTS', 'PEAK_MIN_HOURS',
  'DATE_IN_PAST', 'INVALID_DATE_TIME', 'INVALID_DURATION', 'INVALID_GUESTS', 'INVALID_NUMBER',
  'INVALID_ADDONS', 'INVALID_ADDON', 'INVALID_QUANTITY', 'INVALID_OPTIONS',
  'PACKAGE_UNAVAILABLE', 'INVALID_PACKAGE', 'INVALID_DRAFT', 'INVALID_DRAFT_PRICE',
  'DRAFT_NOT_FOUND', 'DRAFT_CLAIMED', 'DRAFT_EXPIRED_OR_CLAIMED', 'CREATE_FAILED', 'CONFIRM_FAILED',
];

describe('customer wording for server error codes (2026-10-15 review items 4 and 6)', () => {
  it.each(SERVER_CODES)('%s has specific zh and en text', code => {
    expect(isKnownPaymentError(code)).toBe(true);
    const zh = paymentErrorMessage(code, 'zh');
    const en = paymentErrorMessage(code, 'en');
    expect(zh).not.toContain('無法建立付款連結');
    expect(en).not.toContain('Unable to create a payment link');
    expect(zh.length).toBeGreaterThan(8);
    expect(en.length).toBeGreaterThan(8);
  });
  it('tells the customer payment already started instead of a blank save failure', () => {
    expect(paymentErrorMessage('PAYMENT_ALREADY_STARTED', 'zh')).toContain('已經開始咗付款');
  });
  it('falls back generically for unknown codes and shows the code for diagnosis', () => {
    expect(isKnownPaymentError('SOMETHING_NEW')).toBe(false);
    expect(paymentErrorMessage('SOMETHING_NEW', 'zh')).toContain('SOMETHING_NEW');
    expect(paymentErrorMessage('', 'en')).toBe('Unable to create a payment link. Refresh or contact us.');
    expect(paymentErrorMessage('Checkout API 500', 'en')).not.toContain('Checkout API');
  });
});
