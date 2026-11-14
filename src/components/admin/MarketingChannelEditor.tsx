'use client';

// 來源渠道 — the ONE channel list (site review 2026-11-13, phase 4b).
//
// Every channel a booking can carry is a row here: its labels, whether
// customers see it at 確認預訂「喺邊度得知我哋」, whether it is a broker /
// platform channel (staff pick it in 後台直接落單; a booking with it and no
// commission rule is flagged in 支出管理), whether the month-close Excel
// overview gives it its own column pair, and its commission rule.
//
// Rows → site_content/channels (lib/marketingChannels, which also rewrites
// the legacy customer-options text). Commission → system/finance_config,
// the same data 支出管理's rules panel shows.

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  getChannelRegistry, saveChannelRegistry, defaultChannelRegistry, OTHER_OPTION, RESERVED_CHANNEL_IDS, type ChannelDef,
} from '@/lib/marketingChannels';
import { getFinanceConfig, saveFinanceConfig, type FinanceConfig } from '@/lib/expenses';
import type { CommissionRule } from '@/types';
import { Megaphone, Plus, Trash2, Loader2, Check, RotateCcw, ArrowUp, ArrowDown } from 'lucide-react';

interface Row extends ChannelDef {
  isNew?: boolean;
}

interface CommDraft { enabled: boolean; pct: string; base: CommissionRule['base'] }

function makeId(label: string, taken: Set<string>): string {
  const slug = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  let candidate = /^[a-z0-9][a-z0-9-]{1,29}$/.test(slug) ? slug : `ch-${Date.now().toString(36)}`;
  while (taken.has(candidate) || (RESERVED_CHANNEL_IDS as readonly string[]).includes(candidate)) {
    candidate = `ch-${Date.now().toString(36)}${Math.floor(Math.random() * 100)}`;
  }
  return candidate;
}

const CELL = 'px-3 py-2 rounded-xl border-2 border-charcoal/15 bg-white text-sm';
const GRID = 'grid grid-cols-[1fr,1fr,64px,52px,52px,52px,minmax(170px,auto),84px] gap-2 items-center';

export default function MarketingChannelEditor({ locale }: { locale: 'zh' | 'en' }) {
  const zh = locale === 'zh';
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [config, setConfig] = useState<FinanceConfig | null>(null);
  const [comm, setComm] = useState<Record<string, CommDraft>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(force = false) {
    setLoading(true);
    try {
      const [registry, cfg] = await Promise.all([getChannelRegistry(force), getFinanceConfig()]);
      setRows(registry.map((c) => ({ ...c })));
      setConfig(cfg);
      const drafts: Record<string, CommDraft> = {};
      for (const c of registry) {
        const rule = cfg.commissionRules[c.id];
        drafts[c.id] = rule
          ? { enabled: true, pct: String(rule.pct), base: rule.base }
          : { enabled: false, pct: '10', base: c.id === 'agent' ? 'rent' : 'total' };
      }
      // Rules for ids no longer in the list still show, so they can be removed.
      for (const [id, rule] of Object.entries(cfg.commissionRules)) {
        if (!drafts[id]) drafts[id] = { enabled: true, pct: String(rule.pct), base: rule.base };
      }
      setComm(drafts);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const update = (i: number, p: Partial<Row>) => setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...p } : r)));
  const removeRow = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));
  const move = (i: number, by: number) => setRows((prev) => {
    const j = i + by;
    if (j < 0 || j >= prev.length) return prev;
    const next = [...prev];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const addRow = (platform: boolean) =>
    setRows((prev) => [...prev, { id: '', zh: '', en: '', customer: !platform, platform, excel: platform, isNew: true }]);
  const setCommFor = (id: string, p: Partial<CommDraft>) =>
    setComm((prev) => ({ ...prev, [id]: { ...(prev[id] || { enabled: false, pct: '10', base: 'total' }), ...p } }));

  function CommControls({ id }: { id: string }) {
    const d = comm[id] || { enabled: false, pct: '10', base: 'total' as const };
    return (
      <div className="flex items-center gap-1.5 shrink-0">
        <label className="flex items-center gap-1 text-[11px] text-ink-soft whitespace-nowrap cursor-pointer">
          <input type="checkbox" checked={d.enabled} onChange={(e) => setCommFor(id, { enabled: e.target.checked })} className="w-3.5 h-3.5 accent-pink-500" />
          {zh ? '佣金' : 'Comm.'}
        </label>
        {d.enabled && (
          <>
            <input type="number" step="0.1" min={0} value={d.pct} onChange={(e) => setCommFor(id, { pct: e.target.value })}
              className="w-14 px-1.5 py-1 rounded-lg border border-charcoal/15 text-xs bg-white text-right" />
            <span className="text-[11px] text-ink-soft">%</span>
            <select value={d.base} onChange={(e) => setCommFor(id, { base: e.target.value as CommissionRule['base'] })}
              className="px-1.5 py-1 rounded-lg border border-charcoal/15 text-[11px] bg-white">
              <option value="total">{zh ? '全單' : 'Total'}</option>
              <option value="rent">{zh ? '只計場租' : 'Rent only'}</option>
            </select>
          </>
        )}
      </div>
    );
  }

  async function save() {
    if (!config) return;
    setError(null);
    setSaving(true);
    try {
      const taken = new Set(rows.map((r) => r.id).filter(Boolean));
      const finalRows: ChannelDef[] = rows
        .filter((r) => r.zh.trim() || r.en.trim())
        .map((r) => {
          const zhLabel = r.zh.trim() || r.en.trim();
          const en = r.en.trim() || zhLabel;
          const id = r.id || makeId(en || zhLabel, taken);
          taken.add(id);
          return { id, zh: zhLabel, en, customer: r.customer, platform: r.platform, excel: r.excel };
        });
      if (finalRows.length === 0) throw new Error(zh ? '最少要有一個渠道' : 'At least one channel is needed');
      await saveChannelRegistry(finalRows, user?.email || 'admin');

      // Commission rules → system/finance_config, rebuilt from what is ticked.
      const rules: Record<string, CommissionRule> = {};
      for (const [id, d] of Object.entries(comm)) {
        if (!d.enabled) continue;
        const pct = parseFloat(d.pct);
        if (Number.isFinite(pct) && pct > 0) rules[id] = { pct, base: d.base };
      }
      await saveFinanceConfig({ ...config, commissionRules: rules });

      await load(true);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1800);
    } catch (err) {
      setError((zh ? '儲存失敗：' : 'Save failed: ') + (err instanceof Error ? err.message : 'unknown'));
    } finally {
      setSaving(false);
    }
  }

  const flag = (i: number, key: 'customer' | 'platform' | 'excel', r: Row) => (
    <label className="flex justify-center cursor-pointer" title={key}>
      <input type="checkbox" checked={r[key]} onChange={(e) => update(i, { [key]: e.target.checked })} className="w-4 h-4 accent-pink-500" />
    </label>
  );

  return (
    <div className="rounded-2xl border border-pink/25 bg-pink/[0.03] p-5 mb-6">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
        <div>
          <h3 className="font-bold flex items-center gap-2">
            <Megaphone size={16} className="text-pink" />
            {zh ? '來源渠道 + 佣金' : 'Channels + commission'}
          </h3>
          <p className="text-xs text-ink-soft mt-1 max-w-2xl leading-relaxed">
            {zh
              ? '一張表管所有渠道：客人見到嘅（確認預訂「喺邊度得知我哋」）、行家／平台渠道（員工開單時揀，有佣金），同月結 Excel 要唔要獨立一欄。佣金 % 同「支出管理 → 規則設定」係同一份數據。'
              : 'One list for every channel: what customers pick at checkout, broker / platform channels staff pick (with commission), and which get their own column in the month-close Excel. Commission is the same data as the Expenses rules panel.'}
          </p>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-ink-soft py-4 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</p>
      ) : (
        <>
          <div className="mt-3 space-y-2 overflow-x-auto">
            <div className={`${GRID} px-1 min-w-[900px]`}>
              <span className="text-[11px] font-semibold text-ink-soft uppercase tracking-wider">{zh ? '中文顯示名' : 'Chinese'}</span>
              <span className="text-[11px] font-semibold text-ink-soft uppercase tracking-wider">{zh ? '英文顯示名' : 'English'}</span>
              <span className="text-[11px] font-semibold text-ink-soft uppercase tracking-wider">ID</span>
              <span className="text-[11px] font-semibold text-ink-soft uppercase tracking-wider text-center" title={zh ? '客人喺確認預訂時可以揀' : 'Offered to customers'}>{zh ? '客人見' : 'Cust.'}</span>
              <span className="text-[11px] font-semibold text-ink-soft uppercase tracking-wider text-center" title={zh ? '行家／平台渠道：員工開單時揀；冇佣金規則會提示' : 'Broker / platform channel'}>{zh ? '平台' : 'Platf.'}</span>
              <span className="text-[11px] font-semibold text-ink-soft uppercase tracking-wider text-center" title={zh ? '月結 Excel 第一個表獨立一欄' : 'Own column in the month-close Excel'}>Excel</span>
              <span className="text-[11px] font-semibold text-ink-soft uppercase tracking-wider">{zh ? '佣金設定' : 'Commission'}</span>
              <span />
            </div>
            {rows.map((r, i) => (
              <div key={r.id || `new-${i}`} className={`${GRID} min-w-[900px] ${r.platform ? 'bg-amber-50/60 rounded-xl' : ''}`}>
                <input value={r.zh} onChange={(e) => update(i, { zh: e.target.value })} placeholder={zh ? '例：小紅書 / Klook' : 'e.g. 小紅書'} className={CELL} />
                <input value={r.en} onChange={(e) => update(i, { en: e.target.value })} placeholder={zh ? '留空＝同中文' : 'blank = same'} className={CELL} />
                <span className="text-[10px] font-mono text-ink-soft truncate" title={r.id}>{r.id || (zh ? '自動' : 'auto')}</span>
                {flag(i, 'customer', r)}
                {flag(i, 'platform', r)}
                {flag(i, 'excel', r)}
                {r.id
                  ? <CommControls id={r.id} />
                  : <span className="text-[10px] text-ink-soft">{zh ? '儲存後可設佣金' : 'Save first'}</span>}
                <div className="flex items-center">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="w-6 h-8 text-ink-soft hover:text-ink disabled:opacity-20" title={zh ? '上移' : 'Up'}><ArrowUp size={12} /></button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} className="w-6 h-8 text-ink-soft hover:text-ink disabled:opacity-20" title={zh ? '下移' : 'Down'}><ArrowDown size={12} /></button>
                  <button type="button" onClick={() => removeRow(i)} className="w-8 h-8 rounded-lg hover:bg-rose-50 text-rose-400 hover:text-rose-600 flex items-center justify-center" title={zh ? '刪除' : 'Remove'}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
            {/* Fixed 其他 row */}
            <div className={`${GRID} min-w-[900px] opacity-60`}>
              <span className={`${CELL} border-dashed border-charcoal/10 bg-stone-50`}>{OTHER_OPTION.zh}</span>
              <span className={`${CELL} border-dashed border-charcoal/10 bg-stone-50`}>{OTHER_OPTION.en}</span>
              <span className="text-[10px] font-mono text-ink-soft">other</span>
              <span className="text-center text-xs">✓</span><span /><span />
              <span className="text-[10px] text-ink-soft">{zh ? '自動包含（要填說明）' : 'always offered'}</span>
              <span className="text-[10px] text-ink-soft text-center">🔒</span>
            </div>
          </div>
          {/* Rules whose channel is no longer a row. */}
          {Object.keys(comm).filter((id) => comm[id].enabled && !rows.some((r) => r.id === id)).length > 0 && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs">
              <p className="font-semibold text-amber-800 mb-1">{zh ? '以下佣金規則嘅渠道已經唔喺清單：' : 'Commission rules for channels no longer listed:'}</p>
              {Object.keys(comm).filter((id) => comm[id].enabled && !rows.some((r) => r.id === id)).map((id) => (
                <div key={id} className="flex items-center gap-3 py-0.5">
                  <span className="font-mono">{id}</span>
                  <CommControls id={id} />
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 mt-4 flex-wrap">
            <button type="button" onClick={() => addRow(false)}
              className="px-3 py-2 rounded-xl border border-charcoal/15 bg-white text-xs font-semibold hover:bg-cream flex items-center gap-1.5">
              <Plus size={13} /> {zh ? '新增客人渠道' : 'Add customer channel'}
            </button>
            <button type="button" onClick={() => addRow(true)}
              className="px-3 py-2 rounded-xl border border-amber-300 bg-amber-50 text-xs font-semibold hover:bg-amber-100 flex items-center gap-1.5">
              <Plus size={13} /> {zh ? '新增行家／平台渠道' : 'Add broker / platform channel'}
            </button>
            <button type="button" onClick={save} disabled={saving}
              className="btn-primary text-xs flex items-center gap-1.5 disabled:opacity-50">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              {zh ? '儲存渠道 + 佣金設定' : 'Save channels + commission'}
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!window.confirm(zh ? '恢復預設清單（Google / Instagram / Facebook / 小紅書 / 朋友介紹 + 行家 / Reubird / Common Room）？佣金規則不變。' : 'Restore the default list? Commission rules unchanged.')) return;
                await saveChannelRegistry(defaultChannelRegistry(), user?.email || 'admin');
                await load(true);
              }}
              className="px-3 py-2 rounded-xl text-xs text-ink-soft hover:text-ink flex items-center gap-1">
              <RotateCcw size={12} /> {zh ? '恢復預設' : 'Defaults'}
            </button>
            {savedFlash && <span className="text-xs text-emerald-600 font-semibold">✓ {zh ? '已儲存，全站即時生效' : 'Saved'}</span>}
          </div>
          <p className="text-[11px] text-ink-soft mt-2">
            {zh
              ? 'ID 一經使用唔會改（舊訂單靠佢分組）；顯示名可以隨時改。刪除一個渠道，舊訂單仍然會顯示當時儲存嘅名。'
              : 'An id never changes once used (old bookings group by it); labels can change any time. Deleting a channel keeps the name saved on old bookings.'}
          </p>
          {error && <p className="text-xs text-rose-600 mt-2">{error}</p>}
        </>
      )}
    </div>
  );
}
