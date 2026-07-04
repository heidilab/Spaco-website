import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { isTTLockConfigured } from '@/lib/ttlock';

export const runtime = 'nodejs';

/**
 * GET /api/admin/scan-lock-config
 *
 * Dump TTLock setup for diagnostics:
 *  - Per-venue lockId mapping (from site_content/settings `lock_<venueId>`)
 *  - Per-venue lock-guide image (from `lockguide_<venueId>`)
 *  - Global TTLock env-var readiness
 *
 * Surfaces the "ALL sw-a bookings fail to generate passcode" class of
 * bug: usually means `lock_sw-a` is missing / blank / non-numeric in
 * the admin CMS settings.
 */
export async function GET() {
  const settingsSnap = await adminDb.collection('site_content').doc('settings').get();
  // site_content uses a nested `sections` map (see lib/content.ts
  // getSiteContent). Top-level only carries updatedAt / updatedBy /
  // sections itself — the actual `lock_<venueId>` entries live inside
  // sections.
  const docData = settingsSnap.exists ? settingsSnap.data() : null;
  const raw = (docData?.sections || {}) as Record<string, { zh?: string; en?: string } | undefined>;

  const lockIds: Record<string, { rawValue: string; parsed: number | null; ok: boolean }> = {};
  const lockGuides: Record<string, string> = {};
  const otherKeys: string[] = [];

  for (const [k, v] of Object.entries(raw || {})) {
    if (k.startsWith('lock_')) {
      const venueId = k.slice('lock_'.length);
      const value = (v?.zh || v?.en || '').trim();
      const parsed = parseInt(value, 10);
      lockIds[venueId] = {
        rawValue: value,
        parsed: Number.isFinite(parsed) ? parsed : null,
        ok: Number.isFinite(parsed) && parsed > 0,
      };
    } else if (k.startsWith('lockguide_')) {
      const venueId = k.slice('lockguide_'.length);
      lockGuides[venueId] = (v?.zh || v?.en || '').trim();
    } else {
      otherKeys.push(k);
    }
  }

  return NextResponse.json({
    ttlockGlobalConfigured: isTTLockConfigured(),
    lockIds,
    lockGuides,
    settingsDocExists: settingsSnap.exists,
    otherSettingsKeys: otherKeys.slice(0, 40),
    // Full sections dump for diagnostic — large but the customer-
    // facing /api routes are admin-only behind Firestore rules so OK.
    sectionsRaw: docData?.sections ?? null,
  });
}
