import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { buildAuthUrl } from '@/lib/msgraph';

export const runtime = 'nodejs';

// GET /api/onedrive/auth → Microsoft sign-in URL (後台 OneDrive 連結 redirects there).
export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req, 'staff');
  if (!gate.ok) return gate.res;
  try {
    return NextResponse.json({ url: buildAuthUrl(`${req.nextUrl.origin}/api/onedrive/callback`) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'auth url failed' }, { status: 500 });
  }
}
