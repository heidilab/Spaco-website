'use client';

// 特別日子/旺季設定 (peak days) — admin calendar for per-date holiday
// surcharges + raised minimums (Heidi 2026-09-08).
//
// Click a date on the calendar → set, per branch or for all branches:
//   • 節日附加費/位 (per head, adult full / child half, NOT per hour)
//   • 最低人數 / 最低鐘數 floors (only ever RAISE the venue's own)
// A range tool stamps the same settings across a from–to span (whole
// December in one go). Every booking surface reads peak_days live, so
// changes take effect immediately.

import { useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import { listPeakDays, savePeakDay, deletePeakDay } from '@/lib/peakDays';
import type { PeakDayConfig, PeakDayRule } from '@/types';
import { Sparkles, Loader2, Check, ChevronLeft, ChevronRight, Trash2, CopyPlus } from 'lucide-react';

const BRANCHES = ['cwb', 'sw', 'tst', 'wanchai'];
const BRANCH_LABELS: Record<string, { zh: string; en: string }> = {
  cwb: { zh: '銅鑼灣', en: 'CWB' },
  sw: { zh: '上環', en: 'SW' },
  tst: { zh: '尖沙咀', en: 'TST' },
  wanchai: { zh: '灣仔', en: 'WC' },
};

/** Editor draft: string inputs (blank = unset) per scope. */
type RuleDraft = { surchargePerHead: string; minHeadcount: string; minHours: string; forceWeekendRate: boolean };
type Draft = { note: string; all: RuleDraft; branches: Record<string, RuleDraft> };

const emptyRule = (): RuleDraft => ({ surchargePerHead: '', minHeadcount: '', minHours: '', forceWeekendRate: false });
const emptyDraft = (): Draft => ({
  note: '',
  all: emptyRule(),
  branches: Object.fromEntries(BRANCHES.map((b) => [b, emptyRule()])),
});

function ruleToDraft(r?: PeakDayRule | null): RuleDraft {
  return {
    surchargePerHead: r?.surchargePerHead ? String(r.surchargePerHead) : '',
    minHeadcount: r?.minHeadcount ? String(r.minHeadcount) : '',
    minHours: r?.minHours ? String(r.minHours) : '',
    forceWeekendRate: r?.forceWeekendRate === true,
  };
}

function draftToRule(d: RuleDraft): PeakDayRule | null {
  const rule: PeakDayRule = {};
  if (Number(d.surchargePerHead) > 0) rule.surchargePerHead = Number(d.surchargePerHead);
  if (Number(d.minHeadcount) > 0) rule.minHeadcount = Number(d.minHeadcount);
  if (Number(d.minHours) > 0) rule.minHours = Number(d.minHours);
  if (d.forceWeekendRate) rule.forceWeekendRate = true;
  return Object.keys(rule).length ? rule : null;
}

function cfgToDraft(cfg?: PeakDayConfig | null): Draft {
  const d = emptyDraft();
  if (!cfg) return d;
  d.note = cfg.note || '';
  d.all = ruleToDraft(cfg.all);
  for (const b of BRANCHES) d.branches[b] = ruleToDraft(cfg.branches?.[b]);
  return d;
}

function draftToCfg(d: Draft): Omit<PeakDayConfig, 'date' | 'updatedAt'> | null {
  const all = draftToRule(d.all);
  const branches: Record<string, PeakDayRule> = {};
  for (const b of BRANCHES) {
    const r = draftToRule(d.branches[b]);
    if (r) branches[b] = r;
  }
  if (!all && Object.keys(branches).length === 0) return null;
  return {
    ...(d.note.trim() ? { note: d.note.trim() } : {}),
    all: all,
    branches,
  };
}

function ymd(y: number, m: number, day: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export default function PeakDaysPage() {
  const locale = useLocale() as 'zh' | 'en';
  const zh = locale === 'zh';
  const { user, hasPermission } = useAuth();
  const canAccess = hasPermission('staff');

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1-12
  const [days, setDays] = useState<Record<string, PeakDayConfig>>({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [rangeTo, setRangeTo] = useState('');
  const [applyingRange, setApplyingRange] = useState(false);

  function say(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash(null), 3000);
  }

  async function load() {
    setLoading(true);
    try {
      const from = ymd(year, month, 1);
      const to = ymd(year, month, new Date(year, month, 0).getDate());
      setDays(await listPeakDays(from, to));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (canAccess && user) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccess, user, year, month]);

  function pickDate(date: string) {
    setSelected(date);
    setDraft(cfgToDraft(days[date]));
    setRangeTo('');
  }

  async function handleSave() {
    if (!selected) return;
    setSaving(true);
    try {
      const cfg = draftToCfg(draft);
      if (!cfg) {
        if (days[selected]) await deletePeakDay(selected);
        say(zh ? '呢日已清除設定' : 'Cleared');
      } else {
        await savePeakDay(selected, cfg);
        say(zh ? '已儲存 — 即時生效' : 'Saved — live immediately');
      }
      await load();
    } catch {
      say(zh ? '儲存失敗' : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selected || !days[selected]) return;
    setSaving(true);
    try {
      await deletePeakDay(selected);
      setDraft(emptyDraft());
      say(zh ? '已刪除' : 'Deleted');
      await load();
    } finally {
      setSaving(false);
    }
  }

  /** Stamp the current draft onto every date from `selected` to rangeTo. */
  async function handleApplyRange() {
    if (!selected || !rangeTo || rangeTo < selected) return;
    const cfg = draftToCfg(draft);
    if (!cfg) { say(zh ? '請先填設定' : 'Fill in settings first'); return; }
    setApplyingRange(true);
    try {
      const dates: string[] = [];
      const cur = new Date(`${selected}T00:00:00`);
      const end = new Date(`${rangeTo}T00:00:00`);
      while (cur <= end && dates.length < 92) {
        dates.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`);
        cur.setDate(cur.getDate() + 1);
      }
      for (const d of dates) await savePeakDay(d, cfg);
      say(zh ? `已套用到 ${dates.length} 日 — 即時生效` : `Applied to ${dates.length} days`);
      await load();
    } finally {
      setApplyingRange(false);
    }
  }

  const grid = useMemo(() => {
    const first = new Date(year, month - 1, 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const lead = first.getDay(); // 0=Sun
    const cells: Array<{ date: string; day: number } | null> = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push({ date: ymd(year, month, d), day: d });
    return cells;
  }, [year, month]);

  function prevMonth() {
    setSelected(null);
    if (month === 1) { setYear(year - 1); setMonth(12); } else setMonth(month - 1);
  }
  function nextMonth() {
    setSelected(null);
    if (month === 12) { setYear(year + 1); setMonth(1); } else setMonth(month + 1);
  }

  /** Compact badge for a configured date. */
  function badge(cfg: PeakDayConfig): string {
    const s = cfg.all?.surchargePerHead
      || Math.max(0, ...Object.values(cfg.branches || {}).map((r) => r.surchargePerHead || 0));
    if (s > 0) return `+$${s}`;
    const forced = cfg.all?.forceWeekendRate
      || Object.values(cfg.branches || {}).some((r) => r.forceWeekendRate);
    return forced ? '⭐' : '⚙️';
  }

  if (!canAccess) {
    return <div className="p-8 text-gray-500">{zh ? '冇權限' : 'No access'}</div>;
  }

  const todayStr = new Date().toISOString().slice(0, 10);

  const ruleInputs = (scope: 'all' | string, d: RuleDraft, set: (r: RuleDraft) => void) => (
    <div className="grid grid-cols-3 gap-2">
      <div>
        <label className="block text-[11px] text-gray-400 mb-0.5">{zh ? '附加費/位 $' : 'Surcharge/head $'}</label>
        <input type="number" min={0} value={d.surchargePerHead}
          onChange={(e) => set({ ...d, surchargePerHead: e.target.value })}
          placeholder={scope === 'all' ? '—' : (zh ? '跟全部' : 'inherit')}
          className="border rounded px-2 py-1 w-full text-sm text-right" />
      </div>
      <div>
        <label className="block text-[11px] text-gray-400 mb-0.5">{zh ? '最低人數' : 'Min guests'}</label>
        <input type="number" min={0} value={d.minHeadcount}
          onChange={(e) => set({ ...d, minHeadcount: e.target.value })}
          placeholder={scope === 'all' ? '—' : (zh ? '跟全部' : 'inherit')}
          className="border rounded px-2 py-1 w-full text-sm text-right" />
      </div>
      <div>
        <label className="block text-[11px] text-gray-400 mb-0.5">{zh ? '最低鐘數' : 'Min hours'}</label>
        <input type="number" min={0} value={d.minHours}
          onChange={(e) => set({ ...d, minHours: e.target.value })}
          placeholder={scope === 'all' ? '—' : (zh ? '跟全部' : 'inherit')}
          className="border rounded px-2 py-1 w-full text-sm text-right" />
      </div>
      <label className="col-span-3 flex items-center gap-2 text-sm cursor-pointer select-none mt-1">
        <input type="checkbox" checked={d.forceWeekendRate}
          onChange={(e) => set({ ...d, forceWeekendRate: e.target.checked })}
          className="w-4 h-4 accent-rose-500" />
        <span>
          {zh ? '呢日以週末/假日價計費' : 'Charge weekend rate on this date'}
          <span className="text-xs text-gray-400 ml-1">
            {zh ? '（平日 $50/位/小時 → 假日 $58/位/小時 嗰級）' : '(weekday tier → weekend tier, e.g. $50 → $58/head/hr)'}
          </span>
        </span>
      </label>
    </div>
  );

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-primary-600" />
          {zh ? '特別日子設定' : 'Peak Days'}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {zh
            ? '撳日曆設定節日附加費（每位人頭計，唔係每個鐘）同最低人數/鐘數。儲存後即時喺所有前後台預約系統生效。'
            : 'Click a date to set per-head holiday surcharge and minimum guests/hours. Changes are live on every booking surface immediately.'}
        </p>
      </div>

      {flash && (
        <div className="rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm px-4 py-2 flex items-center gap-2">
          <Check className="w-4 h-4" /> {flash}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* ── Calendar ── */}
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center justify-between mb-4">
            <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-gray-100"><ChevronLeft className="w-5 h-5" /></button>
            <div className="font-semibold">{year} 年 {month} 月</div>
            <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-gray-100"><ChevronRight className="w-5 h-5" /></button>
          </div>
          <div className="grid grid-cols-7 text-center text-xs text-gray-400 mb-1">
            {(zh ? ['日', '一', '二', '三', '四', '五', '六'] : ['S', 'M', 'T', 'W', 'T', 'F', 'S']).map((d, i) => <div key={i} className="py-1">{d}</div>)}
          </div>
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-gray-300" /></div>
          ) : (
            <div className="grid grid-cols-7 gap-1">
              {grid.map((cell, i) => cell === null ? <div key={i} /> : (
                <button
                  key={cell.date}
                  onClick={() => pickDate(cell.date)}
                  className={`relative rounded-lg py-2 text-sm border transition
                    ${selected === cell.date ? 'border-primary-600 ring-2 ring-primary-200' : 'border-transparent hover:border-gray-200'}
                    ${days[cell.date] ? 'bg-rose-50 text-rose-700 font-semibold' : 'bg-gray-50/60'}
                    ${cell.date === todayStr ? 'underline underline-offset-2' : ''}`}
                >
                  <div>{cell.day}</div>
                  {days[cell.date] && (
                    <div className="text-[10px] leading-tight">{badge(days[cell.date])}</div>
                  )}
                </button>
              ))}
            </div>
          )}
          <p className="text-xs text-gray-400 mt-3">
            {zh ? '🌹 粉紅色 = 已設定特別日子' : '🌹 Pink = configured peak day'}
          </p>
        </div>

        {/* ── Editor ── */}
        <div className="bg-white rounded-xl border p-5">
          {!selected ? (
            <div className="text-gray-400 text-sm py-10 text-center">
              {zh ? '← 喺日曆撳一日開始設定' : '← Pick a date on the calendar'}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">{selected}</h2>
                {days[selected] && (
                  <button onClick={handleDelete} disabled={saving} className="text-sm text-red-500 hover:underline flex items-center gap-1">
                    <Trash2 className="w-4 h-4" />{zh ? '刪除呢日設定' : 'Delete'}
                  </button>
                )}
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">{zh ? '標籤（客人會見到，例如：聖誕節）' : 'Label shown to customers'}</label>
                <input value={draft.note}
                  onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                  placeholder={zh ? '例：聖誕節 🎄' : 'e.g. Christmas 🎄'}
                  className="border rounded px-2 py-1.5 w-full text-sm" />
              </div>

              <div className="border rounded-lg p-3 bg-amber-50/50">
                <div className="font-medium text-sm mb-2">{zh ? '全部分店' : 'All branches'}</div>
                {ruleInputs('all', draft.all, (r) => setDraft({ ...draft, all: r }))}
              </div>

              <details className="border rounded-lg p-3">
                <summary className="font-medium text-sm cursor-pointer select-none">
                  {zh ? '個別分店唔同設定（可選）' : 'Per-branch overrides (optional)'}
                </summary>
                <div className="space-y-3 mt-3">
                  {BRANCHES.map((b) => (
                    <div key={b}>
                      <div className="text-xs font-medium text-gray-600 mb-1">{BRANCH_LABELS[b][locale]}</div>
                      {ruleInputs(b, draft.branches[b], (r) => setDraft({ ...draft, branches: { ...draft.branches, [b]: r } }))}
                    </div>
                  ))}
                  <p className="text-[11px] text-gray-400">
                    {zh ? '留空 = 跟「全部分店」嘅設定；填咗就以分店為準。' : 'Blank inherits the all-branches value; filled overrides it.'}
                  </p>
                </div>
              </details>

              <button onClick={handleSave} disabled={saving} className="btn-primary text-sm w-full disabled:opacity-40">
                {saving ? <Loader2 className="w-4 h-4 animate-spin inline" /> : (zh ? '儲存呢一日' : 'Save this date')}
              </button>

              <div className="border-t pt-3">
                <label className="block text-xs text-gray-500 mb-1">
                  {zh ? `套用同一設定到日期範圍（由 ${selected} 開始，最多 92 日）` : `Apply the same settings from ${selected} to:`}
                </label>
                <div className="flex gap-2">
                  <input type="date" value={rangeTo} min={selected}
                    onChange={(e) => setRangeTo(e.target.value)}
                    className="border rounded px-2 py-1.5 text-sm flex-1" />
                  <button onClick={handleApplyRange} disabled={applyingRange || !rangeTo}
                    className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-40">
                    {applyingRange ? <Loader2 className="w-4 h-4 animate-spin" /> : <CopyPlus className="w-4 h-4" />}
                    {zh ? '套用到範圍' : 'Apply range'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
