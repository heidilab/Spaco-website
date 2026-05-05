/**
 * Admin helper — list every lock visible to the configured TTLock account.
 * Use this once at setup time to find the `lockId` for each branch's door,
 * then paste those numbers into Admin → 內容管理 → 文字內容 → 系統設定.
 *
 *   GET /api/admin/ttlock/locks
 *
 * Returns: [{ lockId, lockAlias, lockName, lockMac }, …]
 */

import { NextRequest, NextResponse } from 'next/server';
import { listLocks, isTTLockConfigured } from '@/lib/ttlock';
import { adminVerifyIdToken, adminUserHasContentPerm } from '@/lib/adminAuth';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    return NextResponse.json({ error: 'missing-token' }, { status: 401 });
  }
  let uid: string;
  try {
    uid = (await adminVerifyIdToken(token)).uid;
  } catch {
    return NextResponse.json({ error: 'invalid-token' }, { status: 401 });
  }
  if (!(await adminUserHasContentPerm(uid))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  if (!isTTLockConfigured()) {
    return NextResponse.json(
      { error: 'ttlock-not-configured', message: 'Set TTLOCK_* env vars on Vercel' },
      { status: 400 },
    );
  }

  try {
    const locks = await listLocks();
    return NextResponse.json({ locks });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
