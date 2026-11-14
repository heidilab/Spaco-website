'use client';

// 推廣渠道 (source) of a booking, editable by staff.
//
// Customers pick "how did you hear about us" themselves and often pick
// wrong; staff find the real source in WhatsApp (Heidi 2026-11-13). The
// source matters twice: it is the Source column of the month-close sheet,
// and broker / platform commission is keyed on it — commission is derived
// live from `marketingChannel` everywhere (支出管理, 月結, the exports), so
// saving the right channel here is all it takes for e.g. Reubird's 10% to
// appear.

import { useEffect, useMemo, useState } from 'react';
import { doc, updateDoc, serverTimestamp, deleteField } from 'firebase/firestore';
import { Loader2, Pencil } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { channelDisplayLabel, getChannelRegistry, staffChannelOptions, type MarketingChannelOption } from '@/lib/marketingChannels';
import { getFinanceConfig, type FinanceConfig } from '@/lib/expenses';
import { commissionForBooking } from '@/lib/bookingMoney';
import type { BookingRecord } from '@/types';

const LOYALTY: MarketingChannelOption = { id: 'loyalty_member', zh: '老會員', en: 'Loyalty Member' };

export default function BookingSourceEditor({
  booking, locale, onSaved,
}: {
  booking: BookingRecord;
  locale: 'zh' | 'en';
  onSaved: () => void | Promise<void>;
}) {
  const zh = locale === 'zh';
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [options, setOptions] = useState<MarketingChannelOption[]>([]);
  const [config, setConfig] = useState<FinanceConfig | null>(null);
  const [channel, setChannel] = useState<string>(booking.marketingChannel || '');
  const [other, setOther] = useState(booking.marketingChannelOther || '');
  const [clearOverride, setClearOverride] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    // The channel registry (內容管理 → 來源渠道): platform channels first.
    getChannelRegistry()
      .then((registry) => setOptions([...staffChannelOptions(registry), LOYALTY]))
      .catch(() => setOptions([LOYALTY]));
    getFinanceConfig().then(setConfig).catch(() => setConfig(null));
  }, [editing]);

  // The booking's current channel stays selectable even if it is no
  // longer in the configured list (e.g. 'airbnb', or a removed option).
  const allOptions = useMemo(() => {
    const cur = booking.marketingChannel;
    if (!cur || options.some((o) => o.id === cur)) return options;
    const label = channelDisplayLabel(booking, 'zh') || cur;
    return [...options, { id: cur, zh: label, en: channelDisplayLabel(booking, 'en') || cur }];
  }, [options, booking]);

  const hasOverride = typeof booking.commissionOverride === 'number';
  const rule = config?.commissionRules[channel];
  const commission = config
    ? commissionForBooking(
      { ...booking, commissionOverride: hasOverride && !clearOverride ? booking.commissionOverride : undefined },
      rule,
    )
    : null;

  const current = booking.marketingChannel === 'loyalty_member'
    ? (zh ? '🌟 老會員' : '🌟 Loyalty Member')
    : booking.marketingChannel
      ? `📣 ${channelDisplayLabel(booking, locale)}${booking.marketingChannelOther ? `: ${booking.marketingChannelOther}` : ''}`
      : (zh ? '（未填）' : '(not set)');

  async function save() {
    if (!channel) { setError(zh ? '請揀一個來源' : 'Pick a source'); return; }
    setSaving(true); setError(null);
    try {
      const opt = allOptions.find((o) => o.id === channel);
      await updateDoc(doc(db, 'bookings', booking.id), {
        marketingChannel: channel,
        // Snapshot the label so channels outside the built-in list (行家,
        // Reubird, CMS-configured ones) still read properly everywhere.
        marketingChannelLabel: opt?.zh || channel,
        marketingChannelOther: channel === 'other' && other.trim() ? other.trim().slice(0, 200) : deleteField(),
        // The customer's own answer at confirm must not overwrite this.
        marketingChannelSetByStaff: true,
        marketingChannelSetBy: user?.uid || null,
        ...(hasOverride && clearOverride ? { commissionOverride: null } : {}),
        updatedAt: serverTimestamp(),
      });
      await onSaved();
      setEditing(false);
    } catch {
      setError(zh ? '儲存失敗，請再試。' : 'Could not save — try again.');
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
        <span className="text-ink-soft">{zh ? '推廣渠道（來源）' : 'Source'}</span>
        <span className="flex items-center gap-2 font-medium text-right">
          {current}
          <button
            type="button"
            onClick={() => {
              setChannel(booking.marketingChannel || '');
              setOther(booking.marketingChannelOther || '');
              setClearOverride(true);
              setEditing(true);
            }}
            className="inline-flex items-center gap-1 text-xs text-pink hover:underline"
          >
            <Pencil size={11} />{zh ? '更改' : 'Change'}
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className="my-2 rounded-2xl border border-pink/30 bg-pink/5 p-3 space-y-2 text-sm">
      <p className="text-xs font-semibold text-ink">{zh ? '更改推廣渠道（來源）' : 'Change source'}</p>
      <select
        value={channel} onChange={(e) => setChannel(e.target.value)}
        className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
      >
        <option value="">{zh ? '— 請揀 —' : '— choose —'}</option>
        {allOptions.map((o) => <option key={o.id} value={o.id}>{o[locale]}</option>)}
      </select>
      {channel === 'other' && (
        <input
          value={other} onChange={(e) => setOther(e.target.value)} maxLength={200}
          placeholder={zh ? '來源名稱' : 'Source name'}
          className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
        />
      )}
      {commission !== null && channel && (
        <p className="text-xs text-ink-soft">
          {hasOverride && !clearOverride
            ? (zh ? `佣金：保留手動金額 $${commission.toLocaleString()}` : `Commission: manual amount $${commission.toLocaleString()} kept`)
            : rule && rule.pct > 0
              ? (zh
                ? `佣金：${rule.pct}% × ${rule.base === 'rent' ? '場租' : '全單'} = $${commission.toLocaleString()}（會自動計入支出同月結）`
                : `Commission: ${rule.pct}% of ${rule.base === 'rent' ? 'rent' : 'the whole bill'} = $${commission.toLocaleString()} (flows into expenses and month close)`)
              : (zh ? '佣金：呢個來源唔使俾佣金' : 'Commission: none for this source')}
        </p>
      )}
      {hasOverride && (
        <label className="flex items-center gap-2 text-xs text-ink-soft">
          <input type="checkbox" checked={clearOverride} onChange={(e) => setClearOverride(e.target.checked)} />
          {zh
            ? `呢張單有手動佣金 $${(booking.commissionOverride as number).toLocaleString()}，改來源時清除（改用新來源嘅規則）`
            : `Clear the manual commission of $${(booking.commissionOverride as number).toLocaleString()} and use the new source's rule`}
        </label>
      )}
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button" onClick={save} disabled={saving}
          className="rounded-full bg-pink text-white text-xs font-semibold px-4 py-1.5 disabled:opacity-50 flex items-center gap-1.5"
        >
          {saving && <Loader2 size={12} className="animate-spin" />}{zh ? '儲存' : 'Save'}
        </button>
        <button type="button" onClick={() => setEditing(false)} className="rounded-full border border-black/10 text-xs px-4 py-1.5">
          {zh ? '取消' : 'Cancel'}
        </button>
      </div>
    </div>
  );
}
