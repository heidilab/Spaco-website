'use client';

// Voucher campaigns (活動現金券) — cash codes for marketing campaigns.
//
// Two shapes, chosen in the generator (lib/promoCodes):
//   · 多個 code，每個用一次 — giveaways where each code is redeemable ONCE
//     (leak-proof: a code forwarded around a group chat dies after the
//     first use), with a per-code note recording who it was sent to.
//   · 一個 code，可用多次 — ONE code everybody types, good N times in total
//     and dead after the Nth use (Heidi 2026-11-13, VERTEXFC sponsorship).
// Both carry a validity window and a min spend (consumption subtotal,
// which excludes the security deposit).
//
// Data model: plain promo_codes docs (type 'cash', totalUsageLimit 1 or
// N) tagged with `campaign` — the entire existing validation / redemption
// / usage-increment pipeline applies untouched. This component only
// groups, generates, and annotates.

import PromoRestrictionsFields, { restrictionErrorText } from './PromoRestrictionsFields';
import { EMPTY_PROMO_RESTRICTIONS, promoRestrictionError, type PromoRestrictions } from '@/lib/promoEligibility';
import { useMemo, useState } from 'react';
import {
  createVoucherCampaign, updatePromoCode, deletePromoCode,
  convertCampaignToSharedCode, sharedCodeError, normalizeSharedCode, promoUsesLeft, campaignUsage,
  type VoucherCampaignParams, type VoucherCampaignMode, type SharedCodeError,
} from '@/lib/promoCodes';
import type { PromoCode } from '@/types';
import {
  TicketPercent, Plus, X, Loader2, Copy, Check, Trash2, ChevronDown, ChevronRight, Repeat,
} from 'lucide-react';

const todayStr = () => new Date().toISOString().slice(0, 10);

type CodeStatus = 'used' | 'disabled' | 'expired' | 'unused';

function codeStatus(c: PromoCode): CodeStatus {
  if ((c.totalUsageCount || 0) >= (c.totalUsageLimit ?? 1)) return 'used';
  if (!c.enabled) return 'disabled';
  if (c.endDate && todayStr() > c.endDate) return 'expired';
  return 'unused';
}

const STATUS_META: Record<CodeStatus, { zh: string; en: string; cls: string }> = {
  unused:   { zh: '未用', en: 'Unused',   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  used:     { zh: '已用', en: 'Used',     cls: 'bg-stone-100 text-stone-500 border-stone-200' },
  disabled: { zh: '已停用', en: 'Disabled', cls: 'bg-rose-50 text-rose-600 border-rose-200' },
  expired:  { zh: '已過期', en: 'Expired',  cls: 'bg-amber-50 text-amber-700 border-amber-200' },
};

/** A code good more than once (the 一個 code，可用多次 shape). */
const isShared = (c: PromoCode) => (c.totalUsageLimit ?? 1) > 1;

function sharedCodeErrorText(e: SharedCodeError, locale: 'zh' | 'en'): string {
  if (e === 'empty') return locale === 'zh' ? '請輸入優惠碼' : 'Enter the code';
  if (e === 'taken') return locale === 'zh' ? '呢個優惠碼已經有人用緊（同現有 code 撞名），請改另一個' : 'A code with this text already exists';
  return locale === 'zh' ? '優惠碼只可以用英文字母、數字、- 同 _，3 至 30 個字' : 'Use letters, digits, - and _ only (3–30 characters)';
}

/** '' → no per-account limit; a number ≥ 1 otherwise. */
const parsePerUser = (s: string): number | null => {
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n >= 1 ? n : null;
};

interface GenFormState extends PromoRestrictions {
  mode: VoucherCampaignMode;
  campaign: string;
  prefix: string;
  /** shared mode: the code customers type. */
  sharedCode: string;
  /** shared mode: total uses. */
  totalUses: string;
  /** shared mode: uses per account ('' = no limit). */
  perUserLimit: string;
  quantity: string;
  amount: string;
  minSubtotal: string;
  startDate: string;
  endDate: string;
}

const EMPTY_GEN: GenFormState = {
  ...EMPTY_PROMO_RESTRICTIONS,
  mode: 'single_use', sharedCode: '', totalUses: '50', perUserLimit: '',
  campaign: '', prefix: 'SPACO', quantity: '10',
  amount: '500', minSubtotal: '3800', startDate: '', endDate: '',
};

export default function VoucherCampaigns({
  codes, locale, onChanged,
}: {
  /** ALL promo codes — this component picks out the ones with `campaign`. */
  codes: PromoCode[];
  locale: 'zh' | 'en';
  onChanged: () => void;
}) {
  const [genOpen, setGenOpen] = useState(false);
  const [gen, setGen] = useState<GenFormState>(EMPTY_GEN);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openCampaigns, setOpenCampaigns] = useState<Record<string, boolean>>({});
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [savingNote, setSavingNote] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  /** 「改為一個共用 code」 form, open for one campaign at a time. */
  const [convert, setConvert] = useState<{ campaign: string; code: string; perUserLimit: string } | null>(null);
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  const campaigns = useMemo(() => {
    const map = new Map<string, PromoCode[]>();
    for (const c of codes) {
      if (!c.campaign) continue;
      const list = map.get(c.campaign) || [];
      list.push(c);
      map.set(c.campaign, list);
    }
    // Newest campaigns first (by max createdAt-ish: fall back to code order).
    return Array.from(map.entries());
  }, [codes]);

  async function handleGenerate() {
    setError(null);
    const shared = gen.mode === 'shared';
    const quantity = parseInt(shared ? gen.totalUses : gen.quantity, 10);
    const amount = parseFloat(gen.amount);
    if (!gen.campaign.trim()) { setError(locale === 'zh' ? '請輸入 Campaign 名稱' : 'Campaign name required'); return; }
    if (shared) {
      const codeError = sharedCodeError(gen.sharedCode, codes);
      if (codeError) { setError(sharedCodeErrorText(codeError, locale)); return; }
      if (!Number.isFinite(quantity) || quantity < 1 || quantity > 10000) { setError(locale === 'zh' ? '總共可用次數 1–10000' : 'Total uses 1–10000'); return; }
      if (gen.perUserLimit.trim() !== '' && parsePerUser(gen.perUserLimit) == null) { setError(locale === 'zh' ? '每個帳戶可用次數請輸入 1 或以上，或者留空' : 'Per-account uses: 1 or more, or leave blank'); return; }
    } else {
      if (!gen.prefix.trim()) { setError(locale === 'zh' ? '請輸入 code 字頭' : 'Prefix required'); return; }
      if (!Number.isFinite(quantity) || quantity < 1 || quantity > 200) { setError(locale === 'zh' ? '數量 1–200' : 'Quantity 1–200'); return; }
    }
    if (!Number.isFinite(amount) || amount <= 0) { setError(locale === 'zh' ? '請輸入面值' : 'Amount required'); return; }
    const restrictionError = promoRestrictionError(gen);
    if (restrictionError) { setError(restrictionErrorText(restrictionError,locale)); return; }
    setGenerating(true);
    try {
      const params: VoucherCampaignParams = {
        mode: gen.mode,
        campaign: gen.campaign.trim(),
        prefix: gen.prefix.trim(),
        quantity,
        ...(shared ? { sharedCode: normalizeSharedCode(gen.sharedCode), perUserLimit: parsePerUser(gen.perUserLimit) } : {}),
        amount,
        minSubtotal: parseFloat(gen.minSubtotal) || 0,
        startDate: gen.startDate || null,
        endDate: gen.endDate || null,
        venueIds: gen.venueIds || [], excludedDateRanges: gen.excludedDateRanges || [],
        packageScope: gen.packageScope || 'all', packageSlugs: gen.packageSlugs || [],
        appliesToStandardBookings: gen.appliesToStandardBookings !== false,
      };
      await createVoucherCampaign(params);
      setGenOpen(false);
      setGen(EMPTY_GEN);
      setOpenCampaigns((p) => ({ ...p, [params.campaign]: true }));
      onChanged();
    } catch (err) {
      setError((locale === 'zh' ? '生成失敗：' : 'Generate failed: ') + (err instanceof Error ? err.message : 'unknown'));
    } finally {
      setGenerating(false);
    }
  }

  async function saveNote(c: PromoCode) {
    const draft = noteDrafts[c.id];
    if (draft === undefined || draft === (c.note || '')) return;
    setSavingNote(c.id);
    try {
      await updatePromoCode(c.id, { note: draft });
      onChanged();
    } finally {
      setSavingNote(null);
    }
  }

  async function handleConvert(list: PromoCode[]) {
    if (!convert) return;
    setConvertError(null);
    const codeError = sharedCodeError(convert.code, codes);
    if (codeError) { setConvertError(sharedCodeErrorText(codeError, locale)); return; }
    if (convert.perUserLimit.trim() !== '' && parsePerUser(convert.perUserLimit) == null) {
      setConvertError(locale === 'zh' ? '每個帳戶可用次數請輸入 1 或以上，或者留空' : 'Per-account uses: 1 or more, or leave blank');
      return;
    }
    const open = list.filter((c) => promoUsesLeft(c) > 0);
    const uses = open.reduce((sum, c) => sum + promoUsesLeft(c), 0);
    const code = normalizeSharedCode(convert.code);
    if (!window.confirm(locale === 'zh'
      ? `將呢個 campaign 餘下 ${open.length} 個未用嘅 code 刪除，換成一個共用 code「${code}」，總共可用 ${uses} 次。\n\n舊嗰 ${open.length} 個 code 之後會用唔到 — 如果已經派咗俾人，請唔好轉。確定？`
      : `Delete the ${open.length} unused codes of this campaign and replace them with ONE code "${code}", good ${uses} times in total.\n\nThe old codes stop working. Continue?`)) return;
    setConverting(true);
    try {
      await convertCampaignToSharedCode(list, code, parsePerUser(convert.perUserLimit));
      setConvert(null);
      onChanged();
    } catch (err) {
      setConvertError((locale === 'zh' ? '轉換失敗：' : 'Convert failed: ') + (err instanceof Error ? err.message : 'unknown'));
      onChanged();
    } finally {
      setConverting(false);
    }
  }

  /** Delete every code of a campaign. Bookings that redeemed one keep
   *  their discount and the code text; only the admin record goes. */
  async function deleteCampaign(name: string, list: PromoCode[]) {
    const used = list.reduce((s, c) => s + (c.totalUsageCount || 0), 0);
    const msg = locale === 'zh'
      ? `刪除整個 campaign「${name}」？\n\n會刪除佢嘅 ${list.length} 個 code${used > 0 ? `（已經用咗 ${used} 次 — 用咗嘅訂單唔受影響，但呢度嘅記錄會冇咗）` : ''}，刪除後呢啲 code 即時用唔到。`
      : `Delete the whole campaign "${name}"?\n\nIts ${list.length} code(s) are removed${used > 0 ? ` (${used} redemption(s) so far — those bookings keep their discount; only this record goes)` : ''} and stop working at once.`;
    if (!window.confirm(msg)) return;
    setDeletingCampaign(name);
    try {
      for (const c of list) await deletePromoCode(c.id);
      onChanged();
    } finally {
      setDeletingCampaign(null);
    }
  }
  const [deletingCampaign, setDeletingCampaign] = useState<string | null>(null);

  async function toggleEnabled(c: PromoCode) {
    setToggling(c.id);
    try {
      await updatePromoCode(c.id, { enabled: !c.enabled });
      onChanged();
    } finally {
      setToggling(null);
    }
  }

  async function copyUnused(name: string, list: PromoCode[]) {
    const unused = list.filter((c) => codeStatus(c) === 'unused').map((c) => c.code);
    await navigator.clipboard.writeText(unused.join('\n'));
    setCopied(name);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="glass-card p-6 mb-6">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <div>
          <h2 className="font-bold text-lg flex items-center gap-2">
            <TicketPercent size={18} className="text-pink" />
            {locale === 'zh' ? '活動現金券' : 'Voucher campaigns'}
          </h2>
          <p className="text-xs text-ink-soft mt-1 max-w-xl">
            {locale === 'zh'
              ? '兩種做法：①「一個 code，可用多次」— 所有人用同一個 code，用夠總次數就失效；②「多個 code，每個用一次」— 每個 code 只可用一次（防流出重用）。最低消費以消費小計計算，不包括按金。'
              : 'Two kinds: (1) one code good N times in total, shared by everyone; (2) a batch of codes each good once. Min spend applies to the consumption subtotal (deposit excluded).'}
          </p>
        </div>
        <button
          onClick={() => { setGenOpen(!genOpen); setError(null); }}
          className="btn-primary flex items-center gap-2 text-sm"
        >
          {genOpen ? <X size={14} /> : <Plus size={14} />}
          {locale === 'zh' ? '生成現金券' : 'Generate vouchers'}
        </button>
      </div>

      {/* Generator form */}
      {genOpen && (
        <div className="mt-4 rounded-2xl border border-pink/30 bg-pink/5 p-4">
          {/* How the codes work — the choice the generator did not offer
              before (it always made N different single-use codes). */}
          <p className="text-xs font-semibold text-ink-soft mb-1.5">{locale === 'zh' ? '優惠碼點樣用？' : 'How are the codes used?'}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-4">
            {([
              ['shared',
                locale === 'zh' ? '一個 code，可用多次' : 'One code, many uses',
                locale === 'zh' ? '所有人輸入同一個 code；唔同客人都用得，用夠總次數就失效。' : 'Everybody types the same code; it stops working after the total number of uses.'],
              ['single_use',
                locale === 'zh' ? '多個 code，每個用一次' : 'Many codes, one use each',
                locale === 'zh' ? '系統生成一批唔同嘅 code，每個只可用一次，逐個派俾客人。' : 'A batch of different codes, each good once, handed out one by one.'],
            ] as Array<[VoucherCampaignMode, string, string]>).map(([mode, title, hint]) => {
              const on = gen.mode === mode;
              return (
                <button key={mode} type="button" onClick={() => { setGen({ ...gen, mode }); setError(null); }}
                  aria-pressed={on}
                  className={`text-left rounded-xl border-2 px-3 py-2.5 transition-colors ${on ? 'border-pink bg-white' : 'border-charcoal/15 bg-white/60 hover:bg-white'}`}>
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${on ? 'border-pink' : 'border-charcoal/30'}`}>
                      {on && <span className="w-2 h-2 rounded-full bg-pink" />}
                    </span>
                    {title}
                  </span>
                  <span className="block text-xs text-ink-soft mt-1 ml-6">{hint}</span>
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <label className="block col-span-2">
              <span className="text-xs font-semibold text-ink-soft">{locale === 'zh' ? 'Campaign 名稱' : 'Campaign name'}</span>
              <input value={gen.campaign} onChange={(e) => setGen({ ...gen, campaign: e.target.value })}
                placeholder={locale === 'zh' ? '例：8月IG抽獎 $500券' : 'e.g. Aug IG giveaway $500'}
                className="mt-1 w-full px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white" />
            </label>
            {gen.mode === 'shared' ? (
              <>
                <label className="block">
                  <span className="text-xs font-semibold text-ink-soft">{locale === 'zh' ? '優惠碼（客人輸入嘅字）' : 'Code (what customers type)'}</span>
                  <input value={gen.sharedCode} onChange={(e) => setGen({ ...gen, sharedCode: e.target.value.toUpperCase() })}
                    placeholder="VERTEXFC"
                    className="mt-1 w-full px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white font-mono uppercase" />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-ink-soft">{locale === 'zh' ? '總共可用次數' : 'Total uses'}</span>
                  <input type="number" min={1} max={10000} value={gen.totalUses} onChange={(e) => setGen({ ...gen, totalUses: e.target.value })}
                    className="mt-1 w-full px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white" />
                </label>
                <label className="block col-span-2">
                  <span className="text-xs font-semibold text-ink-soft">{locale === 'zh' ? '每個帳戶最多用幾次（留空 = 不限，只計總次數）' : 'Uses per account (blank = no limit)'}</span>
                  <input type="number" min={1} value={gen.perUserLimit} onChange={(e) => setGen({ ...gen, perUserLimit: e.target.value })}
                    placeholder={locale === 'zh' ? '不限' : 'No limit'}
                    className="mt-1 w-full px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white" />
                </label>
              </>
            ) : (
              <>
                <label className="block">
                  <span className="text-xs font-semibold text-ink-soft">{locale === 'zh' ? 'Code 字頭' : 'Prefix'}</span>
                  <input value={gen.prefix} onChange={(e) => setGen({ ...gen, prefix: e.target.value.toUpperCase() })}
                    className="mt-1 w-full px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white font-mono uppercase" />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-ink-soft">{locale === 'zh' ? '數量（1–200）' : 'Quantity (1–200)'}</span>
                  <input type="number" min={1} max={200} value={gen.quantity} onChange={(e) => setGen({ ...gen, quantity: e.target.value })}
                    className="mt-1 w-full px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white" />
                </label>
              </>
            )}
            <label className="block">
              <span className="text-xs font-semibold text-ink-soft">{locale === 'zh' ? '面值 HK$' : 'Value HK$'}</span>
              <input type="number" min={1} value={gen.amount} onChange={(e) => setGen({ ...gen, amount: e.target.value })}
                className="mt-1 w-full px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-ink-soft">{locale === 'zh' ? '最低消費 HK$（不含按金）' : 'Min spend HK$ (excl. deposit)'}</span>
              <input type="number" min={0} value={gen.minSubtotal} onChange={(e) => setGen({ ...gen, minSubtotal: e.target.value })}
                className="mt-1 w-full px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-ink-soft">{locale === 'zh' ? '生效日期' : 'Start date'}</span>
              <input type="date" value={gen.startDate} onChange={(e) => setGen({ ...gen, startDate: e.target.value })}
                className="mt-1 w-full px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-ink-soft">{locale === 'zh' ? '到期日期' : 'End date'}</span>
              <input type="date" value={gen.endDate} onChange={(e) => setGen({ ...gen, endDate: e.target.value })}
                className="mt-1 w-full px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white" />
            </label>
          </div>
          <PromoRestrictionsFields value={gen} locale={locale} onChange={patch => setGen(prev => ({...prev,...patch}))} />
          {error && <p className="text-xs text-rose-600 mt-2">{error}</p>}
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="mt-3 btn-primary flex items-center gap-2 text-sm disabled:opacity-50"
          >
            {generating ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {generating
              ? (locale === 'zh' ? '生成中…' : 'Generating…')
              : gen.mode === 'shared'
                ? (locale === 'zh' ? `確認建立 1 個 code（可用 ${gen.totalUses || '?'} 次）` : `Create 1 code (${gen.totalUses || '?'} uses)`)
                : (locale === 'zh' ? `確認生成 ${gen.quantity} 張` : `Generate ${gen.quantity} codes`)}
          </button>
        </div>
      )}

      {/* Campaign groups */}
      {campaigns.length === 0 && !genOpen && (
        <p className="text-sm text-ink-soft mt-4">{locale === 'zh' ? '未有活動現金券。' : 'No voucher campaigns yet.'}</p>
      )}
      <div className="mt-4 space-y-3">
        {campaigns.map(([name, list]) => {
          const open = !!openCampaigns[name];
          const usage = campaignUsage(list);
          const sample = list[0];
          // Unused single-use codes that could be folded into one shared code.
          const convertible = list.filter((c) => !isShared(c) && promoUsesLeft(c) > 0);
          return (
            <div key={name} className="rounded-2xl border border-charcoal/10 bg-white/60 overflow-hidden">
              <button
                onClick={() => setOpenCampaigns((p) => ({ ...p, [name]: !open }))}
                className="w-full px-4 py-3 flex items-center justify-between gap-3 hover:bg-white/70"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {open ? <ChevronDown size={15} className="shrink-0" /> : <ChevronRight size={15} className="shrink-0" />}
                  <span className="font-semibold text-sm truncate">{name}</span>
                  <span className="text-xs text-ink-soft whitespace-nowrap">
                    HK${(sample.amount || 0).toLocaleString()}
                    {sample.minSubtotal ? ` · ${locale === 'zh' ? '滿' : 'min'} $${sample.minSubtotal.toLocaleString()}` : ''}
                    {sample.endDate ? ` · ${locale === 'zh' ? '至' : 'until'} ${sample.endDate}` : ''}
                  </span>
                </div>
                <span className="text-xs text-ink-soft whitespace-nowrap">
                  {locale === 'zh' ? `已用 ${usage.used}/${usage.total}` : `${usage.used}/${usage.total} used`}
                </span>
              </button>

              {open && (
                <div className="px-4 pb-4">
                  <div className="flex justify-end gap-2 flex-wrap mb-2">
                    {convertible.length > 1 && convert?.campaign !== name && (
                      <button
                        onClick={() => { setConvert({ campaign: name, code: '', perUserLimit: '' }); setConvertError(null); }}
                        className="text-xs flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-pink/40 bg-white hover:bg-pink/5 text-pink font-semibold"
                      >
                        <Repeat size={12} />
                        {locale === 'zh' ? `改為一個共用 code（可用 ${convertible.length} 次）` : `Make it one code (${convertible.length} uses)`}
                      </button>
                    )}
                    <button
                      onClick={() => deleteCampaign(name, list)}
                      disabled={deletingCampaign === name}
                      className="text-xs flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 bg-white hover:bg-rose-50 text-rose-600 disabled:opacity-50"
                    >
                      {deletingCampaign === name ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      {locale === 'zh' ? '刪除整個 campaign' : 'Delete campaign'}
                    </button>
                    <button
                      onClick={() => copyUnused(name, list)}
                      className="text-xs flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-charcoal/15 bg-white hover:bg-cream"
                    >
                      {copied === name ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                      {list.length === 1
                        ? (locale === 'zh' ? '複製 code' : 'Copy code')
                        : (locale === 'zh' ? '複製所有未用 code' : 'Copy unused codes')}
                    </button>
                  </div>
                  {convert?.campaign === name && (
                    <div className="mb-3 rounded-xl border border-pink/30 bg-pink/5 p-3">
                      <p className="text-xs text-ink-soft mb-2">
                        {locale === 'zh'
                          ? `將餘下 ${convertible.length} 個未用嘅 code 換成一個共用 code：所有人輸入同一個 code，總共可用 ${convertible.length} 次，面值、最低消費、日期同限制照舊。舊嗰 ${convertible.length} 個 code 會刪除。`
                          : `Replace the ${convertible.length} unused codes with ONE code good ${convertible.length} times in total; value, min spend, dates and restrictions stay. The old codes are deleted.`}
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <label className="block">
                          <span className="text-xs font-semibold text-ink-soft">{locale === 'zh' ? '優惠碼（客人輸入嘅字）' : 'Code (what customers type)'}</span>
                          <input value={convert.code} onChange={(e) => setConvert({ ...convert, code: e.target.value.toUpperCase() })}
                            placeholder="VERTEXFC"
                            className="mt-1 w-full px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white font-mono uppercase" />
                        </label>
                        <label className="block">
                          <span className="text-xs font-semibold text-ink-soft">{locale === 'zh' ? '每個帳戶最多用幾次（留空 = 不限）' : 'Uses per account (blank = no limit)'}</span>
                          <input type="number" min={1} value={convert.perUserLimit} onChange={(e) => setConvert({ ...convert, perUserLimit: e.target.value })}
                            placeholder={locale === 'zh' ? '不限' : 'No limit'}
                            className="mt-1 w-full px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white" />
                        </label>
                      </div>
                      {convertError && <p className="text-xs text-rose-600 mt-2">{convertError}</p>}
                      <div className="flex gap-2 mt-3">
                        <button onClick={() => handleConvert(list)} disabled={converting}
                          className="btn-primary flex items-center gap-2 text-xs disabled:opacity-50">
                          {converting ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                          {locale === 'zh' ? '確認轉換' : 'Convert'}
                        </button>
                        <button onClick={() => setConvert(null)} disabled={converting}
                          className="text-xs px-3 py-1.5 rounded-lg border border-charcoal/15 bg-white hover:bg-cream">
                          {locale === 'zh' ? '取消' : 'Cancel'}
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="space-y-1.5">
                    {list.map((c) => {
                      const st = codeStatus(c);
                      const meta = STATUS_META[st];
                      const shared = isShared(c);
                      // A shared code that has been redeemed is the record of
                      // those bookings: stop it, do not delete it.
                      const deletable = shared ? (c.totalUsageCount || 0) === 0 : st !== 'used';
                      return (
                        <div key={c.id} className="flex items-center gap-2 text-sm">
                          <span className={`font-mono text-xs px-2 py-1 rounded-lg bg-white border border-charcoal/10 whitespace-nowrap ${st === 'used' ? 'line-through text-stone-400' : ''}`}>
                            {c.code}
                          </span>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-pill border whitespace-nowrap ${meta.cls}`}>
                            {shared && st === 'unused'
                              ? (locale === 'zh' ? `可用 · 已用 ${c.totalUsageCount || 0}/${c.totalUsageLimit}` : `Live · ${c.totalUsageCount || 0}/${c.totalUsageLimit} used`)
                              : shared && st === 'used'
                                ? (locale === 'zh' ? `已用完 ${c.totalUsageLimit}/${c.totalUsageLimit}` : `Used up ${c.totalUsageLimit}/${c.totalUsageLimit}`)
                                : shared
                                  ? `${meta[locale]} · ${c.totalUsageCount || 0}/${c.totalUsageLimit}`
                                  : meta[locale]}
                          </span>
                          {shared && (
                            <span className="text-[10px] text-ink-soft whitespace-nowrap">
                              {c.perUserLimit != null
                                ? (locale === 'zh' ? `每帳戶 ${c.perUserLimit} 次` : `${c.perUserLimit}/account`)
                                : (locale === 'zh' ? '每帳戶不限' : 'no per-account limit')}
                            </span>
                          )}
                          <input
                            value={noteDrafts[c.id] ?? c.note ?? ''}
                            onChange={(e) => setNoteDrafts((p) => ({ ...p, [c.id]: e.target.value }))}
                            onBlur={() => saveNote(c)}
                            placeholder={shared
                              ? (locale === 'zh' ? '備注（例：派咗俾邊個單位）' : 'Note')
                              : (locale === 'zh' ? '備注：send 咗俾邊個？' : 'Note: sent to whom?')}
                            className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-charcoal/10 text-xs bg-white/80 focus:bg-white"
                          />
                          {savingNote === c.id && <Loader2 size={12} className="animate-spin text-ink-soft shrink-0" />}
                          {shared && st !== 'used' && (
                            <button
                              onClick={() => toggleEnabled(c)}
                              disabled={toggling === c.id}
                              className="text-[11px] px-2 py-1 rounded-lg border border-charcoal/15 bg-white hover:bg-cream whitespace-nowrap shrink-0 disabled:opacity-50"
                            >
                              {c.enabled ? (locale === 'zh' ? '停用' : 'Stop') : (locale === 'zh' ? '重新啟用' : 'Resume')}
                            </button>
                          )}
                          {deletable && (
                            <button
                              onClick={async () => {
                                if (!window.confirm(locale === 'zh' ? `刪除 ${c.code}？` : `Delete ${c.code}?`)) return;
                                await deletePromoCode(c.id);
                                onChanged();
                              }}
                              className="w-7 h-7 rounded-lg hover:bg-rose-50 text-rose-400 hover:text-rose-600 flex items-center justify-center shrink-0"
                              title={locale === 'zh' ? '刪除' : 'Delete'}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
