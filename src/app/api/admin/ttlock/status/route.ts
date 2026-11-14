import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { adminDb } from '@/lib/firebaseAdmin';
import {
  isTTLockConfigured, ttlockEnvStatus, testTTLockConnection, testLockRoundTrip, listLocks, cachedTokenInfo, type TTLockListedLock,
} from '@/lib/ttlock';
import { getVenueLockMap, sweepUpcomingBookings, upcomingLockReport } from '@/lib/lockPasscode';
import { loadAllVenuesServer } from '@/lib/venueRegistryServer';
import { getSiteContent } from '@/lib/content';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * The 門鎖設定 page's data (GET) and buttons (POST). Admin only.
 *
 * GET  → environment (names only), the token this process holds, the
 *        account's locks (live), every venue with its lock settings and
 *        whether that lock is in the account, the legacy 系統設定 slots,
 *        the last sweep, and the next days' bookings.
 * POST { action: 'test-connection' }           → log in afresh + list locks
 *      { action: 'test-lock', venueId }         → add + delete a 10-minute code
 *      { action: 'run-sweep' }                  → the 09:00 sweep, now
 */
export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req, 'staff');
  if (!gate.ok) return gate.res;

  const configured = isTTLockConfigured();
  let locks: TTLockListedLock[] = [];
  let locksError: string | undefined;
  if (configured) {
    try { locks = await listLocks(200); } catch (err) { locksError = err instanceof Error ? err.message : String(err); }
  }
  const byId = new Map(locks.map((l) => [l.lockId, l]));

  const venues = (await loadAllVenuesServer()).map((v) => {
    const parsed = parseInt(String(v.ttlockLockId || '').trim(), 10);
    const lockId = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    const lock = lockId ? byId.get(lockId) : undefined;
    return {
      id: v.id, name: v.name, branchKey: v.branchKey || v.id, branchName: v.branchName || v.name, roomLabel: v.roomLabel,
      active: v.active !== false, sortOrder: v.sortOrder ?? 99,
      ttlockLockId: lockId, lockGuideUrl: v.lockGuideUrl || '', lockConfirmKey: v.lockConfirmKey || '',
      inAccount: lockId ? !!lock : null,
      lockAlias: lock?.lockAlias || lock?.lockName || null,
      battery: lock?.electricQuantity ?? null,
      hasGateway: lock?.hasGateway ?? null,
    };
  });

  // Legacy 系統設定 slots still in use (lock id or guide image).
  const legacy: Record<string, { lockId?: number; guideUrl?: string }> = {};
  try {
    const cms = await getSiteContent('settings');
    for (const [k, v] of Object.entries(cms || {})) {
      const val = ((v as { zh?: string; en?: string })?.zh || (v as { zh?: string; en?: string })?.en || '').trim();
      if (!val) continue;
      if (k.startsWith('ttlock_')) { const id = parseInt(val, 10); if (Number.isFinite(id) && id > 0) legacy[k.slice(7)] = { ...(legacy[k.slice(7)] || {}), lockId: id }; }
      if (k.startsWith('lockguide_')) legacy[k.slice(10)] = { ...(legacy[k.slice(10)] || {}), guideUrl: val };
    }
  } catch { /* settings unreadable */ }

  const effective = await getVenueLockMap();
  const statusSnap = await adminDb.collection('system').doc('ttlock_status').get();
  const lastRun = statusSnap.exists ? statusSnap.data() : null;
  const upcoming = await upcomingLockReport();

  return NextResponse.json({
    configured,
    env: ttlockEnvStatus(),
    token: cachedTokenInfo(),
    locks, locksError,
    venues, legacy, effective,
    lastRun: lastRun ? { ...lastRun, lastRunAt: (lastRun.lastRunAt as { toMillis?: () => number })?.toMillis?.() ?? null } : null,
    upcoming,
  });
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req, 'staff');
  if (!gate.ok) return gate.res;
  const body = await req.json().catch(() => ({})) as { action?: string; venueId?: string };

  if (body.action === 'test-connection') {
    const out = await testTTLockConnection();
    return NextResponse.json(out);
  }
  if (body.action === 'test-lock') {
    if (!body.venueId) return NextResponse.json({ error: 'venueId required' }, { status: 400 });
    const map = await getVenueLockMap();
    const lockId = map[body.venueId];
    if (!lockId) return NextResponse.json({ ok: false, error: 'no-lockid' });
    const out = await testLockRoundTrip(lockId);
    return NextResponse.json({ ...out, lockId });
  }
  if (body.action === 'run-sweep') {
    const summary = await sweepUpcomingBookings();
    return NextResponse.json({ ok: true, ...summary });
  }
  return NextResponse.json({ error: 'unknown-action' }, { status: 400 });
}
