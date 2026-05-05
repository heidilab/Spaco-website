'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import {
  CalendarClock, RefreshCw, Link2, Unlink, Check, AlertCircle,
  Loader2, ChevronRight, Clock,
} from 'lucide-react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface SyncMeta {
  lastSyncedAt?: { toDate?: () => Date; seconds?: number };
  scanned?: number; added?: number; updated?: number; removed?: number;
  errors?: string[];
}

interface ConnectedStatus {
  connected: boolean;
  email?: string;
  connected_at?: { toDate?: () => Date; seconds?: number };
}

function fmtTimestamp(v: unknown): string | null {
  if (!v) return null;
  const obj = v as { toDate?: () => Date; seconds?: number };
  if (typeof obj.toDate === 'function') return obj.toDate().toLocaleString();
  if (typeof obj.seconds === 'number') return new Date(obj.seconds * 1000).toLocaleString();
  return null;
}

export default function CalendarSyncPage() {
  const locale = useLocale() as 'zh' | 'en';
  const search = useSearchParams();
  const { hasPermission } = useAuth();

  const [status, setStatus] = useState<ConnectedStatus | null>(null);
  const [syncMeta, setSyncMeta] = useState<SyncMeta | null>(null);
  const [busy, setBusy] = useState<'connect' | 'disconnect' | 'sync' | null>(null);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // OAuth callback feedback
  useEffect(() => {
    const error = search.get('error');
    const connected = search.get('connected');
    const email = search.get('email');
    if (error) {
      setFlash({ kind: 'err', text: (locale === 'zh' ? '連接失敗：' : 'Connect failed: ') + error });
    } else if (connected) {
      setFlash({
        kind: 'ok',
        text: (locale === 'zh' ? '✅ 已連接 Google 日曆' : '✅ Connected to Google Calendar') +
          (email ? ` (${email})` : ''),
      });
    }
  }, [search, locale]);

  // Live status from Firestore
  useEffect(() => {
    if (!hasPermission('gcal')) return;
    const unsubToken = onSnapshot(doc(db, 'secrets/google_oauth'), (snap) => {
      if (!snap.exists()) {
        setStatus({ connected: false });
      } else {
        const data = snap.data() as { connected_email?: string; connected_at?: unknown };
        setStatus({ connected: true, email: data.connected_email,
          connected_at: data.connected_at as ConnectedStatus['connected_at'] });
      }
    });
    const unsubMeta = onSnapshot(doc(db, 'system/calendar_sync'), (snap) => {
      setSyncMeta(snap.exists() ? (snap.data() as SyncMeta) : null);
    });
    return () => { unsubToken(); unsubMeta(); };
  }, [hasPermission]);

  if (!hasPermission('gcal')) {
    return (
      <div className="text-center py-20 text-ink-soft">
        {locale === 'zh' ? '無權限存取' : 'Access Denied'}
      </div>
    );
  }

  const handleConnect = async () => {
    setBusy('connect');
    try {
      const res = await fetch('/api/google/auth');
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else throw new Error(data.error || 'Failed');
    } catch (err) {
      setFlash({ kind: 'err', text: (locale === 'zh' ? '無法啟動授權：' : 'Auth failed: ') + (err instanceof Error ? err.message : String(err)) });
      setBusy(null);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm(locale === 'zh' ? '確定中斷 Google 連接？網站將唔再 sync。' : 'Disconnect Google? Sync will stop.')) return;
    setBusy('disconnect');
    try {
      const res = await fetch('/api/google/disconnect', { method: 'POST' });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      setFlash({ kind: 'ok', text: locale === 'zh' ? '已中斷連接' : 'Disconnected' });
    } catch (err) {
      setFlash({ kind: 'err', text: String(err) });
    } finally {
      setBusy(null);
    }
  };

  const handleSync = async () => {
    setBusy('sync');
    try {
      const res = await fetch('/api/google/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setFlash({
        kind: 'ok',
        text: locale === 'zh'
          ? `✅ Sync 完成：掃描 ${data.scanned}、新增 ${data.added}、更新 ${data.updated}、移除 ${data.removed}`
          : `✅ Sync complete: scanned ${data.scanned}, added ${data.added}, updated ${data.updated}, removed ${data.removed}`,
      });
    } catch (err) {
      setFlash({ kind: 'err', text: (locale === 'zh' ? 'Sync 失敗：' : 'Sync failed: ') + (err instanceof Error ? err.message : String(err)) });
    } finally {
      setBusy(null);
    }
  };

  const isConnected = status?.connected === true;

  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <span className="chip mb-3"><CalendarClock size={12} className="text-pink" /> Calendar Sync</span>
        <h1 className="text-heading font-display">
          <span className="text-ink">{locale === 'zh' ? 'Google 日曆 ' : 'Google Calendar '}</span>
          <span className="text-gradient-pink">{locale === 'zh' ? '同步' : 'Sync'}</span>
        </h1>
        <p className="text-ink-soft mt-3">
          {locale === 'zh'
            ? '雙向 sync：網站 booking 自動入 Google 日曆；Google 上面手動加嘅 event 自動 block 網站 slot。'
            : 'Two-way sync: website bookings push to Google; events you add on Google block website slots.'}
        </p>
      </div>

      {flash && (
        <div className={`mb-6 p-4 rounded-2xl border-2 text-sm ${
          flash.kind === 'ok'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
            : 'bg-rose-50 border-rose-200 text-rose-900'
        }`}>
          {flash.text}
        </div>
      )}

      {/* Connection card */}
      <div className="glass-card p-6 md:p-7 mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-charcoal/30'}`} />
              <h3 className="text-base font-bold text-ink">
                {isConnected
                  ? (locale === 'zh' ? '已連接' : 'Connected')
                  : (locale === 'zh' ? '未連接' : 'Not connected')}
              </h3>
            </div>
            {isConnected && (
              <p className="text-sm text-ink-soft">
                {status?.email && <span className="font-mono">{status.email}</span>}
                {status?.connected_at && (
                  <span className="block text-xs text-ink-soft/70 mt-1">
                    {locale === 'zh' ? '自 ' : 'since '}{fmtTimestamp(status.connected_at)}
                  </span>
                )}
              </p>
            )}
            {!isConnected && (
              <p className="text-sm text-ink-soft">
                {locale === 'zh'
                  ? '撳「Connect」用 spacohk@gmail.com 登入授權（Google 會問你信唔信任 SPACO 應用程式）。'
                  : 'Click Connect and sign in with the Google account that owns the calendars.'}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            {isConnected ? (
              <>
                <button
                  onClick={handleSync}
                  disabled={busy !== null}
                  className="btn-primary disabled:opacity-50"
                >
                  {busy === 'sync' ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                  {locale === 'zh' ? '即時 Sync' : 'Sync now'}
                </button>
                <button
                  onClick={handleDisconnect}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-pill text-sm font-medium border-2 border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                >
                  {busy === 'disconnect' ? <Loader2 size={14} className="animate-spin" /> : <Unlink size={14} />}
                  {locale === 'zh' ? '中斷連接' : 'Disconnect'}
                </button>
              </>
            ) : (
              <button
                onClick={handleConnect}
                disabled={busy !== null}
                className="btn-primary disabled:opacity-50"
              >
                {busy === 'connect' ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />}
                {locale === 'zh' ? '連接 Google' : 'Connect Google'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Sync metadata */}
      {isConnected && (
        <div className="glass-card p-6 md:p-7 mb-6">
          <h3 className="text-base font-bold text-ink mb-4 flex items-center gap-2">
            <Clock size={14} className="text-lavender" />
            {locale === 'zh' ? '上次 sync' : 'Last sync'}
          </h3>
          {syncMeta?.lastSyncedAt ? (
            <>
              <p className="text-sm text-ink mb-3 font-mono">{fmtTimestamp(syncMeta.lastSyncedAt)}</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                <Stat label={locale === 'zh' ? '掃描' : 'Scanned'} value={syncMeta.scanned ?? 0} />
                <Stat label={locale === 'zh' ? '新增' : 'Added'} value={syncMeta.added ?? 0} colour="emerald" />
                <Stat label={locale === 'zh' ? '更新' : 'Updated'} value={syncMeta.updated ?? 0} colour="sky" />
                <Stat label={locale === 'zh' ? '移除' : 'Removed'} value={syncMeta.removed ?? 0} colour="rose" />
              </div>
              {syncMeta.errors && syncMeta.errors.length > 0 && (
                <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
                  <p className="font-bold mb-1.5 flex items-center gap-1"><AlertCircle size={12} /> {locale === 'zh' ? '錯誤' : 'Errors'}</p>
                  <ul className="space-y-0.5 list-disc list-inside">
                    {syncMeta.errors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-ink-soft">
              {locale === 'zh' ? '從未 sync 過。撳上面「即時 Sync」開始。' : 'Never synced yet. Click "Sync now" above.'}
            </p>
          )}
        </div>
      )}

      {/* Calendar config */}
      <div className="glass-card p-6 md:p-7">
        <h3 className="text-base font-bold text-ink mb-4">
          {locale === 'zh' ? '4 條分店日曆' : '4 Branch Calendars'}
        </h3>
        <div className="space-y-2">
          {([
            { key: 'cwb', label: '銅鑼灣 / Causeway Bay' },
            { key: 'wc',  label: '灣仔 / Wan Chai' },
            { key: 'sw',  label: '上環 (sw-a / sw-b / sw-ab) / Sheung Wan' },
            { key: 'tst', label: '尖沙咀 / Tsim Sha Tsui' },
          ] as const).map((c) => (
            <div key={c.key} className="flex items-center gap-3 p-3 rounded-xl bg-white/40 border border-white/60 text-sm">
              <ChevronRight size={14} className="text-ink-soft" />
              <span className="font-semibold text-ink flex-1">{c.label}</span>
              <span className="text-xs text-ink-soft font-mono uppercase">{c.key}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-ink-soft mt-4">
          {locale === 'zh'
            ? 'Calendar IDs 由環境變數 GCAL_CWB_ID / GCAL_WC_ID / GCAL_SW_ID / GCAL_TST_ID 提供。改動需要重啟 dev server。'
            : 'Calendar IDs come from env vars GCAL_CWB_ID / GCAL_WC_ID / GCAL_SW_ID / GCAL_TST_ID. Restart dev server after edits.'}
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value, colour }: { label: string; value: number; colour?: 'emerald' | 'sky' | 'rose' }) {
  const cls =
    colour === 'emerald' ? 'text-emerald-600' :
    colour === 'sky' ? 'text-sky-600' :
    colour === 'rose' ? 'text-rose-600' :
    'text-ink';
  return (
    <div className="rounded-xl bg-white/50 border border-white/60 p-3">
      <p className="text-[10px] uppercase tracking-wider text-ink-soft font-bold">{label}</p>
      <p className={`text-2xl font-bold font-display ${cls}`}>{value}</p>
    </div>
  );
}
