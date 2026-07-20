/* SPACO service worker — Web Push for admin notifications.
 *
 * Deliberately minimal: no offline caching (the admin needs LIVE data;
 * a stale cache showing old bookings would be worse than no PWA). Its
 * only jobs are receiving pushes and opening the right admin page.
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'SPACO', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'SPACO';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || undefined,          // same tag → replaces, no stacking spam
    data: { url: data.url || '/zh/admin/bookings' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/zh/admin/bookings';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus an existing SPACO tab if one is open, else open a new one.
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
