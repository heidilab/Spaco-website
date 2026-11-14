import { promoEligibilityReason, promoRestrictionError, type PromoRestrictions, type PromoBookingContext } from './promoEligibility';
import { hkTodayYmd } from './hkTime';
// Promo code admin CRUD + checkout validation helpers.
//
// Codes live in Firestore at `promo_codes/{id}`. The admin UI uses
// these client helpers (gated by Firestore rules: staff-only).
// Checkout validation runs server-side via /api/promo/validate which
// uses Admin SDK to keep the catalog opaque to customers.

import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, orderBy, serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import type { PromoCode, PromoCodeType } from '@/types';

// ───── Types ─────

export interface PromoDiscount {
  /** Cash value subtracted from the booking subtotal (HK$). */
  amount: number;
  /** Whether the drinks add-on should be set to 0 cost in the breakdown. */
  freeDrinks: boolean;
  /** Resolved code id (for booking persistence). */
  codeId: string;
  /** The original code text (for display). */
  code: string;
  /** Code type (helps the UI label the discount line). */
  type: PromoCodeType;
}

// ───── Admin CRUD ─────

export async function listPromoCodes(): Promise<PromoCode[]> {
  const q = query(collection(db, 'promo_codes'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as PromoCode));
}

export async function getPromoCode(id: string): Promise<PromoCode | null> {
  const snap = await getDoc(doc(db, 'promo_codes', id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as PromoCode;
}

export async function createPromoCode(data: Omit<PromoCode, 'id' | 'createdAt' | 'updatedAt' | 'totalUsageCount'>): Promise<string> {
  const restrictionError = promoRestrictionError(data);
  if (restrictionError) throw new Error(restrictionError);
  const ref = await addDoc(collection(db, 'promo_codes'), {
    ...data,
    code: data.code.trim().toUpperCase(),
    totalUsageCount: 0,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updatePromoCode(id: string, patch: Partial<Omit<PromoCode, 'id' | 'createdAt' | 'totalUsageCount'>>): Promise<void> {
  const update = { ...patch, updatedAt: serverTimestamp() };
  if (typeof patch.code === 'string') update.code = patch.code.trim().toUpperCase();
  await updateDoc(doc(db, 'promo_codes', id), update);
}

export async function deletePromoCode(id: string): Promise<void> {
  await deleteDoc(doc(db, 'promo_codes', id));
}

// ───── Voucher campaigns (活動現金券) ─────
//
// Cash vouchers for marketing campaigns, in one of two shapes:
//
//   'single_use' — a batch of different codes, each good ONCE (type
//     'cash', totalUsageLimit 1: the leak-proofing Heidi asked for — a
//     screenshot forwarded to a group chat is dead after the first
//     redemption).
//   'shared' — ONE code that everybody types, good N times in total
//     across all customers and dead after the Nth use (Heidi 2026-11-13,
//     the VERTEXFC sponsorship: "同一個優惠碼…用夠 50 次就會失效" — the
//     generator had only offered 50 different codes).
//
// Both: optional min spend (consumption subtotal, which already EXCLUDES
// the security deposit) and a validity window. Both are plain
// promo_codes docs, so validation / redemption / counting are the
// existing pipeline (`totalUsageLimit` vs `totalUsageCount`).

export type VoucherCampaignMode = 'single_use' | 'shared';

/** What customers type: trimmed, upper-case (the validator upper-cases
 *  the input before matching). */
export function normalizeSharedCode(raw: string): string {
  return (raw || '').trim().toUpperCase();
}

export type SharedCodeError = 'empty' | 'format' | 'taken';

/** Why a shared code text cannot be used, or null. `taken`: another code
 *  with the same text exists — the validator matches the first doc it
 *  finds, so a duplicate would make one of the two unusable. */
export function sharedCodeError(raw: string, existing: Array<Pick<PromoCode, 'code'>>): SharedCodeError | null {
  const code = normalizeSharedCode(raw);
  if (!code) return 'empty';
  if (!/^[A-Z0-9][A-Z0-9_-]{2,29}$/.test(code)) return 'format';
  if (existing.some((c) => normalizeSharedCode(c.code) === code)) return 'taken';
  return null;
}

/** Uses still open on a code (0 when used up). */
export function promoUsesLeft(c: Pick<PromoCode, 'totalUsageLimit' | 'totalUsageCount'>): number {
  return Math.max(0, (c.totalUsageLimit ?? 1) - (c.totalUsageCount || 0));
}

/** 「已用 x / y」 for a campaign: redemptions so far over everything the
 *  campaign can ever give out. Works for both shapes — 50 single-use
 *  codes and one code good 50 times both read x/50. */
export function campaignUsage(list: Array<Pick<PromoCode, 'totalUsageLimit' | 'totalUsageCount'>>): { used: number; total: number } {
  let used = 0; let total = 0;
  for (const c of list) {
    const cap = c.totalUsageLimit ?? 1;
    total += cap;
    used += Math.min(cap, c.totalUsageCount || 0);
  }
  return { used, total };
}

/** Unambiguous charset — no 0/O/1/I/L so codes survive being read out
 *  loud or retyped from a photo. */
const VOUCHER_CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomVoucherSuffix(len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) {
    s += VOUCHER_CHARSET[Math.floor(Math.random() * VOUCHER_CHARSET.length)];
  }
  return s;
}

export interface VoucherCampaignParams extends PromoRestrictions {
  /** Campaign name — groups the codes in the admin list. */
  campaign: string;
  /** Default 'single_use'. */
  mode?: VoucherCampaignMode;
  /** single_use: code prefix, e.g. "SPACO500" → SPACO500-X7KQ2M. */
  prefix: string;
  /** single_use: how many codes to generate (1-200).
   *  shared: how many times the one code can be used in total (1-10000). */
  quantity: number;
  /** shared: the code customers type, e.g. "VERTEXFC". */
  sharedCode?: string;
  /** shared: uses per account. null / absent = no per-account limit
   *  (only the total counts). */
  perUserLimit?: number | null;
  /** HK$ cash value of each voucher. */
  amount: number;
  /** Min consumption subtotal (EXCLUDES deposit). 0 = no minimum. */
  minSubtotal: number;
  startDate: string | null;
  endDate: string | null;
}

/** Generate a batch of single-use cash voucher codes. Returns the created
 *  codes in order. Codes are unique within the batch; the random space
 *  (31^6 ≈ 890M) makes cross-batch collisions vanishingly unlikely, and a
 *  duplicate would just be two docs with the same code string — the
 *  validator matches the first, so worst case one voucher is unusable,
 *  never double-spendable. */
export async function createVoucherCampaign(params: VoucherCampaignParams): Promise<PromoCode[]> {
  const restrictionError = promoRestrictionError(params);
  if (restrictionError) throw new Error(restrictionError);
  // NOTE: no `undefined` values — the client Firestore SDK rejects them.
  const voucher = (code: string, totalUsageLimit: number, perUserLimit: number | null) => ({
    code,
    type: 'cash' as const,
    amount: params.amount,
    ...(params.minSubtotal > 0 ? { minSubtotal: params.minSubtotal } : {}),
    startDate: params.startDate,
    endDate: params.endDate,
    totalUsageLimit,
    perUserLimit,
    enabled: true,
    campaign: params.campaign,
    venueIds: params.venueIds || [],
    excludedDateRanges: params.excludedDateRanges || [],
    packageScope: params.packageScope || 'all',
    packageSlugs: params.packageSlugs || [],
    appliesToStandardBookings: params.appliesToStandardBookings !== false,
    description: params.campaign,
    note: '',
  });
  const save = async (data: ReturnType<typeof voucher>): Promise<PromoCode> => {
    const id = await createPromoCode(data as unknown as Parameters<typeof createPromoCode>[0]);
    return { id, totalUsageCount: 0, ...data } as unknown as PromoCode;
  };

  if (params.mode === 'shared') {
    // ONE code, good `quantity` times in total.
    const code = normalizeSharedCode(params.sharedCode || '');
    const codeError = sharedCodeError(code, []);
    if (codeError) throw new Error(`shared_code_${codeError}`);
    const uses = Math.max(1, Math.min(10000, Math.floor(params.quantity)));
    const perUser = params.perUserLimit != null && params.perUserLimit >= 1 ? Math.floor(params.perUserLimit) : null;
    return [await save(voucher(code, uses, perUser))];
  }

  const qty = Math.max(1, Math.min(200, Math.floor(params.quantity)));
  const created: PromoCode[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < qty; i++) {
    let code: string;
    do { code = `${params.prefix.toUpperCase()}-${randomVoucherSuffix(6)}`; } while (seen.has(code));
    seen.add(code);
    created.push(await save(voucher(code, 1, 1)));
  }
  return created;
}

/** Turn a campaign of single-use codes into ONE shared code: the new code
 *  carries every use the old codes still had (50 unused codes → one code
 *  good 50 times) with the same value, minimum spend, dates and
 *  restrictions; the unused old codes are then deleted. Codes already
 *  redeemed stay as the record of those bookings.
 *
 *  The new code is created FIRST: if deleting the old ones is interrupted
 *  the campaign has too many codes (visible, deletable), never none. */
export async function convertCampaignToSharedCode(
  list: PromoCode[],
  sharedCode: string,
  perUserLimit: number | null,
): Promise<PromoCode> {
  const open = list.filter((c) => promoUsesLeft(c) > 0);
  if (open.length === 0) throw new Error('nothing_to_convert');
  const code = normalizeSharedCode(sharedCode);
  const codeError = sharedCodeError(code, []);
  if (codeError) throw new Error(`shared_code_${codeError}`);
  const from = open[0];
  const uses = open.reduce((sum, c) => sum + promoUsesLeft(c), 0);
  const data = {
    code,
    type: 'cash' as const,
    amount: from.amount || 0,
    ...(from.minSubtotal ? { minSubtotal: from.minSubtotal } : {}),
    startDate: from.startDate ?? null,
    endDate: from.endDate ?? null,
    totalUsageLimit: uses,
    perUserLimit: perUserLimit != null && perUserLimit >= 1 ? Math.floor(perUserLimit) : null,
    enabled: true,
    campaign: from.campaign || '',
    venueIds: from.venueIds || [],
    excludedDateRanges: from.excludedDateRanges || [],
    packageScope: from.packageScope || 'all',
    packageSlugs: from.packageSlugs || [],
    appliesToStandardBookings: from.appliesToStandardBookings !== false,
    description: from.description || from.campaign || '',
    note: '',
  };
  const id = await createPromoCode(data as unknown as Parameters<typeof createPromoCode>[0]);
  for (const c of open) await deletePromoCode(c.id);
  return { id, totalUsageCount: 0, ...data } as unknown as PromoCode;
}

// ───── Pure pricing logic (no Firestore) — shared with server validator ─────

/** Compute the HK$ value of a promo code applied to a given booking
 *  context. Returns null if the code can't be applied (e.g. minSubtotal
 *  not met). Pure function so server + client + admin preview share. */
export function calcPromoDiscount(
  code: PromoCode,
  ctx: PromoBookingContext & {
    subtotal: number;
    /** Venue-rental portion of the bill (pricing.baseCharge, incl. any
     *  peak surcharge). Basis for percentScope === 'rent' codes. When a
     *  caller can't supply it, rent-scoped % falls back to the full
     *  subtotal (never overcharges the discount base's cap below). */
    baseCharge?: number;
    /** Adult-equivalent (1 adult + 0.5 × children). Used for per_pax. */
    adultEquiv: number;
    /** Cost of the drinks add-on already in the cart (0 if none). Used
     *  for free_drinks to know how much to discount. */
    drinksCost: number;
    /** Venue the customer is booking — checked against `code.venueIds`
     *  when the code is scoped to specific branches. */
    venueId?: string;
  },
): PromoDiscount | null {
  if (!code.enabled) return null;
  // Window check.
  const todayStr = hkTodayYmd();
  if (code.startDate && todayStr < code.startDate) return null;
  if (code.endDate && todayStr > code.endDate) return null;

  if (promoEligibilityReason(code, ctx)) return null;

  // Minimum subtotal check (cash type).
  if (code.type === 'cash' && code.minSubtotal && ctx.subtotal < code.minSubtotal) {
    return null;
  }

  let amount = 0;
  // Free drinks fires either when the primary type is free_drinks OR
  // when the orthogonal `freeDrinks` flag was set as a combo with a
  // monetary type.
  let freeDrinks = code.type === 'free_drinks' || code.freeDrinks === true;

  switch (code.type) {
    case 'percent': {
      const pct = Math.max(0, Math.min(100, code.percent || 0));
      // 'rent' scope discounts the venue-rental portion only — food &
      // drinks add-ons keep full price.
      const base = code.percentScope === 'rent'
        ? Math.min(ctx.baseCharge ?? ctx.subtotal, ctx.subtotal)
        : ctx.subtotal;
      amount = Math.round((pct / 100) * base);
      break;
    }
    case 'cash': {
      amount = Math.max(0, code.amount || 0);
      break;
    }
    case 'per_pax': {
      const perPax = Math.max(0, code.amount || 0);
      amount = Math.round(perPax * ctx.adultEquiv);
      break;
    }
    case 'free_drinks': {
      amount = Math.max(0, ctx.drinksCost);
      break;
    }
  }

  // Stack the drinks-cost discount on top of the monetary discount when
  // the combo flag is on (not already done by the free_drinks case).
  if (freeDrinks && code.type !== 'free_drinks') {
    amount += Math.max(0, ctx.drinksCost);
  }

  // Cap discount to subtotal so we never go negative.
  amount = Math.min(amount, ctx.subtotal);

  return {
    amount,
    freeDrinks,
    codeId: code.id,
    code: code.code,
    type: code.type,
  };
}
