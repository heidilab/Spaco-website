// Rewards consumed once, on confirmation, whichever path confirmed the
// booking (site review 2026-11-13 #6).

import { describe, it, expect, vi, beforeEach } from 'vitest';

type Doc = Record<string, unknown>;
const store = vi.hoisted(() => ({ docs: new Map<string, Doc>() }));

vi.mock('./firebaseAdmin', () => {
  const docRef = (path: string) => ({ path, collection: (c: string) => collRef(`${path}/${c}`) });
  const collRef = (path: string) => ({ doc: (id: string) => docRef(`${path}/${id}`) });
  const tx = {
    get: async (ref: { path: string }) => {
      const data = store.docs.get(ref.path);
      return { exists: !!data, data: () => data };
    },
    update: (ref: { path: string }, patch: Doc) => {
      const cur = store.docs.get(ref.path) || {};
      const next: Doc = { ...cur };
      for (const [k, v] of Object.entries(patch)) {
        if (v && typeof v === 'object' && (v as { __inc?: number }).__inc !== undefined) next[k] = ((cur[k] as number) || 0) + (v as { __inc: number }).__inc;
        else next[k] = v;
      }
      store.docs.set(ref.path, next);
    },
  };
  return { adminDb: { collection: collRef, runTransaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } };
});
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'TS', increment: (n: number) => ({ __inc: n }) },
}));

import { consumeBookingRewards } from './bookingRewards';

const seed = (booking: Doc) => {
  store.docs.clear();
  store.docs.set('bookings/b1', { status: 'confirmed', userId: 'u1', pointsUsed: 500, promoCodeId: 'p1', ...booking });
  store.docs.set('users/u1', { loyaltyPoints: 800 });
  store.docs.set('promo_codes/p1', { totalUsageCount: 3 });
};

beforeEach(() => seed({}));

describe('consumeBookingRewards', () => {
  it('deducts the points and counts the promo once', async () => {
    const r = await consumeBookingRewards('b1');
    expect(r).toEqual({ pointsDeducted: 500, promoCounted: true });
    expect(store.docs.get('users/u1')!.loyaltyPoints).toBe(300);
    expect(store.docs.get('promo_codes/p1')!.totalUsageCount).toBe(4);
    expect(store.docs.get('bookings/b1')).toMatchObject({ pointsRedeemedAt: 'TS', pointsActuallyDeducted: 500, promoRedeemedAt: 'TS' });
  });

  it('a second call is a no-op', async () => {
    await consumeBookingRewards('b1');
    const r = await consumeBookingRewards('b1');
    expect(r.skipped).toBe('already-consumed');
    expect(store.docs.get('users/u1')!.loyaltyPoints).toBe(300);
    expect(store.docs.get('promo_codes/p1')!.totalUsageCount).toBe(4);
  });

  it('does nothing for a booking that is not confirmed', async () => {
    seed({ status: 'awaiting_payment' });
    expect((await consumeBookingRewards('b1')).skipped).toBe('not-confirmed');
    expect(store.docs.get('users/u1')!.loyaltyPoints).toBe(800);
  });

  it('never takes more points than the account holds', async () => {
    seed({ pointsUsed: 1000 });
    const r = await consumeBookingRewards('b1');
    expect(r.pointsDeducted).toBe(800);
    expect(store.docs.get('users/u1')!.loyaltyPoints).toBe(0);
  });

  it('a booking with neither points nor a promo is left alone', async () => {
    seed({ pointsUsed: 0, promoCodeId: null });
    expect((await consumeBookingRewards('b1')).skipped).toBe('nothing-to-consume');
  });
});
