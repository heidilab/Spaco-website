// Server loader for the package registry (lib/packages). The create
// route awaits this before pricing a package booking, so the server sells
// the package the customer was shown in 套餐管理's current form. Cached
// briefly per instance.

import { adminDb } from './firebaseAdmin';
import { sanitizePackages, setPackageRegistry, type EventPackage } from './packages';

const TTL_MS = 30_000;
let cached: { at: number; list: EventPackage[] | null } | null = null;

export async function loadPackagesServer(force = false): Promise<EventPackage[] | null> {
  if (!force && cached && Date.now() - cached.at < TTL_MS) {
    setPackageRegistry(cached.list);
    return cached.list;
  }
  try {
    const snap = await adminDb.collection('site_content').doc('packages').get();
    const list = snap.exists ? sanitizePackages(snap.data()?.items) : null;
    cached = { at: Date.now(), list };
    setPackageRegistry(list);
    return list;
  } catch (err) {
    // Keep whatever was active (the last good list, or the coded one).
    console.warn('[packages] server load failed:', err);
    return cached?.list ?? null;
  }
}

export function invalidatePackagesCache(): void {
  cached = null;
}
