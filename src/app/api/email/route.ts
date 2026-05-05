import { NextRequest, NextResponse } from 'next/server';
import { sendEmail } from '@/lib/email';

export async function POST(request: NextRequest) {
  try {
    const { to, subject, html } = await request.json();

    if (!to || !subject || !html) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const result = await sendEmail({ to, subject, html });
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    console.error('Email API error:', err);
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 });
  }
}
