import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { processBookingForLockAccess } from '@/lib/lockPasscode';
import { requireCronSecret } from '@/lib/adminAuth';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * GET /api/admin/sweep-lock-passcodes?days=7&apply=true
 *
 * Replicates the daily cron's behaviour on demand, restricted to the
 * next `days` (default 7). Returns the ProcessResult for every
 * confirmed booking in the window, so we can see which ones the
 * regular cron skipped or errored on.
 *
 *  - apply=false (default) → reports current lockPasscode status only,
 *                            no generation
 *  - apply=true            → actually runs processBookingForLockAccess
 *                            on each (idempotent: bails on
 *                            passcode-exists)
 */
export async function GET(req: NextRequest) {
  const _gate = requireCronSecret(req);
  if (_gate) return _gate;

  const apply = req.nextUrl.searchParams.get('apply') === 'true';
  const days = parseInt(req.nextUrl.searchParams.get('days') || '7', 10);
  const now = Date.now();
  const ymdInHkt = (ms: number) => {
    const d = new Date(ms + 8 * 60 * 60 * 1000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  };
  const fromYmd = ymdInHkt(now);
  const toYmd = ymdInHkt(now + days * 24 * 60 * 60 * 1000);

  const snap = await adminDb
    .collection('bookings')
    .where('status', '==', 'confirmed')
    .where('date', '>=', fromYmd)
    .where('date', '<=', toYmd)
    .get();

  const rows: Array<Record<string, unknown>> = [];
  for (const doc of snap.docs) {
    const b = doc.data() as {
      venueId?: string; date?: string; startTime?: string;
      balanceDue?: number;
      lockPasscode?: { passcode?: string; source?: string };
    };
    const hasPasscode = !!b.lockPasscode?.passcode;
    const row: Record<string, unknown> = {
      id: doc.id.slice(0, 8),
      fullId: doc.id,
      venueId: b.venueId,
      date: b.date,
      startTime: b.startTime,
      balanceDue: b.balanceDue ?? 0,
      hasPasscodeBefore: hasPasscode,
    };
    if (apply) {
      try {
        const result = await processBookingForLockAccess(doc.id);
        row.processResult = result;
      } catch (err) {
        row.processError = err instanceof Error ? err.message : String(err);
      }
    }
    rows.push(row);
  }
  return NextResponse.json({
    fromYmd, toYmd,
    scanned: rows.length,
    rows,
  });
}
