// Server loader for the 附加服務管理 settings (see lib/addOnConfig).
//
// API routes that price a booking (create / modify / confirm) await this
// first, so the server charges the same prices the customer was shown and
// refuses add-ons staff have switched off. Cached briefly per instance.

import { adminDb } from './firebaseAdmin';
import { sanitizeAddOnConfig, setAddOnConfig, type AddOnConfig } from './addOnConfig';

const TTL_MS = 30_000;
let cached: { at: number; config: AddOnConfig } | null = null;

export async function loadAddOnConfigServer(force = false): Promise<AddOnConfig> {
  if (!force && cached && Date.now() - cached.at < TTL_MS) {
    setAddOnConfig(cached.config);
    return cached.config;
  }
  try {
    const snap = await adminDb.collection('site_content').doc('addons').get();
    const config = sanitizeAddOnConfig(snap.exists ? snap.data()?.items : null);
    cached = { at: Date.now(), config };
    setAddOnConfig(config);
    return config;
  } catch (err) {
    // Keep whatever was active (the last good settings, or the built-in
    // catalog) rather than fail a booking over a settings read.
    console.warn('[addOnConfig] server load failed:', err);
    return cached?.config ?? {};
  }
}

/** Drop the cache after staff save new settings. */
export function invalidateAddOnConfigCache(): void {
  cached = null;
}
