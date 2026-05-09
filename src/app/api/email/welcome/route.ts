import { NextRequest, NextResponse } from 'next/server';
import { buildWelcomeEmail } from '@/lib/email';
import { sendAutomatedEmail } from '@/lib/emailAutomations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Welcome email — fired from the client right after first sign-up.
 * Idempotent at the call-site (auth.ts only fires it for new docs).
 */
export async function POST(req: NextRequest) {
  try {
    const { to, customerName } = await req.json();
    if (!to) return NextResponse.json({ error: 'to required' }, { status: 400 });
    const tpl = buildWelcomeEmail({ customerName: customerName || 'there' });
    await sendAutomatedEmail({ automationKey: 'welcome', to, subject: tpl.subject, html: tpl.html });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[welcome] failed:', err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
