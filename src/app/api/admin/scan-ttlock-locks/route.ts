import { NextResponse } from 'next/server';
import { listLocks, isTTLockConfigured } from '@/lib/ttlock';
import { getVenueLockMap } from '@/lib/lockPasscode';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * GET /api/admin/scan-ttlock-locks
 *
 * Diagnostic — cross-reference our configured per-venue lockIds with
 * what TTLock says the account can access. Surfaces:
 *  - Locks visible to our TTLock account (id, name, alias)
 *  - Whether each `ttlock_<venueId>` config points to an
 *    accessible lock, missing one, or a wrong id
 *
 * Goal: explain why sw-a / sw-b / sw-ab passcodes silently fail to
 * generate (presumably because the lockId is for a lock OTHER than
 * the one the customer's email sends them to use).
 */
export async function GET() {
  if (!isTTLockConfigured()) {
    return NextResponse.json({
      ok: false,
      error: 'TTLock env vars not configured',
    });
  }

  let locks: Array<{ lockId: number; lockName?: string; lockAlias?: string; electricQuantity?: number; macAddress?: string }> = [];
  let listErr: string | null = null;
  try {
    locks = await listLocks(200);
  } catch (err) {
    listErr = err instanceof Error ? err.message : String(err);
  }

  // Built-in helper from lockPasscode reads the same `ttlock_` prefix
  // the cron uses, so this map matches what the real code sees.
  let configured: Record<string, number> = {};
  try {
    configured = await getVenueLockMap();
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'config-read-failed' });
  }

  const accessibleIds = new Set(locks.map((l) => l.lockId));
  const venueStatus = Object.entries(configured).map(([venueId, lockId]) => ({
    venueId,
    configuredLockId: lockId,
    isAccessible: accessibleIds.has(lockId),
    matchedLock: locks.find((l) => l.lockId === lockId) || null,
  }));

  return NextResponse.json({
    ok: true,
    listErr,
    configuredVenueCount: venueStatus.length,
    accessibleLockCount: locks.length,
    venueStatus,
    allLocks: locks.map((l) => ({
      lockId: l.lockId,
      lockName: l.lockName,
      lockAlias: l.lockAlias,
      battery: l.electricQuantity,
      mac: l.macAddress,
    })),
  });
}
