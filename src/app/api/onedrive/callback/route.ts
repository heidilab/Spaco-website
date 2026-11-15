import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeAndStore, verifyState } from '@/lib/msgraph';

export const runtime = 'nodejs';

// GET /api/onedrive/callback?code=…&state=… — Microsoft lands here after
// Heidi signs in. The signed state proves WE started this sign-in, so a
// stranger cannot connect their own drive to the site.
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const adminPage = `${origin}/zh/admin/onedrive`;
  const code = req.nextUrl.searchParams.get('code');
  const error = req.nextUrl.searchParams.get('error');
  const desc = req.nextUrl.searchParams.get('error_description');
  if (error) return NextResponse.redirect(`${adminPage}?error=${encodeURIComponent(desc || error)}`);
  if (!code) return NextResponse.redirect(`${adminPage}?error=missing_code`);
  if (!verifyState(req.nextUrl.searchParams.get('state'))) return NextResponse.redirect(`${adminPage}?error=bad_state`);
  try {
    const { email } = await exchangeCodeAndStore(code, `${origin}/api/onedrive/callback`);
    return NextResponse.redirect(`${adminPage}?connected=1${email ? `&email=${encodeURIComponent(email)}` : ''}`);
  } catch (err) {
    return NextResponse.redirect(`${adminPage}?error=${encodeURIComponent(err instanceof Error ? err.message : 'oauth_failed')}`);
  }
}
