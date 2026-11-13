import { NextRequest, NextResponse } from 'next/server';
import { buildWelcomeEmail } from '@/lib/email';
import { sendAutomatedEmail } from '@/lib/emailAutomations';
import { adminVerifyIdToken } from '@/lib/adminAuth';
import { adminDb } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Welcome email — fired from the client right after first sign-up.
 * Idempotent at the call-site (auth.ts only fires it for new docs).
 * The address comes from the signed-in user's own profile, never from
 * the request body (site review 2026-11-13 #11: it sent to any `to`).
 */
export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) return NextResponse.json({ error: 'missing-token' }, { status: 401 });
    let uid: string;
    try { uid = (await adminVerifyIdToken(token)).uid; } catch { return NextResponse.json({ error: 'invalid-token' }, { status: 401 }); }
    const userSnap = await adminDb.collection('users').doc(uid).get();
    const user = userSnap.exists ? (userSnap.data() as { email?: string; displayName?: string }) : null;
    if (!user?.email) return NextResponse.json({ ok: true, skipped: 'no email' });
    const tpl = buildWelcomeEmail({ customerName: user.displayName || user.email.split('@')[0] || 'there' });
    await sendAutomatedEmail({ automationKey: 'welcome', to: user.email, subject: tpl.subject, html: tpl.html });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[welcome] failed:', err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
