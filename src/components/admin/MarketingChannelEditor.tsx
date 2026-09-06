'use client';

// Structured editor for the 來源渠道選項 (marketing-channel options)
// customers pick from at 確認預訂「喺邊度得知我哋」 — plus, per Heidi's
// 2026-09 spec, the COMMISSION settings for every channel live here too:
// tick 需要佣金 on a row, give it a %, and the same rule appears in
// 支出管理's rules panel (both read/write system/finance_config, so the
// two screens can never disagree).
//
// Broker/platform channels (行家 / Reubird / Common Room) are not
// customer-facing options — they're picked in 後台直接落單 — but their
// commission rules are managed here in a fixed section below the
// editable rows.
//
// Channel-list storage stays the same line format (`id | 中文 | English`)
// in site_content/settings → marketing_channels.

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { updateSiteContent } from '@/lib/content';
import {
  getMarketingChannelOptions, OTHER_OPTION, type MarketingChannelOption,
} from '@/lib/marketingChannels';
import {
  getFinanceConfig, saveFinanceConfig, type FinanceConfig,
} from '@/lib/expenses';
import type { CommissionRule } from '@/types';
import { Megaphone, Plus, Trash2, Loader2, Check, RotateCcw } from 'lucide-react';

interface Row extends MarketingChannelOption {
  isNew?: boolean;
}

/** Broker/platform presets — commission editable here, names fixed. */
const BROKER_PRESETS: { id: string; zh: string; en: string; defaultBase: CommissionRule['base'] }[] = [
  { id: 'agent', zh: '行家', en: 'Agent', defaultBase: 'rent' },
  { id: 'reubird', zh: 'Reubird', en: 'Reubird', defaultBase: 'total' },
  { id: 'commonroom', zh: 'Common Room', en: 'Common Room', defaultBase: 'total' },
];

interface CommDraft { enabled: boolean; pct: string; base: CommissionRule['base'] }

function makeId(zh: string, taken: Set<string>): string {
  const slug = zh.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  let candidate = /^[a-z0-9-]{2,30}$/.test(slug) ? slug : `ch-${Date.now().toString(36)}`;
  while (taken.has(candidate) || candidate === 'other' || candidate === 'loyalty_member') {
    candidate = `ch-${Date.now().toString(36)}${Math.floor(Math.random() * 100)}`;
  }
  return candidate;
}

export default function MarketingChannelEditor({ locale }: { locale: 'zh' | 'en' }) {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [config, setConfig] = useState<FinanceConfig | null>(null);
  const [comm, setComm] = useState<Record<string, CommDraft>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [opts, cfg] = await Promise.all([getMarketingChannelOptions(), getFinanceConfig()]);
      setRows(opts.filter((o) => o.id !== 'other'));
      setConfig(cfg);
      // Commission drafts for every known id (options + presets).
      const drafts: Record<string, CommDraft> = {};
      const seed = (id: string, defaultBase: CommissionRule['base']) => {
        const rule = cfg.commissionRules[id];
        drafts[id] = rule
          ? { enabled: true, pct: String(rule.pct), base: rule.base }
          : { enabled: false, pct: '10', base: defaultBase };
      };
      for (const o of opts) if (o.id !== 'other') seed(o.id, 'total');
      for (const p of BROKER_PRESETS) seed(p.id, p.defaultBase);
      setComm(drafts);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  function updateRow(i: number, field: 'zh' | 'en', value: string) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  }
  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }
  function addRow() {
    setRows((prev) => [...prev, { id: '', zh: '', en: '', isNew: true }]);
  }
  function setCommFor(id: string, patch: Partial<CommDraft>) {
    setComm((prev) => ({ ...prev, [id]: { ...(prev[id] || { enabled: false, pct: '10', base: 'total' }), ...patch } }));
  }

  /** Commission control cluster shared by option rows and preset rows. */
  function CommControls({ id }: { id: string }) {
    const d = comm[id] || { enabled: false, pct: '10', base: 'total' as const };
    return (
      <div className="flex items-center gap-1.5 shrink-0">
        <label className="flex items-center gap-1 text-[11px] text-ink-soft whitespace-nowrap cursor-pointer">
          <input
            type="checkbox"
            checked={d.enabled}
            onChange={(e) => setCommFor(id, { enabled: e.target.checked })}
            className="w-3.5 h-3.5 accent-pink-500"
          />
          {locale === 'zh' ? '佣金' : 'Comm.'}
        </label>
        {d.enabled && (
          <>
            <input
              type="number" step="0.1" min={0}
              value={d.pct}
              onChange={(e) => setCommFor(id, { pct: e.target.value })}
              className="w-14 px-1.5 py-1 rounded-lg border border-charcoal/15 text-xs bg-white text-right"
            />
            <span className="text-[11px] text-ink-soft">%</span>
            <select
              value={d.base}
              onChange={(e) => setCommFor(id, { base: e.target.value as CommissionRule['base'] })}
              className="px-1.5 py-1 rounded-lg border border-charcoal/15 text-[11px] bg-white"
            >
              <option value="total">{locale === 'zh' ? '全單' : 'Total'}</option>
              <option value="rent">{locale === 'zh' ? '只計場租' : 'Rent only'}</option>
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
      // 1. Channel option list → site_content (same line format as before).
      const taken = new Set(rows.map((r) => r.id).filter(Boolean));
      const idByIndex: string[] = [];
      const finalRows = rows
        .filter((r) => r.zh.trim() || r.en.trim())
        .map((r) => {
          const zh = r.zh.trim() || r.en.trim();
          const en = r.en.trim() || zh;
          const id = r.id || makeId(en || zh, taken);
          taken.add(id);
          idByIndex.push(id);
          return { id, zh, en };
        });
      const text = finalRows.map((r) => `${r.id} | ${r.zh} | ${r.en}`).join('\n');
      await updateSiteContent('settings', {
        marketing_channels: { zh: text, en: text },
      }, user?.email || 'admin');

      // 2. Commission rules → system/finance_config. The map is rebuilt
      //    from whatever is TICKED (options + broker presets), so both
      //    this screen and 支出管理 always show the same rules.
      const rules: Record<string, CommissionRule> = {};
      const applyDraft = (id: string) => {
        const d = comm[id];
        if (d?.enabled) {
          const pct = parseFloat(d.pct);
          if (Number.isFinite(pct) && pct > 0) rules[id] = { pct, base: d.base };
        }
      };
      for (const r of finalRows) applyDraft(r.id);
      for (const p of BROKER_PRESETS) applyDraft(p.id);
      await saveFinanceConfig({ ...config, commissionRules: rules });

      await load();
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1800);
    } catch (err) {
      setError((locale === 'zh' ? '儲存失敗：' : 'Save failed: ') + (err instanceof Error ? err.message : 'unknown'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-pink/25 bg-pink/[0.03] p-5 mb-6">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
        <div>
          <h3 className="font-bold flex items-center gap-2">
            <Megaphone size={16} className="text-pink" />
            {locale === 'zh' ? '來源渠道選項 + 佣金' : 'Marketing channels + commission'}
          </h3>
          <p className="text-xs text-ink-soft mt-1 max-w-2xl leading-relaxed">
            {locale === 'zh'
              ? '客人第一次成功預訂前會被問「喺邊度得知我哋」。每個渠道可以剔「佣金」並設定 %（只計場租＝食品飲品豁免）。佣金設定同「支出管理 → 規則設定」係同一份數據，兩邊改都得。'
              : 'First-time customers pick from these. Tick 佣金 to set a commission % per channel (rent-only = F&B exempt). Same data as the Expenses rules panel — edit in either place.'}
          </p>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-ink-soft py-4 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</p>
      ) : (
        <>
          <div className="mt-3 space-y-2">
            <div className="grid grid-cols-[1fr,1fr,70px,minmax(180px,auto),32px] gap-2 px-1">
              <span className="text-[11px] font-semibold text-ink-soft uppercase tracking-wider">{locale === 'zh' ? '中文顯示名' : 'Chinese'}</span>
              <span className="text-[11px] font-semibold text-ink-soft uppercase tracking-wider">{locale === 'zh' ? '英文顯示名' : 'English'}</span>
              <span className="text-[11px] font-semibold text-ink-soft uppercase tracking-wider">ID</span>
              <span className="text-[11px] font-semibold text-ink-soft uppercase tracking-wider">{locale === 'zh' ? '佣金設定' : 'Commission'}</span>
              <span />
            </div>
            {rows.map((r, i) => (
              <div key={r.id || `new-${i}`} className="grid grid-cols-[1fr,1fr,70px,minmax(180px,auto),32px] gap-2 items-center">
                <input value={r.zh} onChange={(e) => updateRow(i, 'zh', e.target.value)}
                  placeholder={locale === 'zh' ? '例：小紅書' : 'e.g. 小紅書'}
                  className="px-3 py-2 rounded-xl border-2 border-charcoal/15 bg-white text-sm" />
                <input value={r.en} onChange={(e) => updateRow(i, 'en', e.target.value)}
                  placeholder={locale === 'zh' ? '留空＝同中文' : 'blank = same'}
                  className="px-3 py-2 rounded-xl border-2 border-charcoal/15 bg-white text-sm" />
                <span className="text-[10px] font-mono text-ink-soft truncate" title={r.id}>
                  {r.id || (locale === 'zh' ? '自動' : 'auto')}
                </span>
                {r.id
                  ? <CommControls id={r.id} />
                  : <span className="text-[10px] text-ink-soft">{locale === 'zh' ? '儲存後可設佣金' : 'Save first'}</span>}
                <button type="button" onClick={() => removeRow(i)}
                  className="w-8 h-8 rounded-lg hover:bg-rose-50 text-rose-400 hover:text-rose-600 flex items-center justify-center">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {/* Fixed 其他 row */}
            <div className="grid grid-cols-[1fr,1fr,70px,minmax(180px,auto),32px] gap-2 items-center opacity-60">
              <span className="px-3 py-2 rounded-xl border-2 border-dashed border-charcoal/10 bg-stone-50 text-sm">{OTHER_OPTION.zh}</span>
              <span className="px-3 py-2 rounded-xl border-2 border-dashed border-charcoal/10 bg-stone-50 text-sm">{OTHER_OPTION.en}</span>
              <span className="text-[10px] font-mono text-ink-soft">other</span>
              <span className="text-[10px] text-ink-soft">{locale === 'zh' ? '自動包含' : 'auto'}</span>
              <span className="text-[10px] text-ink-soft">🔒</span>
            </div>
          </div>

          {/* Broker / platform presets — commission only */}
          <div className="mt-4 rounded-xl border border-charcoal/10 bg-white/50 p-3">
            <p className="text-[11px] font-semibold text-ink-soft uppercase tracking-wider mb-2">
              {locale === 'zh' ? '平台／行家渠道（只喺後台「直接落單」用，客人唔會見到）' : 'Broker / platform channels (admin direct bookings only)'}
            </p>
            <div className="space-y-1.5">
              {BROKER_PRESETS.map((p) => (
                <div key={p.id} className="flex items-center gap-3 text-sm">
                  <span className="w-32">{p.zh}</span>
                  <span className="text-[10px] font-mono text-ink-soft w-24">{p.id}</span>
                  <CommControls id={p.id} />
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 mt-4 flex-wrap">
            <button type="button" onClick={addRow}
              className="px-3 py-2 rounded-xl border border-charcoal/15 bg-white text-xs font-semibold hover:bg-cream flex items-center gap-1.5">
              <Plus size={13} /> {locale === 'zh' ? '新增選項' : 'Add option'}
            </button>
            <button type="button" onClick={save} disabled={saving}
              className="btn-primary text-xs flex items-center gap-1.5 disabled:opacity-50">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              {locale === 'zh' ? '儲存渠道 + 佣金設定' : 'Save channels + commission'}
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!window.confirm(locale === 'zh' ? '恢復預設選項（Google / Instagram / Facebook / 小紅書 / 朋友介紹）？佣金規則不變。' : 'Restore the default options? Commission rules unchanged.')) return;
                await updateSiteContent('settings', { marketing_channels: { zh: '', en: '' } }, user?.email || 'admin');
                await load();
              }}
              className="px-3 py-2 rounded-xl text-xs text-ink-soft hover:text-ink flex items-center gap-1">
              <RotateCcw size={12} /> {locale === 'zh' ? '恢復預設' : 'Defaults'}
            </button>
            {savedFlash && <span className="text-xs text-emerald-600 font-semibold">✓ {locale === 'zh' ? '已儲存，兩邊即時生效' : 'Saved'}</span>}
          </div>
          {error && <p className="text-xs text-rose-600 mt-2">{error}</p>}
        </>
      )}
    </div>
  );
}
