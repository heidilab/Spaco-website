import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const m=vi.hoisted(()=>({verify:vi.fn(),draft:undefined as Record<string,unknown>|undefined,created:[] as Array<{collection:string;data:Record<string,unknown>}>,phone:vi.fn()}));
vi.mock('@/lib/adminAuth',()=>({adminVerifyIdToken:m.verify}));
vi.mock('@/lib/promoCodes',()=>({calcPromoDiscount:vi.fn()}));
vi.mock('@/lib/peakDaysAdmin',()=>({getPeakDayAdmin:async()=>null}));
vi.mock('@/lib/venueRegistryServer',()=>({getVenueByIdServer:async()=>({id:'cwb',slug:'causeway-bay',capacity:{max:70},minGuests:{weekday:15,weekend:20},minHours:{weekday:5,weekend:5},pricing:{weekday:50,weekend:58}}),venuesSharingSpaceServer:async()=>['cwb']}));
vi.mock('@/lib/firebaseAdmin',()=>{
  const version={isEqual:()=>true};
  const reference=(name:string,id='new-booking')=>({name,id,get:async()=>name==='booking_drafts'?{exists:!!m.draft,data:()=>m.draft,updateTime:version}:{exists:true,data:()=>({loyaltyPoints:1000})},update:m.phone});
  const collection=(name:string)=>({doc:(id?:string)=>reference(name,id),where:()=>({where:()=>({get:async()=>({docs:[]})}),get:async()=>({docs:[]})})});
  return {adminDb:{collection,runTransaction:async(fn:(tx:unknown)=>Promise<unknown>)=>fn({
    get:async(ref:ReturnType<typeof reference>)=>ref.name==='booking_drafts'?{exists:!!m.draft,data:()=>m.draft,updateTime:version}:{docs:[],exists:true},
    create:(ref:ReturnType<typeof reference>,data:Record<string,unknown>)=>m.created.push({collection:ref.name,data}),update:()=>{},set:()=>{},
  })}};
});
import { POST } from './route';
const body={venueId:'cwb',branchSlug:'forged',packageSlug:'birthday-cwb',date:'2026-11-20',startTime:'10:00',endTime:'13:00',guestCount:15,childCount:0,addOns:[],pricing:{baseCharge:1,subtotal:1,addOnTotal:0,securityDeposit:0,deposit:1},userId:'victim',whatsappPhone:'+85200000000'};
const request=(b:unknown,auth=true)=>new NextRequest('https://spaco.test/api/bookings/create',{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer token'}:{})},body:JSON.stringify(b)});
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-09T00:00:00+08:00'));m.verify.mockResolvedValue({uid:'alice'});m.draft=undefined;m.created=[];m.phone.mockResolvedValue(undefined);});
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
