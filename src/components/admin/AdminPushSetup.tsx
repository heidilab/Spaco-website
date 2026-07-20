'use client';

// Admin push-notification enrolment — small banner in the admin sidebar.
//
// Registers /sw.js and subscribes this device to Web Push so staff get
// phone/desktop notifications for everything that already emails them
// (new booking / supplier order / receipt pending). Subscription is saved
// via /api/push/subscribe (requireAdmin-gated).
//
// iOS notes: Web Push needs iOS 16.4+ AND the site added to the Home
// Screen (Safari share → 加入主畫面) — inside plain Safari the API is
// absent, so we show a hint instead of the button.

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Bell, BellOff, BellRing } from 'lucide-react';
import { adminApiFetch } from '@/lib/adminApiFetch';
import { useAuth } from '@/contexts/AuthContext';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from(Array.from(rawData, (c) => c.charCodeAt(0)));
}

type PushState = 'unsupported' | 'ios-needs-a2hs' | 'off' | 'on' | 'denied' | 'busy';

export default function AdminPushSetup() {
  const locale = useLocale() as 'zh' | 'en';
  const { user } = useAuth();
  const [state, setState] = useState<PushState>('busy');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (typeof window === 'undefined') return;
      const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
      const standalone = window.matchMedia('(display-mode: standalone)').matches
        || (navigator as { standalone?: boolean }).standalone === true;
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        // iOS Safari (not installed) has no PushManager — guide to A2HS.
        setState(isIOS && !standalone ? 'ios-needs-a2hs' : 'unsupported');
        return;
      }
      try {
        const reg = await navigator.serviceWorker.register('/sw.js');
        const sub = await reg.pushManager.getSubscription();
        if (sub) setState('on');
        else setState(Notification.permission === 'denied' ? 'denied' : 'off');
      } catch {
        setState('unsupported');
      }
    })();
  }, []);

  async function enable() {
    setError(null);
    setState('busy');
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setState(perm === 'denied' ? 'denied' : 'off'); return; }
      const reg = await navigator.serviceWorker.ready;
      const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapid) throw new Error('VAPID key missing');
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapid) as BufferSource,
      });
      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      const res = await adminApiFetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, email: user?.email }),
      });
      if (!res.ok) throw new Error(`subscribe failed (${res.status})`);
      setState('on');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
      setState('off');
    }
  }

  async function disable() {
    setError(null);
    setState('busy');
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await adminApiFetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {});
        await sub.unsubscribe();
      }
      setState('off');
    } catch {
      setState('on');
    }
  }

  if (state === 'unsupported') return null;

  if (state === 'ios-needs-a2hs') {
    return (
      <p className="text-[10px] text-ink-soft leading-relaxed">
        📲 {locale === 'zh'
          ? '想收手機通知？用 Safari 分享 → 「加入主畫面」安裝 SPACO，再喺 App 入面開啟通知。'
          : 'For phone notifications: Safari Share → "Add to Home Screen", then enable inside the app.'}
      </p>
    );
  }

  if (state === 'denied') {
    return (
      <p className="text-[10px] text-ink-soft leading-relaxed flex items-start gap-1">
        <BellOff size={11} className="mt-0.5 shrink-0" />
        {locale === 'zh'
          ? '通知權限已被封鎖 — 請喺瀏覽器/系統設定重新允許。'
          : 'Notifications blocked — re-allow in browser/system settings.'}
      </p>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={state === 'on' ? disable : enable}
        disabled={state === 'busy'}
        className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition ${
          state === 'on'
            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
            : 'bg-gradient-pink text-white shadow-glow hover:opacity-90'
        } disabled:opacity-50`}
      >
        {state === 'on' ? <BellRing size={13} /> : <Bell size={13} />}
        {state === 'busy'
          ? '…'
          : state === 'on'
            ? (locale === 'zh' ? '手機通知已開啟 ✓（撳關閉）' : 'Push ON ✓ (tap to disable)')
            : (locale === 'zh' ? '開啟手機通知' : 'Enable push notifications')}
      </button>
      {state === 'on' && (
        <button
          type="button"
          onClick={async () => {
            setError(null);
            try { await adminApiFetch('/api/push/test', { method: 'POST' }); }
            catch { setError('test failed'); }
          }}
          className="w-full mt-1 text-[10px] text-ink-soft hover:text-pink underline"
        >
          {locale === 'zh' ? '發送測試通知' : 'Send test notification'}
        </button>
      )}
      {error && <p className="text-[10px] text-rose-500 mt-1">{error}</p>}
    </div>
  );
}
