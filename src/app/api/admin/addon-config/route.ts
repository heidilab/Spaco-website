import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebaseAdmin';
import { requireAdmin } from '@/lib/adminAuth';
import { PRICE_EDITABLE_ADDON_IDS, sanitizeAddOnConfig, type AddOnConfig } from '@/lib/addOnConfig';
import { invalidateAddOnConfigCache } from '@/lib/addOnConfigServer';
import { addOnSelectionTotal, addOnUnitPrice } from '@/lib/pricing';
import { loadAllVenuesServer } from '@/lib/venueRegistryServer';
import type { AddOnOptions } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Entry = { id: string; quantity: number; options?: AddOnOptions };

/** The part of the settings that decides what 到會 / 水煙 cost. */
const cateringPricing = (c: AddOnConfig) => JSON.stringify([
  c.catering?.dishes?.map((d) => [d.code, d.category, d.price ?? null]) ?? null,
  c.catering?.tierPrices ?? null, c.catering?.extraDishFee ?? null, c.catering?.doorstepFee ?? null,
]);
const shishaPricing = (c: AddOnConfig) => JSON.stringify(c.shisha?.shishaPrices ?? null);

/**
 * Save the 附加服務管理 settings (availability, branches, prices, menus).
 *
 * A PRICE change must only apply to bookings made from now on. Bookings
 * made since this feature shipped carry the price they were sold at
 * (AddOnOptions.unitPrice, or soldTotal for 到會 / 水煙); older ones do
 * not. So before a changed price is saved, every existing booking that
 * has that add-on without a stamped price gets the OLD price stamped on
 * it. After that a later staff edit of the booking keeps what the
 * customer agreed to, and month close keeps the money in the same column.
 *
 * POST { items } → { ok, items, lockedBookings }
 */
export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req, 'staff');
  if (!gate.ok) return gate.res;

  let body: { items?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 }); }
  const next = sanitizeAddOnConfig(body.items);

  const ref = adminDb.collection('site_content').doc('addons');
  const before: AddOnConfig = sanitizeAddOnConfig((await ref.get()).data()?.items);

  // Which add-ons change price at which venue?
  const venues = await loadAllVenuesServer();
  const oldPrice = new Map<string, number>(); // `${addOnId}|${venueId}` → price before
  const changedIds = new Set<string>();
  for (const id of PRICE_EDITABLE_ADDON_IDS) {
    for (const venue of venues) {
      const was = addOnUnitPrice(id, venue, before);
      oldPrice.set(`${id}|${venue.id}`, was);
      if (was !== addOnUnitPrice(id, venue, next)) changedIds.add(id);
    }
  }
  // 到會 / 水煙 are sold as a total for the selection.
  const totalIds = new Set<string>();
  if (cateringPricing(before) !== cateringPricing(next)) totalIds.add('catering');
  if (shishaPricing(before) !== shishaPricing(next)) totalIds.add('shisha');

  // Lock the old price onto existing bookings that have no stamped price.
  let lockedBookings = 0;
  if (changedIds.size > 0 || totalIds.size > 0) {
    const snap = await adminDb.collection('bookings').get();
    let batch = adminDb.batch();
    let pending = 0;
    for (const doc of snap.docs) {
      const data = doc.data() as { addOns?: Entry[]; venueId?: string; packageSlug?: string };
      if (!Array.isArray(data.addOns) || !data.venueId) continue;
      let touched = false;
      const addOns = data.addOns.map((a) => {
        if (totalIds.has(a.id) && typeof a.options?.soldTotal !== 'number') {
          touched = true;
          return { ...a, options: { ...(a.options || {}), soldTotal: addOnSelectionTotal(a, before) } };
        }
        // Package add-ons are priced by the package, not the catalog.
        if (data.packageSlug || !changedIds.has(a.id) || typeof a.options?.unitPrice === 'number') return a;
        const price = oldPrice.get(`${a.id}|${data.venueId}`);
        if (typeof price !== 'number') return a;
        touched = true;
        return { ...a, options: { ...(a.options || {}), unitPrice: price } };
      });
      if (!touched) continue;
      batch.update(doc.ref, { addOns });
      lockedBookings++;
      if (++pending >= 400) { await batch.commit(); batch = adminDb.batch(); pending = 0; }
    }
    if (pending > 0) await batch.commit();
  }

  await ref.set({ items: next, updatedAt: FieldValue.serverTimestamp(), updatedBy: gate.uid });
  invalidateAddOnConfigCache();
  return NextResponse.json({ ok: true, items: next, lockedBookings });
}
