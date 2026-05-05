import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeAndStore } from '@/lib/googleCalendar';

// GET /api/google/callback?code=...&state=...
// Google redirects here after the user grants consent. Exchange the code
// for a refresh token, persist it, then bounce the user back to the admin
// calendar-sync page.
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const error = req.nextUrl.searchParams.get('error');
  const origin = req.nextUrl.origin;
  const redirectUri = `${origin}/api/google/callback`;
  const adminPage = `${origin}/zh/admin/calendar-sync`;

  if (error) {
    return NextResponse.redirect(`${adminPage}?error=${encodeURIComponent(error)}`);
  }
  if (!code) {
    return NextResponse.redirect(`${adminPage}?error=missing_code`);
  }

  try {
    const { email } = await exchangeCodeAndStore(code, redirectUri);
    return NextResponse.redirect(
      `${adminPage}?connected=1${email ? `&email=${encodeURIComponent(email)}` : ''}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'oauth_exchange_failed';
    return NextResponse.redirect(`${adminPage}?error=${encodeURIComponent(msg)}`);
  }
}
