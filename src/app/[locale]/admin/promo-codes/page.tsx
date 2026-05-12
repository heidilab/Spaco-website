'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import {
  listPromoCodes, createPromoCode, updatePromoCode, deletePromoCode,
} from '@/lib/promoCodes';
import type { PromoCode, PromoCodeType } from '@/types';
import { venues } from '@/lib/venues';
import {
  Tag, Plus, Edit2, Trash2, X, Check, Loader2, Calendar, Users as UsersIcon, AlertCircle, Building2,
} from 'lucide-react';

interface FormState {
  code: string;
  type: PromoCodeType;
  percent: string;
  amount: string;
  minSubtotal: string;
  startDate: string;
  endDate: string;
  totalUsageLimit: string;
  perUserLimit: string;
  enabled: boolean;
  description: string;
  venueIds: string[];
  freeDrinks: boolean;
}

const EMPTY_FORM: FormState = {
  code: '',
  type: 'percent',
  percent: '',
  amount: '',
  minSubtotal: '',
  startDate: '',
  endDate: '',
  totalUsageLimit: '',
  perUserLimit: '1',
  enabled: true,
  description: '',
  venueIds: [],
  freeDrinks: false,
};

const TYPE_LABELS: Record<PromoCodeType, { zh: string; en: string; hint: { zh: string; en: string } }> = {
  percent:      { zh: '折扣 %',     en: 'Percent off', hint: { zh: '例：12 = 88 折', en: 'e.g. 12 = 12% off' } },
  cash:         { zh: '現金券 $',   en: 'Cash off',    hint: { zh: '固定金額減免', en: 'Fixed HK$ off' } },
  free_drinks:  { zh: '免費飲品',   en: 'Free drinks', hint: { zh: '飲品 add-on 變免費', en: 'Drinks add-on becomes free' } },
  per_pax:      { zh: '每位減 $',   en: 'Per-pax',     hint: { zh: '每個成人 equiv 減', en: 'Per adult-equivalent' } },
};

export default function PromoCodesPage() {
  const locale = useLocale() as 'zh' | 'en';
  const { hasPermission } = useAuth();
  const canAccess = hasPermission('gcal');

  const [codes, setCodes] = useState<PromoCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null); // null = none, "new" = creating
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await listPromoCodes();
      setCodes(data);
    } catch (err) {
      setFlash({ kind: 'err', text: (locale === 'zh' ? '載入失敗：' : 'Load failed: ') + (err instanceof Error ? err.message : 'unknown') });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (canAccess) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccess]);

  function startCreate() {
    setForm(EMPTY_FORM);
    setEditingId('new');
  }
  function startEdit(c: PromoCode) {
    setForm({
      code: c.code,
      type: c.type,
      percent: c.percent != null ? String(c.percent) : '',
      amount: c.amount != null ? String(c.amount) : '',
      minSubtotal: c.minSubtotal != null ? String(c.minSubtotal) : '',
      startDate: c.startDate || '',
      endDate: c.endDate || '',
      totalUsageLimit: c.totalUsageLimit != null ? String(c.totalUsageLimit) : '',
      perUserLimit: c.perUserLimit != null ? String(c.perUserLimit) : '',
      enabled: c.enabled,
      description: c.description || '',
      venueIds: c.venueIds || [],
      freeDrinks: !!c.freeDrinks,
    });
    setEditingId(c.id);
  }
  function cancelEdit() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  async function handleSave() {
    if (!form.code.trim()) {
      setFlash({ kind: 'err', text: locale === 'zh' ? '請輸入優惠碼' : 'Code required' });
      return;
    }
    if (form.type === 'percent' && !form.percent) {
      setFlash({ kind: 'err', text: locale === 'zh' ? '請輸入折扣 %' : 'Percent required' });
      return;
    }
    if ((form.type === 'cash' || form.type === 'per_pax') && !form.amount) {
      setFlash({ kind: 'err', text: locale === 'zh' ? '請輸入金額' : 'Amount required' });
      return;
    }
    setSaving(true);
    try {
      // Firestore's client SDK refuses explicit `undefined` field values,
      // so we build the payload by spreading the always-present fields
      // and conditionally adding the optional ones.
      const num = (s: string) => s.trim() === '' ? null : Number(s);
      const minSubtotalVal = form.type === 'cash' ? num(form.minSubtotal) : null;
      const data: Record<string, unknown> = {
        code: form.code,
        type: form.type,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        totalUsageLimit: num(form.totalUsageLimit),
        perUserLimit: num(form.perUserLimit),
        enabled: form.enabled,
        freeDrinks: form.freeDrinks,
        venueIds: form.venueIds,
      };
      if (form.type === 'percent') data.percent = Number(form.percent);
      if (form.type === 'cash' || form.type === 'per_pax') data.amount = Number(form.amount);
      if (minSubtotalVal != null) data.minSubtotal = minSubtotalVal;
      const desc = form.description.trim();
      if (desc) data.description = desc;

      if (editingId === 'new') {
        await createPromoCode(data as Parameters<typeof createPromoCode>[0]);
      } else if (editingId) {
        await updatePromoCode(editingId, data as Parameters<typeof updatePromoCode>[1]);
      }
      setFlash({ kind: 'ok', text: locale === 'zh' ? '✅ 已儲存' : '✅ Saved' });
      setTimeout(() => setFlash(null), 2000);
      cancelEdit();
      await load();
    } catch (err) {
      setFlash({ kind: 'err', text: (locale === 'zh' ? '儲存失敗：' : 'Save failed: ') + (err instanceof Error ? err.message : 'unknown') });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string, code: string) {
    if (!confirm(locale === 'zh' ? `刪除優惠碼「${code}」？此動作不可復原。` : `Delete code "${code}"? This cannot be undone.`)) return;
    try {
      await deletePromoCode(id);
      setFlash({ kind: 'ok', text: locale === 'zh' ? '🗑️ 已刪除' : '🗑️ Deleted' });
      setTimeout(() => setFlash(null), 2000);
      await load();
    } catch (err) {
      setFlash({ kind: 'err', text: (locale === 'zh' ? '刪除失敗：' : 'Delete failed: ') + (err instanceof Error ? err.message : 'unknown') });
    }
  }

  async function handleToggleEnabled(c: PromoCode) {
    try {
      await updatePromoCode(c.id, { enabled: !c.enabled });
      await load();
    } catch (err) {
      setFlash({ kind: 'err', text: (locale === 'zh' ? '更新失敗：' : 'Update failed: ') + (err instanceof Error ? err.message : 'unknown') });
    }
  }

  if (!canAccess) {
    return <div className="text-center py-20 text-ink-soft">{locale === 'zh' ? '無權限存取' : 'Access Denied'}</div>;
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-pill bg-white/60 border border-charcoal/10 mb-4">
            <Tag size={14} className="text-pink" />
            <span className="text-xs font-medium text-ink-soft">Promo Codes</span>
          </div>
          <h1 className="text-heading">
            {locale === 'zh' ? '優惠碼' : 'Promo Codes'}
          </h1>
          <p className="mt-2 text-ink-soft text-sm max-w-2xl">
            {locale === 'zh'
              ? '建立 / 管理優惠碼。客人喺結帳時輸入個 code，系統會自動驗證有效期、用量限制、最低消費。'
              : 'Create and manage discount codes. Customers enter the code at checkout; the system validates window, usage limits, and minimum spend.'}
          </p>
        </div>
        <button onClick={startCreate} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> {locale === 'zh' ? '新增優惠碼' : 'New Code'}
        </button>
      </div>

      {flash && (
        <div className={`mb-4 px-4 py-3 rounded-xl text-sm ${
          flash.kind === 'ok' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
        }`}>
          {flash.text}
        </div>
      )}

      {/* Editor */}
      {editingId && (
        <div className="glass-card p-6 mb-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-lg">
              {editingId === 'new'
                ? (locale === 'zh' ? '新增優惠碼' : 'New Promo Code')
                : (locale === 'zh' ? '編輯優惠碼' : 'Edit Promo Code')}
            </h2>
            <button onClick={cancelEdit} className="w-8 h-8 rounded-full hover:bg-white/60 flex items-center justify-center">
              <X size={16} />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label={locale === 'zh' ? '優惠碼' : 'Code'}>
              <input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="WELCOME10"
                className="w-full px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white/85 font-mono uppercase"
              />
            </Field>
            <Field label={locale === 'zh' ? '類型' : 'Type'}>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as PromoCodeType })}
                className="w-full px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white/85"
              >
                {(['percent', 'cash', 'free_drinks', 'per_pax'] as PromoCodeType[]).map((t) => (
                  <option key={t} value={t}>{TYPE_LABELS[t][locale]}</option>
                ))}
              </select>
              <p className="text-[11px] text-ink-soft mt-1">{TYPE_LABELS[form.type].hint[locale]}</p>
            </Field>

            {form.type === 'percent' && (
              <Field label={locale === 'zh' ? '折扣 %' : 'Percent'}>
                <input
                  type="number" min={0} max={100}
                  value={form.percent}
                  onChange={(e) => setForm({ ...form, percent: e.target.value })}
                  placeholder="12"
                  className="w-full px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white/85"
                />
              </Field>
            )}

            {(form.type === 'cash' || form.type === 'per_pax') && (
              <Field label={locale === 'zh' ? `減 HK$ ${form.type === 'per_pax' ? '/位' : ''}` : `HK$ off${form.type === 'per_pax' ? '/pax' : ''}`}>
                <input
                  type="number" min={0}
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  placeholder="100"
                  className="w-full px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white/85"
                />
              </Field>
            )}

            {form.type === 'cash' && (
              <Field label={locale === 'zh' ? '最低消費（HK$，可選）' : 'Min subtotal (HK$, optional)'}>
                <input
                  type="number" min={0}
                  value={form.minSubtotal}
                  onChange={(e) => setForm({ ...form, minSubtotal: e.target.value })}
                  placeholder="2000"
                  className="w-full px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white/85"
                />
              </Field>
            )}

            <Field label={locale === 'zh' ? '起始日期（可選）' : 'Start date (optional)'}>
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white/85"
              />
            </Field>
            <Field label={locale === 'zh' ? '結束日期（可選）' : 'End date (optional)'}>
              <input
                type="date"
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white/85"
              />
            </Field>

            <Field label={locale === 'zh' ? '總用量限制（空 = 無限）' : 'Total uses (blank = unlimited)'}>
              <input
                type="number" min={0}
                value={form.totalUsageLimit}
                onChange={(e) => setForm({ ...form, totalUsageLimit: e.target.value })}
                placeholder="100"
                className="w-full px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white/85"
              />
            </Field>
            <Field label={locale === 'zh' ? '每帳戶限用次數（空 = 無限）' : 'Per-user uses (blank = unlimited)'}>
              <input
                type="number" min={0}
                value={form.perUserLimit}
                onChange={(e) => setForm({ ...form, perUserLimit: e.target.value })}
                placeholder="1"
                className="w-full px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white/85"
              />
            </Field>

            <Field label={locale === 'zh' ? '備註（內部）' : 'Description (internal)'} fullWidth>
              <input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder={locale === 'zh' ? '例：6月 promo email' : 'e.g. June promo email'}
                className="w-full px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white/85"
              />
            </Field>
          </div>

          {/* Per-branch scope. Empty selection = applies to all branches. */}
          <Field
            label={
              <span className="flex items-center gap-1.5">
                <Building2 size={13} />
                {locale === 'zh' ? '適用分店（唔揀 = 所有分店）' : 'Applies to branches (none = all)'}
              </span>
            }
            fullWidth
          >
            <div className="flex flex-wrap gap-2">
              {venues.map((v) => {
                const checked = form.venueIds.includes(v.id);
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() =>
                      setForm({
                        ...form,
                        venueIds: checked
                          ? form.venueIds.filter((x) => x !== v.id)
                          : [...form.venueIds, v.id],
                      })
                    }
                    className={`px-3 py-1.5 rounded-pill text-xs font-medium border transition-all ${
                      checked
                        ? 'bg-gradient-pink text-white border-transparent shadow-glow'
                        : 'bg-white/60 text-ink border-charcoal/15 hover:bg-white'
                    }`}
                  >
                    {checked && '✓ '}{v.name[locale]}
                  </button>
                );
              })}
            </div>
            {form.venueIds.length > 0 && (
              <button
                type="button"
                onClick={() => setForm({ ...form, venueIds: [] })}
                className="mt-2 text-xs text-ink-soft underline hover:text-pink"
              >
                {locale === 'zh' ? '清除選擇（適用所有分店）' : 'Clear (apply to all)'}
              </button>
            )}
          </Field>

          {/* Free-drinks combo flag. Hidden when type is already free_drinks
              (then it's already implied). */}
          {form.type !== 'free_drinks' && (
            <label className="flex items-start gap-2 text-sm pt-2">
              <input
                type="checkbox"
                checked={form.freeDrinks}
                onChange={(e) => setForm({ ...form, freeDrinks: e.target.checked })}
                className="w-4 h-4 mt-0.5"
              />
              <span>
                <span className="font-medium">
                  {locale === 'zh' ? '額外送免費飲品' : 'Also include free drinks'}
                </span>
                <span className="block text-xs text-ink-soft mt-0.5">
                  {locale === 'zh'
                    ? '飲品 add-on 變免費，可同上面選擇嘅折扣 combo'
                    : 'Drinks add-on becomes free on top of the monetary discount above'}
                </span>
              </span>
            </label>
          )}

          <label className="flex items-center gap-2 text-sm pt-2">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              className="w-4 h-4"
            />
            {locale === 'zh' ? '啟用（客人可即時使用）' : 'Enabled (customers can use right away)'}
          </label>

          <div className="flex items-center gap-2 pt-2">
            <button onClick={handleSave} disabled={saving} className="btn-primary disabled:opacity-40 flex items-center gap-2">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {locale === 'zh' ? '儲存' : 'Save'}
            </button>
            <button onClick={cancelEdit} className="px-4 py-2 rounded-xl bg-white/60 text-sm hover:bg-white">
              {locale === 'zh' ? '取消' : 'Cancel'}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="glass-card p-10 text-center text-ink-soft">
          <Loader2 size={20} className="animate-spin inline mr-2" /> Loading…
        </div>
      ) : codes.length === 0 ? (
        <div className="glass-card p-10 text-center text-ink-soft">
          <Tag size={32} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">{locale === 'zh' ? '未有優惠碼。撳「新增優惠碼」開始。' : 'No codes yet. Click "New Code" to start.'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {codes.map((c) => (
            <div key={c.id} className="glass-card p-5">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-lg font-bold text-ink">{c.code}</span>
                    <span className={`inline-flex px-2 py-0.5 rounded-pill text-[10px] font-semibold ${typeChipClass(c.type)}`}>
                      {TYPE_LABELS[c.type][locale]}
                    </span>
                    {!c.enabled && (
                      <span className="inline-flex px-2 py-0.5 rounded-pill text-[10px] font-semibold bg-charcoal/10 text-ink-soft">
                        {locale === 'zh' ? '已暫停' : 'Paused'}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-semibold text-pink mb-1">{summarise(c, locale)}</p>
                  {c.description && <p className="text-xs text-ink-soft mb-1">{c.description}</p>}
                  <div className="flex items-center gap-3 text-xs text-ink-soft flex-wrap">
                    {(c.startDate || c.endDate) && (
                      <span className="flex items-center gap-1">
                        <Calendar size={11} /> {c.startDate || '∞'} → {c.endDate || '∞'}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <UsersIcon size={11} />
                      {locale === 'zh' ? '已用 ' : 'Used '}{c.totalUsageCount}
                      {c.totalUsageLimit != null ? ` / ${c.totalUsageLimit}` : ` / ∞`}
                      {c.perUserLimit != null ? ` · 每人 ${c.perUserLimit}` : ' · 每人 ∞'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleToggleEnabled(c)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                      c.enabled
                        ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                        : 'bg-rose-100 text-rose-700 hover:bg-rose-200'
                    }`}
                  >
                    {c.enabled ? (locale === 'zh' ? '已啟用' : 'On') : (locale === 'zh' ? '已暫停' : 'Off')}
                  </button>
                  <button
                    onClick={() => startEdit(c)}
                    className="w-8 h-8 rounded-lg bg-white/60 text-ink-soft hover:bg-white flex items-center justify-center"
                    title={locale === 'zh' ? '編輯' : 'Edit'}
                  >
                    <Edit2 size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(c.id, c.code)}
                    className="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 flex items-center justify-center"
                    title={locale === 'zh' ? '刪除' : 'Delete'}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children, fullWidth }: { label: React.ReactNode; children: React.ReactNode; fullWidth?: boolean }) {
  return (
    <div className={fullWidth ? 'md:col-span-2' : ''}>
      <label className="block text-xs font-semibold text-ink-soft uppercase tracking-wider mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function summarise(c: PromoCode, locale: 'zh' | 'en'): string {
  switch (c.type) {
    case 'percent':
      return locale === 'zh' ? `減 ${c.percent ?? 0}%` : `${c.percent ?? 0}% off`;
    case 'cash':
      return locale === 'zh'
        ? `減 HK$${(c.amount ?? 0).toLocaleString()}${c.minSubtotal ? `（滿 HK$${c.minSubtotal.toLocaleString()}）` : ''}`
        : `HK$${(c.amount ?? 0).toLocaleString()} off${c.minSubtotal ? ` (min HK$${c.minSubtotal.toLocaleString()})` : ''}`;
    case 'per_pax':
      return locale === 'zh' ? `每位減 HK$${c.amount ?? 0}` : `HK$${c.amount ?? 0} off per pax`;
    case 'free_drinks':
      return locale === 'zh' ? '免費飲品任飲' : 'Free drinks add-on';
  }
}

function typeChipClass(t: PromoCodeType): string {
  switch (t) {
    case 'percent': return 'bg-pink-100 text-pink-700';
    case 'cash': return 'bg-amber-100 text-amber-700';
    case 'free_drinks': return 'bg-sky-100 text-sky-700';
    case 'per_pax': return 'bg-violet-100 text-violet-700';
  }
}
