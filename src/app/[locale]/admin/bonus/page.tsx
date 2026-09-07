'use client';

// CS 獎金 — per-branch monthly sales targets with tiered bonuses.
//
//   設定    admin sets each branch's tiers (target → bonus, cumulative,
//          2–3 layers) + the CS emails to notify; admins are CC'd
//   通知    the daily bonus-check cron emails at 80% progress and on
//          each tier achieved (deduped per branch per month)
//   報表    live progress this month + a per-month × per-branch bonus
//          history list (sales basis identical to 月結: countsForFinance
//          bookings' pricing.subtotal, resetting on the 1st)

import { useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import { getAllBookings } from '@/lib/firestore';
import { branchKey as branchKeyOf, countsForFinance } from '@/lib/finance';
import { getBonusConfig, saveBonusConfig } from '@/lib/bonus';
import { evaluateBonus, sortedTiers } from '@/lib/bonusMath';
import type { BookingRecord, BonusConfig, BonusTier } from '@/types';
import { Award, Loader2, Plus, Trash2, Check, Settings2 } from 'lucide-react';

const BRANCHES = ['cwb', 'sw', 'tst', 'wanchai'];
const BRANCH_LABELS: Record<string, { zh: string; en: string }> = {
  cwb: { zh: '銅鑼灣', en: 'CWB' },
  sw: { zh: '上環', en: 'SW' },
  tst: { zh: '尖沙咀', en: 'TST' },
  wanchai: { zh: '灣仔', en: 'WC' },
};

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/** Last 12 months ending at the current one, newest first. */
function recentMonths(): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

function fmt(n: number): string {
  return n.toLocaleString('en-HK', { maximumFractionDigits: 0 });
}

export default function BonusPage() {
  const locale = useLocale() as 'zh' | 'en';
  const zh = locale === 'zh';
  const { user, hasPermission } = useAuth();
  const canAccess = hasPermission('documents');
  const isAdminRole = hasPermission('staff');

  const [allBookings, setAllBookings] = useState<BookingRecord[]>([]);
  const [cfg, setCfg] = useState<BonusConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isPreviewHost, setIsPreviewHost] = useState(false);
  useEffect(() => {
    const h = window.location.hostname;
    setIsPreviewHost(h !== 'spacohk.com' && h !== 'www.spacohk.com');
  }, []);

  useEffect(() => {
    if (!canAccess || !user) { setLoading(false); return; }
    Promise.all([getAllBookings(), getBonusConfig()])
      .then(([all, c]) => { setAllBookings(all); setCfg(c); })
      .finally(() => setLoading(false));
  }, [canAccess, user]);

  function say(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash(null), 2500);
  }

  /** Month sales per branch — identical basis to 月結. */
  const salesFor = useMemo(() => {
    const cache = new Map<string, number>();
    return (bk: string, month: string): number => {
      const key = `${bk}:${month}`;
      if (cache.has(key)) return cache.get(key)!;
      const v = allBookings
        .filter((b) => countsForFinance(b, { includeTest: isPreviewHost })
          && b.date.startsWith(month) && branchKeyOf(b.venueId) === bk)
        .reduce((s, b) => s + (b.pricing.subtotal || 0), 0);
      cache.set(key, v);
      return v;
    };
  }, [allBookings, isPreviewHost]);

  // ── Settings edits (drafts held locally, saved as one doc) ──
  function updateBranchTiers(bk: string, tiers: BonusTier[]) {
    if (!cfg) return;
    setCfg({ ...cfg, branches: { ...cfg.branches, [bk]: { tiers } } });
  }
  async function handleSave() {
    if (!cfg) return;
    setSaving(true);
    try {
      // Drop empty tiers so the cron never sees target-0 rows.
      const cleaned: BonusConfig = {
        branches: Object.fromEntries(Object.entries(cfg.branches).map(([bk, b]) => [bk, {
          tiers: sortedTiers((b.tiers || []).filter((t) => t.target > 0 && t.bonus > 0)),
        }])),
      };
      await saveBonusConfig(cleaned);
      setCfg(cleaned);
      say(zh ? '已儲存設定' : 'Settings saved');
    } catch {
      say(zh ? '儲存失敗' : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (!canAccess) {
    return <div className="p-8 text-gray-500">{zh ? '冇權限' : 'No access'}</div>;
  }

  const month = currentMonth();
  const history = recentMonths();

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Award className="w-6 h-6 text-primary-600" />
          {zh ? 'CS 獎金' : 'CS Bonus'}
        </h1>
        {isAdminRole && (
          <button
            onClick={() => setSettingsOpen(!settingsOpen)}
            className="btn-secondary flex items-center gap-1.5 text-sm"
          >
            <Settings2 className="w-4 h-4" />
            {zh ? '目標設定' : 'Targets'}
          </button>
        )}
      </div>

      {isPreviewHost && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm px-4 py-2">
          🧪 {zh ? '測試環境 — 數字包含測試訂單，只供驗收功能' : 'Test environment — numbers include test bookings'}
        </div>
      )}
      {flash && (
        <div className="rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm px-4 py-2 flex items-center gap-2">
          <Check className="w-4 h-4" /> {flash}
        </div>
      )}

      {loading || !cfg ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>
      ) : (
        <>
          {/* ── Settings ── */}
          {settingsOpen && isAdminRole && (
            <div className="bg-white rounded-xl border p-5 space-y-5">
              <h2 className="font-semibold">{zh ? '目標與通知設定' : 'Targets & Notifications'}</h2>
              {BRANCHES.map((bk) => {
                const b = cfg.branches[bk] || { tiers: [] };
                return (
                  <div key={bk} className="border rounded-lg p-4 space-y-3">
                    <div className="font-medium">{BRANCH_LABELS[bk][locale]}</div>
                    {(b.tiers.length ? b.tiers : []).map((t, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm flex-wrap">
                        <span className="text-gray-500 w-14">{zh ? `第 ${i + 1} 層` : `Tier ${i + 1}`}</span>
                        <span className="text-gray-400">{zh ? '目標' : 'Target'} $</span>
                        <input
                          type="number" value={t.target || ''}
                          onChange={(e) => updateBranchTiers(bk, b.tiers.map((x, j) => j === i ? { ...x, target: Number(e.target.value) } : x))}
                          className="border rounded px-2 py-1 w-28 text-right"
                        />
                        <span className="text-gray-400">{zh ? '獎金' : 'Bonus'} $</span>
                        <input
                          type="number" value={t.bonus || ''}
                          onChange={(e) => updateBranchTiers(bk, b.tiers.map((x, j) => j === i ? { ...x, bonus: Number(e.target.value) } : x))}
                          className="border rounded px-2 py-1 w-24 text-right"
                        />
                        <button onClick={() => updateBranchTiers(bk, b.tiers.filter((_, j) => j !== i))} className="text-gray-300 hover:text-red-500">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => updateBranchTiers(bk, [...b.tiers, { target: 0, bonus: 0 }])}
                      className="text-sm text-primary-600 hover:underline flex items-center gap-1"
                    >
                      <Plus className="w-4 h-4" />{zh ? '加一層目標' : 'Add tier'}
                    </button>
                  </div>
                );
              })}
              <p className="text-xs text-gray-400">
                {zh
                  ? '📧 通知會自動發送俾員工管理入面所有 Admin 同 CS 帳戶，唔使喺度另外設定。'
                  : '📧 Alerts go automatically to every Admin and CS account in Staff Management.'}
              </p>
              <button onClick={handleSave} disabled={saving} className="btn-primary text-sm disabled:opacity-40">
                {saving ? <Loader2 className="w-4 h-4 animate-spin inline" /> : (zh ? '儲存設定' : 'Save')}
              </button>
            </div>
          )}

          {/* ── This month's progress ── */}
          <div className="grid md:grid-cols-2 gap-4">
            {BRANCHES.map((bk) => {
              const tiers = sortedTiers((cfg.branches[bk]?.tiers || []).filter((t) => t.target > 0));
              const sales = salesFor(bk, month);
              const ev = evaluateBonus(sales, tiers);
              const topTarget = tiers.length ? tiers[tiers.length - 1].target : 0;
              const overallPct = topTarget ? Math.min(100, (sales / topTarget) * 100) : 0;
              return (
                <div key={bk} className="bg-white rounded-xl border p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold">{BRANCH_LABELS[bk][locale]}</div>
                    {ev.totalBonus > 0 && (
                      <span className="text-xs bg-green-100 text-green-800 rounded-full px-2 py-0.5 font-semibold">
                        🎉 {zh ? '獎金' : 'Bonus'} ${fmt(ev.totalBonus)}
                      </span>
                    )}
                  </div>
                  <div className="text-2xl font-bold">${fmt(sales)}</div>
                  {tiers.length === 0 ? (
                    <div className="text-sm text-gray-400">{zh ? '未設定目標' : 'No targets set'}</div>
                  ) : (
                    <>
                      <div className="relative bg-gray-100 rounded-full h-3 overflow-hidden">
                        <div
                          className={`h-3 rounded-full ${ev.totalBonus > 0 ? 'bg-green-500' : 'bg-primary-500'}`}
                          style={{ width: `${overallPct}%` }}
                        />
                        {tiers.slice(0, -1).map((t, i) => (
                          <div key={i} className="absolute top-0 h-3 w-0.5 bg-white" style={{ left: `${(t.target / topTarget) * 100}%` }} />
                        ))}
                      </div>
                      <div className="space-y-1 text-sm">
                        {tiers.map((t, i) => {
                          const hit = ev.achievedTierIndexes.includes(i);
                          const isNext = ev.nextTierIndex === i;
                          return (
                            <div key={i} className={`flex justify-between ${hit ? 'text-green-700' : isNext ? 'text-gray-800' : 'text-gray-400'}`}>
                              <span>
                                {hit ? '✅' : '⬜'} {zh ? `第 ${i + 1} 層` : `Tier ${i + 1}`} — ${fmt(t.target)}
                                {isNext && ev.nextTierProgressPct !== null && (
                                  <span className="ml-1 text-xs text-primary-600 font-medium">({ev.nextTierProgressPct.toFixed(0)}%)</span>
                                )}
                              </span>
                              <span className="font-medium">${fmt(t.bonus)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── History ── */}
          <div className="bg-white rounded-xl border p-5 overflow-x-auto">
            <h2 className="font-semibold mb-3">{zh ? '獎金記錄（過去 12 個月）' : 'Bonus History (last 12 months)'}</h2>
            <p className="text-xs text-gray-400 mb-3">
              {zh
                ? '註：用而家嘅目標設定計算。營業額每月 1 號重新起計。'
                : 'Computed against the current tier settings; sales reset on the 1st.'}
            </p>
            <table className="text-sm min-w-[640px] w-full">
              <thead>
                <tr className="text-gray-500 border-b">
                  <th className="text-left py-2">{zh ? '月份' : 'Month'}</th>
                  {BRANCHES.map((bk) => (
                    <th key={bk} className="text-right">{BRANCH_LABELS[bk][locale]}</th>
                  ))}
                  <th className="text-right font-semibold">{zh ? '合共' : 'Total'}</th>
                </tr>
              </thead>
              <tbody>
                {history.map((m) => {
                  let rowTotal = 0;
                  const cells = BRANCHES.map((bk) => {
                    const tiers = (cfg.branches[bk]?.tiers || []).filter((t) => t.target > 0);
                    if (!tiers.length) return { bonus: 0, sales: 0 };
                    const sales = salesFor(bk, m);
                    const ev = evaluateBonus(sales, tiers);
                    rowTotal += ev.totalBonus;
                    return { bonus: ev.totalBonus, sales };
                  });
                  return (
                    <tr key={m} className={`border-b last:border-0 ${m === month ? 'bg-primary-50/50' : ''}`}>
                      <td className="py-1.5">{m}{m === month ? (zh ? '（本月）' : ' (now)') : ''}</td>
                      {cells.map((c, i) => (
                        <td key={i} className="text-right">
                          {c.bonus > 0
                            ? <span className="text-green-700 font-semibold">${fmt(c.bonus)}</span>
                            : <span className="text-gray-300">—</span>}
                        </td>
                      ))}
                      <td className="text-right font-semibold">{rowTotal > 0 ? `$${fmt(rowTotal)}` : <span className="text-gray-300">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
