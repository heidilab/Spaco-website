import { describe, it, expect, vi, beforeEach } from 'vitest';
const saved=vi.hoisted(()=>({docs:[] as Record<string,unknown>[]}));
vi.mock('./firebase',()=>({db:{}}));
vi.mock('firebase/firestore',async importOriginal=>({
  ...await importOriginal<typeof import('firebase/firestore')>(),
  collection:()=>({}),serverTimestamp:()=>({testTimestamp:true}),
  addDoc:async(_ref:unknown,data:Record<string,unknown>)=>{saved.docs.push(data);return{id:`fake-${saved.docs.length}`};},
}));
import { createVoucherCampaign } from './promoCodes';
beforeEach(()=>{saved.docs=[];});
describe('voucher campaign eligibility persistence',()=>{
  it('copies every restriction to each generated voucher',async()=>{
    const restrictions={venueIds:['cwb'],packageScope:'exclude' as const,packageSlugs:['birthday-cwb'],appliesToStandardBookings:true,excludedDateRanges:[{start:'2026-12-24',end:'2026-12-26'}]};
    const codes=await createVoucherCampaign({campaign:'TEST',prefix:'TEST',quantity:2,amount:500,minSubtotal:3800,startDate:null,endDate:null,...restrictions});
    expect(saved.docs).toHaveLength(2);
    for(const doc of saved.docs)expect(doc).toMatchObject({...restrictions,totalUsageLimit:1,perUserLimit:1});
    expect(codes[0]).toMatchObject(restrictions);
  });
  it('rejects invalid date ranges before creating any code',async()=>{
    await expect(createVoucherCampaign({campaign:'TEST',prefix:'TEST',quantity:2,amount:500,minSubtotal:0,startDate:null,endDate:null,excludedDateRanges:[{start:'2026-12-26',end:'2026-12-24'}]})).rejects.toThrow('invalid_dates');
    expect(saved.docs).toHaveLength(0);
  });
});
