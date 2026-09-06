'use client';

// Structured editor for the 來源渠道選項 (marketing-channel options)
// customers pick from at 確認預訂「喺邊度得知我哋」.
//
// Heidi's feedback (2026-09): the raw one-line-per-option textarea was
// not usable — the editor must SHOW the options currently in effect
// (including the built-in defaults when nothing is configured yet) and
// let her add / edit / remove items row by row.
//
// Storage stays the same line format (`id | 中文 | English`) in
// site_content/settings → marketing_channels, so parseChannelConfig and
// every consumer are untouched — this component is purely a nicer pen.

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { updateSiteContent } from '@/lib/content';
import {
  getMarketingChannelOptions, OTHER_OPTION, type MarketingChannelOption,
} from '@/lib/marketingChannels';
import { Megaphone, Plus, Trash2, Loader2, Check, RotateCcw } from 'lucide-react';

interface Row extends MarketingChannelOption {
  /** True for rows added this session — id not yet frozen. */
  isNew?: boolean;
}

/** Stable id for a new row: ascii names slugify (threads → threads);
 *  anything else gets a short random id. Existing ids NEVER change. */
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const opts = await getMarketingChannelOptions();
      setRows(opts.filter((o) => o.id !== 'other'));
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

  async function save(rowsToSave: Row[]) {
    setError(null);
    setSaving(true);
    try {
      const taken = new Set(rowsToSave.map((r) => r.id).filter(Boolean));
      const finalRows = rowsToSave
        .filter((r) => r.zh.trim() || r.en.trim())
        .map((r) => {
          const zh = r.zh.trim() || r.en.trim();
          const en = r.en.trim() || zh;
          const id = r.id || makeId(en || zh, taken);
          taken.add(id);
          return { id, zh, en };
        });
      const text = finalRows.map((r) => `${r.id} | ${r.zh} | ${r.en}`).join('\n');
      await updateSiteContent('settings', {
        marketing_channels: { zh: text, en: text },
      }, user?.email || 'admin');
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
            {locale === 'zh' ? '來源渠道選項' : 'Marketing channel options'}
          </h3>
          <p className="text-xs text-ink-soft mt-1 max-w-2xl leading-relaxed">
            {locale === 'zh'
              ? '客人第一次成功預訂前，確認頁會問「喺邊度得知我哋」— 下面就係佢哋見到嘅選項。可以隨時改名、新增、刪除；「其他」選項會自動包含，唔使加。刪除選項唔影響舊訂單嘅記錄。'
              : 'First-time customers pick from these options at checkout. Edit / add / remove freely; "Other" is always included automatically. Removing an option never affects past bookings.'}
          </p>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-ink-soft py-4 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</p>
      ) : (
        <>
          <div className="mt-3 space-y-2">
            {/* Header row */}
            <div className="grid grid-cols-[1fr,1fr,90px,32px] gap-2 px-1">
              <span className="text-[11px] font-semibold text-ink-soft uppercase tracking-wider">{locale === 'zh' ? '中文顯示名' : 'Chinese label'}</span>
              <span className="text-[11px] font-semibold text-ink-soft uppercase tracking-wider">{locale === 'zh' ? '英文顯示名' : 'English label'}</span>
              <span className="text-[11px] font-semibold text-ink-soft uppercase tracking-wider" title={locale === 'zh' ? '報表分組用，系統自動產生' : 'Report grouping key, auto-generated'}>ID</span>
              <span />
            </div>
            {rows.map((r, i) => (
              <div key={r.id || `new-${i}`} className="grid grid-cols-[1fr,1fr,90px,32px] gap-2 items-center">
                <input
                  value={r.zh}
                  onChange={(e) => updateRow(i, 'zh', e.target.value)}
                  placeholder={locale === 'zh' ? '例：小紅書' : 'e.g. 小紅書'}
                  className="px-3 py-2 rounded-xl border-2 border-charcoal/15 bg-white text-sm"
                />
                <input
                  value={r.en}
                  onChange={(e) => updateRow(i, 'en', e.target.value)}
                  placeholder={locale === 'zh' ? '例：RED（留空＝同中文）' : 'e.g. RED (blank = same as zh)'}
                  className="px-3 py-2 rounded-xl border-2 border-charcoal/15 bg-white text-sm"
                />
                <span className="text-[10px] font-mono text-ink-soft truncate" title={r.id}>
                  {r.id || (locale === 'zh' ? '儲存後產生' : 'auto on save')}
                </span>
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  className="w-8 h-8 rounded-lg hover:bg-rose-50 text-rose-400 hover:text-rose-600 flex items-center justify-center"
                  title={locale === 'zh' ? '刪除' : 'Remove'}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {/* The fixed 其他 row */}
            <div className="grid grid-cols-[1fr,1fr,90px,32px] gap-2 items-center opacity-60">
              <span className="px-3 py-2 rounded-xl border-2 border-dashed border-charcoal/10 bg-stone-50 text-sm">{OTHER_OPTION.zh}</span>
              <span className="px-3 py-2 rounded-xl border-2 border-dashed border-charcoal/10 bg-stone-50 text-sm">{OTHER_OPTION.en}</span>
              <span className="text-[10px] font-mono text-ink-soft">other</span>
              <span className="text-[10px] text-ink-soft" title={locale === 'zh' ? '自動包含，客人揀「其他」要填文字說明' : 'Always included; customers picking Other must type details'}>🔒</span>
            </div>
          </div>

          <div className="flex items-center gap-2 mt-4 flex-wrap">
            <button
              type="button"
              onClick={addRow}
              className="px-3 py-2 rounded-xl border border-charcoal/15 bg-white text-xs font-semibold hover:bg-cream flex items-center gap-1.5"
            >
              <Plus size={13} /> {locale === 'zh' ? '新增選項' : 'Add option'}
            </button>
            <button
              type="button"
              onClick={() => save(rows)}
              disabled={saving}
              className="btn-primary text-xs flex items-center gap-1.5 disabled:opacity-50"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              {locale === 'zh' ? '儲存渠道選項' : 'Save options'}
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!window.confirm(locale === 'zh' ? '恢復預設選項（Google / Instagram / Facebook / 小紅書 / 朋友介紹）？' : 'Restore the default options?')) return;
                await updateSiteContent('settings', { marketing_channels: { zh: '', en: '' } }, user?.email || 'admin');
                await load();
              }}
              className="px-3 py-2 rounded-xl text-xs text-ink-soft hover:text-ink flex items-center gap-1"
            >
              <RotateCcw size={12} /> {locale === 'zh' ? '恢復預設' : 'Restore defaults'}
            </button>
            {savedFlash && <span className="text-xs text-emerald-600 font-semibold">✓ {locale === 'zh' ? '已儲存，即時生效' : 'Saved — live immediately'}</span>}
          </div>
          {error && <p className="text-xs text-rose-600 mt-2">{error}</p>}
        </>
      )}
    </div>
  );
}
