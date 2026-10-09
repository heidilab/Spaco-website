import type { BookingRecord, PromoCode } from '@/types';
import { computeGrandTotal, paidBase } from './bookingMoney';

export function settlementDecision(booking: BookingRecord, credit: number, points: number, promo: PromoCode | undefined, userUses: number, now: number) {
  let review: string | null = null;
  if (['cancelled', 'payment_not_completed'].includes(booking.status)) review = 'inactive_booking';
  else if (booking.paymentReviewRequired) review = 'existing_payment_review';
  else if (!['awaiting_payment', 'awaiting_review', 'pending', 'confirmed', 'completed'].includes(booking.status)) review = 'unexpected_status';
  else if (!paidBase(booking) && booking.pendingExpiresAt && booking.pendingExpiresAt <= now) review = 'expired_hold';
  if (!review && !booking.pointsRedeemedAt && (booking.pointsUsed || 0) > points) review = 'insufficient_points';
  if (!review && booking.promoCodeId && !booking.promoRedeemedAt && (!promo
    || (promo.totalUsageLimit != null && promo.totalUsageCount >= promo.totalUsageLimit)
    || (promo.perUserLimit != null && userUses >= promo.perUserLimit))) review = 'promo_limit';
  const balanceDue = Math.max(0, Math.round((computeGrandTotal(booking) - paidBase(booking) - credit) * 100) / 100);
  const status = review ? (['cancelled', 'payment_not_completed'].includes(booking.status) ? booking.status : 'awaiting_review') : booking.status === 'completed' || (booking.depositRefund && balanceDue === 0) ? 'completed' : 'confirmed';
  return { review, balanceDue, status };
}
