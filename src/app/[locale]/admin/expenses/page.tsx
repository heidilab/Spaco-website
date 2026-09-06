'use client';

// 支出管理 (Finance Phase 2) — per-branch monthly expense ledger.
//
// Replaces the DR side of Heidi's Financial Master Excel:
//   固定開支  seeded from admin-defined templates, editable per month
//   雜項支出  free-form rows (repairs, supplies, …)
//   佣金      derived live per broker booking (行家 rent-only / Reubird
//             total, per finance_config), per-booking override editable
//   KPay 費   estimated % on kpay payments (statement reconciliation
//             replaces estimates at month close — Phase 3)
//
// The monthly close (Phase 3) reads: Σ(stored rows) + Σ(derived rows).

import { useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import { getAllBookings } from '@/lib/firestore';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { branchKey as branchKeyOf, branchGroupName, countsForFinance } from '@/lib/finance';
import {
  listExpenses, addExpense, updateExpense, deleteExpense,
  listTemplates, addTemplate, updateTemplate, deleteTemplate, seedRecurring,
  getFinanceConfig, saveFinanceConfig, type FinanceConfig,
} from '@/lib/expenses';
import { commissionForBooking, estimatedKpayFee, discountedSubtotal } from '@/lib/bookingMoney';
import { channelDisplayLabel } from '@/lib/marketingChannels';
import type { BookingRecord, ExpenseRecord, ExpenseTemplate } from '@/types';
import {
  Wallet, Plus, Trash2, Loader2, Check, Settings2, RefreshCw,
} from 'lucide-react';

const BRANCHES = ['cwb', 'sw', 'tst', 'wanchai'];

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export default function ExpensesPage() {
  const locale = useLocale() as 'zh' | 'en';
  const { user, hasPermission } = useAuth();
  const canAccess = hasPermission('documents');
  const isAdminRole = hasPermission('staff');

  const [branch, setBranch] = useState('cwb');
  const [month, setMonth] = useState(currentMonth());
  const [rows, setRows] = useState<ExpenseRecord[]>([]);
  const [templates, setTemplates] = useState<ExpenseTemplate[]>([]);
  const [bookings, setBookings] = useState<BookingRecord[]>([]);
  const [config, setConfig] = useState<FinanceConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState<string | null>(null);

  // Manual-row form
  const [newItem, setNewItem] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newDate, setNewDate] = useState('');
  const [adding, setAdding] = useState(false);

  // Template manager
  const [tplOpen, setTplOpen] = useState(false);
  const [tplName, setTplName] = useState('');
  const [tplAmount, setTplAmount] = useState('');

  // Inline edits (amount drafts by expense id / booking id)
  const [amountDrafts, setAmountDrafts] = useState<Record<string, string>>({});
  const [overrideDrafts, setOverrideDrafts] = useState<Record<string, string>>({});

  async function load() {
    if (!user) return;
    setLoading(true);
    try {
      const [exp, tpl, all, cfg] = await Promise.all([
        listExpenses(branch, month),
        listTemplates(branch),
        getAllBookings(),
        getFinanceConfig(),
      ]);
      // Auto-seed missing recurring rows, then re-read if anything seeded.
      const created = await seedRecurring(branch, month, tpl, exp, user.uid);
      setRows(created > 0 ? await listExpenses(branch, month) : exp);
      setTemplates(tpl);
      setConfig(cfg);
      setBookings(all.filter((b) =>
        countsForFinance(b)
        && b.date.startsWith(month)
        && branchKeyOf(b.venueId) === branch));
    } finally {
      setLoading(false);
      setAmountDrafts({});
      setOverrideDrafts({});
    }
  }
  useEffect(() => {
    if (canAccess && user) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccess, user, branch, month]);

  // ── Derived auto items ──
  const commissionRows = useMemo(() => {
    if (!config) return [];
    return bookings
      .map((b) => {
        const ch = b.marketingChannel || '';
        const rule = config.commissionRules[ch];
        const amount = commissionForBooking(b, rule);
        return { booking: b, rule, amount, channel: ch };
      })
      .filter((r) => r.rule || typeof r.booking.commissionOverride === 'number')
      .filter((r) => r.amount > 0 || typeof r.booking.commissionOverride === 'number');
  }, [bookings, config]);

  const kpayFeeRows = useMemo(() => {
    if (!config) return [];
    return bookings
      .map((b) => ({ booking: b, fee: estimatedKpayFee(b, config.kpayFeePct) }))
      .filter((r) => r.fee > 0);
  }, [bookings, config]);

  const recurringRows = rows.filter((r) => r.source === 'recurring');
  const manualRows = rows.filter((r) => r.source === 'manual');
  const totals = {
    recurring: recurringRows.reduce((s, r) => s + r.amount, 0),
    manual: manualRows.reduce((s, r) => s + r.amount, 0),
    commission: commissionRows.reduce((s, r) => s + r.amount, 0),
    kpay: kpayFeeRows.reduce((s, r) => s + r.fee, 0),
  };
  const grandTotal = totals.recurring + totals.manual + totals.commission + totals.kpay;

  async function handleAddManual() {
    if (!user || !newItem.trim() || !(parseFloat(newAmount) > 0)) return;
    setAdding(true);
    try {
      await addExpense({
        branchKey: branch, month,
        date: newDate || `${month}-15`,
        item: newItem.trim(),
        amount: parseFloat(newAmount),
        source: 'manual',
        createdBy: user.uid,
      });
      setNewItem(''); setNewAmount(''); setNewDate('');
      await load();
    } finally { setAdding(false); }
  }

  async function saveAmount(r: ExpenseRecord) {
    const draft = amountDrafts[r.id];
    if (draft === undefined) return;
    const v = parseFloat(draft);
    if (!Number.isFinite(v) || v < 0 || v === r.amount) return;
    await updateExpense(r.id, { amount: v });
    await load();
  }

  async function saveOverride(b: BookingRecord) {
    const draft = overrideDrafts[b.id];
    if (draft === undefined) return;
    const trimmed = draft.trim();
    const v = trimmed === '' ? null : parseFloat(trimmed);
    if (v !== null && (!Number.isFinite(v) || v < 0)) return;
    await updateDoc(doc(db, 'bookings', b.id), {
      ...(v === null ? { commissionOverride: null } : { commissionOverride: v }),
      updatedAt: serverTimestamp(),
    });
    setFlash(locale === 'zh' ? '✓ 佣金已更新' : '✓ Commission updated');
    setTimeout(() => setFlash(null), 1500);
    await load();
  }

  if (!canAccess) {
    return <div className="text-center py-20 text-ink-soft">{locale === 'zh' ? '無權限存取' : 'Access Denied'}</div>;
  }

  const inputCls = 'px-2.5 py-1.5 rounded-lg border border-charcoal/15 text-sm bg-white';

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <span className="chip mb-3"><Wallet size={12} className="text-pink" /> Expenses</span>
        <h1 className="text-heading font-display">
          <span className="text-gradient-pink">{locale === 'zh' ? '支出管理' : 'Expenses'}</span>
        </h1>
        <p className="text-ink-soft mt-2 text-sm max-w-2xl">
          {locale === 'zh'
            ? '每間舖每個月一本帳：固定開支自動入帳、雜項隨手加、佣金同 KPay 費自動計。月結（Phase 3）會直接攞呢度嘅數。'
            : 'Per-branch monthly ledger: recurring costs auto-seeded, one-offs added by hand, commissions and KPay fees derived automatically.'}
        </p>
      </div>

      {/* Branch + month picker */}
      <div className="flex items-center gap-2 flex-wrap mb-5">
        {BRANCHES.map((b) => (
          <button key={b} onClick={() => setBranch(b)}
            className={`px-3.5 py-2 rounded-pill text-sm font-semibold transition ${
              branch === b ? 'bg-gradient-pink text-white shadow-glow' : 'bg-white/60 text-ink-soft hover:bg-white'
            }`}>
            {branchGroupName(b)[locale]}
          </button>
        ))}
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
          className="ml-auto px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white/85" />
      </div>

      {flash && <div className="mb-3 text-sm text-emerald-700">{flash}</div>}
      {loading ? (
        <p className="text-ink-soft py-10 flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Loading…</p>
      ) : (
        <div className="space-y-5">
          {/* Totals */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              [locale === 'zh' ? '固定開支' : 'Recurring', totals.recurring],
              [locale === 'zh' ? '雜項' : 'One-offs', totals.manual],
              [locale === 'zh' ? '佣金' : 'Commission', totals.commission],
              [locale === 'zh' ? 'KPay 費(估)' : 'KPay fee (est.)', totals.kpay],
              [locale === 'zh' ? '總支出' : 'Total', grandTotal],
            ].map(([label, v], i) => (
              <div key={i} className={`glass-card p-4 ${i === 4 ? 'border-2 border-pink/30' : ''}`}>
                <p className="text-[11px] text-ink-soft uppercase tracking-wider">{label}</p>
                <p className="text-lg font-bold font-display">HK${(v as number).toLocaleString()}</p>
              </div>
            ))}
          </div>

          {/* 固定開支 */}
          <div className="glass-card p-6">
            <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
              <h2 className="font-bold">{locale === 'zh' ? '固定開支' : 'Recurring costs'}</h2>
              <button onClick={() => setTplOpen(!tplOpen)}
                className="text-xs flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-charcoal/15 bg-white hover:bg-cream">
                <Settings2 size={12} /> {locale === 'zh' ? '設定固定項目' : 'Manage templates'}
              </button>
            </div>

            {tplOpen && (
              <div className="rounded-2xl border border-pink/25 bg-pink/[0.03] p-4 mb-4">
                <p className="text-xs text-ink-soft mb-2">
                  {locale === 'zh'
                    ? `「${branchGroupName(branch)[locale]}」嘅固定開支項目 — 新月份會自動入帳；當月金額可以喺下面個表逐月改，唔影響呢度嘅預設。`
                    : `Recurring items for ${branchGroupName(branch)[locale]} — auto-seeded each month; per-month amounts editable below without touching these defaults.`}
                </p>
                <div className="space-y-1.5 mb-3">
                  {templates.map((t) => (
                    <div key={t.id} className="flex items-center gap-2 text-sm">
                      <span className="flex-1">{t.name}</span>
                      <span className="text-ink-soft text-xs">HK${t.amount.toLocaleString()}</span>
                      <button onClick={async () => { await updateTemplate(t.id, { active: !t.active }); await load(); }}
                        className={`text-[10px] px-2 py-0.5 rounded-pill border ${t.active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-stone-100 text-stone-500 border-stone-200'}`}>
                        {t.active ? (locale === 'zh' ? '生效中' : 'Active') : (locale === 'zh' ? '已停用' : 'Off')}
                      </button>
                      <button onClick={async () => {
                        if (!window.confirm(locale === 'zh' ? `刪除固定項目「${t.name}」？（已入帳嘅月份唔受影響）` : `Delete template "${t.name}"?`)) return;
                        await deleteTemplate(t.id); await load();
                      }} className="w-7 h-7 rounded-lg hover:bg-rose-50 text-rose-400 flex items-center justify-center">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                  {templates.length === 0 && <p className="text-xs text-ink-soft italic">{locale === 'zh' ? '未有固定項目 — 例如：租金 / 管理費 / 電費 / 寛頻 / 清潔' : 'No templates yet — e.g. Rent / Mgmt fee / Electricity'}</p>}
                </div>
                <div className="flex gap-2">
                  <input value={tplName} onChange={(e) => setTplName(e.target.value)}
                    placeholder={locale === 'zh' ? '項目名（例：租金）' : 'Item (e.g. Rent)'} className={`flex-1 ${inputCls}`} />
                  <input type="number" value={tplAmount} onChange={(e) => setTplAmount(e.target.value)}
                    placeholder="HK$" className={`w-28 ${inputCls}`} />
                  <button
                    onClick={async () => {
                      if (!tplName.trim() || !(parseFloat(tplAmount) >= 0)) return;
                      await addTemplate({ branchKey: branch, name: tplName.trim(), amount: parseFloat(tplAmount), order: templates.length, active: true });
                      setTplName(''); setTplAmount('');
                      await load();
                    }}
                    className="btn-primary text-xs flex items-center gap-1"><Plus size={12} /> {locale === 'zh' ? '新增' : 'Add'}</button>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              {recurringRows.map((r) => (
                <div key={r.id} className="flex items-center gap-2 text-sm">
                  <span className="flex-1">{r.item}</span>
                  <input
                    type="number"
                    value={amountDrafts[r.id] ?? String(r.amount)}
                    onChange={(e) => setAmountDrafts((p) => ({ ...p, [r.id]: e.target.value }))}
                    onBlur={() => saveAmount(r)}
                    className={`w-28 text-right ${inputCls}`}
                  />
                  <button onClick={async () => {
                    if (!window.confirm(locale === 'zh' ? `刪除本月「${r.item}」？` : `Remove "${r.item}" for this month?`)) return;
                    await deleteExpense(r.id); await load();
                  }} className="w-7 h-7 rounded-lg hover:bg-rose-50 text-rose-400 flex items-center justify-center"><Trash2 size={12} /></button>
                </div>
              ))}
              {recurringRows.length === 0 && (
                <p className="text-xs text-ink-soft italic">{locale === 'zh' ? '本月未有固定開支 — 先喺「設定固定項目」加項目。' : 'None this month — define templates first.'}</p>
              )}
            </div>
          </div>

          {/* 雜項支出 */}
          <div className="glass-card p-6">
            <h2 className="font-bold mb-3">{locale === 'zh' ? '雜項支出' : 'One-off expenses'}</h2>
            <div className="space-y-1.5 mb-3">
              {manualRows.map((r) => (
                <div key={r.id} className="flex items-center gap-2 text-sm">
                  <span className="text-xs text-ink-soft w-20">{r.date?.slice(5)}</span>
                  <span className="flex-1">{r.item}</span>
                  <input
                    type="number"
                    value={amountDrafts[r.id] ?? String(r.amount)}
                    onChange={(e) => setAmountDrafts((p) => ({ ...p, [r.id]: e.target.value }))}
                    onBlur={() => saveAmount(r)}
                    className={`w-28 text-right ${inputCls}`}
                  />
                  <button onClick={async () => {
                    if (!window.confirm(locale === 'zh' ? `刪除「${r.item}」？` : `Delete "${r.item}"?`)) return;
                    await deleteExpense(r.id); await load();
                  }} className="w-7 h-7 rounded-lg hover:bg-rose-50 text-rose-400 flex items-center justify-center"><Trash2 size={12} /></button>
                </div>
              ))}
              {manualRows.length === 0 && <p className="text-xs text-ink-soft italic">{locale === 'zh' ? '本月未有雜項。' : 'None yet.'}</p>}
            </div>
            <div className="flex gap-2 flex-wrap">
              <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className={inputCls} />
              <input value={newItem} onChange={(e) => setNewItem(e.target.value)}
                placeholder={locale === 'zh' ? '項目（例：維修冷氣）' : 'Item (e.g. AC repair)'} className={`flex-1 min-w-[160px] ${inputCls}`} />
              <input type="number" value={newAmount} onChange={(e) => setNewAmount(e.target.value)} placeholder="HK$" className={`w-28 ${inputCls}`} />
              <button onClick={handleAddManual} disabled={adding}
                className="btn-primary text-xs flex items-center gap-1 disabled:opacity-50">
                {adding ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} {locale === 'zh' ? '入帳' : 'Add'}
              </button>
            </div>
          </div>

          {/* 佣金（自動） */}
          <div className="glass-card p-6">
            <h2 className="font-bold mb-1">{locale === 'zh' ? '佣金（自動計算）' : 'Commissions (auto)'}</h2>
            <p className="text-xs text-ink-soft mb-3">
              {locale === 'zh'
                ? '按渠道規則自動計：行家 = 只計場租（食品飲品豁免）；Reubird = 全單消費。每單可以直接改金額（議價單）。'
                : 'Per channel rules: 行家 = rent only (F&B exempt); Reubird = full consumption. Override any booking inline.'}
            </p>
            <div className="space-y-1.5">
              {commissionRows.map(({ booking: b, rule, amount, channel }) => (
                <div key={b.id} className="flex items-center gap-2 text-sm flex-wrap">
                  <span className="text-xs text-ink-soft w-14">{b.date.slice(5)}</span>
                  <span className="flex-1 min-w-[140px] truncate">
                    {b.customerName || '—'} · <span className="text-xs text-ink-soft">{channelDisplayLabel(b, locale)}</span>
                  </span>
                  <span className="text-[11px] text-ink-soft whitespace-nowrap">
                    {rule ? `${rule.pct}% × ${rule.base === 'rent' ? (locale === 'zh' ? '場租' : 'rent') : (locale === 'zh' ? '全單' : 'total')} $${(rule.base === 'rent' ? (b.pricing.baseCharge || 0) : discountedSubtotal(b.pricing.subtotal, b.promoDiscount)).toLocaleString()}` : (locale === 'zh' ? '手動' : 'manual')}
                  </span>
                  <input
                    type="number"
                    value={overrideDrafts[b.id] ?? String(typeof b.commissionOverride === 'number' ? b.commissionOverride : amount)}
                    onChange={(e) => setOverrideDrafts((p) => ({ ...p, [b.id]: e.target.value }))}
                    onBlur={() => saveOverride(b)}
                    className={`w-28 text-right ${inputCls} ${typeof b.commissionOverride === 'number' ? 'border-amber-300 bg-amber-50' : ''}`}
                    title={locale === 'zh' ? '改金額 = 手動覆蓋自動計算' : 'Editing overrides the auto amount'}
                  />
                </div>
              ))}
              {commissionRows.length === 0 && <p className="text-xs text-ink-soft italic">{locale === 'zh' ? '本月冇行家/平台訂單。' : 'No broker bookings this month.'}</p>}
            </div>
          </div>

          {/* KPay 費（估算） */}
          <div className="glass-card p-6">
            <h2 className="font-bold mb-1">{locale === 'zh' ? `KPay 手續費（估算 ${config?.kpayFeePct ?? 1.5}%）` : `KPay fees (est. ${config?.kpayFeePct ?? 1.5}%)`}</h2>
            <p className="text-xs text-ink-soft mb-3">
              {locale === 'zh'
                ? '按 KPay 收款金額估算。月結時 upload KPay statement 會用實數取代（Phase 3）。'
                : 'Estimated on KPay-collected amounts; the monthly statement upload replaces estimates with actuals (Phase 3).'}
            </p>
            <div className="space-y-1">
              {kpayFeeRows.map(({ booking: b, fee }) => (
                <div key={b.id} className="flex items-center gap-2 text-xs text-ink-soft">
                  <span className="w-14">{b.date.slice(5)}</span>
                  <span className="flex-1 truncate">{b.customerName || b.id.slice(0, 8)}</span>
                  <span className="font-medium text-ink">HK${fee.toLocaleString()}</span>
                </div>
              ))}
              {kpayFeeRows.length === 0 && <p className="text-xs text-ink-soft italic">{locale === 'zh' ? '本月冇 KPay 收款。' : 'No KPay payments this month.'}</p>}
            </div>
          </div>

          {/* Config — admin role only */}
          {isAdminRole && config && (
            <div className="glass-card p-6">
              <h2 className="font-bold mb-3 flex items-center gap-2"><Settings2 size={15} /> {locale === 'zh' ? '規則設定（只限 Admin）' : 'Rules (admin only)'}</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                <label className="block">
                  <span className="text-xs font-semibold text-ink-soft">{locale === 'zh' ? '行家佣金 %（只計場租）' : 'Agent % (rent only)'}</span>
                  <input type="number" step="0.1" value={config.commissionRules.agent?.pct ?? 10}
                    onChange={(e) => setConfig({ ...config, commissionRules: { ...config.commissionRules, agent: { pct: parseFloat(e.target.value) || 0, base: 'rent' } } })}
                    className={`mt-1 w-full ${inputCls}`} />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-ink-soft">{locale === 'zh' ? 'Reubird 佣金 %（全單）' : 'Reubird % (total)'}</span>
                  <input type="number" step="0.1" value={config.commissionRules.reubird?.pct ?? 10}
                    onChange={(e) => setConfig({ ...config, commissionRules: { ...config.commissionRules, reubird: { pct: parseFloat(e.target.value) || 0, base: 'total' } } })}
                    className={`mt-1 w-full ${inputCls}`} />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-ink-soft">{locale === 'zh' ? 'KPay 費估算 %' : 'KPay fee est. %'}</span>
                  <input type="number" step="0.1" value={config.kpayFeePct}
                    onChange={(e) => setConfig({ ...config, kpayFeePct: parseFloat(e.target.value) || 0 })}
                    className={`mt-1 w-full ${inputCls}`} />
                </label>
              </div>
              <button
                onClick={async () => { await saveFinanceConfig(config); setFlash(locale === 'zh' ? '✓ 規則已儲存' : '✓ Saved'); setTimeout(() => setFlash(null), 1500); await load(); }}
                className="btn-primary text-xs mt-3 flex items-center gap-1"><Check size={12} /> {locale === 'zh' ? '儲存規則' : 'Save rules'}</button>
            </div>
          )}

          <button onClick={load} className="text-xs text-ink-soft hover:text-pink flex items-center gap-1">
            <RefreshCw size={11} /> {locale === 'zh' ? '重新載入' : 'Reload'}
          </button>
        </div>
      )}
    </div>
  );
}
