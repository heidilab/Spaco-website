import { describe,it,expect,vi } from 'vitest';
import { NextRequest } from 'next/server';
const store=vi.hoisted(()=>({code:{} as Record<string,unknown>}));
vi.mock('@/lib/firebase',()=>({db:{}}));
vi.mock('@/lib/firebaseAdmin',()=>({adminDb:{collection:()=>({where:()=>({limit:()=>({get:async()=>({empty:false,docs:[{id:'test',data:()=>store.code}]})})})})}}));
import { POST } from './route';
const request=(extra:Record<string,unknown>)=>new NextRequest('https://example.test/api/promo/validate',{method:'POST',body:JSON.stringify({code:'TEST',subtotal:6800,baseCharge:6800,adultEquiv:15,drinksCost:0,...extra})});
describe('promo preview error reasons',()=>{
 it('reports excluded event dates',async()=>{store.code={enabled:true,type:'cash',amount:500,excludedDateRanges:[{start:'2026-12-24',end:'2026-12-26'}]};expect(await(await POST(request({date:'2026-12-25'}))).json()).toMatchObject({valid:false,reason:'excluded_date'});});
 it('fails closed without dates for a date-restricted code',async()=>{store.code={enabled:true,type:'cash',amount:500,excludedDateRanges:[{start:'2026-12-24',end:'2026-12-26'}]};expect(await(await POST(request({}))).json()).toMatchObject({valid:false,reason:'missing_booking_context'});});
 it('reports package mismatch',async()=>{store.code={enabled:true,type:'cash',amount:500,packageScope:'none'};expect(await(await POST(request({packageSlug:'birthday-cwb'}))).json()).toMatchObject({valid:false,reason:'wrong_package'});});
 it('accepts an eligible package with its flat subtotal',async()=>{store.code={enabled:true,type:'percent',percent:10,packageScope:'include',packageSlugs:['birthday-cwb']};expect(await(await POST(request({packageSlug:'birthday-cwb'}))).json()).toMatchObject({valid:true,amount:680});});
});
