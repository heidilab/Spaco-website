'use client';

// 支出管理 (Finance Phase 2) — per-branch monthly expense ledger.
//
// Replaces the DR side of Heidi's Financial Master Excel:
//   固定開支  seeded from admin-defined templates, editable per month
//   雜項支出  free-form rows (repairs, supplies, …)
//   佣金      derived live per broker booking (行家 rent-only / Reubird
//             total, per finance_config), per-booking override editable
//   KPay 費   per booking: actual fee of each payment found on an
//             uploaded KPay statement (月結 → KPay 對帳), estimated % for
//             payments whose statement is not uploaded yet
//
// The monthly close (Phase 3) reads: Σ(stored rows) + Σ(derived rows).

import { useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import { getAllBookings } from '@/lib/firestore';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { branchKey as branchKeyOf, branchGroupName, countsForFinance, financeBranches } from '@/lib/finance';
import { loadAllVenues } from '@/lib/venueRegistry';
import {
  listExpenses, addExpense, updateExpense, deleteExpense,
  listTemplates, addTemplate, updateTemplate, deleteTemplate, seedRecurring, sameExpenseItem,
  getFinanceConfig, saveFinanceConfig, type FinanceConfig,
} from '@/lib/expenses';
import { commissionForBooking, commissionBase, depositDeductionsKept } from '@/lib/bookingMoney';
import { listKpayStatements } from '@/lib/monthClose';
import { reconcileKpayFees, kpayFeeOf, sumKpayFees, type KpayReconciliation } from '@/lib/kpayReconcile';
import { channelDisplayLabel, getChannelRegistry, platformChannelIds, type MarketingChannelOption } from '@/lib/marketingChannels';
import type { BookingRecord, ExpenseRecord, ExpenseTemplate, Venue } from '@/types';
import {
  Wallet, Plus, Trash2, Loader2, Check, Settings2, RefreshCw,
} from 'lucide-react';

// Branch tabs come from the venue registry (finance.financeBranches): the
// original four keep their keys, so existing expenses and templates still
// match, and a branch added in 分店管理 is ONE ledger under its branchKey —
// 尖沙咀 HART's three rooms → `tsthart` (owner decision 2026-11-10).

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export default function ExpensesPage() {
  const locale = useLocale() as 'zh' | 'en';
  const { user, hasPermission } = useAuth();
  // Admin-only since 2026-09-07 — CS must not see expenses/close data.
  const canAccess = hasPermission('staff');
  const isAdminRole = hasPermission('staff');

  const [branch, setBranch] = useState('cwb');
  const [month, setMonth] = useState(currentMonth());
  const [rows, setRows] = useState<ExpenseRecord[]>([]);
  const [templates, setTemplates] = useState<ExpenseTemplate[]>([]);
  const [bookings, setBookings] = useState<BookingRecord[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [config, setConfig] = useState<FinanceConfig | null>(null);
  // KPay fee per booking, reconciled against the uploaded statements.
  const [kpayRecon, setKpayRecon] = useState<KpayReconciliation | null>(null);
  const [channelNames, setChannelNames] = useState<Map<string, MarketingChannelOption>>(new Map());
  // Broker / platform channel ids (內容管理 → 來源渠道), for the no-rule warning.
  const [platformIds, setPlatformIds] = useState<string[]>([]);
  useEffect(() => {
    getChannelRegistry().then((registry) => {
      setChannelNames(new Map(registry.map((o) => [o.id, o])));
      setPlatformIds(platformChannelIds(registry));
    }).catch(() => {});
  }, []);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState<string | null>(null);
  // Preview/test deployments include 🧪 test bookings (they're the only
  // bookings that exist there — see countsForFinance). Prod never does.
  const [isPreviewHost, setIsPreviewHost] = useState(false);
  useEffect(() => {
    const h = window.location.hostname;
    setIsPreviewHost(h !== 'spacohk.com' && h !== 'www.spacohk.com');
  }, []);

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
      const [exp, tpl, all, cfg, registry, statements] = await Promise.all([
        listExpenses(branch, month),
        listTemplates(branch),
        getAllBookings(),
        getFinanceConfig(),
        // Falls back to the static venues if the registry is unreachable
        // (then only the original four branches are listed).
        loadAllVenues(),
        listKpayStatements(),
      ]);
      setVenues(registry);
      // Over ALL bookings, so every statement row can find its booking.
      setKpayRecon(reconcileKpayFees(all, statements, cfg.kpayFeePct));
      // Auto-seed missing recurring rows, then re-read if anything seeded.
      const created = await seedRecurring(branch, month, tpl, exp, user.uid);
      setRows(created > 0 ? await listExpenses(branch, month) : exp);
      setTemplates(tpl);
      setConfig(cfg);
      const previewHost = typeof window !== 'undefined'
        && !['spacohk.com', 'www.spacohk.com'].includes(window.location.hostname);
      setBookings(all.filter((b) =>
        countsForFinance(b, { includeTest: previewHost })
        && b.date.startsWith(month)
        && branchKeyOf(b.venueId, registry) === branch));
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
  // A broker / platform booking whose channel has NO rule is listed too,
  // flagged 「未設佣金規則」, instead of vanishing: a booking moved to
  // Common Room (#C7xSBqCw, 2026-11-13) earned nothing and nothing said
  // why. Its amount can still be typed by hand.
  const commissionRows = useMemo(() => {
    if (!config) return [];
    return bookings
      .map((b) => {
        const ch = b.marketingChannel || '';
        const rule = config.commissionRules[ch];
        const amount = commissionForBooking(b, rule);
        return { booking: b, rule, amount, channel: ch, noRule: !rule && platformIds.includes(ch) };
      })
      .filter((r) => r.rule || r.noRule || typeof r.booking.commissionOverride === 'number')
      .filter((r) => r.amount > 0 || r.noRule || typeof r.booking.commissionOverride === 'number');
  }, [bookings, config, platformIds]);

  const kpayFeeRows = useMemo(() => {
    if (!kpayRecon) return [];
    return bookings
      .map((b) => ({ booking: b, kpay: kpayFeeOf(kpayRecon, b.id) }))
      .filter((r) => r.kpay.lines.length > 0)
      .map((r) => ({ ...r, fee: r.kpay.fee }));
  }, [bookings, kpayRecon]);
  const kpayTotals = useMemo(() => sumKpayFees(kpayFeeRows.map((r) => r.kpay)), [kpayFeeRows]);

  const recurringRows = rows.filter((r) => r.source === 'recurring');
  const manualRows = rows.filter((r) => r.source === 'manual');
  const totals = {
    recurring: recurringRows.reduce((s, r) => s + r.amount, 0),
    manual: manualRows.reduce((s, r) => s + r.amount, 0),
    commission: commissionRows.reduce((s, r) => s + r.amount, 0),
    kpay: kpayTotals.fee,
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

  /** Save the typed commission for one booking (null = back to auto). A
   *  typed amount equal to the auto amount is stored anyway: she wants
   *  「呢張單就係呢個數」 to stick even if the rule changes later. */
  async function saveOverride(b: BookingRecord, value: number | null) {
    setSavingOverride(b.id);
    try {
      await updateDoc(doc(db, 'bookings', b.id), {
        commissionOverride: value,
        updatedAt: serverTimestamp(),
      });
      setOverrideDrafts((p) => { const n = { ...p }; delete n[b.id]; return n; });
      setFlash(value === null
        ? (locale === 'zh' ? '✓ 已還原自動計算' : '✓ Back to auto')
        : (locale === 'zh' ? `✓ 佣金已儲存：HK$${value.toLocaleString()}` : `✓ Commission saved: HK$${value.toLocaleString()}`));
      setTimeout(() => setFlash(null), 2000);
      await load();
    } finally {
      setSavingOverride(null);
    }
  }
  const [savingOverride, setSavingOverride] = useState<string | null>(null);

  if (!canAccess) {
    return <div className="text-center py-20 text-ink-soft">{locale === 'zh' ? '無權限存取' : 'Access Denied'}</div>;
  }

  // The original four + every active branch in 分店管理. The selected
  // branch stays listed even if it was taken offline meanwhile.
  const branches = financeBranches(venues, [branch]);

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
        {branches.map(({ key: b, name }) => (
          <button key={b} onClick={() => setBranch(b)}
            className={`px-3.5 py-2 rounded-pill text-sm font-semibold transition ${
              branch === b ? 'bg-gradient-pink text-white shadow-glow' : 'bg-white/60 text-ink-soft hover:bg-white'
            }`}>
            {name[locale]}
          </button>
        ))}
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
          className="ml-auto px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white/85" />
      </div>

      {isPreviewHost && (
        <div className="mb-3 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
          🧪 {locale === 'zh'
            ? '測試環境：此處包含測試單嘅佣金/費用，方便你驗證。正式站只計真訂單。'
            : 'Test environment: test bookings are included here for verification. Production counts real bookings only.'}
        </div>
      )}
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
              [
                kpayTotals.estimatedLines === 0 && kpayTotals.actualLines > 0
                  ? (locale === 'zh' ? 'KPay 費(實際)' : 'KPay fee (actual)')
                  : kpayTotals.actualLines > 0
                    ? (locale === 'zh' ? 'KPay 費(部分估算)' : 'KPay fee (part est.)')
                    : (locale === 'zh' ? 'KPay 費(估)' : 'KPay fee (est.)'),
                totals.kpay,
              ],
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
                    ? `「${branchGroupName(branch, venues)[locale]}」嘅固定開支項目 — 新月份會自動入帳；當月金額可以喺下面個表逐月改，唔影響呢度嘅預設。`
                    : `Recurring items for ${branchGroupName(branch, venues)[locale]} — auto-seeded each month; per-month amounts editable below without touching these defaults.`}
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
                        if (!window.confirm(locale === 'zh'
                          ? `刪除固定項目「${t.name}」？\n\n${month} 同之後月份已入帳嘅「${t.name}」會一併刪除；${month} 之前嘅月份唔受影響。`
                          : `Delete template "${t.name}"?\n\nIts rows in ${month} and later months are removed too; earlier months are untouched.`)) return;
                        const removed = await deleteTemplate(t.id, month);
                        setFlash(locale === 'zh' ? `✓ 已刪除「${t.name}」${removed > 0 ? `，連同 ${removed} 個月份嘅入帳` : ''}` : `✓ Deleted "${t.name}"${removed > 0 ? ` and ${removed} month row(s)` : ''}`);
                        setTimeout(() => setFlash(null), 2500);
                        await load();
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
              {recurringRows.map((r, idx) => {
                const orphan = !!r.templateId && !templates.some((t) => t.id === r.templateId);
                const duplicate = recurringRows.findIndex((o) => sameExpenseItem(o.item, r.item)) < idx;
                return (
                <div key={r.id} className="flex items-center gap-2 text-sm">
                  <span className="flex-1">
                    {r.item}
                    {orphan && (
                      <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-pill border bg-amber-50 text-amber-700 border-amber-200 whitespace-nowrap"
                        title={locale === 'zh' ? '呢個固定項目已經刪除；呢行係之前入咗帳嘅，唔要就撳垃圾桶' : 'Its template was deleted; this row was seeded earlier — delete it if not wanted'}>
                        {locale === 'zh' ? '固定項目已刪除' : 'Template deleted'}
                      </span>
                    )}
                    {duplicate && (
                      <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-pill border bg-rose-50 text-rose-600 border-rose-200 whitespace-nowrap"
                        title={locale === 'zh' ? '同名項目本月出現多過一次' : 'Same item appears more than once this month'}>
                        {locale === 'zh' ? '重複' : 'Duplicate'}
                      </span>
                    )}
                  </span>
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
                );
              })}
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
            <h2 className="font-bold mb-1">{locale === 'zh' ? '佣金（自動計算，可手動改）' : 'Commissions (auto, editable)'}</h2>
            <p className="text-xs text-ink-soft mb-3">
              {locale === 'zh'
                ? '按渠道規則自動計，計埋扣按金嘅加時／罰款：行家 = 場租 + 加時/罰款（食品飲品豁免）；Reubird = 全單 + 加時/罰款。金額有出入就直接改個數，撳「儲存」— 儲存咗嘅數以後都用返呢個，月結亦跟呢個。'
                : 'Per channel rules, including 加時/罰款 kept from the deposit: 行家 = rent + extras (F&B exempt); Reubird = full bill + extras. Type a different amount and press Save — the saved figure is what month close uses.'}
            </p>
            <div className="space-y-1.5">
              {commissionRows.map(({ booking: b, rule, amount, noRule }) => {
                const manual = typeof b.commissionOverride === 'number';
                const auto = rule ? Math.round(commissionBase(b, rule.base) * (rule.pct / 100) * 100) / 100 : 0;
                const extras = depositDeductionsKept(b);
                const shown = overrideDrafts[b.id] ?? String(manual ? b.commissionOverride : amount);
                const typed = shown.trim() === '' ? NaN : parseFloat(shown);
                const current = manual ? (b.commissionOverride as number) : amount;
                const dirty = overrideDrafts[b.id] !== undefined && Number.isFinite(typed) && typed >= 0 && typed !== current;
                const busy = savingOverride === b.id;
                return (
                  <div key={b.id} className="flex items-center gap-2 text-sm flex-wrap">
                    <span className="text-xs text-ink-soft w-14">{b.date.slice(5)}</span>
                    <span className="flex-1 min-w-[140px] truncate">
                      {b.customerName || '—'} · <span className="text-xs text-ink-soft">{channelDisplayLabel(b, locale)}</span>
                    </span>
                    <span className="text-[11px] text-ink-soft whitespace-nowrap">
                      {rule
                        ? `${rule.pct}% × ${rule.base === 'rent' ? (locale === 'zh' ? '場租' : 'rent') : (locale === 'zh' ? '全單' : 'total')} $${commissionBase(b, rule.base).toLocaleString()}${extras > 0 ? (locale === 'zh' ? `（含加時/罰款 $${extras.toLocaleString()}）` : ` (incl. extras $${extras.toLocaleString()})`) : ''} = $${auto.toLocaleString()}`
                        : noRule && !manual
                          ? <span className="text-amber-700 font-semibold" title={locale === 'zh' ? '去 財務 → 來源渠道／佣金，喺呢個渠道剔「佣金」並儲存' : 'Tick 佣金 for this channel under 財務 → 來源渠道／佣金 and save'}>
                              {locale === 'zh' ? `⚠ 「${channelDisplayLabel(b, locale)}」未設佣金規則` : `⚠ no commission rule for "${channelDisplayLabel(b, locale)}"`}
                            </span>
                          : (locale === 'zh' ? '手動' : 'manual')}
                    </span>
                    <input
                      type="number"
                      min={0}
                      value={shown}
                      onChange={(e) => setOverrideDrafts((p) => ({ ...p, [b.id]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === 'Enter' && dirty && !busy) saveOverride(b, typed); }}
                      className={`w-28 text-right ${inputCls} ${manual ? 'border-amber-300 bg-amber-50' : ''}`}
                      title={manual ? (locale === 'zh' ? '手動儲存嘅佣金' : 'Manually saved commission') : (locale === 'zh' ? '自動計算' : 'Auto')}
                    />
                    <button
                      onClick={() => saveOverride(b, typed)}
                      disabled={!dirty || busy}
                      className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1 disabled:opacity-40"
                    >
                      {busy ? <Loader2 size={12} className="animate-spin" /> : null}
                      {locale === 'zh' ? '儲存' : 'Save'}
                    </button>
                    {manual && (
                      <button
                        onClick={() => saveOverride(b, null)}
                        disabled={busy}
                        title={locale === 'zh' ? `還原自動計算（$${auto.toLocaleString()}）` : `Back to auto ($${auto.toLocaleString()})`}
                        className="text-[11px] px-2 py-1 rounded-lg border border-charcoal/15 bg-white hover:bg-cream whitespace-nowrap disabled:opacity-40"
                      >
                        {locale === 'zh' ? '還原自動' : 'Auto'}
                      </button>
                    )}
                  </div>
                );
              })}
              {commissionRows.length === 0 && <p className="text-xs text-ink-soft italic">{locale === 'zh' ? '本月冇行家/平台訂單。' : 'No broker bookings this month.'}</p>}
            </div>
          </div>

          {/* KPay 手續費 — actual per payment where a statement has it */}
          <div className="glass-card p-6">
            <h2 className="font-bold mb-1">{locale === 'zh' ? 'KPay 手續費' : 'KPay fees'}</h2>
            <p className="text-xs text-ink-soft mb-3">
              {locale === 'zh'
                ? `每張訂單嘅手續費 = 佢每筆 KPay 付款喺「俾錢嗰個月」結單上面嘅實際手續費相加。未上載嗰個月結單嘅付款，暫時按 ${config?.kpayFeePct ?? 1.5}% 估算（標示「含估算」）。結單喺「月結 → KPay 對帳」上載。`
                : `A booking's fee is the actual fee of each of its KPay payments, read off the statement of the month it was paid in. Payments whose statement is not uploaded yet use the ${config?.kpayFeePct ?? 1.5}% estimate (marked). Upload statements under Month Close → KPay Reconciliation.`}
            </p>
            <div className="space-y-1">
              {kpayFeeRows.map(({ booking: b, fee, kpay }) => (
                <div key={b.id} className="flex items-center gap-2 text-xs text-ink-soft">
                  <span className="w-14">{b.date.slice(5)}</span>
                  <span className="flex-1 truncate">{b.customerName || b.id.slice(0, 8)}</span>
                  {kpay.lines.some((l) => !l.actual) && (
                    <span className="text-amber-700">{locale === 'zh' ? '含估算' : 'part est.'}</span>
                  )}
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
              <p className="text-xs text-ink-soft mb-3">
                {locale === 'zh'
                  ? '呢度同「財務 → 來源渠道／佣金」係同一份佣金數據 — 邊度改都會同步。新增渠道（包括行家／平台）同佣金請去嗰度。'
                  : 'Same data as 財務 → 來源渠道／佣金 — edit in either place. Add channels (brokers / platforms too) and their rules there.'}
              </p>
              <div className="space-y-2 text-sm mb-3">
                {Object.entries(config.commissionRules).map(([id, rule]) => {
                  const label = channelNames.get(id)?.[locale] || id;
                  return (
                    <div key={id} className="flex items-center gap-2 flex-wrap">
                      <span className="w-32 truncate">{label}</span>
                      <span className="text-[10px] font-mono text-ink-soft w-24 truncate">{id}</span>
                      <input type="number" step="0.1" min={0} value={rule.pct}
                        onChange={(e) => setConfig({ ...config, commissionRules: { ...config.commissionRules, [id]: { ...rule, pct: parseFloat(e.target.value) || 0 } } })}
                        className={`w-20 text-right ${inputCls}`} />
                      <span className="text-xs text-ink-soft">%</span>
                      <select value={rule.base}
                        onChange={(e) => setConfig({ ...config, commissionRules: { ...config.commissionRules, [id]: { ...rule, base: e.target.value as 'rent' | 'total' } } })}
                        className={inputCls}>
                        <option value="total">{locale === 'zh' ? '全單' : 'Total'}</option>
                        <option value="rent">{locale === 'zh' ? '只計場租' : 'Rent only'}</option>
                      </select>
                      <button type="button"
                        onClick={() => {
                          if (!window.confirm(locale === 'zh' ? `移除「${label}」嘅佣金規則？` : `Remove commission rule for ${label}?`)) return;
                          const next = { ...config.commissionRules };
                          delete next[id];
                          setConfig({ ...config, commissionRules: next });
                        }}
                        className="w-7 h-7 rounded-lg hover:bg-rose-50 text-rose-400 flex items-center justify-center"><Trash2 size={12} /></button>
                    </div>
                  );
                })}
                {Object.keys(config.commissionRules).length === 0 && (
                  <p className="text-xs text-ink-soft italic">{locale === 'zh' ? '未有佣金規則。' : 'No rules.'}</p>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
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
