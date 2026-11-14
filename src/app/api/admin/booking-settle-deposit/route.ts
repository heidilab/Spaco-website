import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { settleDepositServer } from '@/lib/bookingLifecycle';

export const runtime = 'nodejs';

/**
 * POST /api/admin/booking-settle-deposit
 *   { bookingId, deductions: [{label, amount}], mode?: 'settle' | 'amend' | 'recover-points', actorEmail? }
 *
 * Deposit settlement in one transaction (site review 2026-11-13, phase
 * 5, #21): refund, deductions, the amount still owed, the status and the
 * loyalty points together; points for an overflow wait until it is paid.
 */
export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req, 'bookings');
  if (!gate.ok) return gate.res;
  const body = await req.json().catch(() => ({})) as { bookingId?: string; deductions?: unknown; mode?: string; actorEmail?: string };
  if (!body.bookingId) return NextResponse.json({ error: 'bookingId required' }, { status: 400 });
  const mode = body.mode === 'amend' || body.mode === 'recover-points' ? body.mode : 'settle';
  try {
    const result = await settleDepositServer(body.bookingId, body.deductions ?? [], { uid: gate.uid, email: typeof body.actorEmail === 'string' ? body.actorEmail.slice(0, 200) : undefined }, mode);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'failed';
    const known = ['BOOKING_NOT_FOUND', 'ALREADY_SETTLED', 'NOT_SETTLED', 'EVENT_NOT_ENDED', 'USER_NOT_FOUND'];
    return NextResponse.json({ error: msg }, { status: msg === 'BOOKING_NOT_FOUND' ? 404 : known.includes(msg) ? 400 : 500 });
  }
}
