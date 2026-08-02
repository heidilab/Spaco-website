'use client';

// Voucher campaigns (活動現金券) — batch-generated single-use cash codes.
//
// Heidi's spec: marketing giveaways where each code is redeemable ONCE
// (leak-proof: a code forwarded around a group chat dies after the first
// use), with a validity window, min-spend (consumption subtotal, which
// excludes the security deposit), and a per-code free-text note recording
// which customer the code was sent to.
//
// Data model: plain promo_codes docs (type 'cash', totalUsageLimit 1)
// tagged with `campaign` — the entire existing validation / redemption /
// usage-increment pipeline applies untouched. This component only groups,
// generates, and annotates.

import { useMemo, useState } from 'react';
import {
  createVoucherCampaign, updatePromoCode, deletePromoCode,
  type VoucherCampaignParams,
} from '@/lib/promoCodes';
import type { PromoCode } from '@/types';
import {
  TicketPercent, Plus, X, Loader2, Copy, Check, Trash2, ChevronDown, ChevronRight,
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

interface GenFormState {
  campaign: string;
  prefix: string;
  quantity: string;
  amount: string;
  minSubtotal: string;
  startDate: string;
  endDate: string;
}

const EMPTY_GEN: GenFormState = {
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
    const quantity = parseInt(gen.quantity, 10);
    const amount = parseFloat(gen.amount);
    if (!gen.campaign.trim()) { setError(locale === 'zh' ? '請輸入 Campaign 名稱' : 'Campaign name required'); return; }
    if (!gen.prefix.trim()) { setError(locale === 'zh' ? '請輸入 code 字頭' : 'Prefix required'); return; }
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > 200) { setError(locale === 'zh' ? '數量 1–200' : 'Quantity 1–200'); return; }
    if (!Number.isFinite(amount) || amount <= 0) { setError(locale === 'zh' ? '請輸入面值' : 'Amount required'); return; }
    setGenerating(true);
    try {
      const params: VoucherCampaignParams = {
        campaign: gen.campaign.trim(),
        prefix: gen.prefix.trim(),
        quantity,
        amount,
        minSubtotal: parseFloat(gen.minSubtotal) || 0,
        startDate: gen.startDate || null,
        endDate: gen.endDate || null,
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
            {locale === 'zh' ? '活動現金券（單次使用）' : 'Voucher campaigns (single-use)'}
          </h2>
          <p className="text-xs text-ink-soft mt-1 max-w-xl">
            {locale === 'zh'
              ? '批量生成一次性現金券：每個 code 只可用一次，用完即死（防流出重用）。最低消費以消費小計計算，不包括按金。'
              : 'Batch-generate single-use cash vouchers. Each code dies after one redemption. Min spend applies to the consumption subtotal (deposit excluded).'}
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <label className="block col-span-2">
              <span className="text-xs font-semibold text-ink-soft">{locale === 'zh' ? 'Campaign 名稱' : 'Campaign name'}</span>
              <input value={gen.campaign} onChange={(e) => setGen({ ...gen, campaign: e.target.value })}
                placeholder={locale === 'zh' ? '例：8月IG抽獎 $500券' : 'e.g. Aug IG giveaway $500'}
                className="mt-1 w-full px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white" />
            </label>
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
          {error && <p className="text-xs text-rose-600 mt-2">{error}</p>}
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="mt-3 btn-primary flex items-center gap-2 text-sm disabled:opacity-50"
          >
            {generating ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {generating
              ? (locale === 'zh' ? '生成中…' : 'Generating…')
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
          const usedCount = list.filter((c) => codeStatus(c) === 'used').length;
          const sample = list[0];
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
                  {locale === 'zh' ? `已用 ${usedCount}/${list.length}` : `${usedCount}/${list.length} used`}
                </span>
              </button>

              {open && (
                <div className="px-4 pb-4">
                  <div className="flex justify-end mb-2">
                    <button
                      onClick={() => copyUnused(name, list)}
                      className="text-xs flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-charcoal/15 bg-white hover:bg-cream"
                    >
                      {copied === name ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                      {locale === 'zh' ? '複製所有未用 code' : 'Copy unused codes'}
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    {list.map((c) => {
                      const st = codeStatus(c);
                      const meta = STATUS_META[st];
                      return (
                        <div key={c.id} className="flex items-center gap-2 text-sm">
                          <span className={`font-mono text-xs px-2 py-1 rounded-lg bg-white border border-charcoal/10 whitespace-nowrap ${st === 'used' ? 'line-through text-stone-400' : ''}`}>
                            {c.code}
                          </span>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-pill border whitespace-nowrap ${meta.cls}`}>
                            {meta[locale]}
                          </span>
                          <input
                            value={noteDrafts[c.id] ?? c.note ?? ''}
                            onChange={(e) => setNoteDrafts((p) => ({ ...p, [c.id]: e.target.value }))}
                            onBlur={() => saveNote(c)}
                            placeholder={locale === 'zh' ? '備注：send 咗俾邊個？' : 'Note: sent to whom?'}
                            className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-charcoal/10 text-xs bg-white/80 focus:bg-white"
                          />
                          {savingNote === c.id && <Loader2 size={12} className="animate-spin text-ink-soft shrink-0" />}
                          {st !== 'used' && (
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
