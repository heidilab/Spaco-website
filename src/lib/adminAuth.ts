/**
 * Server-side admin authentication helpers — used by API routes that need
 * to verify the caller is a logged-in admin.
 *
 * Pattern: client passes the Firebase ID token in `Authorization: Bearer …`,
 * server verifies it with the Admin SDK, then checks the staff role from
 * the `admin_users` Firestore collection.
 */

import 'server-only';
import { getAuth } from 'firebase-admin/auth';
import { adminDb } from './firebaseAdmin';
import { ROLE_PERMISSIONS } from '@/types';

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
