import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { sendStaffPush } from '@/lib/webPushServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/push/test — sends a test push to every enrolled staff device.
// Used by the 發送測試通知 link in the admin sidebar to verify enrolment.
export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req, 'bookings');
  if (!gate.ok) return gate.res;

  await sendStaffPush({
    title: '🔔 SPACO 測試通知',
    body: '手機通知運作正常！新預訂 / 入數紙 / 供應商訂單都會推送到呢部裝置。',
    url: '/zh/admin/bookings',
    tag: 'test-push',
  });
  return NextResponse.json({ ok: true });
}
