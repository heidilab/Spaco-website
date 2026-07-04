import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/admin/sync-promo-freedrinks-cost
 *   { dryRun?: boolean }   // default true
 *
 * Backfills `promoFreeDrinksCost` on every booking whose promo code is
 * a `free_drinks` type, so it equals the booking's `promoDiscount`.
 *
 * Why: `updateBookingDateTime`'s promo-recompute logic uses
 * `promoFreeDrinksCost > 0` as the marker for "this booking has a
 * free_drinks promo, scale the discount with pax on admin edit". If
 * promoFreeDrinksCost is missing / stale / out of sync with
 * promoDiscount, the recompute either skips entirely or uses the
 * wrong baseline. Legacy bookings (pre-cleanup-fix patch) only had
 * promoDiscount updated, leaving promoFreeDrinksCost drifted.
 *
 * This route reads every promo_codes doc once (caches the type
 * lookup), then sweeps bookings. For free_drinks bookings where
 * promoFreeDrinksCost !== promoDiscount, sets them equal.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { dryRun?: boolean };
  const dryRun = body.dryRun !== false;

  // Load promo_codes lookup → which codeIds are free_drinks type.
  const promoSnap = await adminDb.collection('promo_codes').get();
  const freeDrinksCodeIds = new Set<string>();
  for (const doc of promoSnap.docs) {
    const d = doc.data() as { type?: string; freeDrinks?: boolean };
    if (d.type === 'free_drinks' || d.freeDrinks === true) {
      freeDrinksCodeIds.add(doc.id);
    }
  }

  // Sweep bookings.
  const all = await adminDb.collection('bookings').get();
  const patched: Array<Record<string, unknown>> = [];
  const skipped: Array<Record<string, unknown>> = [];
  for (const doc of all.docs) {
    const b = doc.data() as {
      promoCode?: string;
      promoCodeId?: string;
      promoDiscount?: number;
      promoFreeDrinksCost?: number;
      status?: string;
    };
    if (!b.promoCodeId || !freeDrinksCodeIds.has(b.promoCodeId)) continue;
    const promoDiscount = b.promoDiscount ?? 0;
    if (promoDiscount <= 0) continue;
    const storedFreeDrinksCost = b.promoFreeDrinksCost;
    if (storedFreeDrinksCost === promoDiscount) {
      skipped.push({
        id: doc.id.slice(0, 8),
        promoCode: b.promoCode,
        promoDiscount,
        promoFreeDrinksCost: storedFreeDrinksCost,
        reason: 'already in sync',
      });
      continue;
    }
    patched.push({
      id: doc.id.slice(0, 8),
      fullId: doc.id,
      promoCode: b.promoCode,
      promoDiscount,
      from: storedFreeDrinksCost ?? null,
      to: promoDiscount,
    });
    if (!dryRun) {
      await adminDb.collection('bookings').doc(doc.id).update({
        promoFreeDrinksCost: promoDiscount,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }
  return NextResponse.json({
    ok: true,
    dryRun,
    patchedCount: patched.length,
    alreadyInSyncCount: skipped.length,
    patched,
  });
}
