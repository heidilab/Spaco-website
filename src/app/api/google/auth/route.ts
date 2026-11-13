import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { buildAuthUrl } from '@/lib/googleCalendar';
import { requireAdmin } from '@/lib/adminAuth';

export const runtime = 'nodejs';

// GET /api/google/auth → the Google OAuth consent URL for the admin
// calendar-sync page. Staff only (gcal permission), and the `state` is
// kept in an HttpOnly cookie that the callback must match — before
// 2026-11-13 anyone could run the flow and replace the stored business
// token (site review #3).
export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req, 'gcal');
  if (!gate.ok) return gate.res;
  try {
    const origin = req.nextUrl.origin;
    const redirectUri = `${origin}/api/google/callback`;
    const state = randomBytes(16).toString('hex');
    const url = buildAuthUrl(redirectUri, state);
    const res = NextResponse.json({ url });
    res.cookies.set('gcal_oauth_state', state, {
      httpOnly: true,
      secure: origin.startsWith('https://'),
      sameSite: 'lax',
      path: '/api/google/callback',
      maxAge: 600,
    });
    return res;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to build auth URL' },
      { status: 500 },
    );
  }
}
