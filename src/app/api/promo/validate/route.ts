import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { calcPromoDiscount } from '@/lib/promoCodes';
import type { PromoCode } from '@/types';

export const runtime = 'nodejs';

// POST /api/promo/validate { code, subtotal, adultEquiv, drinksCost, userId }
//
// Server-side validation — keeps the promo catalog opaque (the client
// never gets a list of codes). Returns the resolved discount or a
// reason why the code can't be used.

interface ValidateBody {
  code?: string;
  subtotal?: number;
  adultEquiv?: number;
  drinksCost?: number;
  userId?: string;
  /** Booking venue id — required when the code is branch-scoped, otherwise
   *  ignored. Promos with no `venueIds` field apply to every branch. */
  venueId?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body: ValidateBody = await req.json();
    const codeText = (body.code || '').trim().toUpperCase();
    if (!codeText) {
      return NextResponse.json({ valid: false, reason: 'missing' }, { status: 400 });
    }
    const subtotal = Math.max(0, body.subtotal || 0);
    const adultEquiv = Math.max(0, body.adultEquiv || 1);
    const drinksCost = Math.max(0, body.drinksCost || 0);

    const snap = await adminDb
      .collection('promo_codes')
      .where('code', '==', codeText)
      .limit(1)
      .get();

    if (snap.empty) {
      return NextResponse.json({ valid: false, reason: 'not_found' });
    }
    const doc = snap.docs[0];
    const code = { id: doc.id, ...doc.data() } as PromoCode;

    if (!code.enabled) {
      return NextResponse.json({ valid: false, reason: 'disabled' });
    }

    // Window check + minSubtotal check + venue scope are all inside calcPromoDiscount.
    const discount = calcPromoDiscount(code, { subtotal, adultEquiv, drinksCost, venueId: body.venueId });
    if (!discount) {
      // Determine specific reason for clearer UI message.
      const todayStr = new Date().toISOString().slice(0, 10);
      if (code.startDate && todayStr < code.startDate) {
        return NextResponse.json({ valid: false, reason: 'not_started', startDate: code.startDate });
      }
      if (code.endDate && todayStr > code.endDate) {
        return NextResponse.json({ valid: false, reason: 'expired', endDate: code.endDate });
      }
      if (code.venueIds && code.venueIds.length > 0 && (!body.venueId || !code.venueIds.includes(body.venueId))) {
        return NextResponse.json({ valid: false, reason: 'wrong_venue', venueIds: code.venueIds });
      }
      if (code.type === 'cash' && code.minSubtotal && subtotal < code.minSubtotal) {
        return NextResponse.json({ valid: false, reason: 'min_subtotal', minSubtotal: code.minSubtotal });
      }
      return NextResponse.json({ valid: false, reason: 'unknown' });
    }

    // Total usage cap check.
    if (code.totalUsageLimit != null && code.totalUsageCount >= code.totalUsageLimit) {
      return NextResponse.json({ valid: false, reason: 'sold_out' });
    }

    // Per-user usage cap — count completed bookings by this user with
    // this code. Skipped when no userId given (public preview).
    if (code.perUserLimit != null && body.userId) {
      const usage = await adminDb
        .collection('bookings')
        .where('userId', '==', body.userId)
        .where('promoCodeId', '==', code.id)
        .where('promoRedeemedAt', '!=', null)
        .count()
        .get();
      const count = usage.data().count;
      if (count >= code.perUserLimit) {
        return NextResponse.json({ valid: false, reason: 'per_user_limit', perUserLimit: code.perUserLimit });
      }
    }

    return NextResponse.json({
      valid: true,
      codeId: code.id,
      code: code.code,
      type: code.type,
      amount: discount.amount,
      freeDrinks: discount.freeDrinks,
      description: code.description || null,
    });
  } catch (err) {
    return NextResponse.json(
      { valid: false, reason: 'error', error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
