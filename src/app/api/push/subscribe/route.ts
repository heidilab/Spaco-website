import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { requireAdmin } from '@/lib/adminAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/push/subscribe — register this device for staff push
// notifications. Staff-only (any role holding `bookings`). Doc id is the
// endpoint hash so re-subscribing the same browser upserts.
// DELETE — remove this device's subscription (turn notifications off).

function endpointDocId(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('hex').slice(0, 40);
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req, 'bookings');
  if (!gate.ok) return gate.res;

  const body = await req.json().catch(() => null) as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
    email?: string;
  } | null;
  if (!body?.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return NextResponse.json({ error: 'invalid-subscription' }, { status: 400 });
  }

  await adminDb.collection('push_subscriptions').doc(endpointDocId(body.endpoint)).set({
    uid: gate.uid,
    email: body.email ?? null,
    endpoint: body.endpoint,
    keys: { p256dh: body.keys.p256dh, auth: body.keys.auth },
    userAgent: req.headers.get('user-agent') || null,
    createdAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const gate = await requireAdmin(req, 'bookings');
  if (!gate.ok) return gate.res;

  const body = await req.json().catch(() => null) as { endpoint?: string } | null;
  if (!body?.endpoint) {
    return NextResponse.json({ error: 'missing-endpoint' }, { status: 400 });
  }
  await adminDb.collection('push_subscriptions').doc(endpointDocId(body.endpoint)).delete();
  return NextResponse.json({ ok: true });
}
