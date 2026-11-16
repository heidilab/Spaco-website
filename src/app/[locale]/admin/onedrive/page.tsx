'use client';

// OneDrive 單據連結 (2026-11) — Heidi connects her personal OneDrive once,
// picks one folder per branch (they live in different places in her
// drive; month sub-folders inside are read automatically) and each
// branch's Financial Master workbook. Rows land on the month's own sheet
// (NOV-2026 …) in the Expenses block — the month decides the sheet, so
// nothing is picked by hand. From then on /api/cron/onedrive-receipts
// reads every new file into 支出管理.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { adminApiFetch } from '@/lib/adminApiFetch';
import type { OneDriveReceiptsConfig } from '@/types';
import {
  Cloud, Link2, Unlink, Loader2, Folder, FolderOpen, FileSpreadsheet, ChevronRight, Check, RefreshCw,
  AlertTriangle, ExternalLink, X,
} from 'lucide-react';

interface Branch { key: string; zh: string; en: string }
interface RecentFile {
  id: string; name: string; folderPath?: string; status: string; branchKey?: string; error?: string;
  expenseId?: string; webUrl?: string; queuedAt?: string; processedAt?: string; fileDeleted?: boolean;
}
interface Status {
  configured: boolean;
  connection: { connected: boolean; email?: string; name?: string; connectedAt?: string };
  branches: Branch[];
  recent: RecentFile[];
  config: Omit<OneDriveReceiptsConfig, 'deltaLinks'> & { lastScanAt?: string | null };
}
interface BrowseItem { id: string; name: string; isFolder: boolean; isExcel: boolean; childCount: number; size: number; path: string }
interface BrowseState { item: { id: string; name: string; path: string; parentId: string | null }; children: BrowseItem[] }
interface MonthLayout { headerRow: number; vendorColumn: string; amountColumn: string; dateColumn?: string; noteColumn?: string }
interface WorkbookMeta {
  worksheets: Array<{ id: string; name: string; headers: string[]; usedAddress?: string; monthLayout?: MonthLayout }>;
  tables: Array<{ id: string; name: string; worksheet: string; address: string; columns: string[] }>;
}

/** Sheet names that look like a month (NOV-2026, Nov 2026, 2026-11 …). */
const MONTHISH = /^(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s_-]*\d{2,4}|\d{4}[\s_-]*(?:\d{2}|[a-z]{3,9})|\d{2}[\s_-]*\d{4})$/i;

function fmtTime(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong', hour12: false });
}

export default function OneDrivePage() {
  const locale = useLocale() as 'zh' | 'en';
  const zh = locale === 'zh';
  const { user, hasPermission } = useAuth();
  const canAccess = hasPermission('staff');
  const search = useSearchParams();

  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  // Folder / file browser
  const [browseMode, setBrowseMode] = useState<'folder' | 'excel' | null>(null);
  const [browse, setBrowse] = useState<BrowseState | null>(null);
  const [browseBusy, setBrowseBusy] = useState(false);
  const [crumbs, setCrumbs] = useState<Array<{ id: string; name: string }>>([{ id: 'root', name: 'OneDrive' }]);

  // Which branch the folder browser is choosing for.
  const [folderForBranch, setFolderForBranch] = useState<string | null>(null);

  // Excel draft — for one branch at a time (her month-sheet layout).
  const [excelPick, setExcelPick] = useState<{ branchKey: string; itemId: string; name: string; path: string } | null>(null);
  const [meta, setMeta] = useState<WorkbookMeta | null>(null);
  const [headerRow, setHeaderRow] = useState(5);
  const [vendorCol, setVendorCol] = useState('Q');
  const [amountCol, setAmountCol] = useState('R');
  const [idCol, setIdCol] = useState('V');
  const [dateCol, setDateCol] = useState('A');
  const [noteCol, setNoteCol] = useState('U');

  const say = (kind: 'ok' | 'err', text: string) => { setFlash({ kind, text }); setTimeout(() => setFlash(null), 6000); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApiFetch('/api/onedrive/status');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setStatus(data);
    } catch (e) {
      say('err', e instanceof Error ? e.message : 'load failed');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (canAccess && user) load(); }, [canAccess, user, load]);

  useEffect(() => {
    const err = search.get('error');
    const connected = search.get('connected');
    if (err) say('err', (zh ? '連接失敗：' : 'Connect failed: ') + err);
    else if (connected) say('ok', zh ? '✓ OneDrive 已連接' : '✓ OneDrive connected');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openBrowser(mode: 'folder' | 'excel', branchKey?: string) {
    setBrowseMode(mode);
    setFolderForBranch(branchKey || null);
    setCrumbs([{ id: 'root', name: 'OneDrive' }]);
    await goTo('root');
  }
  async function goTo(itemId: string) {
    setBrowseBusy(true);
    try {
      const res = await adminApiFetch(`/api/onedrive/browse?itemId=${encodeURIComponent(itemId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setBrowse(data);
    } catch (e) {
      say('err', e instanceof Error ? e.message : 'browse failed');
    } finally { setBrowseBusy(false); }
  }
  async function enter(item: BrowseItem) {
    setCrumbs((c) => [...c, { id: item.id, name: item.name }]);
    await goTo(item.id);
  }
  async function crumbTo(idx: number) {
    const c = crumbs.slice(0, idx + 1);
    setCrumbs(c);
    await goTo(c[c.length - 1].id);
  }

  async function saveConfig(body: Record<string, unknown>, okText: string) {
    const res = await adminApiFetch('/api/onedrive/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    say('ok', okText);
    await load();
  }

  /** Assign the folder currently open in the browser to `folderForBranch`. */
  async function chooseCurrentFolder() {
    if (!browse || browse.item.id === 'root' || !folderForBranch || !status) return;
    setBusy('folder');
    try {
      const others = (status.config.branchFolders || []).filter((b) => b.branchKey !== folderForBranch);
      const branchFolders = [...others, { id: browse.item.id, name: browse.item.name, path: browse.item.path, branchKey: folderForBranch }];
      await saveConfig({ branchFolders },
        zh ? '✓ 已設定分店資料夾，由而家開始上載嘅新檔案會自動入帳（月份子資料夾一樣會讀）' : '✓ Branch folder set — files uploaded from now on are read automatically (month sub-folders included)');
      setBrowseMode(null); setFolderForBranch(null);
    } catch (e) { say('err', e instanceof Error ? e.message : 'save failed'); } finally { setBusy(null); }
  }

  async function removeBranchFolder(branchKey: string) {
    if (!status) return;
    if (!confirm(zh ? '取消呢間舖嘅資料夾？已入帳嘅支出唔會刪。' : 'Remove this branch folder? Existing expenses stay.')) return;
    setBusy('folder');
    try {
      await saveConfig({ branchFolders: (status.config.branchFolders || []).filter((b) => b.branchKey !== branchKey) }, zh ? '已取消' : 'Removed');
    } catch (e) { say('err', e instanceof Error ? e.message : 'save failed'); } finally { setBusy(null); }
  }

  async function pickExcel(item: BrowseItem) {
    if (!folderForBranch) return;
    const branchKey = folderForBranch;
    setExcelPick({ branchKey, itemId: item.id, name: item.name, path: item.path });
    setBrowseMode(null);
    setMeta(null);
    setBusy('meta');
    try {
      const res = await adminApiFetch(`/api/onedrive/excel-meta?itemId=${encodeURIComponent(item.id)}`);
      const data: WorkbookMeta & { error?: string } = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setMeta(data);
      // Prefer the layout found on a month sheet; else what she saved last time; else her usual Q/R row 5.
      const saved = status?.config.excelByBranch?.[branchKey];
      const found = data.worksheets.find((w) => w.monthLayout && MONTHISH.test(w.name))?.monthLayout
        || data.worksheets.find((w) => w.monthLayout)?.monthLayout;
      const same = saved && saved.itemId === item.id;
      if (found) { setHeaderRow(found.headerRow); setVendorCol(found.vendorColumn); setAmountCol(found.amountColumn); }
      else if (same && saved.vendorColumn) { setHeaderRow(saved.headerRow || 5); setVendorCol(saved.vendorColumn); setAmountCol(saved.amountColumn || 'R'); }
      else { setHeaderRow(5); setVendorCol('Q'); setAmountCol('R'); }
      setIdCol(same && saved.idColumn ? saved.idColumn : 'V');
      setDateCol(same && saved.dateColumn !== undefined ? saved.dateColumn : (found?.dateColumn ?? 'A'));
      setNoteCol(same && saved.noteColumn !== undefined ? saved.noteColumn : (found?.noteColumn ?? 'U'));
    } catch (e) { say('err', e instanceof Error ? e.message : 'workbook read failed'); } finally { setBusy(null); }
  }

  const monthSheets = useMemo(() => (meta?.worksheets || []).filter((w) => MONTHISH.test(w.name)), [meta]);
  const detectedOn = useMemo(() => (meta?.worksheets || []).filter((w) => w.monthLayout).map((w) => w.name), [meta]);

  async function saveExcel() {
    if (!excelPick) return;
    const L = /^[A-Za-z]{1,3}$/;
    if (!L.test(vendorCol) || !L.test(amountCol) || !L.test(idCol) || (dateCol && !L.test(dateCol)) || (noteCol && !L.test(noteCol))) { say('err', zh ? '欄位請填英文字母（例如 Q）' : 'Columns must be letters (e.g. Q)'); return; }
    setBusy('excel');
    try {
      const { branchKey, ...file } = excelPick;
      await saveConfig({ excelForBranch: { branchKey, excel: { ...file, mode: 'month', headerRow, vendorColumn: vendorCol.toUpperCase(), amountColumn: amountCol.toUpperCase(), idColumn: idCol.toUpperCase(), dateColumn: dateCol.trim().toUpperCase(), noteColumn: noteCol.trim().toUpperCase() } } },
        zh ? '✓ Excel 已連結，呢間舖嘅新單據會寫入對應月份嗰張 sheet' : '✓ Excel linked — this branch\'s new receipts go onto the matching month sheet');
      setExcelPick(null); setMeta(null);
    } catch (e) { say('err', e instanceof Error ? e.message : 'save failed'); } finally { setBusy(null); }
  }

  async function clearExcel(branchKey: string) {
    if (!confirm(zh ? '取消呢間舖嘅 Excel 同步？已寫入嘅行唔會刪除。' : 'Stop syncing this branch to Excel? Existing rows stay.')) return;
    setBusy('excel');
    try { await saveConfig({ clearExcelForBranch: branchKey }, zh ? '已取消 Excel 同步' : 'Excel sync removed'); }
    catch (e) { say('err', e instanceof Error ? e.message : 'failed'); } finally { setBusy(null); }
  }

  async function connect() {
    setBusy('connect');
    try {
      const res = await adminApiFetch('/api/onedrive/auth');
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || 'no url');
      window.location.href = data.url;
    } catch (e) { say('err', e instanceof Error ? e.message : 'failed'); setBusy(null); }
  }
  async function disconnect() {
    if (!confirm(zh ? '確定中斷 OneDrive 連接？自動入帳會停止，已入帳嘅支出不受影響。' : 'Disconnect OneDrive? Auto-ingest stops; existing expenses stay.')) return;
    setBusy('disconnect');
    try { await adminApiFetch('/api/onedrive/disconnect', { method: 'POST' }); say('ok', zh ? '已中斷連接' : 'Disconnected'); await load(); }
    finally { setBusy(null); }
  }
  /** 「立即同步」: one request reads ~2 files inside Vercel's 60 s, so keep
   *  calling while the server says files are still waiting (≤ 8 rounds). */
  async function syncNow() {
    setBusy('sync'); setSyncResult(null);
    let processed = 0; let queued = 0; let seen = 0; let failed = 0; let remaining = 0;
    try {
      for (let round = 1; round <= 8; round++) {
        const res = await adminApiFetch('/api/onedrive/sync', { method: 'POST' });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || res.statusText);
        if (d.skipped) { setSyncResult(zh ? `略過：${d.skipped}` : `Skipped: ${d.skipped}`); return; }
        if (d.error) { setSyncResult((zh ? '錯誤：' : 'Error: ') + d.error); return; }
        if (round === 1) { seen = d.scan?.seen ?? 0; queued = d.scan?.queued ?? 0; }
        processed += d.process?.processed ?? 0; failed += d.process?.errors?.length ?? 0;
        remaining = d.process?.remaining ?? 0;
        setSyncResult(zh
          ? `掃描 ${seen} 項變動，新排隊 ${queued} 個檔案，已讀入 ${processed} 張單據${failed ? `，${failed} 個失敗` : ''}${remaining ? `，仲有 ${remaining} 張讀緊…` : ''}`
          : `Scanned ${seen} changes, queued ${queued}, read ${processed} receipts${failed ? `, ${failed} failed` : ''}${remaining ? `, ${remaining} still to go…` : ''}`);
        await load();
        if (!remaining) break;
      }
      if (remaining) setSyncResult((s) => (s || '') + (zh ? '（其餘會喺 15 分鐘內自動繼續）' : ' (the rest continue automatically within 15 min)'));
    } catch (e) { setSyncResult((zh ? '錯誤：' : 'Error: ') + (e instanceof Error ? e.message : 'failed')); }
    finally { setBusy(null); }
  }

  if (!canAccess) return <div className="text-center py-20 text-ink-soft">{zh ? '無權限存取' : 'Access Denied'}</div>;

  const connected = status?.connection.connected === true;
  const cfg = status?.config;
  const btn = 'text-xs flex items-center gap-1 px-3 py-2 rounded-lg border border-charcoal/15 bg-white hover:bg-cream disabled:opacity-50';
  const inputCls = 'px-2.5 py-1.5 rounded-lg border border-charcoal/15 text-sm bg-white';
  const statusLabel: Record<string, { zh: string; en: string; cls: string }> = {
    queued: { zh: '排隊中', en: 'Queued', cls: 'bg-sky-50 text-sky-700' },
    done: { zh: '已入帳', en: 'Done', cls: 'bg-emerald-50 text-emerald-700' },
    error: { zh: '失敗', en: 'Error', cls: 'bg-rose-50 text-rose-700' },
    skipped: { zh: '略過', en: 'Skipped', cls: 'bg-gray-100 text-gray-600' },
    no_branch: { zh: '未知分店', en: 'No branch', cls: 'bg-amber-50 text-amber-700' },
  };

  const browserPanel = browseMode ? (
            <div className="glass-card p-5 border-2 border-pink/30">
              <div className="flex items-center gap-2 mb-3 text-sm flex-wrap">
                <span className="font-semibold">{browseMode === 'folder'
                  ? (zh ? `揀「${status?.branches.find((b) => b.key === folderForBranch)?.zh || ''}」嘅單據資料夾` : `Choose receipts folder for ${status?.branches.find((b) => b.key === folderForBranch)?.en || ''}`)
                  : (zh ? `揀「${status?.branches.find((b) => b.key === folderForBranch)?.zh || ''}」嘅 Excel 檔` : `Choose workbook for ${status?.branches.find((b) => b.key === folderForBranch)?.en || ''}`)}</span>
                <span className="text-ink-soft">·</span>
                {crumbs.map((c, i) => (
                  <span key={c.id} className="flex items-center gap-1">
                    {i > 0 && <ChevronRight size={12} className="text-ink-soft" />}
                    <button onClick={() => crumbTo(i)} className={`hover:text-pink ${i === crumbs.length - 1 ? 'font-medium' : 'text-ink-soft'}`}>{c.name}</button>
                  </span>
                ))}
                <button onClick={() => setBrowseMode(null)} className="ml-auto text-ink-soft hover:text-rose-600"><X size={16} /></button>
              </div>
              {browseBusy || !browse ? (
                <p className="text-xs text-ink-soft flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> …</p>
              ) : (
                <div className="space-y-1 max-h-80 overflow-auto">
                  {browse.children.length === 0 && <p className="text-xs text-ink-soft italic">{zh ? '空資料夾' : 'Empty folder'}</p>}
                  {browse.children.map((c) => (
                    <div key={c.id} className="flex items-center gap-2 text-sm">
                      {c.isFolder ? (
                        <button onClick={() => enter(c)} className="flex-1 flex items-center gap-2 text-left px-2 py-1.5 rounded-lg hover:bg-cream">
                          <Folder size={14} className="text-amber-500" /> <span className="truncate">{c.name}</span>
                          <span className="text-[11px] text-ink-soft ml-auto">{c.childCount}</span><ChevronRight size={12} className="text-ink-soft" />
                        </button>
                      ) : browseMode === 'excel' ? (
                        <button onClick={() => pickExcel(c)} className="flex-1 flex items-center gap-2 text-left px-2 py-1.5 rounded-lg hover:bg-emerald-50">
                          <FileSpreadsheet size={14} className="text-emerald-600" /> <span className="truncate">{c.name}</span>
                          <span className="text-[11px] text-pink ml-auto">{zh ? '選用' : 'Use'}</span>
                        </button>
                      ) : (
                        <span className="flex-1 flex items-center gap-2 px-2 py-1.5 text-ink-soft/60"><FileSpreadsheet size={14} /> {c.name}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {browseMode === 'folder' && browse && browse.item.id !== 'root' && (
                <button onClick={chooseCurrentFolder} disabled={busy === 'folder'} className="btn-primary text-xs mt-3 flex items-center gap-1">
                  {busy === 'folder' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} {zh ? `選用「${browse.item.name}」做${status?.branches.find((b) => b.key === folderForBranch)?.zh || ''}嘅單據資料夾` : `Use "${browse.item.name}" for ${status?.branches.find((b) => b.key === folderForBranch)?.en || ''}`}
                </button>
              )}
            </div>
  ) : null;

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <span className="chip mb-3"><Cloud size={12} className="text-pink" /> OneDrive</span>
        <h1 className="text-heading font-display"><span className="text-gradient-pink">{zh ? 'OneDrive 單據連結' : 'OneDrive receipts'}</span></h1>
        <p className="text-ink-soft mt-2 text-sm max-w-2xl">
          {zh
            ? '單據放入 OneDrive 分店資料夾 → 每 15 分鐘自動讀取 → 入支出管理（未核數）→ 同步寫入你 Financial Master 對應月份嗰張 sheet。喺支出管理改數或刪除，Excel 同一行會跟住改。'
            : 'Drop receipts into the chosen OneDrive folder → read every 15 min → 支出管理 rows (unreviewed) → mirrored into your own Excel. Edits in 支出管理 update the same Excel row.'}
        </p>
      </div>

      {flash && (
        <div className={`mb-4 px-3 py-2 rounded-xl text-sm ${flash.kind === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{flash.text}</div>
      )}
      {loading && !status ? (
        <p className="text-ink-soft py-10 flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Loading…</p>
      ) : status && (
        <div className="space-y-5">
          {/* 1. Connection */}
          <div className="glass-card p-6">
            <h2 className="font-bold mb-3">{zh ? '1 · 連接 Microsoft 帳戶' : '1 · Connect Microsoft account'}</h2>
            {!status.configured ? (
              <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                <div>
                  {zh
                    ? '未設定 Microsoft 應用程式。要先喺 Azure 開一個免費 App registration，再喺 Vercel 加 MS_OAUTH_CLIENT_ID 同 MS_OAUTH_CLIENT_SECRET 兩個環境變數。'
                    : 'Microsoft app not configured. Create a free Azure App registration and set MS_OAUTH_CLIENT_ID / MS_OAUTH_CLIENT_SECRET in Vercel.'}
                </div>
              </div>
            ) : connected ? (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="inline-flex items-center gap-1 text-emerald-700"><Check size={14} /> {zh ? '已連接' : 'Connected'}</span>
                <span className="text-ink-soft">{status.connection.name}{status.connection.email ? ` · ${status.connection.email}` : ''}</span>
                {status.connection.connectedAt && <span className="text-xs text-ink-soft">{zh ? '自 ' : 'since '}{fmtTime(status.connection.connectedAt)}</span>}
                <button onClick={disconnect} disabled={busy === 'disconnect'} className={`${btn} ml-auto text-rose-600`}>
                  {busy === 'disconnect' ? <Loader2 size={12} className="animate-spin" /> : <Unlink size={12} />} {zh ? '中斷連接' : 'Disconnect'}
                </button>
              </div>
            ) : (
              <button onClick={connect} disabled={busy === 'connect'} className="btn-primary text-sm flex items-center gap-2">
                {busy === 'connect' ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} {zh ? '登入 Microsoft，連接我的 OneDrive' : 'Sign in with Microsoft to connect OneDrive'}
              </button>
            )}
          </div>

          {/* 2. One folder per branch */}
          <div className={`glass-card p-6 ${!connected ? 'opacity-50 pointer-events-none' : ''}`}>
            <h2 className="font-bold mb-1">{zh ? '2 · 每間舖嘅單據資料夾' : '2 · Receipts folder per branch'}</h2>
            <p className="text-xs text-ink-soft mb-3">
              {zh
                ? '每間舖揀自己嗰個資料夾（可以喺 OneDrive 唔同位置）。資料夾入面再分年份／月份子資料夾都冇問題，全部會自動讀。設定後只會讀由而家開始新上載嘅檔案，舊單據唔會重複入帳。'
                : 'Pick each branch\'s own folder (they can live anywhere in OneDrive). Year/month sub-folders inside are read automatically. Only files uploaded from now on are read — old receipts are not re-entered.'}
            </p>
            <div className="space-y-2">
              {status.branches.map((b) => {
                const chosen = (cfg?.branchFolders || []).find((f) => f.branchKey === b.key);
                return (
                  <div key={b.key} className="flex items-center gap-3 text-sm flex-wrap">
                    <span className="w-36 shrink-0 font-medium">{zh ? b.zh : b.en}</span>
                    {chosen ? (
                      <span className="inline-flex items-center gap-1.5 flex-1 min-w-[200px] truncate"><FolderOpen size={15} className="text-pink shrink-0" /> <span className="truncate">{chosen.path || chosen.name}</span></span>
                    ) : <span className="text-ink-soft italic flex-1 min-w-[200px]">{zh ? '未揀' : 'Not chosen'}</span>}
                    <button onClick={() => openBrowser('folder', b.key)} disabled={busy === 'folder'} className={btn}><Folder size={12} /> {chosen ? (zh ? '改' : 'Change') : (zh ? '揀資料夾' : 'Choose')}</button>
                    {chosen && <button onClick={() => removeBranchFolder(b.key)} disabled={busy === 'folder'} className={`${btn} text-rose-600`}><X size={12} /></button>}
                  </div>
                );
              })}
            </div>
          </div>

          {browseMode === 'folder' && browserPanel}

          {/* 3. Excel — one Financial Master workbook per branch */}
          <div className={`glass-card p-6 ${!connected ? 'opacity-50 pointer-events-none' : ''}`}>
            <h2 className="font-bold mb-1">{zh ? '3 · 同步到每間舖嘅 Financial Master Excel' : '3 · Mirror into each branch\'s Financial Master'}</h2>
            <p className="text-xs text-ink-soft mb-3">
              {zh
                ? '每間舖揀自己嗰個 Excel 檔就得。唔使揀 sheet：每張單據會按佢嘅月份自動寫入嗰張月份 sheet（例如 NOV-2026），放喺「Total Expenses」上面第一個空行 — Vendor 欄寫項目、Amount 欄寫金額、Date 欄（A）寫單據日期、Remarks 欄（U）寫備註。另外會喺嗰行寫一個 SPACO ID 落一個你冇用嘅欄（預設 V 欄），改數或刪除時先搵得返同一行。'
                : 'Pick each branch\'s workbook. No sheet to choose: every receipt goes onto its own month sheet (e.g. NOV-2026) on the first empty line above “Total Expenses” — item under Vendor, amount under Amount, receipt date in the Date column (A), note in Remarks (U). A SPACO ID is written in an unused column (V by default) so edits and deletes find the same line.'}
            </p>
            <div className="space-y-2">
              {status.branches.map((b) => {
                const x = cfg?.excelByBranch?.[b.key];
                const editing = excelPick?.branchKey === b.key;
                const monthMode = x && (x.mode === 'month' || (!x.mode && !x.worksheet));
                return (
                  <div key={b.key}>
                    <div className="flex items-center gap-3 text-sm flex-wrap">
                      <span className="w-36 shrink-0 font-medium">{zh ? b.zh : b.en}</span>
                      {x ? (
                        <span className="flex-1 min-w-[200px] truncate text-xs">
                          <FileSpreadsheet size={14} className="inline text-emerald-600 mr-1" />{x.name}
                          <span className="text-ink-soft">
                            {monthMode
                              ? ` · ${zh ? '按月份 sheet' : 'month sheets'} · Vendor=${x.vendorColumn || 'Q'} Amount=${x.amountColumn || 'R'}${x.dateColumn ? ` ${zh ? '日期' : 'Date'}=${x.dateColumn}` : ''}${x.noteColumn ? ` ${zh ? '備註' : 'Remarks'}=${x.noteColumn}` : ''} ID=${x.idColumn || 'V'}`
                              : ` · sheet「${x.worksheet}」· ID=${x.columns?.id}`}
                          </span>
                        </span>
                      ) : <span className="text-ink-soft italic flex-1 min-w-[200px]">{zh ? '未揀' : 'Not chosen'}</span>}
                      <button onClick={() => openBrowser('excel', b.key)} disabled={busy === 'excel' || busy === 'meta'} className={btn}><FileSpreadsheet size={12} /> {x ? (zh ? '改' : 'Change') : (zh ? '揀 Excel 檔' : 'Choose')}</button>
                      {x && <button onClick={() => clearExcel(b.key)} disabled={busy === 'excel'} className={`${btn} text-rose-600`}><X size={12} /></button>}
                    </div>
                    {editing && excelPick && (
                      <div className="mt-2 ml-0 md:ml-36 border border-charcoal/10 rounded-xl p-4 space-y-3 text-sm bg-white/60">
                        <div className="flex items-center gap-2"><FileSpreadsheet size={15} className="text-emerald-600" /> <span className="font-medium truncate">{excelPick.path}</span>
                          <button onClick={() => { setExcelPick(null); setMeta(null); }} className="ml-auto text-ink-soft hover:text-rose-600"><X size={14} /></button></div>
                        {busy === 'meta' || !meta ? (
                          <p className="text-xs text-ink-soft flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> {zh ? '讀取 sheet…' : 'Reading sheets…'}</p>
                        ) : (
                          <>
                            <p className="text-xs">
                              {monthSheets.length > 0
                                ? (zh ? `搵到 ${monthSheets.length} 張月份 sheet：` : `${monthSheets.length} month sheets found: `) + monthSheets.map((w) => w.name).join('、')
                                : (zh ? '⚠ 呢個檔案未見有月份 sheet（例如 NOV-2026）— 單據會等到嗰個月嘅 sheet 開咗先寫入。' : '⚠ No month sheets (e.g. NOV-2026) yet — rows wait until that month\'s sheet exists.')}
                            </p>
                            <p className="text-xs">
                              {detectedOn.length > 0
                                ? <span className="text-emerald-700 inline-flex items-center gap-1"><Check size={12} /> {zh ? `已自動認出 Vendor / Amount / Date / Remarks 欄（喺 ${detectedOn.slice(0, 3).join('、')}${detectedOn.length > 3 ? '…' : ''}）` : `Vendor / Amount / Date / Remarks columns detected (on ${detectedOn.slice(0, 3).join(', ')}${detectedOn.length > 3 ? '…' : ''})`}</span>
                                : <span className="text-amber-700 inline-flex items-center gap-1"><AlertTriangle size={12} /> {zh ? '未認出「Vendor | Amount」標題，請喺下面填返欄位' : 'Could not find the “Vendor | Amount” header — fill the columns below'}</span>}
                            </p>
                            <div className="flex flex-wrap gap-3">
                              <label className="block"><span className="text-xs font-semibold text-ink-soft">{zh ? 'Vendor（項目）欄' : 'Vendor column'}</span>
                                <input value={vendorCol} onChange={(e) => setVendorCol(e.target.value.toUpperCase())} className={`mt-1 block w-16 ${inputCls}`} /></label>
                              <label className="block"><span className="text-xs font-semibold text-ink-soft">{zh ? 'Amount（金額）欄' : 'Amount column'}</span>
                                <input value={amountCol} onChange={(e) => setAmountCol(e.target.value.toUpperCase())} className={`mt-1 block w-16 ${inputCls}`} /></label>
                              <label className="block"><span className="text-xs font-semibold text-ink-soft">{zh ? '標題行' : 'Header row'}</span>
                                <input type="number" min={1} value={headerRow} onChange={(e) => setHeaderRow(Math.max(1, parseInt(e.target.value) || 1))} className={`mt-1 block w-16 ${inputCls}`} /></label>
                              <label className="block"><span className="text-xs font-semibold text-ink-soft">{zh ? '日期欄（留空＝唔寫）' : 'Date column (blank = skip)'}</span>
                                <input value={dateCol} onChange={(e) => setDateCol(e.target.value.toUpperCase())} className={`mt-1 block w-16 ${inputCls}`} /></label>
                              <label className="block"><span className="text-xs font-semibold text-ink-soft">{zh ? '備註欄（留空＝唔寫）' : 'Remarks column (blank = skip)'}</span>
                                <input value={noteCol} onChange={(e) => setNoteCol(e.target.value.toUpperCase())} className={`mt-1 block w-16 ${inputCls}`} /></label>
                              <label className="block"><span className="text-xs font-semibold text-ink-soft">{zh ? 'SPACO ID 寫入邊欄（空欄）' : 'SPACO ID column (unused)'}</span>
                                <input value={idCol} onChange={(e) => setIdCol(e.target.value.toUpperCase())} className={`mt-1 block w-16 ${inputCls}`} /></label>
                            </div>
                            <p className="text-xs text-ink-soft">{zh ? '每張月份 sheet 都會再自動對一次標題；上面嘅欄位只係認唔出時先用。' : 'Each month sheet is re-checked for the header; the letters above are only the fallback.'}</p>
                            <button onClick={saveExcel} disabled={busy === 'excel'} className="btn-primary text-xs flex items-center gap-1">
                              {busy === 'excel' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} {zh ? '儲存呢間舖嘅 Excel 設定' : 'Save this branch\'s Excel settings'}
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {browseMode === 'excel' && browserPanel}

          {/* 4. Sync + log */}
          <div className={`glass-card p-6 ${!connected ? 'opacity-50 pointer-events-none' : ''}`}>
            <div className="flex items-center gap-3 flex-wrap mb-3">
              <h2 className="font-bold">{zh ? '4 · 同步狀態' : '4 · Sync'}</h2>
              <span className="text-xs text-ink-soft">{zh ? '上次掃描：' : 'Last scan: '}{fmtTime(cfg?.lastScanAt)}</span>
              {cfg?.lastScanError && <span className="text-xs text-rose-600 inline-flex items-center gap-1"><AlertTriangle size={12} /> {cfg.lastScanError}</span>}
              <button onClick={syncNow} disabled={busy === 'sync' || !(cfg?.branchFolders || []).length} className={`${btn} ml-auto`}>
                {busy === 'sync' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} {zh ? '立即同步' : 'Sync now'}
              </button>
            </div>
            {syncResult && <p className="text-sm mb-3">{syncResult}</p>}
            {status.recent.length === 0 ? (
              <p className="text-xs text-ink-soft italic">{zh ? '仲未讀過任何檔案。上載一張單據到分店資料夾試試。' : 'No files read yet — upload a receipt into a branch folder to try it.'}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-ink-soft text-left">
                    <th className="py-1 pr-2">{zh ? '檔案' : 'File'}</th><th className="pr-2">{zh ? '資料夾' : 'Folder'}</th><th className="pr-2">{zh ? '分店' : 'Branch'}</th><th className="pr-2">{zh ? '狀態' : 'Status'}</th><th className="pr-2">{zh ? '時間' : 'When'}</th><th></th>
                  </tr></thead>
                  <tbody>
                    {status.recent.map((f) => {
                      const s = statusLabel[f.status] || { zh: f.status, en: f.status, cls: 'bg-gray-100' };
                      return (
                        <tr key={f.id} className="border-t border-charcoal/5">
                          <td className="py-1.5 pr-2 max-w-[220px] truncate">{f.webUrl ? <a href={f.webUrl} target="_blank" rel="noreferrer" className="hover:text-pink inline-flex items-center gap-1">{f.name} <ExternalLink size={10} /></a> : f.name}{f.fileDeleted && <span className="ml-1 text-rose-500">({zh ? '已刪' : 'deleted'})</span>}</td>
                          <td className="pr-2 text-ink-soft max-w-[160px] truncate">{f.folderPath?.replace(/\/[^/]*$/, '')}</td>
                          <td className="pr-2">{status.branches.find((b) => b.key === f.branchKey)?.[zh ? 'zh' : 'en'] || f.branchKey || '—'}</td>
                          <td className="pr-2"><span className={`px-1.5 py-0.5 rounded ${s.cls}`}>{zh ? s.zh : s.en}</span>{f.error && <span className="ml-1 text-rose-600" title={f.error}>{f.error.slice(0, 60)}</span>}</td>
                          <td className="pr-2 text-ink-soft whitespace-nowrap">{fmtTime(f.processedAt || f.queuedAt)}</td>
                          <td>{f.expenseId && <a href={`/${locale}/admin/expenses`} className="text-pink hover:underline">{zh ? '支出管理' : 'Expenses'}</a>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
