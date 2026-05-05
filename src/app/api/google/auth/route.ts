import { NextRequest, NextResponse } from 'next/server';
import { buildAuthUrl } from '@/lib/googleCalendar';

// GET /api/google/auth → returns the Google OAuth consent URL
// (the admin page redirects to this URL).
export async function GET(req: NextRequest) {
  try {
    const origin = req.nextUrl.origin;
    const redirectUri = `${origin}/api/google/callback`;
    // Simple state for CSRF protection — page round-trips it back.
    const state = Math.random().toString(36).slice(2);
    const url = buildAuthUrl(redirectUri, state);
    return NextResponse.json({ url, state });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to build auth URL' },
      { status: 500 },
    );
  }
}
