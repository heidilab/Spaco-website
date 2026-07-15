/**
 * Server-side admin authentication helpers — used by API routes that need
 * to verify the caller is a logged-in admin.
 *
 * Pattern: client passes the Firebase ID token in `Authorization: Bearer …`,
 * server verifies it with the Admin SDK, then checks the staff role from
 * the `admin_users` Firestore collection.
 */

import 'server-only';
import { NextResponse } from 'next/server';
import { getAuth } from 'firebase-admin/auth';
import { adminDb } from './firebaseAdmin';
import { ROLE_PERMISSIONS } from '@/types';

/**
 * Gate an API route on a logged-in staff member holding `perm`.
 * Returns `{ ok: true, uid }` or `{ ok: false, res }` — callers do:
 *   const gate = await requireAdmin(req);
 *   if (!gate.ok) return gate.res;
 * The client must send the Firebase ID token as `Authorization: Bearer …`
 * (use adminApiFetch on the client).
 */
export async function requireAdmin(
  req: Request,
  perm: 'bookings' | 'content' | 'gcal' | 'members' | 'deposit' = 'bookings',
): Promise<{ ok: true; uid: string } | { ok: false; res: NextResponse }> {
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    return { ok: false, res: NextResponse.json({ error: 'missing-token' }, { status: 401 }) };
  }
  let uid: string;
  try {
    const decoded = await adminVerifyIdToken(token);
    uid = decoded.uid;
  } catch {
    return { ok: false, res: NextResponse.json({ error: 'invalid-token' }, { status: 401 }) };
  }
  const role = await getStaffRoleAdmin(uid);
  const perms = role ? ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS] : null;
  if (!Array.isArray(perms) || !perms.includes(perm)) {
    return { ok: false, res: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  }
  return { ok: true, uid };
}

/**
 * Gate a manual/diagnostic route on the shared CRON_SECRET (sent as
 * `Authorization: Bearer <CRON_SECRET>`). For endpoints not driven by
 * the admin UI — closes them to the public without needing a Firebase
 * session. Returns null when authorized, or a 401 response.
 */
export function requireCronSecret(req: Request): NextResponse | null {
  const auth = req.headers.get('authorization') || '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}

/** Verify a Firebase ID token and return the decoded claims. Throws on
 *  invalid / expired tokens. */
export async function adminVerifyIdToken(idToken: string) {
  return getAuth().verifyIdToken(idToken);
}

/** Look up the staff role for a uid. Returns null if not an admin. */
export async function getStaffRoleAdmin(uid: string): Promise<string | null> {
  const snap = await adminDb.collection('admin_users').doc(uid).get();
  if (!snap.exists) return null;
  const data = snap.data();
  return (data?.role as string) || 'admin';
}

/** True iff the user has the `content` permission (Admin Content edit). */
export async function adminUserHasContentPerm(uid: string): Promise<boolean> {
  const role = await getStaffRoleAdmin(uid);
  if (!role) return false;
  const perms = ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS];
  return Array.isArray(perms) && perms.includes('content');
}

/** True iff the user has the `bookings` permission (manage bookings). */
export async function adminUserHasBookingsPerm(uid: string): Promise<boolean> {
  const role = await getStaffRoleAdmin(uid);
  if (!role) return false;
  const perms = ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS];
  return Array.isArray(perms) && perms.includes('bookings');
}
