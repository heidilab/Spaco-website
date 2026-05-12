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

// ───── Pure pricing logic (no Firestore) — shared with server validator ─────

/** Compute the HK$ value of a promo code applied to a given booking
 *  context. Returns null if the code can't be applied (e.g. minSubtotal
 *  not met). Pure function so server + client + admin preview share. */
export function calcPromoDiscount(
  code: PromoCode,
  ctx: {
    subtotal: number;
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
  const todayStr = new Date().toISOString().slice(0, 10);
  if (code.startDate && todayStr < code.startDate) return null;
  if (code.endDate && todayStr > code.endDate) return null;

  // Branch scope check — empty / undefined venueIds = applies to every
  // branch. Otherwise the booking's venueId must be in the allowlist.
  if (code.venueIds && code.venueIds.length > 0) {
    if (!ctx.venueId || !code.venueIds.includes(ctx.venueId)) return null;
  }

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
      amount = Math.round((pct / 100) * ctx.subtotal);
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
