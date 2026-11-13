// 活動現金券 — ONE code good N times (Heidi 2026-11-13). Her VERTEXFC
// sponsorship was meant as one code the team shares, usable 50 times in
// total until 2027-11-30; the generator could only make 50 different
// single-use codes.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = vi.hoisted(() => ({ added: [] as Record<string, unknown>[], deleted: [] as string[] }));
vi.mock('./firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', async (importOriginal) => ({
  ...await importOriginal<typeof import('firebase/firestore')>(),
  collection: () => ({}),
  doc: (_db: unknown, _col: string, id: string) => ({ id }),
  serverTimestamp: () => ({ testTimestamp: true }),
  addDoc: async (_ref: unknown, data: Record<string, unknown>) => { store.added.push(data); return { id: `new-${store.added.length}` }; },
  deleteDoc: async (ref: { id: string }) => { store.deleted.push(ref.id); },
}));

import {
  createVoucherCampaign, convertCampaignToSharedCode, sharedCodeError, campaignUsage, promoUsesLeft,
} from './promoCodes';
import type { PromoCode } from '@/types';

beforeEach(() => { store.added = []; store.deleted = []; });

const base = { campaign: 'VERTEXFC 足球隊 sponsor', prefix: 'SPACO', amount: 500, minSubtotal: 3800, startDate: null, endDate: '2027-11-30' };

describe('one code, good N times', () => {
  it('creates ONE code with the total as its usage limit', async () => {
    const codes = await createVoucherCampaign({ ...base, mode: 'shared', sharedCode: ' vertexfc ', quantity: 50 });
    expect(codes).toHaveLength(1);
    expect(store.added).toHaveLength(1);
    expect(store.added[0]).toMatchObject({
      code: 'VERTEXFC', type: 'cash', amount: 500, minSubtotal: 3800, endDate: '2027-11-30',
      totalUsageLimit: 50, totalUsageCount: 0, campaign: 'VERTEXFC 足球隊 sponsor', enabled: true,
    });
  });

  it('has no per-account limit unless one is given — only the total counts', async () => {
    await createVoucherCampaign({ ...base, mode: 'shared', sharedCode: 'VERTEXFC', quantity: 50 });
    expect(store.added[0].perUserLimit).toBeNull();
    await createVoucherCampaign({ ...base, mode: 'shared', sharedCode: 'VERTEXFC2', quantity: 50, perUserLimit: 1 });
    expect(store.added[1].perUserLimit).toBe(1);
  });

  it('refuses a missing or malformed code before writing anything', async () => {
    await expect(createVoucherCampaign({ ...base, mode: 'shared', sharedCode: '', quantity: 50 })).rejects.toThrow('shared_code_empty');
    await expect(createVoucherCampaign({ ...base, mode: 'shared', sharedCode: 'VERTEX FC', quantity: 50 })).rejects.toThrow('shared_code_format');
    expect(store.added).toHaveLength(0);
  });

  it('the single-use batch is unchanged: N different codes, each good once', async () => {
    const codes = await createVoucherCampaign({ ...base, quantity: 3 });
    expect(codes).toHaveLength(3);
    expect(new Set(store.added.map((d) => d.code)).size).toBe(3);
    for (const d of store.added) expect(d).toMatchObject({ totalUsageLimit: 1, perUserLimit: 1 });
  });
});

describe('code text checks', () => {
  const existing = [{ code: 'WELCOME10' }, { code: 'SPACO-X7KQ2M' }];
  it('accepts a new code in any letter case', () => {
    expect(sharedCodeError('vertexfc', existing)).toBeNull();
    expect(sharedCodeError('VERTEX-FC_2027', existing)).toBeNull();
  });
  it('refuses a code that already exists (the validator matches the first one it finds)', () => {
    expect(sharedCodeError('welcome10', existing)).toBe('taken');
  });
  it('refuses empty, too short, and codes with spaces or symbols', () => {
    expect(sharedCodeError('  ', existing)).toBe('empty');
    expect(sharedCodeError('AB', existing)).toBe('format');
    expect(sharedCodeError('VERTEX FC', existing)).toBe('format');
    expect(sharedCodeError('足球隊', existing)).toBe('format');
  });
});

describe('「已用 x / y」 of a campaign', () => {
  it('reads the same for 50 single-use codes and for one code good 50 times', () => {
    const batch = Array.from({ length: 50 }, (_, i) => ({ totalUsageLimit: 1, totalUsageCount: i < 3 ? 1 : 0 }));
    expect(campaignUsage(batch)).toEqual({ used: 3, total: 50 });
    expect(campaignUsage([{ totalUsageLimit: 50, totalUsageCount: 3 }])).toEqual({ used: 3, total: 50 });
  });
  it('a code is used up at its limit', () => {
    expect(promoUsesLeft({ totalUsageLimit: 50, totalUsageCount: 49 })).toBe(1);
    expect(promoUsesLeft({ totalUsageLimit: 50, totalUsageCount: 50 })).toBe(0);
    expect(promoUsesLeft({ totalUsageLimit: 50, totalUsageCount: 51 })).toBe(0);
  });
});

describe('turning a batch of single-use codes into one shared code', () => {
  const single = (id: string, used: boolean): PromoCode => ({
    id, code: `SPACO-${id}`, type: 'cash', amount: 500, minSubtotal: 3800, startDate: null, endDate: '2027-11-30',
    totalUsageLimit: 1, totalUsageCount: used ? 1 : 0, perUserLimit: 1, enabled: true,
    campaign: 'VERTEXFC 足球隊 sponsor', venueIds: ['tst'], packageScope: 'all', packageSlugs: [],
    appliesToStandardBookings: true, excludedDateRanges: [{ start: '2026-12-24', end: '2026-12-26' }],
  } as unknown as PromoCode);

  it('50 unused codes become one code good 50 times, same terms; the old codes are deleted', async () => {
    const list = Array.from({ length: 50 }, (_, i) => single(`c${i}`, false));
    const created = await convertCampaignToSharedCode(list, 'vertexfc', null);
    expect(store.added).toHaveLength(1);
    expect(store.added[0]).toMatchObject({
      code: 'VERTEXFC', type: 'cash', amount: 500, minSubtotal: 3800, endDate: '2027-11-30',
      totalUsageLimit: 50, perUserLimit: null, campaign: 'VERTEXFC 足球隊 sponsor',
      venueIds: ['tst'], excludedDateRanges: [{ start: '2026-12-24', end: '2026-12-26' }],
    });
    expect(store.deleted).toHaveLength(50);
    expect(created.code).toBe('VERTEXFC');
  });

  it('codes already redeemed stay, and only the remaining uses carry over', async () => {
    const list = [single('a', true), single('b', false), single('c', false)];
    await convertCampaignToSharedCode(list, 'VERTEXFC', 1);
    expect(store.added[0]).toMatchObject({ totalUsageLimit: 2, perUserLimit: 1 });
    expect(store.deleted.sort()).toEqual(['b', 'c']);
  });

  it('does nothing when every code is used, or the new code is invalid', async () => {
    await expect(convertCampaignToSharedCode([single('a', true)], 'VERTEXFC', null)).rejects.toThrow('nothing_to_convert');
    await expect(convertCampaignToSharedCode([single('b', false)], 'NO GOOD', null)).rejects.toThrow('shared_code_format');
    expect(store.added).toHaveLength(0);
    expect(store.deleted).toHaveLength(0);
  });
});
