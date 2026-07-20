// Web Push sender for staff notifications (server-only).
//
// Subscriptions live in Firestore at `push_subscriptions/{docId}`:
//   { uid, email, endpoint, keys: { p256dh, auth }, userAgent, createdAt }
// written by /api/push/subscribe (requireAdmin-gated; docId = sha256 of the
// endpoint so re-subscribing the same device upserts instead of duplicating).
//
// Recipient policy mirrors getStaffNotificationRecipients(): every current
// admin_users member whose role grants the `bookings` permission. A device
// keeps receiving pushes only while its owner still holds that permission —
// demoting a departing CS silently stops their phone too, no cleanup needed.

import webpush from 'web-push';
import { adminDb } from './firebaseAdmin';
import { ROLE_PERMISSIONS } from '@/types';

let vapidConfigured = false;
function ensureVapid(): boolean {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  if (!vapidConfigured) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:spacohk@gmail.com', pub, priv);
    vapidConfigured = true;
  }
  return true;
}

export interface StaffPushPayload {
  title: string;
  body: string;
  /** Admin page to open when the notification is tapped. */
  url?: string;
  /** Same tag replaces an earlier notification instead of stacking. */
  tag?: string;
}

/**
 * Send a push to every registered device of every staff member with the
 * `bookings` permission. Never throws — a push failure must not break the
 * booking/email flow it rides along with. Dead subscriptions (404/410 from
 * the push service) are deleted so the collection self-cleans.
 */
export async function sendStaffPush(payload: StaffPushPayload): Promise<void> {
  try {
    if (!ensureVapid()) {
      console.warn('[webPush] VAPID keys not configured — skipping push');
      return;
    }

    // Staff uids holding the bookings permission (mirror of the email list).
    const staffSnap = await adminDb.collection('admin_users').get();
    const allowedUids = new Set<string>();
    staffSnap.forEach((d) => {
      const role = (d.data() as { role?: string }).role || 'admin';
      const perms = ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS];
      if (Array.isArray(perms) && perms.includes('bookings')) allowedUids.add(d.id);
    });
    if (allowedUids.size === 0) return;

    const subsSnap = await adminDb.collection('push_subscriptions').get();
    if (subsSnap.empty) return;

    const body = JSON.stringify({
      title: payload.title,
      body: payload.body,
      url: payload.url || '/zh/admin/bookings',
      ...(payload.tag ? { tag: payload.tag } : {}),
    });

    await Promise.all(subsSnap.docs.map(async (d) => {
      const sub = d.data() as {
        uid?: string;
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      };
      if (!sub.uid || !allowedUids.has(sub.uid)) return;
      if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return;
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
          body,
        );
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // Subscription expired / revoked — remove it.
          await d.ref.delete().catch(() => {});
        } else {
          console.warn('[webPush] send failed:', status, err instanceof Error ? err.message : err);
        }
      }
    }));
  } catch (err) {
    console.warn('[webPush] sendStaffPush failed (non-fatal):', err);
  }
}
