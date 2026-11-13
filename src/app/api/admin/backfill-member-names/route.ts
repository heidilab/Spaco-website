import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebaseAdmin';
import { requireAdmin } from '@/lib/adminAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Fill in members whose profile has no name (shown as 「訪客」 on bookings).
 *
 * Cause (Heidi 2026-11-13): `users/{uid}.displayName` was written only
 * when the profile doc was first created. A doc created while the name
 * was not available yet (sign-up interrupted, or the email-registration
 * race) kept an empty name for good, even though the member's Google
 * account carries one. Sign-in now repairs that (lib/auth), but only for
 * members who come back — this fills the rest from their sign-in account.
 *
 * POST → { checked, filled, stillEmpty }
 */
export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req, 'members');
  if (!gate.ok) return gate.res;

  const snap = await adminDb.collection('users').get();
  const empty = snap.docs.filter((d) => !String(d.data().displayName || '').trim());
  let filled = 0;
  for (let i = 0; i < empty.length; i += 100) {
    const chunk = empty.slice(i, i + 100);
    const res = await getAuth().getUsers(chunk.map((d) => ({ uid: d.id })));
    const nameByUid = new Map<string, string>();
    for (const u of res.users) {
      const name = (u.displayName || u.providerData.find((p) => p.displayName)?.displayName || '').trim();
      if (name) nameByUid.set(u.uid, name.slice(0, 200));
    }
    const batch = adminDb.batch();
    let writes = 0;
    for (const d of chunk) {
      const name = nameByUid.get(d.id);
      if (!name) continue;
      batch.update(d.ref, { displayName: name, updatedAt: FieldValue.serverTimestamp() });
      writes++;
    }
    if (writes > 0) { await batch.commit(); filled += writes; }
  }
  return NextResponse.json({ ok: true, checked: snap.size, filled, stillEmpty: empty.length - filled });
}
