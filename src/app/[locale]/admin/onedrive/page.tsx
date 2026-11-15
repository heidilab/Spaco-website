'use client';

// OneDrive 單據連結 (2026-11) — Heidi connects her personal OneDrive once,
// picks one folder per branch (they live in different places in her
// drive; month sub-folders inside are read automatically) and the Excel
// workbook + columns the rows should mirror into. From then on
// /api/cron/onedrive-receipts reads every new file into 支出管理.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { adminApiFetch } from '@/lib/adminApiFetch';
import type { ExcelColumnKey, OneDriveReceiptsConfig } from '@/types';
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
interface WorkbookMeta {
  worksheets: Array<{ id: string; name: string; headers: string[]; usedAddress?: string }>;
  tables: Array<{ id: string; name: string; worksheet: string; address: string; columns: string[] }>;
}

const COLUMN_FIELDS: Array<{ key: ExcelColumnKey; zh: string; en: string; required?: boolean }> = [
  { key: 'id', zh: 'SPACO ID（必須，用來搵返同一行）', en: 'SPACO ID (required — how a row is found again)', required: true },
  { key: 'date', zh: '日期', en: 'Date' },
  { key: 'branch', zh: '分店', en: 'Branch' },
  { key: 'item', zh: '項目（商戶 · 內容）', en: 'Item (vendor · summary)' },
  { key: 'vendor', zh: '商戶', en: 'Vendor' },
  { key: 'amount', zh: '金額', en: 'Amount' },
  { key: 'category', zh: '類別', en: 'Category' },
  { key: 'note', zh: '備註', en: 'Note' },
  { key: 'reviewed', zh: '已核數（✓）', en: 'Reviewed (✓)' },
  { key: 'link', zh: '單據連結', en: 'Receipt link' },
];

function colLetter(i: number): string {
  let n = i + 1; let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
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

  // Excel mapping draft
  const [excelPick, setExcelPick] = useState<{ itemId: string; name: string; path: string } | null>(null);
  const [meta, setMeta] = useState<WorkbookMeta | null>(null);
  const [sheet, setSheet] = useState('');
  const [table, setTable] = useState('');
  const [headerRow, setHeaderRow] = useState(1);
  const [columns, setColumns] = useState<Partial<Record<ExcelColumnKey, string>>>({});

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
    setFolderForBranch(mode === 'folder' ? branchKey || null : null);
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
    setExcelPick({ itemId: item.id, name: item.name, path: item.path });
    setBrowseMode(null);
    setMeta(null);
    setBusy('meta');
    try {
      const res = await adminApiFetch(`/api/onedrive/excel-meta?itemId=${encodeURIComponent(item.id)}`);
      const data: WorkbookMeta & { error?: string } = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setMeta(data);
      const first = data.worksheets[0];
      setSheet(first?.name || '');
      setTable('');
      setHeaderRow(1);
      setColumns(autoMap(first?.headers || []));
    } catch (e) { say('err', e instanceof Error ? e.message : 'workbook read failed'); } finally { setBusy(null); }
  }

  /** Pre-fill the mapping from header text (she confirms). */
  function autoMap(headers: string[]): Partial<Record<ExcelColumnKey, string>> {
    const out: Partial<Record<ExcelColumnKey, string>> = {};
    const rules: Array<[ExcelColumnKey, RegExp]> = [
      ['id', /spaco|^id$|編號|識別/i], ['date', /date|日期/i], ['branch', /branch|分店|店/i], ['amount', /amount|金額|total|hk\$|\$/i],
      ['vendor', /vendor|supplier|商戶|供應商|shop/i], ['category', /category|類別|分類/i], ['item', /item|項目|description|內容|詳情/i],
      ['note', /note|remark|備註/i], ['reviewed', /review|核|checked|✓/i], ['link', /link|連結|url|receipt/i],
    ];
    headers.forEach((h, i) => {
      for (const [k, re] of rules) if (!out[k] && h && re.test(h)) { out[k] = colLetter(i); break; }
    });
    return out;
  }

  const sheetMeta = useMemo(() => meta?.worksheets.find((w) => w.name === sheet), [meta, sheet]);
  const sheetTables = useMemo(() => (meta?.tables || []).filter((t) => t.worksheet === sheet), [meta, sheet]);
  const headerOptions = useMemo(() => {
    const hs = sheetMeta?.headers || [];
    const n = Math.max(hs.length, 26);
    return Array.from({ length: n }, (_, i) => ({ letter: colLetter(i), label: hs[i] ? `${colLetter(i)} · ${hs[i]}` : colLetter(i) }));
  }, [sheetMeta]);

  async function saveExcel() {
    if (!excelPick || !sheet) return;
    if (!columns.id) { say('err', zh ? '請揀「SPACO ID」欄 — 建議喺 Excel 最右加一欄，可以隱藏' : 'Pick the SPACO ID column — add one at the far right (it can be hidden)'); return; }
    setBusy('excel');
    try {
      await saveConfig({ excel: { ...excelPick, worksheet: sheet, table: table || undefined, headerRow, columns } },
        zh ? '✓ Excel 已連結，新單據會寫入呢張 sheet' : '✓ Excel linked — new receipts will be written to this sheet');
      setExcelPick(null); setMeta(null);
    } catch (e) { say('err', e instanceof Error ? e.message : 'save failed'); } finally { setBusy(null); }
  }

  async function clearExcel() {
    if (!confirm(zh ? '取消 Excel 同步？已寫入嘅行唔會刪除。' : 'Stop syncing to Excel? Existing rows stay.')) return;
    setBusy('excel');
    try { await saveConfig({ clearExcel: true }, zh ? '已取消 Excel 同步' : 'Excel sync removed'); }
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
  async function syncNow() {
    setBusy('sync'); setSyncResult(null);
    try {
      const res = await adminApiFetch('/api/onedrive/sync', { method: 'POST' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || res.statusText);
      if (d.skipped) setSyncResult(zh ? `略過：${d.skipped}` : `Skipped: ${d.skipped}`);
      else if (d.error) setSyncResult((zh ? '錯誤：' : 'Error: ') + d.error);
      else setSyncResult(zh
        ? `掃描 ${d.scan?.seen ?? 0} 項變動，新排隊 ${d.scan?.queued ?? 0} 個檔案，今次讀入 ${d.process?.processed ?? 0} 張單據${d.process?.errors?.length ? `，${d.process.errors.length} 個失敗` : ''}`
        : `Scanned ${d.scan?.seen ?? 0} changes, queued ${d.scan?.queued ?? 0}, read ${d.process?.processed ?? 0} receipts${d.process?.errors?.length ? `, ${d.process.errors.length} failed` : ''}`);
      await load();
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
                  ? (zh ? `揀「${status.branches.find((b) => b.key === folderForBranch)?.zh || ''}」嘅單據資料夾` : `Choose receipts folder for ${status.branches.find((b) => b.key === folderForBranch)?.en || ''}`)
                  : (zh ? '揀 Excel 檔' : 'Choose workbook')}</span>
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
                  {busy === 'folder' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} {zh ? `選用「${browse.item.name}」做${status.branches.find((b) => b.key === folderForBranch)?.zh || ''}嘅單據資料夾` : `Use "${browse.item.name}" for ${status.branches.find((b) => b.key === folderForBranch)?.en || ''}`}
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
            ? '單據放入 OneDrive 指定資料夾 → 每 15 分鐘自動讀取 → 入支出管理（未核數）→ 同步寫入你自己嘅 Excel。喺支出管理改數，Excel 同一行會跟住改。'
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

          {/* 3. Excel */}
          <div className={`glass-card p-6 ${!connected ? 'opacity-50 pointer-events-none' : ''}`}>
            <h2 className="font-bold mb-1">{zh ? '3 · 同步到我的 Excel' : '3 · Mirror into my Excel'}</h2>
            <p className="text-xs text-ink-soft mb-3">
              {zh ? '揀你 OneDrive 入面嘅 Excel 檔同 sheet，再對應每欄。一定要有一欄放 SPACO ID（可以隱藏）— 改數或刪除時先搵得返同一行。' : 'Pick the workbook and sheet in your OneDrive, then map the columns. One column must hold the SPACO ID (can be hidden) so edits and deletes find the same row.'}
            </p>
            {cfg?.excel && !excelPick && (
              <div className="flex flex-wrap items-center gap-3 text-sm mb-2">
                <span className="inline-flex items-center gap-1.5"><FileSpreadsheet size={15} className="text-emerald-600" /> <span className="font-medium">{cfg.excel.path || cfg.excel.name}</span></span>
                <span className="text-xs text-ink-soft">{zh ? 'sheet' : 'sheet'} 「{cfg.excel.worksheet}」{cfg.excel.table ? ` · ${zh ? '表格' : 'table'} ${cfg.excel.table}` : ''} · {Object.entries(cfg.excel.columns).map(([k, v]) => `${k}=${v}`).join(' ')}</span>
                <button onClick={clearExcel} disabled={busy === 'excel'} className={`${btn} ml-auto text-rose-600`}><X size={12} /> {zh ? '取消同步' : 'Remove'}</button>
              </div>
            )}
            {!excelPick && (
              <button onClick={() => openBrowser('excel')} className={btn}><FileSpreadsheet size={12} /> {cfg?.excel ? (zh ? '改 Excel 檔 / 欄' : 'Change workbook / columns') : (zh ? '揀 Excel 檔' : 'Choose workbook')}</button>
            )}
            {excelPick && (
              <div className="border border-charcoal/10 rounded-xl p-4 space-y-3 text-sm">
                <div className="flex items-center gap-2"><FileSpreadsheet size={15} className="text-emerald-600" /> <span className="font-medium">{excelPick.path}</span>
                  <button onClick={() => { setExcelPick(null); setMeta(null); }} className="ml-auto text-ink-soft hover:text-rose-600"><X size={14} /></button></div>
                {busy === 'meta' || !meta ? (
                  <p className="text-xs text-ink-soft flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> {zh ? '讀取 sheet 同標題…' : 'Reading sheets and headers…'}</p>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-3">
                      <label className="block"><span className="text-xs font-semibold text-ink-soft">{zh ? 'Sheet' : 'Sheet'}</span>
                        <select value={sheet} onChange={(e) => { setSheet(e.target.value); setTable(''); setColumns(autoMap(meta.worksheets.find((w) => w.name === e.target.value)?.headers || [])); }} className={`mt-1 block ${inputCls}`}>
                          {meta.worksheets.map((w) => <option key={w.id} value={w.name}>{w.name}</option>)}
                        </select></label>
                      {sheetTables.length > 0 && (
                        <label className="block"><span className="text-xs font-semibold text-ink-soft">{zh ? '格式化表格（建議）' : 'Formatted table (recommended)'}</span>
                          <select value={table} onChange={(e) => setTable(e.target.value)} className={`mt-1 block ${inputCls}`}>
                            <option value="">{zh ? '（唔用表格，直接加落最尾一行）' : '(no table — append below last row)'}</option>
                            {sheetTables.map((t) => <option key={t.id} value={t.name}>{t.name} · {t.address.split('!').pop()}</option>)}
                          </select></label>
                      )}
                      <label className="block"><span className="text-xs font-semibold text-ink-soft">{zh ? '標題喺第幾行' : 'Header row'}</span>
                        <input type="number" min={1} value={headerRow} onChange={(e) => setHeaderRow(Math.max(1, parseInt(e.target.value) || 1))} className={`mt-1 block w-20 ${inputCls}`} /></label>
                    </div>
                    {sheetMeta && sheetMeta.headers.length > 0 && (
                      <p className="text-xs text-ink-soft">{zh ? '第一行標題：' : 'First row: '}{sheetMeta.headers.filter(Boolean).join(' · ') || '—'}</p>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {COLUMN_FIELDS.map((f) => (
                        <label key={f.key} className="flex items-center gap-2">
                          <span className={`text-xs w-56 shrink-0 ${f.required ? 'font-semibold' : 'text-ink-soft'}`}>{zh ? f.zh : f.en}</span>
                          <select value={columns[f.key] || ''} onChange={(e) => setColumns((c) => ({ ...c, [f.key]: e.target.value || undefined }))} className={`flex-1 ${inputCls} ${f.required && !columns[f.key] ? 'border-rose-300' : ''}`}>
                            <option value="">{zh ? '— 唔寫 —' : '— skip —'}</option>
                            {headerOptions.map((o) => <option key={o.letter} value={o.letter}>{o.label}</option>)}
                          </select>
                        </label>
                      ))}
                    </div>
                    <button onClick={saveExcel} disabled={busy === 'excel'} className="btn-primary text-xs flex items-center gap-1">
                      {busy === 'excel' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} {zh ? '儲存 Excel 設定' : 'Save Excel settings'}
                    </button>
                  </>
                )}
              </div>
            )}
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
