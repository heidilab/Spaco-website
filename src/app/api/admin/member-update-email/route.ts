import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebaseAdmin';
import { requireAdmin } from '@/lib/adminAuth';
import { normalizeMemberEmail } from '@/lib/memberEmail';

export const runtime = 'nodejs';

/**
 * POST /api/admin/member-update-email { uid, email }
 *
 * Staff correction of a member's email address (會員管理 → 電郵), for the
 * case where the customer mistyped it at sign-up (e.g. `yahoo.com.hj`)
 * and therefore receives none of the booking / passcode / reminder emails.
 *
 * Every customer-facing email is addressed to `users/{uid}.email` at send
 * time, so updating the profile is what actually fixes delivery. Bookings
 * do not carry a copy of the email, so there is nothing to cascade.
 *
 * The Firebase Auth record is updated too so that the account's sign-in
 * identity matches the corrected address. If Auth refuses (most commonly
 * `email-already-exists` because the customer later created a second
 * account with the right spelling), the profile fix is kept and the Auth
 * error is reported back so staff can decide how to merge/handle it.
 *
 * Needs the `members` permission (admin + cs).
 */
export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req, 'members');
  if (!gate.ok) return gate.res;

  let body: { uid?: unknown; email?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid-json' }, { status: 400 });
  }

  const uid = typeof body.uid === 'string' ? body.uid.trim() : '';
  if (!uid) return NextResponse.json({ error: 'Missing uid' }, { status: 400 });

  const email = normalizeMemberEmail(body.email);
  if (!email) return NextResponse.json({ error: 'invalid-email' }, { status: 400 });

  const userRef = adminDb.collection('users').doc(uid);
  const snap = await userRef.get();
  if (!snap.exists) return NextResponse.json({ error: 'Member not found' }, { status: 404 });

  const previousEmail = typeof snap.data()?.email === 'string' ? (snap.data()!.email as string) : null;
  if (previousEmail && previousEmail.toLowerCase() === email) {
    return NextResponse.json({ ok: true, email, unchanged: true, authUpdated: false });
  }

  await userRef.update({
    email,
    updatedAt: FieldValue.serverTimestamp(),
    emailCorrectedAt: FieldValue.serverTimestamp(),
    emailCorrectedBy: gate.uid,
    emailCorrectedFrom: previousEmail,
  });

  let authUpdated = false;
  let authError: string | null = null;
  try {
    await getAuth().updateUser(uid, { email });
    authUpdated = true;
  } catch (err) {
    const code = (err as { code?: string } | undefined)?.code;
    authError = code || (err instanceof Error ? err.message : 'auth-update-failed');
    console.warn(`[member-update-email] auth update failed for ${uid}:`, authError);
  }

  return NextResponse.json({ ok: true, email, previousEmail, authUpdated, authError });
}
