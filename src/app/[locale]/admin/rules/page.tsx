'use client';

// 預訂規則 (site review 2026-11-13, phase 4d) — one place for the money
// rules that were written in code, 預訂須知, 條款 and FAQ separately:
// deposit tiers, fixed deposit deductions, loyalty-point rates and the
// instalment rule. Saved to site_content/booking_rules (lib/bookingRules);
// pricing, deposit settlement, 預訂須知 and 條款 read the same document.

import { useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import { loadBookingRules, saveBookingRules } from '@/lib/bookingRulesClient';
import {
  DEFAULT_BOOKING_RULES, sanitizeBookingRules, depositTierLines, deductionLines, installmentSentence, pointsSentence,
  type BookingRules,
} from '@/lib/bookingRules';
import { Scale, Loader2, Check, Plus, Trash2, RotateCcw } from 'lucide-react';

interface TierRow { upTo: string; deposit: string }
interface DeductionRow { id: string; zh: string; en: string; amount: string }
interface Draft {
  tiers: TierRow[];
  deductions: DeductionRow[];
  pointsPerHkd: string; pointsEarnPerHkd: string;
  installmentThreshold: string; installmentPct: string; balanceDueDaysBefore: string;
}

const INPUT = 'w-full border rounded-lg px-2.5 py-1.5 text-sm bg-white';

function draftOf(r: BookingRules): Draft {
  return {
    tiers: r.depositTiers.map((t) => ({ upTo: t.upTo === null ? '' : String(t.upTo), deposit: String(t.deposit) })),
    deductions: r.deductionItems.map((d) => ({ id: d.id, zh: d.zh, en: d.en, amount: String(d.amount) })),
    pointsPerHkd: String(r.pointsPerHkd), pointsEarnPerHkd: String(r.pointsEarnPerHkd),
    installmentThreshold: String(r.installmentThreshold), installmentPct: String(r.installmentPct), balanceDueDaysBefore: String(r.balanceDueDaysBefore),
  };
}
function rulesOf(d: Draft): BookingRules {
  return sanitizeBookingRules({
    depositTiers: d.tiers.map((t) => ({ upTo: t.upTo.trim() === '' ? null : t.upTo, deposit: t.deposit })),
    deductionItems: d.deductions.map((x) => ({ ...x })),
    pointsPerHkd: d.pointsPerHkd, pointsEarnPerHkd: d.pointsEarnPerHkd,
    installmentThreshold: d.installmentThreshold, installmentPct: d.installmentPct, balanceDueDaysBefore: d.balanceDueDaysBefore,
  });
}
const slugOf = (zh: string, en: string, taken: Set<string>) => {
  const base = (en || zh).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `item-${Date.now().toString(36)}`;
  let out = base; let n = 2;
  while (taken.has(out)) out = `${base}-${n++}`;
  return out;
};

export default function BookingRulesAdminPage() {
  const locale = useLocale() as 'zh' | 'en';
  const zh = locale === 'zh';
  const { user, hasPermission } = useAuth();
  const canAccess = hasPermission('staff');

  const [draft, setDraft] = useState<Draft>(draftOf(DEFAULT_BOOKING_RULES));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!canAccess) return;
    loadBookingRules(true).then((r) => setDraft(draftOf(r))).finally(() => setLoading(false));
  }, [canAccess]);

  const preview = useMemo(() => rulesOf(draft), [draft]);
  const problems = useMemo(() => {
    const out: string[] = [];
    const open = draft.tiers.filter((t) => t.upTo.trim() === '').length;
    if (draft.tiers.length === 0) out.push(zh ? '最少要有一個按金級別' : 'At least one deposit tier');
    if (open !== 1) out.push(zh ? '要有一個（而且只有一個）「以上」級別（上限留空）' : 'Exactly one open-ended tier (blank cap)');
    if (draft.tiers.some((t) => t.deposit.trim() === '' || !(Number(t.deposit) >= 0))) out.push(zh ? '每個級別都要填按金' : 'Every tier needs a deposit');
    if (draft.deductions.some((d) => !d.zh.trim() || d.amount.trim() === '' || !(Number(d.amount) >= 0))) out.push(zh ? '每項扣款都要有中文名同金額' : 'Every deduction needs a Chinese name and an amount');
    if (!(Number(draft.pointsPerHkd) >= 1)) out.push(zh ? '「幾多積分當 $1」最少 1' : 'Points per HK$1 must be at least 1');
    return out;
  }, [draft, zh]);

  const setTier = (i: number, p: Partial<TierRow>) => setDraft((d) => ({ ...d, tiers: d.tiers.map((t, j) => (j === i ? { ...t, ...p } : t)) }));
  const setDed = (i: number, p: Partial<DeductionRow>) => setDraft((d) => ({ ...d, deductions: d.deductions.map((x, j) => (j === i ? { ...x, ...p } : x)) }));

  async function save() {
    if (problems.length > 0) { setMessage({ ok: false, text: problems.join('；') }); return; }
    setSaving(true); setMessage(null);
    try {
      const taken = new Set<string>();
      const withIds: Draft = {
        ...draft,
        deductions: draft.deductions.map((x) => {
          const id = x.id.trim() ? x.id.trim().toLowerCase() : slugOf(x.zh, x.en, taken);
          taken.add(id);
          return { ...x, id };
        }),
      };
      const saved = await saveBookingRules(rulesOf(withIds), user?.email || 'admin');
      setDraft(draftOf(saved));
      setMessage({ ok: true, text: zh ? '已儲存。計價、按金結算、預訂須知同條款即時跟住變。' : 'Saved — pricing, settlement, guidelines and terms follow at once.' });
    } catch {
      setMessage({ ok: false, text: zh ? '儲存失敗，請再試。' : 'Could not save — please try again.' });
    } finally {
      setSaving(false);
    }
  }

  if (!canAccess) return <div className="p-8 text-gray-500">{zh ? '冇權限' : 'No access'}</div>;

  return (
    <div className="p-4 md:p-8 pb-28 space-y-5 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Scale className="w-6 h-6 text-pink" />
          {zh ? '預訂規則' : 'Booking rules'}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {zh
            ? '按金級別、固定按金扣款、積分同分期規則只喺呢度設定一次：訂場計價、按金結算、客人預訂須知同條款都會自動用同一套數字。'
            : 'Deposit tiers, fixed deductions, loyalty points and the instalment rule are set once here; pricing, settlement, the guidelines and the terms all use them.'}
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>
      ) : (
        <>
          {/* ── deposit tiers ── */}
          <section className="bg-white rounded-xl border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{zh ? '按金級別（按場地消費：場租＋附加服務）' : 'Deposit tiers (by the bill: rent + add-ons)'}</h2>
              <button type="button" onClick={() => setDraft((d) => ({ ...d, tiers: draftOf(DEFAULT_BOOKING_RULES).tiers }))} className="text-xs text-gray-500 hover:underline inline-flex items-center gap-1"><RotateCcw className="w-3 h-3" />{zh ? '還原預設' : 'Defaults'}</button>
            </div>
            <div className="hidden md:grid grid-cols-[1fr,1fr,2.5rem] gap-2 text-xs text-gray-500 px-1">
              <span>{zh ? '消費上限 HK$（最後一級留空＝以上）' : 'Bill up to HK$ (blank = and above)'}</span><span>{zh ? '按金 HK$' : 'Deposit HK$'}</span><span />
            </div>
            {draft.tiers.map((t, i) => (
              <div key={i} className="grid grid-cols-[1fr,1fr,2.5rem] gap-2 items-center">
                <input type="number" min={1} value={t.upTo} onChange={(e) => setTier(i, { upTo: e.target.value })} placeholder={zh ? '以上' : 'and above'} className={INPUT} />
                <input type="number" min={0} value={t.deposit} onChange={(e) => setTier(i, { deposit: e.target.value })} className={INPUT} />
                <button type="button" onClick={() => setDraft((d) => ({ ...d, tiers: d.tiers.filter((_, j) => j !== i) }))} className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
            <button type="button" onClick={() => setDraft((d) => ({ ...d, tiers: [...d.tiers, { upTo: '', deposit: '' }] }))} className="text-sm text-pink hover:underline inline-flex items-center gap-1"><Plus className="w-4 h-4" />{zh ? '新增級別' : 'Add tier'}</button>
            <div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-600 whitespace-pre-line">
              <span className="font-semibold">{zh ? '客人會見到：' : 'Customers read:'}</span>{'\n'}{depositTierLines(locale, preview).map((l) => `• ${l}`).join('\n')}
            </div>
          </section>

          {/* ── fixed deductions ── */}
          <section className="bg-white rounded-xl border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{zh ? '固定按金扣款項目（結算時剔選）' : 'Fixed deposit deductions (ticked at settlement)'}</h2>
              <button type="button" onClick={() => setDraft((d) => ({ ...d, deductions: draftOf(DEFAULT_BOOKING_RULES).deductions }))} className="text-xs text-gray-500 hover:underline inline-flex items-center gap-1"><RotateCcw className="w-3 h-3" />{zh ? '還原預設' : 'Defaults'}</button>
            </div>
            <div className="hidden md:grid grid-cols-[1fr,1fr,7rem,2.5rem] gap-2 text-xs text-gray-500 px-1">
              <span>{zh ? '中文' : 'Chinese'}</span><span>English</span><span>HK$</span><span />
            </div>
            {draft.deductions.map((x, i) => (
              <div key={i} className="grid grid-cols-2 md:grid-cols-[1fr,1fr,7rem,2.5rem] gap-2 items-center">
                <input value={x.zh} onChange={(e) => setDed(i, { zh: e.target.value })} placeholder={zh ? '例：沒有關閉焗爐' : 'e.g. Oven not turned off'} className={INPUT} />
                <input value={x.en} onChange={(e) => setDed(i, { en: e.target.value })} placeholder={zh ? 'English（留空＝用中文）' : 'English (blank = Chinese)'} className={INPUT} />
                <input type="number" min={0} value={x.amount} onChange={(e) => setDed(i, { amount: e.target.value })} className={INPUT} />
                <button type="button" onClick={() => setDraft((d) => ({ ...d, deductions: d.deductions.filter((_, j) => j !== i) }))} className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
            <button type="button" onClick={() => setDraft((d) => ({ ...d, deductions: [...d.deductions, { id: '', zh: '', en: '', amount: '' }] }))} className="text-sm text-pink hover:underline inline-flex items-center gap-1"><Plus className="w-4 h-4" />{zh ? '新增項目' : 'Add item'}</button>
            <div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-600 whitespace-pre-line">
              <span className="font-semibold">{zh ? '客人會見到：' : 'Customers read:'}</span>{'\n'}{deductionLines(locale, preview, '-').map((l) => `• ${l}`).join('\n')}
            </div>
          </section>

          {/* ── points + instalment ── */}
          <section className="bg-white rounded-xl border p-4 space-y-3">
            <h2 className="font-semibold">{zh ? '積分同分期' : 'Points and instalment'}</h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <label className="block"><span className="text-xs text-gray-500">{zh ? '每消費 $1 賺幾多積分' : 'Points earned per HK$1'}</span><input type="number" min={0} step="0.01" value={draft.pointsEarnPerHkd} onChange={(e) => setDraft((d) => ({ ...d, pointsEarnPerHkd: e.target.value }))} className={`${INPUT} mt-1`} /></label>
              <label className="block"><span className="text-xs text-gray-500">{zh ? '幾多積分當 $1 用' : 'Points worth HK$1'}</span><input type="number" min={1} value={draft.pointsPerHkd} onChange={(e) => setDraft((d) => ({ ...d, pointsPerHkd: e.target.value }))} className={`${INPUT} mt-1`} /></label>
              <label className="block"><span className="text-xs text-gray-500">{zh ? '總額超過 HK$ 可分期' : 'Instalment above HK$'}</span><input type="number" min={0} value={draft.installmentThreshold} onChange={(e) => setDraft((d) => ({ ...d, installmentThreshold: e.target.value }))} className={`${INPUT} mt-1`} /></label>
              <label className="block"><span className="text-xs text-gray-500">{zh ? '先付 %' : 'Upfront %'}</span><input type="number" min={1} max={100} value={draft.installmentPct} onChange={(e) => setDraft((d) => ({ ...d, installmentPct: e.target.value }))} className={`${INPUT} mt-1`} /></label>
              <label className="block"><span className="text-xs text-gray-500">{zh ? '餘額活動前幾日付' : 'Balance due days before'}</span><input type="number" min={0} value={draft.balanceDueDaysBefore} onChange={(e) => setDraft((d) => ({ ...d, balanceDueDaysBefore: e.target.value }))} className={`${INPUT} mt-1`} /></label>
            </div>
            <div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-600 whitespace-pre-line">
              <span className="font-semibold">{zh ? '客人會見到：' : 'Customers read:'}</span>{'\n'}{installmentSentence(locale, preview)}{'\n'}{pointsSentence(locale, preview)}
            </div>
            <p className="text-xs text-amber-700">
              {zh
                ? '注意：改積分比率只影響之後嘅結算；已經 credit 嘅積分唔會重計。改按金級別只影響新訂單；已落嘅訂單按金不變。'
                : 'Changing the points rate affects future settlements only; deposit tiers apply to new bookings only.'}
            </p>
          </section>

          <p className="text-xs text-gray-500">
            {zh
              ? '預訂須知同條款會自動插入以上數字。如果你喺內容管理自己寫咗預訂須知內文，可以用 {{DEPOSIT_TIERS}}、{{DEDUCTIONS}}、{{INSTALLMENT}}、{{POINTS}} 呢幾個代號，系統會自動換成最新規則。'
              : 'The guidelines and terms insert these figures automatically. Your own guideline text in 內容管理 may use the tokens {{DEPOSIT_TIERS}}, {{DEDUCTIONS}}, {{INSTALLMENT}} and {{POINTS}}.'}
          </p>

          <div className="sticky bottom-3 bg-white/95 backdrop-blur rounded-xl border p-4 flex flex-wrap items-center gap-3 shadow">
            <button onClick={save} disabled={saving} className="btn-primary text-sm flex items-center gap-2 disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {zh ? '儲存規則' : 'Save rules'}
            </button>
            {message && <span className={`text-sm ${message.ok ? 'text-green-700' : 'text-red-600'}`}>{message.text}</span>}
            {!message && problems.length > 0 && <span className="text-sm text-red-600">{problems.join('；')}</span>}
          </div>
        </>
      )}
    </div>
  );
}
