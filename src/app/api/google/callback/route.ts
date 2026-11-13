import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeAndStore } from '@/lib/googleCalendar';

export const runtime = 'nodejs';

// GET /api/google/callback?code=...&state=...
// Google redirects here after the user grants consent. The `state` must
// match the cookie /api/google/auth set for this browser (so only a flow
// a signed-in staff member started can store a token), then the code is
// exchanged for a refresh token and the user bounced back to the admin
// calendar-sync page.
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const error = req.nextUrl.searchParams.get('error');
  const origin = req.nextUrl.origin;
  const redirectUri = `${origin}/api/google/callback`;
  const adminPage = `${origin}/zh/admin/calendar-sync`;
  const expected = req.cookies.get('gcal_oauth_state')?.value;
  const done = (url: string) => {
    const res = NextResponse.redirect(url);
    res.cookies.set('gcal_oauth_state', '', { path: '/api/google/callback', maxAge: 0 });
    return res;
  };

  if (error) return done(`${adminPage}?error=${encodeURIComponent(error)}`);
  if (!code) return done(`${adminPage}?error=missing_code`);
  if (!expected || !state || state !== expected) return done(`${adminPage}?error=state_mismatch`);

  try {
    const { email } = await exchangeCodeAndStore(code, redirectUri);
    return done(`${adminPage}?connected=1${email ? `&email=${encodeURIComponent(email)}` : ''}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'oauth_exchange_failed';
    return done(`${adminPage}?error=${encodeURIComponent(msg)}`);
  }
}
