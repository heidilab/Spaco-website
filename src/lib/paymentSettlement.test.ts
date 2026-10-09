import { describe, it, expect } from 'vitest';
import { settlementDecision } from './paymentSettlement';
import type { BookingRecord, PromoCode } from '@/types';
const booking = { status:'awaiting_payment', pricing:{baseCharge:1000,addOnTotal:0,securityDeposit:0}, payments:[] } as unknown as BookingRecord;
describe('payment settlement decisions',()=>{
  it('preserves cancelled status while recording money',()=>{
    expect(settlementDecision({...booking,status:'cancelled'},1000,0,undefined,0,0)).toMatchObject({status:'cancelled',review:'inactive_booking',balanceDue:0});
  });
  it('never confirms an expired hold even before the expiry cron runs',()=>{
    expect(settlementDecision({...booking,pendingExpiresAt:1},1000,0,undefined,0,2)).toMatchObject({status:'awaiting_review',review:'expired_hold'});
  });
  it('requires the entire points balance',()=>{
    expect(settlementDecision({...booking,pointsUsed:1000},990,999,undefined,0,0).review).toBe('insufficient_points');
  });
  it('does not deduct previously redeemed rewards again',()=>{
    expect(settlementDecision({...booking,pointsUsed:1000,pointsRedeemedAt:1 as never},1000,0,undefined,0,0).review).toBeNull();
  });
  it('checks global and per-user promo limits',()=>{
    const pc={totalUsageCount:1,totalUsageLimit:1,perUserLimit:1} as PromoCode;
    expect(settlementDecision({...booking,promoCodeId:'p'},900,0,pc,0,0).review).toBe('promo_limit');
    expect(settlementDecision({...booking,promoCodeId:'p'},900,0,{...pc,totalUsageLimit:10},1,0).review).toBe('promo_limit');
  });
  it('keeps completed bookings completed',()=>{
    expect(settlementDecision({...booking,status:'completed'},1000,0,undefined,0,0).status).toBe('completed');
  });
});
