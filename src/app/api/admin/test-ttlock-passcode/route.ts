import { NextRequest, NextResponse } from 'next/server';
import { addKeyboardPasscode, deleteKeyboardPasscode } from '@/lib/ttlock';
import { getVenueLockMap } from '@/lib/lockPasscode';
import { requireCronSecret } from '@/lib/adminAuth';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * GET /api/admin/test-ttlock-passcode?venue=<venueId>
 *   omit venue → tests every configured venue
 *
 * Diagnostic — actually CALLS the TTLock add-passcode API for each
 * venue's lockId with a short-lived test passcode (valid for the next
 * 10 minutes), then immediately deletes it. Surfaces the real TTLock
 * errcode + errmsg so we can see why specific locks (sw-a / sw-b /
 * sw-ab) fail to generate while cwb works.
 *
 * Side effects:
 *  - Each successful test creates + immediately deletes a passcode
 *    named "SPACO-DIAG-<ts>" in the TTLock app
 *  - Failed tests leave nothing behind
 *  - No Firestore writes, no customer emails
 */
export async function GET(req: NextRequest) {
  const _gate = requireCronSecret(req);
  if (_gate) return _gate;

  const targetVenue = req.nextUrl.searchParams.get('venue');
  const lockMap = await getVenueLockMap();
  const targets = targetVenue
    ? (lockMap[targetVenue] ? [[targetVenue, lockMap[targetVenue]] as const] : [])
    : Object.entries(lockMap);

  const now = Date.now();
  const results: Array<Record<string, unknown>> = [];
  for (const [venueId, lockId] of targets) {
    const startMs = now + 60 * 60 * 1000;          // valid from +1h
    const endMs   = now + 70 * 60 * 1000;          // valid for 10 min
    const name    = `SPACO-DIAG-${Math.floor(now / 1000)}`;
    try {
      const { passcode, keyboardPwdId } = await addKeyboardPasscode({
        lockId,
        startMs,
        endMs,
        name,
      });
      // Immediately clean up so the lock app doesn't accumulate test
      // entries. Cleanup failures are non-fatal — log and move on.
      let cleanupErr: string | null = null;
      try {
        await deleteKeyboardPasscode({ lockId, keyboardPwdId });
      } catch (err) {
        cleanupErr = err instanceof Error ? err.message : String(err);
      }
      results.push({
        venueId,
        lockId,
        status: 'OK',
        passcode,
        keyboardPwdId,
        cleanupErr,
      });
    } catch (err) {
      results.push({
        venueId,
        lockId,
        status: 'FAIL',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return NextResponse.json({ tested: results.length, results });
}
