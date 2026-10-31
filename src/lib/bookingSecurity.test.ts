import { describe, expect, it } from 'vitest';
import { bookingInterval, pricePackage, validateAddOns, checkoutAmount, sanitizeAdminDiscount } from './bookingSecurity';
import type { BookingRecord } from '@/types';
const now = Date.parse('2026-10-09T00:00:00+08:00');
const birthday = { packageSlug:'birthday-cwb', venueId:'cwb', date:'2026-10-20', startTime:'10:00',endTime:'13:00',guestCount:15,addOns:[] };
const booking = { userId:'alice', status:'awaiting_payment', pricing:{baseCharge:12000,addOnTotal:0,subtotal:12000,securityDeposit:2000,deposit:7000},pointsDiscount:100,balanceDue:7000,payments:[] } as unknown as BookingRecord;
describe('trusted prices and booking validation', () => {
  it('uses the catalog birthday price, including the refundable deposit', () => {
    expect(pricePackage(birthday, 0, now)).toEqual({baseCharge:6800,addOnTotal:0,subtotal:6800,securityDeposit:2000,deposit:0});
  });
  it('rejects unknown or wrong-venue packages', () => {
    expect(()=>pricePackage({...birthday,packageSlug:'made-up'},0,now)).toThrow('INVALID_PACKAGE');
    expect(()=>pricePackage({...birthday,venueId:'tst'},0,now)).toThrow('INVALID_PACKAGE');
  });
  it('enforces duration, latest end and advance notice', () => {
    expect(()=>pricePackage({...birthday,endTime:'14:00'},0,now)).toThrow();
    expect(()=>pricePackage({...birthday,startTime:'16:00',endTime:'19:00'},0,now)).toThrow();
    expect(()=>pricePackage({...birthday,date:'2026-10-10'},0,now)).toThrow();
  });
  it('prices extra mahjong guests and permits midnight rollover', () => {
    const price = pricePackage({packageSlug:'mahjong-wanchai',venueId:'wanchai',date:'2026-10-20',endDate:'2026-10-21',startTime:'22:00',endTime:'06:00',guestCount:6,addOns:[]},0,now);
    expect(price.baseCharge).toBe(1800);
  });
  it('prices corporate BBQ from the catalog and peak surcharge from the server', () => {
    const price = pricePackage({packageSlug:'corporate-tst',venueId:'tst',date:'2026-10-20',startTime:'10:00',endTime:'15:00',guestCount:20,addOns:[{id:'bbq',quantity:20}]},50,now);
    expect(price.subtotal).toBe(4800+1000+2760);
  });
  it('rejects negative/duplicate/custom addons and nested negative quantities', () => {
    for (const addons of [[{id:'bbq-grill',quantity:-2}],[{id:'drinks',quantity:1},{id:'drinks',quantity:1}],[{id:'custom-x',quantity:1}], [{id:'catering',quantity:1,options:{extraCutlerySets:-100}}]]) {
      expect(()=>validateAddOns(addons)).toThrow();
    }
  });
  it('rejects invalid calendar dates, reversed times and invalid minutes', () => {
    expect(()=>bookingInterval('2026-02-31','12:00','14:00')).toThrow();
    expect(()=>bookingInterval('2026-10-20','14:00','12:00')).toThrow();
    expect(()=>bookingInterval('2026-10-20','12:99','14:00')).toThrow();
  });
  it('charges the stored upfront deposit less points, not the remaining balance', () => {
    expect(checkoutAmount(booking,false,now)).toBe(6900);
  });
  it('rejects dead bookings, expired holds and duplicate initial payments', () => {
    expect(()=>checkoutAmount({...booking,status:'cancelled'},false,now)).toThrow();
    expect(()=>checkoutAmount({...booking,pendingExpiresAt:now-1},false,now)).toThrow();
    expect(()=>checkoutAmount({...booking,payments:[{amount:6900}] as BookingRecord['payments']},false,now)).toThrow();
  });
  it('supports balance payments and settlement overflow', () => {
    const paid = {...booking,status:'confirmed',payments:[{amount:6900}]} as BookingRecord;
    expect(checkoutAmount(paid,true,now)).toBe(7000);
    expect(checkoutAmount({...paid, payments:[{amount:13900}] as BookingRecord['payments'],balanceDue:650,depositRefund:{} as BookingRecord['depositRefund']},true,now)).toBe(650);
  });
  it('lets a paid booking settle its balance after the 30-minute hold lapsed (TST 2026-10-31: FPS approval never cleared pendingExpiresAt)', () => {
    const paid = {...booking,status:'confirmed',payments:[{amount:6900}],pendingExpiresAt:now-3600000} as BookingRecord;
    expect(checkoutAmount(paid,true,now)).toBe(7000);
    // The hold still guards the FIRST payment.
    expect(()=>checkoutAmount({...booking,pendingExpiresAt:now-1},false,now)).toThrow('BOOKING_EXPIRED');
  });
  it('deducts a staff 折扣優惠 from the balance owed', () => {
    // rent 12,000 × 10% = 1,200 off → 12,000 − 1,200 − 100 pts + 2,000 deposit − 6,900 paid = 5,800.
    // Admin saves re-store balanceDue from the same formula; a stale higher stored value still wins (amountOwed = max).
    const paid = {...booking,status:'confirmed',payments:[{amount:6900}],adminDiscount:{type:'percent',value:10,scope:'rent'},balanceDue:0} as BookingRecord;
    expect(checkoutAmount(paid,true,now)).toBe(5800);
    expect(checkoutAmount({...paid,balanceDue:7000},true,now)).toBe(7000);
  });
});
describe('staff discount input', () => {
  it('accepts the three CS forms and normalises them', () => {
    expect(sanitizeAdminDiscount({type:'cash',value:500,scope:'all',note:' 熟客 '})).toEqual({type:'cash',value:500,scope:'all',note:'熟客'});
    expect(sanitizeAdminDiscount({type:'percent',value:15,scope:'rent'})).toEqual({type:'percent',value:15,scope:'rent'});
    expect(sanitizeAdminDiscount({type:'percent',value:20,scope:'all',note:''})).toEqual({type:'percent',value:20,scope:'all'});
  });
  it('treats absent or zero as no discount', () => {
    expect(sanitizeAdminDiscount(undefined)).toBeNull();
    expect(sanitizeAdminDiscount(null)).toBeNull();
    expect(sanitizeAdminDiscount({type:'cash',value:0,scope:'all'})).toBeNull();
  });
  it('rejects malformed, negative, over-100% or oversized input', () => {
    for (const bad of ['10', 10, {type:'free',value:1,scope:'all'}, {type:'cash',value:-5,scope:'all'}, {type:'percent',value:120,scope:'all'},
      {type:'cash',value:Infinity,scope:'all'}, {type:'cash',value:1,scope:'deposit'}, {type:'cash',value:1,scope:'all',note:'x'.repeat(201)}, {type:'cash',value:'5',scope:'all'}]) {
      expect(()=>sanitizeAdminDiscount(bad)).toThrow();
    }
  });
});
