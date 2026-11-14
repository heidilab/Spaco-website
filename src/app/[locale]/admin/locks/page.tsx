'use client';

// 門鎖設定 — the one place for the TTLock door-lock integration (site
// review 2026-11-13, phase 3). Before this page the lock id could be set
// in two places, the account login lived only in Vercel, and nothing
// showed whether the lock was actually connected.
//
//   • 帳戶連接: which settings exist (names only), the token held, and a
//     「測試連線」 that logs in and lists the account's locks.
//   • 每個場地一行 (from 分店管理): pick the lock from the account, confirm
//     key, door-guide image; 「測試此門鎖」 adds and deletes a 10-minute code.
//   • 規則: when codes are issued and how long they are valid.
//   • 最近活動: the last sweep, and the next days' bookings with retry /
//     resend / revoke buttons.

import { useCallback, useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import { adminApiFetch } from '@/lib/adminApiFetch';
import { Link } from '@/i18n/routing';
import { doc, updateDoc, deleteField, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { tryGenerateLockPasscode, resendLockPasscode, revokeLockPasscode } from '@/lib/lockPasscodeClient';
import { KeyRound, Loader2, RefreshCw, Play, Check, X, AlertTriangle, ExternalLink } from 'lucide-react';

interface LockRow { lockId: number; lockAlias: string; lockName: string; electricQuantity?: number; hasGateway?: boolean }
interface VenueRow {
  id: string; name: { zh: string; en: string }; branchKey: string; branchName: { zh: string; en: string }; roomLabel?: { zh?: string; en?: string };
  active: boolean; sortOrder: number; ttlockLockId: number | null; lockGuideUrl: string; lockConfirmKey: string;
  inAccount: boolean | null; lockAlias: string | null; battery: number | null; hasGateway: boolean | null;
}
interface Upcoming {
  bookingId: string; date: string; startTime: string; endTime: string; venueId: string;
  state: 'has-code' | 'email-pending' | 'revoke-failed' | 'no-code' | 'manual'; reason: string;
  passcodeValidFrom?: number; passcodeValidTo?: number; balanceDue: number;
}
interface Status {
  configured: boolean;
  env: { clientId: boolean; clientSecret: boolean; refreshToken: boolean; username: boolean; password: boolean; apiBase: string };
  token: { method: string; expiresAt: number; fetchedAt: number } | null;
  locks: LockRow[]; locksError?: string;
  venues: VenueRow[];
  legacy: Record<string, { lockId?: number; guideUrl?: string }>;
  effective: Record<string, number>;
  lastRun: { lastRunAt: number | null; scanned?: number; generated?: number; reminded?: number; emailed?: number; skipped?: number; errors?: number; problems?: Array<{ bookingId: string; reason: string; error: string }> } | null;
  upcoming: Upcoming[];
}

const hk = (ms?: number | null) => (ms ? new Date(ms).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong', hour12: false }) : '—');

export default function LocksPage() {
  const locale = useLocale() as 'zh' | 'en';
  const zh = locale === 'zh';
  const { user, hasPermission } = useAuth();
  const canAccess = hasPermission('staff');

  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [connTest, setConnTest] = useState<{ ok: boolean; method?: string; tokenExpiresAt?: number; error?: string; count?: number } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { lockId: string; confirmKey: string; guideUrl: string }>>({});
  const [lockTest, setLockTest] = useState<Record<string, { ok: boolean; error?: string }>>({});

  const say = (kind: 'ok' | 'err', text: string) => { setFlash({ kind, text }); setTimeout(() => setFlash(null), 4000); };

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await adminApiFetch('/api/admin/ttlock/status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Status;
      setStatus(data);
      const d: typeof drafts = {};
      for (const v of data.venues) d[v.id] = { lockId: v.ttlockLockId ? String(v.ttlockLockId) : '', confirmKey: v.lockConfirmKey || '', guideUrl: v.lockGuideUrl || '' };
      setDrafts(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);
  const uid = user?.uid;
  useEffect(() => { if (canAccess && uid) load(); }, [canAccess, uid, load]);

  async function post(action: string, extra: Record<string, unknown> = {}) {
    const res = await adminApiFetch('/api/admin/ttlock/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
    return data;
  }

  async function testConnection() {
    setBusy('conn');
    try {
      const out = await post('test-connection') as { ok: boolean; method?: string; tokenExpiresAt?: number; error?: string; locks?: LockRow[] };
      setConnTest({ ok: out.ok, method: out.method, tokenExpiresAt: out.tokenExpiresAt, error: out.error, count: out.locks?.length });
      if (out.ok) await load();
    } catch (err) { setConnTest({ ok: false, error: err instanceof Error ? err.message : String(err) }); }
    finally { setBusy(null); }
  }

  async function saveVenue(v: VenueRow) {
    const d = drafts[v.id];
    if (!d) return;
    const lockId = d.lockId.trim();
    if (lockId && !/^\d+$/.test(lockId)) { say('err', zh ? '門鎖 ID 只可以係數字' : 'Lock ID must be a number'); return; }
    setBusy(`save:${v.id}`);
    try {
      await updateDoc(doc(db, 'venues', v.id), {
        ttlockLockId: lockId || deleteField(),
        lockConfirmKey: d.confirmKey || deleteField(),
        lockGuideUrl: d.guideUrl.trim() || deleteField(),
        updatedAt: serverTimestamp(),
      });
      say('ok', zh ? `已儲存 ${v.name.zh}` : `Saved ${v.name.en}`);
      await load();
    } catch (err) { say('err', (zh ? '儲存失敗：' : 'Save failed: ') + (err instanceof Error ? err.message : String(err))); }
    finally { setBusy(null); }
  }

  async function testLock(v: VenueRow) {
    setBusy(`test:${v.id}`);
    try {
      const out = await post('test-lock', { venueId: v.id }) as { ok: boolean; error?: string };
      setLockTest((p) => ({ ...p, [v.id]: out }));
    } catch (err) { setLockTest((p) => ({ ...p, [v.id]: { ok: false, error: err instanceof Error ? err.message : String(err) } })); }
    finally { setBusy(null); }
  }

  async function migrateLegacy() {
    if (!status) return;
    const todo = status.venues.filter((v) => status.legacy[v.id] && ((!v.ttlockLockId && status.legacy[v.id].lockId) || (!v.lockGuideUrl && status.legacy[v.id].guideUrl)));
    if (todo.length === 0) { say('ok', zh ? '冇嘢需要搬' : 'Nothing to move'); return; }
    if (!window.confirm(zh ? `將 ${todo.length} 個場地嘅舊設定（門鎖 ID／指引圖）搬入分店管理？` : `Copy the legacy settings of ${todo.length} venue(s) into 分店管理?`)) return;
    setBusy('migrate');
    try {
      for (const v of todo) {
        const l = status.legacy[v.id];
        await updateDoc(doc(db, 'venues', v.id), {
          ...(!v.ttlockLockId && l.lockId ? { ttlockLockId: String(l.lockId) } : {}),
          ...(!v.lockGuideUrl && l.guideUrl ? { lockGuideUrl: l.guideUrl } : {}),
          updatedAt: serverTimestamp(),
        });
      }
      say('ok', zh ? `已搬入 ${todo.length} 個場地` : `Copied ${todo.length} venue(s)`);
      await load();
    } catch (err) { say('err', (zh ? '搬遷失敗：' : 'Migration failed: ') + (err instanceof Error ? err.message : String(err))); }
    finally { setBusy(null); }
  }

  async function runSweep() {
    setBusy('sweep');
    try {
      const out = await post('run-sweep') as { scanned: number; results: Array<{ action: string }> };
      const n = (a: string) => out.results.filter((r) => r.action === a).length;
      say('ok', zh ? `掃描 ${out.scanned} 張單：生成 ${n('generated')}、補發電郵 ${n('emailed')}、提醒 ${n('reminded')}、失敗 ${n('error')}` : `Scanned ${out.scanned}: generated ${n('generated')}, emailed ${n('emailed')}, reminded ${n('reminded')}, errors ${n('error')}`);
      await load();
    } catch (err) { say('err', (zh ? '執行失敗：' : 'Sweep failed: ') + (err instanceof Error ? err.message : String(err))); }
    finally { setBusy(null); }
  }

  async function bookingAction(id: string, action: 'generate' | 'resend' | 'revoke') {
    if (action === 'revoke' && !window.confirm(zh ? '刪除呢張單嘅門鎖密碼？' : 'Revoke this passcode?')) return;
    setBusy(`${action}:${id}`);
    try {
      if (action === 'generate') {
        const out = await tryGenerateLockPasscode(id) as { result?: { action: string; reason: string; error?: string } };
        const r = out.result;
        say(r?.action === 'generated' || r?.action === 'emailed' ? 'ok' : 'err', `${r?.action || '?'} · ${r?.reason || ''}${r?.error ? ` · ${r.error}` : ''}`);
      } else if (action === 'resend') { await resendLockPasscode(id); say('ok', zh ? '已重發密碼電郵' : 'Passcode email re-sent'); }
      else { await revokeLockPasscode(id); say('ok', zh ? '已刪除密碼' : 'Passcode revoked'); }
      await load();
    } catch (err) { say('err', err instanceof Error ? err.message : String(err)); }
    finally { setBusy(null); }
  }

  if (!canAccess) return <div className="p-8 text-ink-soft">{zh ? '無權限存取' : 'No access'}</div>;

  const venueLabel = (v: VenueRow) => {
    const room = v.roomLabel?.[locale] || v.roomLabel?.zh;
    const branch = v.branchName?.[locale] || v.branchName?.zh || v.name[locale];
    return room ? `${branch} · ${room}` : branch;
  };
  const venueName = (id: string) => { const v = status?.venues.find((x) => x.id === id); return v ? venueLabel(v) : id; };
  const legacyCount = status ? Object.keys(status.legacy).length : 0;
  const STATE_META: Record<Upcoming['state'], { zh: string; en: string; cls: string }> = {
    'has-code': { zh: '已有密碼', en: 'Has code', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    'manual': { zh: '手動密碼', en: 'Manual', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
    'email-pending': { zh: '電郵未發', en: 'Email pending', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    'revoke-failed': { zh: '刪除失敗', en: 'Revoke failed', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
    'no-code': { zh: '未有密碼', en: 'No code', cls: 'bg-stone-100 text-stone-600 border-stone-200' },
  };
  const REASON_TEXT: Record<string, { zh: string; en: string }> = {
    'no-lockid': { zh: '場地未設門鎖 ID（手動處理）', en: 'No lock ID (manual)' },
    'window-not-open': { zh: '未到 48 小時', en: 'Window not open' },
    'balance-due': { zh: '未付清尾數', en: 'Balance due' },
    'booking-already-started': { zh: '已開場', en: 'Already started' },
    eligible: { zh: '可以生成', en: 'Eligible' },
  };

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold flex items-center gap-2"><KeyRound className="w-6 h-6 text-pink" />{zh ? '門鎖設定' : 'Door locks'}</h1>
        <button onClick={load} disabled={loading} className="text-xs flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-charcoal/15 bg-white hover:bg-cream disabled:opacity-50">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> {zh ? '重新讀取' : 'Reload'}
        </button>
      </div>
      {flash && <div className={`rounded-lg border text-sm px-4 py-2 ${flash.kind === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>{flash.text}</div>}
      {error && <div className="rounded-lg border bg-rose-50 border-rose-200 text-rose-700 text-sm px-4 py-2">{error}</div>}

      {loading && !status ? <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div> : status && (
        <>
          {/* ── Account ── */}
          <div className="glass-card p-6 space-y-3">
            <h2 className="font-bold">{zh ? '帳戶連接' : 'Account connection'}</h2>
            <div className="flex flex-wrap gap-2 text-xs">
              {([['clientId', 'Client ID'], ['clientSecret', 'Client Secret'], ['refreshToken', 'Refresh token'], ['username', zh ? '帳戶電郵' : 'Username'], ['password', zh ? '密碼' : 'Password']] as const).map(([k, label]) => (
                <span key={k} className={`chip ${status.env[k] ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-stone-100 text-stone-500'}`}>{status.env[k] ? '✓' : '✗'} {label}</span>
              ))}
              <span className="chip font-mono">{status.env.apiBase}</span>
            </div>
            <p className="text-sm text-ink-soft">
              {status.configured
                ? (zh ? '登入資料齊全。' : 'Credentials present.')
                : (zh ? '⚠ 登入資料未齊：要喺 Vercel 環境變數設定 TTLOCK_CLIENT_ID、TTLOCK_CLIENT_SECRET 同（帳戶電郵 + 密碼 或 refresh token）。' : '⚠ Credentials missing: set TTLOCK_CLIENT_ID, TTLOCK_CLIENT_SECRET and (username + password, or a refresh token) on Vercel.')}
              {status.token && (zh ? ` 目前 token：以${status.token.method === 'password' ? '密碼' : 'refresh token'}登入，${hk(status.token.fetchedAt)} 取得，${hk(status.token.expiresAt)} 前有效。` : ` Current token: ${status.token.method}, fetched ${hk(status.token.fetchedAt)}, valid until ${hk(status.token.expiresAt)}.`)}
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              <button onClick={testConnection} disabled={busy === 'conn' || !status.configured} className="btn-primary text-sm flex items-center gap-2 disabled:opacity-40">
                {busy === 'conn' ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} {zh ? '測試連線' : 'Test connection'}
              </button>
              {connTest && (
                <span className={`text-sm ${connTest.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {connTest.ok
                    ? (zh ? `✓ 連接成功（${connTest.method === 'password' ? '密碼' : 'refresh token'}登入，帳戶內 ${connTest.count ?? 0} 個鎖）` : `✓ Connected (${connTest.method}, ${connTest.count ?? 0} locks)`)
                    : (zh ? `✗ 連接失敗：${connTest.error}` : `✗ Failed: ${connTest.error}`)}
                </span>
              )}
              {status.locksError && <span className="text-sm text-rose-700">{zh ? '讀取鎖列表失敗：' : 'Lock list failed: '}{status.locksError}</span>}
            </div>
            {status.locks.length > 0 && (
              <p className="text-xs text-ink-soft">
                {zh ? '帳戶內嘅鎖：' : 'Locks in the account: '}
                {status.locks.map((l) => `${l.lockAlias || l.lockName} (#${l.lockId}${typeof l.electricQuantity === 'number' ? ` · 🔋${l.electricQuantity}%` : ''})`).join('、')}
              </p>
            )}
          </div>

          {/* ── Venues ── */}
          <div className="glass-card p-6 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="font-bold">{zh ? '每個場地嘅門鎖' : 'Locks per space'}</h2>
              {legacyCount > 0 && (
                <button onClick={migrateLegacy} disabled={busy === 'migrate'} className="text-xs flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 disabled:opacity-50">
                  {busy === 'migrate' ? <Loader2 size={12} className="animate-spin" /> : <AlertTriangle size={12} />}
                  {zh ? `仲有 ${legacyCount} 個舊設定喺 內容管理 → 系統設定 — 搬入分店管理` : `${legacyCount} legacy setting(s) in 系統設定 — copy into 分店管理`}
                </button>
              )}
            </div>
            <p className="text-xs text-ink-soft">{zh ? '設定儲存喺分店管理嘅場地資料入面（同分店管理頁面係同一份）。留空門鎖 ID 即係呢個場地用手動密碼。' : 'Stored on the venue in 分店管理 (the same record). An empty lock ID means manual passcodes for that space.'}</p>
            <div className="space-y-2">
              {[...status.venues].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)).map((v) => {
                const d = drafts[v.id] || { lockId: '', confirmKey: '', guideUrl: '' };
                const dirty = d.lockId !== (v.ttlockLockId ? String(v.ttlockLockId) : '') || d.confirmKey !== (v.lockConfirmKey || '') || d.guideUrl !== (v.lockGuideUrl || '');
                const t = lockTest[v.id];
                const legacy = status.legacy[v.id];
                return (
                  <div key={v.id} className={`rounded-xl border p-3 ${v.active ? 'border-charcoal/10 bg-white/60' : 'border-dashed border-charcoal/10 bg-stone-50 opacity-70'}`}>
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <span className="font-semibold text-sm">{venueLabel(v)}</span>
                      <span className="text-[10px] font-mono text-ink-soft">{v.id}</span>
                      {!v.active && <span className="chip text-[10px]">{zh ? '已落架' : 'Offline'}</span>}
                      {v.ttlockLockId
                        ? v.inAccount === true
                          ? <span className="chip text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">✓ {zh ? '鎖喺帳戶內' : 'In account'}{v.lockAlias ? ` · ${v.lockAlias}` : ''}</span>
                          : v.inAccount === false
                            ? <span className="chip text-[10px] bg-rose-50 text-rose-700 border-rose-200">✗ {zh ? '帳戶內搵唔到呢個鎖 ID' : 'Lock not in account'}</span>
                            : <span className="chip text-[10px] bg-stone-100 text-stone-600">{zh ? '未能核對（連線問題）' : 'Unverified'}</span>
                        : <span className="chip text-[10px] bg-amber-50 text-amber-700 border-amber-200">{zh ? '手動密碼' : 'Manual'}</span>}
                      {typeof v.battery === 'number' && <span className={`chip text-[10px] ${v.battery < 20 ? 'bg-rose-50 text-rose-700 border-rose-200' : ''}`}>🔋 {v.battery}%</span>}
                      {v.hasGateway === false && <span className="chip text-[10px] bg-rose-50 text-rose-700 border-rose-200">{zh ? '冇 gateway' : 'No gateway'}</span>}
                      {legacy && (legacy.lockId || legacy.guideUrl) && <span className="chip text-[10px] bg-amber-50 text-amber-700 border-amber-200" title={`ttlock_${v.id}: ${legacy.lockId ?? '—'}`}>{zh ? '系統設定有舊值' : 'Legacy slot'}</span>}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
                      <label className="block md:col-span-4">
                        <span className="text-[11px] font-semibold text-ink-soft">{zh ? '門鎖（由帳戶揀，或者填 ID）' : 'Lock (pick, or type the ID)'}</span>
                        <div className="flex gap-1 mt-1">
                          <select value={status.locks.some((l) => String(l.lockId) === d.lockId) ? d.lockId : ''} onChange={(e) => setDrafts((p) => ({ ...p, [v.id]: { ...d, lockId: e.target.value } }))} className="flex-1 px-2 py-1.5 rounded-lg border border-charcoal/15 text-sm bg-white">
                            <option value="">{zh ? '— 揀一個鎖 —' : '— pick a lock —'}</option>
                            {status.locks.map((l) => <option key={l.lockId} value={String(l.lockId)}>{l.lockAlias || l.lockName} (#{l.lockId})</option>)}
                          </select>
                          <input value={d.lockId} onChange={(e) => setDrafts((p) => ({ ...p, [v.id]: { ...d, lockId: e.target.value.trim() } }))} placeholder="ID" className="w-24 px-2 py-1.5 rounded-lg border border-charcoal/15 text-sm bg-white font-mono" />
                        </div>
                      </label>
                      <label className="block md:col-span-2">
                        <span className="text-[11px] font-semibold text-ink-soft">{zh ? '確認鍵' : 'Confirm key'}</span>
                        <select value={d.confirmKey} onChange={(e) => setDrafts((p) => ({ ...p, [v.id]: { ...d, confirmKey: e.target.value } }))} className="mt-1 w-full px-2 py-1.5 rounded-lg border border-charcoal/15 text-sm bg-white">
                          <option value="">{zh ? '預設' : 'Default'}</option><option value="#">#</option><option value="🔔">🔔</option>
                        </select>
                      </label>
                      <label className="block md:col-span-4">
                        <span className="text-[11px] font-semibold text-ink-soft">{zh ? '門鎖指引圖網址' : 'Door-guide image URL'}</span>
                        <input value={d.guideUrl} onChange={(e) => setDrafts((p) => ({ ...p, [v.id]: { ...d, guideUrl: e.target.value } }))} placeholder="https://…" className="mt-1 w-full px-2 py-1.5 rounded-lg border border-charcoal/15 text-xs bg-white font-mono" />
                      </label>
                      <div className="md:col-span-2 flex gap-1">
                        <button onClick={() => saveVenue(v)} disabled={!dirty || busy === `save:${v.id}`} className="btn-primary text-xs px-3 py-1.5 disabled:opacity-40 flex items-center gap-1">
                          {busy === `save:${v.id}` ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} {zh ? '儲存' : 'Save'}
                        </button>
                        <button onClick={() => testLock(v)} disabled={!v.ttlockLockId || busy === `test:${v.id}` || !status.configured} className="text-xs px-2.5 py-1.5 rounded-lg border border-charcoal/15 bg-white hover:bg-cream disabled:opacity-40 whitespace-nowrap">
                          {busy === `test:${v.id}` ? <Loader2 size={12} className="animate-spin inline" /> : (zh ? '測試此門鎖' : 'Test lock')}
                        </button>
                      </div>
                    </div>
                    {t && <p className={`text-xs mt-2 ${t.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{t.ok ? (zh ? '✓ 成功：已經加咗一個 10 分鐘嘅測試密碼並即時刪除' : '✓ OK: a 10-minute test code was added and deleted') : (zh ? `✗ 失敗：${t.error}` : `✗ Failed: ${t.error}`)}</p>}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Rules ── */}
          <div className="glass-card p-6">
            <h2 className="font-bold mb-2">{zh ? '規則（固定）' : 'Rules'}</h2>
            <ul className="text-sm text-ink-soft space-y-1 list-disc pl-5">
              <li>{zh ? '每日 09:00 自動掃未來 3 日嘅已確認訂單；確認付款、批核收據、改狀態時亦會即時試一次。' : 'Daily 09:00 sweep of the next 3 days of confirmed bookings; payment confirmation, receipt approval and status changes also try at once.'}</li>
              <li>{zh ? '開場前 48 小時內、尾數已付清先會生成；有尾數就改為發尾數提醒（每日最多一次）。' : 'Issued within 48 hours of the start and only when the balance is paid; otherwise a balance reminder (once a day at most).'}</li>
              <li>{zh ? '密碼由開場前 60 分鐘（或者提早入場佈置開始時間，以較早者為準）有效到完場；過夜單到第二日完場。' : 'Valid from 60 minutes before the start (or the start of early set-up, whichever is earlier) until the end; overnight bookings until day 2 ends.'}</li>
              <li>{zh ? '改時間後會自動刪舊密碼、出新密碼並重發電郵；取消會刪密碼，刪唔到會喺下面顯示「刪除失敗」。' : 'A time change deletes the old code and issues a new one; cancellation revokes it, and a failed revoke is listed below.'}</li>
              <li>{zh ? '電郵發唔出（或者 Email 自動化熄咗）唔會當已發，會喺每日掃描時再試。' : 'An email that did not go out (or was switched off) is retried by the daily sweep.'}</li>
            </ul>
          </div>

          {/* ── Activity ── */}
          <div className="glass-card p-6 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="font-bold">{zh ? '最近活動' : 'Recent activity'}</h2>
              <button onClick={runSweep} disabled={busy === 'sweep'} className="btn-primary text-xs flex items-center gap-1 disabled:opacity-50">
                {busy === 'sweep' ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} {zh ? '立即執行掃描' : 'Run sweep now'}
              </button>
            </div>
            <p className="text-sm text-ink-soft">
              {status.lastRun?.lastRunAt
                ? (zh ? `上次掃描：${hk(status.lastRun.lastRunAt)} — 掃描 ${status.lastRun.scanned ?? 0}，生成 ${status.lastRun.generated ?? 0}，補發電郵 ${status.lastRun.emailed ?? 0}，提醒 ${status.lastRun.reminded ?? 0}，失敗 ${status.lastRun.errors ?? 0}` : `Last sweep ${hk(status.lastRun.lastRunAt)} — scanned ${status.lastRun.scanned ?? 0}, generated ${status.lastRun.generated ?? 0}, emailed ${status.lastRun.emailed ?? 0}, reminded ${status.lastRun.reminded ?? 0}, errors ${status.lastRun.errors ?? 0}`)
                : (zh ? '未有掃描記錄（由今日起會記錄）。' : 'No sweep recorded yet.')}
            </p>
            {status.lastRun?.problems && status.lastRun.problems.length > 0 && (
              <ul className="text-xs text-rose-700 space-y-0.5">
                {status.lastRun.problems.map((p) => <li key={p.bookingId}>#{p.bookingId.slice(0, 8)} · {p.reason}{p.error ? ` · ${p.error}` : ''}</li>)}
              </ul>
            )}
            <h3 className="font-semibold text-sm mt-2">{zh ? '未來 3 日嘅已確認訂單' : 'Confirmed bookings in the next 3 days'}</h3>
            {status.upcoming.length === 0 ? <p className="text-sm text-ink-soft">{zh ? '冇。' : 'None.'}</p> : (
              <div className="space-y-1.5">
                {status.upcoming.map((u) => {
                  const meta = STATE_META[u.state];
                  const reason = REASON_TEXT[u.reason]?.[locale] || u.reason;
                  return (
                    <div key={u.bookingId} className="flex items-center gap-2 text-sm flex-wrap rounded-lg bg-white/60 border border-charcoal/10 px-3 py-2">
                      <span className="text-xs text-ink-soft w-24">{u.date.slice(5)} {u.startTime}</span>
                      <span className="flex-1 min-w-[140px] truncate">{venueName(u.venueId)}</span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-pill border ${meta.cls}`}>{meta[locale]}</span>
                      {u.state === 'no-code' && <span className="text-[11px] text-ink-soft">{reason}{u.balanceDue > 0 ? ` · $${u.balanceDue.toLocaleString()}` : ''}</span>}
                      {u.passcodeValidFrom && <span className="text-[11px] text-ink-soft">{hk(u.passcodeValidFrom).slice(5, 16)} → {hk(u.passcodeValidTo).slice(5, 16)}</span>}
                      <span className="flex gap-1 ml-auto">
                        {(u.state === 'no-code' || u.state === 'email-pending') && (
                          <button onClick={() => bookingAction(u.bookingId, 'generate')} disabled={!!busy} className="text-[11px] px-2 py-1 rounded-lg border border-charcoal/15 bg-white hover:bg-cream disabled:opacity-40">{u.state === 'no-code' ? (zh ? '立即生成' : 'Generate') : (zh ? '重試電郵' : 'Retry email')}</button>
                        )}
                        {(u.state === 'has-code' || u.state === 'manual') && (
                          <button onClick={() => bookingAction(u.bookingId, 'resend')} disabled={!!busy} className="text-[11px] px-2 py-1 rounded-lg border border-charcoal/15 bg-white hover:bg-cream disabled:opacity-40">{zh ? '重發電郵' : 'Resend'}</button>
                        )}
                        {u.state !== 'no-code' && (
                          <button onClick={() => bookingAction(u.bookingId, 'revoke')} disabled={!!busy} className="text-[11px] px-2 py-1 rounded-lg border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 disabled:opacity-40 flex items-center gap-1"><X size={10} />{u.state === 'revoke-failed' ? (zh ? '再試刪除' : 'Retry revoke') : (zh ? '刪除' : 'Revoke')}</button>
                        )}
                        <Link href={`/admin/bookings/${u.bookingId}`} className="text-[11px] px-2 py-1 rounded-lg border border-charcoal/15 bg-white hover:bg-cream flex items-center gap-1"><ExternalLink size={10} />{zh ? '訂單' : 'Open'}</Link>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
