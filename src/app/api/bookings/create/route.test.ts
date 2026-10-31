import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const m=vi.hoisted(()=>({verify:vi.fn(),draft:undefined as Record<string,unknown>|undefined,created:[] as Array<{collection:string;data:Record<string,unknown>}>,phone:vi.fn(),promo:undefined as Record<string,unknown>|undefined,userBookings:[] as Array<{id:string;data:()=>Record<string,unknown>}>,overlapBookings:[] as Array<{id:string;data:()=>Record<string,unknown>}>}));
vi.mock('@/lib/adminAuth',()=>({adminVerifyIdToken:m.verify}));
vi.mock('@/lib/firebase',()=>({db:{}}));
vi.mock('@/lib/peakDaysAdmin',()=>({getPeakDayAdmin:async()=>null}));
vi.mock('@/lib/venueRegistryServer',()=>({getVenueByIdServer:async()=>({id:'cwb',slug:'causeway-bay',capacity:{max:70},minGuests:{weekday:15,weekend:20},minHours:{weekday:5,weekend:5},pricing:{weekday:50,weekend:58}}),venuesSharingSpaceServer:async()=>['cwb']}));
vi.mock('@/lib/firebaseAdmin',()=>{
  const version={isEqual:()=>true};
  const reference=(name:string,id='new-booking')=>({name,id,get:async()=>name==='booking_drafts'?{exists:!!m.draft,data:()=>m.draft,updateTime:version}:name==='promo_codes'?{exists:!!m.promo,id:'test-promo',data:()=>m.promo}:{exists:true,data:()=>({loyaltyPoints:1000})},update:m.phone});
  const collection=(name:string)=>({doc:(id?:string)=>reference(name,id),where:()=>({__coll:name,where:()=>({__coll:name,get:async()=>({docs:[]})}),get:async()=>({docs:name==='bookings'?m.userBookings:[]})})});
  return {adminDb:{collection,runTransaction:async(fn:(tx:unknown)=>Promise<unknown>)=>fn({
    get:async(ref:ReturnType<typeof reference>)=>ref.name==='booking_drafts'?{exists:!!m.draft,data:()=>m.draft,updateTime:version}:(ref as unknown as {__coll?:string}).__coll==='bookings'?{docs:m.overlapBookings,exists:true}:{docs:[],exists:true},
    create:(ref:ReturnType<typeof reference>,data:Record<string,unknown>)=>m.created.push({collection:ref.name,data}),update:()=>{},set:()=>{},
  })}};
});
import { POST } from './route';
const body={venueId:'cwb',branchSlug:'forged',packageSlug:'birthday-cwb',date:'2026-11-20',startTime:'10:00',endTime:'13:00',guestCount:15,childCount:0,addOns:[],pricing:{baseCharge:1,subtotal:1,addOnTotal:0,securityDeposit:0,deposit:1},userId:'victim',whatsappPhone:'+85200000000'};
const request=(b:unknown,auth=true)=>new NextRequest('https://spaco.test/api/bookings/create',{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer token'}:{})},body:JSON.stringify(b)});
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-09T00:00:00+08:00'));m.verify.mockResolvedValue({uid:'alice'});m.draft=undefined;m.promo=undefined;m.created=[];m.userBookings=[];m.overlapBookings=[];m.phone.mockResolvedValue(undefined);});
describe('booking creation boundaries',()=>{
  it('rejects unauthenticated creates',async()=>{expect((await POST(request(body,false))).status).toBe(401);expect(m.created).toEqual([]);});
  it('ignores client price, uid, status and invented expiry for a real package',async()=>{
    const response=await POST(request({...body,status:'confirmed',pendingExpiresAt:9999999999999}));
    expect(response.status).toBe(200);
    const booking=m.created.find(x=>x.collection==='bookings')!.data;
    expect(booking.userId).toBe('alice');expect(booking.status).toBe('awaiting_payment');
    expect(booking.pricing).toEqual({baseCharge:6800,addOnTotal:0,subtotal:6800,securityDeposit:2000,deposit:8800});
    expect(booking.pendingExpiresAt).toBe(Date.now()+30*60000);expect(booking.branchSlug).toBe('causeway-bay');
  });
  it('refuses any new booking while a settlement debt is unpaid, and allows it once paid (Heidi 2026-10-18)',async()=>{
    const debt={status:'confirmed',date:'2026-10-01',userId:'alice',pricing:{baseCharge:2000,addOnTotal:0,securityDeposit:1000},payments:[{amount:3000}],depositRefund:{amount:0,deductions:[{amount:2000}],refundedAt:'2026-10-02T00:00:00Z'},balanceDue:1000};
    m.userBookings=[{id:'old',data:()=>debt}];
    const blocked=await POST(request(body));
    expect(blocked.status).toBe(400);expect((await blocked.json()).error).toBe('SETTLEMENT_DEBT_OUTSTANDING');expect(m.created).toEqual([]);
    m.userBookings=[{id:'old',data:()=>({...debt,status:'completed',balanceDue:0,payments:[{amount:3000},{amount:1000}]})}];
    expect((await POST(request(body))).status).toBe(200);
  });
  it('refuses a slot already held by a paid booking even when its blocked_slots are missing (CWB 2026-10-31)',async()=>{
    m.overlapBookings=[{id:'sold',data:()=>({venueId:'cwb',date:'2026-11-20',startTime:'09:00',endTime:'12:00',status:'confirmed'})}];
    const res=await POST(request(body));
    expect(res.status).toBe(409);expect((await res.json()).error).toBe('SLOT_CONFLICT');expect(m.created).toEqual([]);
    m.overlapBookings=[{id:'gone',data:()=>({venueId:'cwb',date:'2026-11-20',startTime:'09:00',endTime:'12:00',status:'cancelled'})}];
    expect((await POST(request(body))).status).toBe(200);
  });
  it('rejects invented package names',async()=>{expect((await POST(request({...body,packageSlug:'free'}))).status).toBe(400);expect(m.created).toEqual([]);});
  it('uses authoritative CS terms even if the client changes price, date and venue',async()=>{
    m.draft={...body,packageSlug:'birthday-cwb',status:'pending',claimedBy:null,expiresAt:{toMillis:()=>Date.now()+3600000},pricing:{baseCharge:999,subtotal:7300,addOnTotal:500,securityDeposit:2000,deposit:9300}};
    const response=await POST(request({...body,draftId:'staff-draft',venueId:'tst',date:'2026-10-10',pricing:{subtotal:1}}));
    expect(response.status).toBe(200);
    const booking=m.created.find(x=>x.collection==='bookings')!.data;
    expect(booking.venueId).toBe('cwb');expect(booking.date).toBe('2026-11-20');
    expect(booking.pricing).toEqual({baseCharge:6800,addOnTotal:500,subtotal:7300,securityDeposit:2000,deposit:9300});
  });
  it('rejects an expired staff quote',async()=>{
    m.draft={...body,status:'pending',expiresAt:{toMillis:()=>Date.now()-1}};
    expect((await POST(request({...body,draftId:'staff-draft'}))).status).toBe(409);expect(m.created).toEqual([]);
  });
});


describe('package promo restrictions at authoritative creation',()=>{
  const promo={code:'TEST',type:'cash',amount:500,enabled:true,totalUsageCount:0,packageScope:'include',packageSlugs:['birthday-cwb'],venueIds:['cwb']};
  it('applies an allowed package code against server-computed pricing',async()=>{
    m.promo=promo;
    expect((await POST(request({...body,promoCodeId:'test-promo',promoDiscount:99999}))).status).toBe(200);
    const b=m.created.find(x=>x.collection==='bookings')!.data;
    expect(b.promoDiscount).toBe(500);
    expect((b.pricing as {subtotal:number}).subtotal).toBe(6800);
  });
  it('rejects an excluded event date despite a client claimed discount',async()=>{
    m.promo={...promo,excludedDateRanges:[{start:body.date,end:body.date}]};
    expect((await POST(request({...body,promoCodeId:'test-promo',promoDiscount:500}))).status).toBe(400);
    expect(m.created).toEqual([]);
  });
  it('revalidates a CS draft against its real package rather than client input',async()=>{
    m.promo={...promo,packageScope:'none'};
    m.draft={...body,promoCodeId:'test-promo',promoDiscount:500,status:'pending',claimedBy:null,expiresAt:{toMillis:()=>Date.now()+3600000},pricing:{baseCharge:6800,subtotal:6800,addOnTotal:0,securityDeposit:2000,deposit:8800}};
    expect((await POST(request({...body,draftId:'staff-draft',packageSlug:null}))).status).toBe(400);
    expect(m.created).toEqual([]);
  });
});

describe('staff 折扣優惠 on CS links (Heidi 2026-10-31)',()=>{
  const draftBase={...body,packageSlug:undefined,venueId:'cwb',date:'2026-11-20',startTime:'10:00',endTime:'15:00',guestCount:20,childCount:0,addOns:[],status:'pending',claimedBy:null,expiresAt:{toMillis:()=>Date.now()+3600000},
    pricing:{baseCharge:5000,addOnTotal:1000,subtotal:6000,securityDeposit:2000,deposit:8000}};
  it('deducts a rent-only % discount from the upfront charge and stores it on the booking',async()=>{
    m.draft={...draftBase,adminDiscount:{type:'percent',value:10,scope:'rent',note:'熟客'}};
    const response=await POST(request({...body,draftId:'staff-draft'}));
    expect(response.status).toBe(200);
    const booking=m.created.find(x=>x.collection==='bookings')!.data;
    // 6,000 − 500 (10% of rent 5,000) + 2,000 deposit = 7,500 ≤ 10k → paid in full upfront
    expect(booking.pricing).toEqual({baseCharge:5000,addOnTotal:1000,subtotal:6000,securityDeposit:2000,deposit:7500});
    expect(booking.balanceDue).toBe(0);
    expect(booking.adminDiscount).toEqual({type:'percent',value:10,scope:'rent',note:'熟客'});
  });
  it('deducts a cash discount from the whole bill',async()=>{
    m.draft={...draftBase,adminDiscount:{type:'cash',value:800,scope:'all'}};
    const response=await POST(request({...body,draftId:'staff-draft'}));
    expect(response.status).toBe(200);
    const booking=m.created.find(x=>x.collection==='bookings')!.data;
    expect((booking.pricing as {deposit:number}).deposit).toBe(7200);
  });
  it('rejects a malformed discount on the draft rather than guessing',async()=>{
    m.draft={...draftBase,adminDiscount:{type:'percent',value:150,scope:'all'}};
    expect((await POST(request({...body,draftId:'staff-draft'}))).status).toBe(400);
    expect(m.created).toEqual([]);
  });
  it('ignores a discount a customer puts in a self-booking body',async()=>{
    const response=await POST(request({...body,adminDiscount:{type:'percent',value:90,scope:'all'}}));
    expect(response.status).toBe(200);
    const booking=m.created.find(x=>x.collection==='bookings')!.data;
    expect(booking.adminDiscount).toBeUndefined();
    expect((booking.pricing as {deposit:number}).deposit).toBe(8800);
  });
});
