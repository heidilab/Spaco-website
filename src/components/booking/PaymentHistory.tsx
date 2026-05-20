'use client';

// Renders a booking's payments[] audit log. Used on both the admin
// booking detail page and the customer-facing /my-bookings/[id] page,
// so it has to handle the BookingRecord.payments entry shape exactly.
// When `adminMode` is set, legacy entries (those without a
// rental/deposit split) get a "拆分" button so admin can retroactively
// attribute the money.

import { useState } from 'react';
import type { BookingRecord } from '@/types';
import { CreditCard, Wand2, X as XIcon, Loader2 } from 'lucide-react';

const METHOD_LABELS: Record<string, { zh: string; en: string }> = {
  stripe: { zh: 'Stripe', en: 'Stripe' },
  fps:    { zh: 'FPS 轉數快', en: 'FPS' },
  bank:   { zh: '銀行轉帳', en: 'Bank' },
  cash:   { zh: '現金', en: 'Cash' },
  other:  { zh: '其他', en: 'Other' },
};

function fmtRecordedAt(v: unknown): string {
  if (!v) return '';
  if (typeof v === 'string') {
    return new Date(v).toLocaleString();
  }
  const obj = v as { toDate?: () => Date; seconds?: number };
  if (typeof obj.toDate === 'function') return obj.toDate().toLocaleString();
  if (typeof obj.seconds === 'number') return new Date(obj.seconds * 1000).toLocaleString();
  return '';
}

export default function PaymentHistory({
  booking,
  locale,
  adminMode = false,
  onUpdated,
}: {
  booking: BookingRecord;
  locale: 'zh' | 'en';
  /** When true, show admin-only controls (拆分 button for legacy
   *  entries that pre-date the rental/deposit split). */
  adminMode?: boolean;
  /** Called after a successful split so the parent can refresh. */
  onUpdated?: () => void;
}) {
  const payments = booking.payments || [];
  const [splittingIdx, setSplittingIdx] = useState<number | null>(null);
  const [rentalInput, setRentalInput] = useState<string>('');
  const [depInput, setDepInput] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Legacy detection: any entry that has a positive amount but no split
  // is from the pre-split endpoint. When at least one exists, pricing.*
  // fields may not yet reflect the legacy money so any synthesis math
  // would be off; we hide the initial row + show a banner asking admin
  // to split before drawing the full audit.
  const hasUnsplit = payments.some(
    (p) =>
      (p.amount || 0) > 0
      && (p.rentalAmount || 0) === 0
      && (p.addOnAmount || 0) === 0
      && (p.depositAmount || 0) === 0,
  );

  // Three-bucket sums across all logged payments (場租 / 附加項目 / 按金).
  // Legacy entries pre-dating the addOnAmount split lump everything into
  // rentalAmount — we don't try to retroactively split them here; the
  // 3-bucket view just shows 附加項目 = 0 for those rows.
  const loggedRentalSum = payments.reduce((s, p) => s + (p.rentalAmount || 0), 0);
  const loggedAddOnSum = payments.reduce((s, p) => s + (p.addOnAmount || 0), 0);
  const loggedDepositSum = payments.reduce((s, p) => s + (p.depositAmount || 0), 0);

  // Only synthesize an "initial confirmation payment" row when the
  // booking has been paid for AND there are no logged entries at all.
  // Pre-this-commit Stripe webhooks didn't write payments[] entries, so
  // a legacy confirmed booking would otherwise render an empty list.
  // Modern bookings have one Stripe entry per charge (initial / balance)
  // already in payments[], so the synthetic row would double-count.
  const isPaid =
    booking.status === 'confirmed' ||
    booking.status === 'completed' ||
    !!booking.paymentVerifiedAt;

  // Synthesize the historical "paid" portion not yet captured in
  // payments[] (e.g. Stripe charges from before the webhook started
  // writing audit entries). Total paid = grandTotal − balanceDue.
  //
  // Bucket-fill instead of pro-rata. The booking system's own pricing
  // flow charges the customer's confirmation payment against the
  // FOUNDATIONAL buckets first (refundable deposit, then venue rental),
  // with add-ons treated as optional extras that can be added later.
  // For Heidi's #6sURGgn9 the first $4,390 was meant to be:
  //   按金 $1,000   (full deposit)
  //   場租 $3,000   (full venue rental)
  //   附加項目 $390 (Shisha only — BBQ was added LATER)
  // The earlier pro-rata logic split each bucket at the same ratio and
  // produced $679/$2,039/$1,672, which mangled the breakdown. The
  // bucket-fill order below reconstructs the correct split for the
  // common "admin added an add-on after the customer already paid"
  // case without needing to store a pricing snapshot.
  const grandTotal = (booking.pricing.subtotal || 0) + (booking.pricing.securityDeposit || 0);
  const actualPaidTotal = isPaid ? Math.max(0, grandTotal - (booking.balanceDue || 0)) : 0;
  const loggedTotalAmount = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const synthAmount = hasUnsplit ? 0 : Math.max(0, actualPaidTotal - loggedTotalAmount);

  const baseCharge = booking.pricing.baseCharge ?? 0;
  const addOnTotal = booking.pricing.addOnTotal ?? 0;
  const securityDeposit = booking.pricing.securityDeposit ?? 0;
  const remainingRental = Math.max(0, baseCharge - loggedRentalSum);
  const remainingAddOn = Math.max(0, addOnTotal - loggedAddOnSum);
  const remainingDeposit = Math.max(0, securityDeposit - loggedDepositSum);

  // Greedy fill: deposit → rental → add-ons. Each bucket consumes as
  // much of the synthAmount as it can hold, then the next bucket gets
  // whatever's left. No rounding drift because we use integer
  // subtractions, not ratios.
  let remaining = synthAmount;
  const initialDeposit = Math.min(remaining, remainingDeposit);
  remaining -= initialDeposit;
  const initialRental = Math.min(remaining, remainingRental);
  remaining -= initialRental;
  // Any leftover (rare — happens only if grandTotal > sum of buckets
  // due to data corruption) lumps into add-ons so total still matches.
  const initialAddOn = remaining;

  const initialPaid = initialDeposit + initialRental + initialAddOn;
  const initialMethod = (booking.paymentMethod || 'stripe') as 'stripe' | 'fps' | 'bank' | 'cash' | 'other';

  // Nothing to show? Bail early.
  if (payments.length === 0 && initialPaid === 0) return null;

  const totalRental = loggedRentalSum + initialRental;
  const totalAddOn = loggedAddOnSum + initialAddOn;
  const totalDeposit = loggedDepositSum + initialDeposit;

  async function handleSplitSubmit() {
    if (splittingIdx === null) return;
    const rental = parseFloat(rentalInput) || 0;
    const dep = parseFloat(depInput) || 0;
    const entry = payments[splittingIdx];
    if (rental + dep !== entry.amount) {
      setErr(locale === 'zh'
        ? `兩個金額相加要等於 HK$${entry.amount.toLocaleString()}`
        : `Rental + deposit must equal HK$${entry.amount.toLocaleString()}`);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/admin/booking-fix-payment-split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId: booking.id,
          paymentIndex: splittingIdx,
          rentalAmount: rental,
          depositAmount: dep,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Split failed');
      setSplittingIdx(null);
      setRentalInput('');
      setDepInput('');
      onUpdated?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'unknown');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glass-card p-6 space-y-3 text-sm">
      <h2 className="font-bold flex items-center gap-2">
        <CreditCard size={16} className="text-pink" />
        {locale === 'zh' ? '付款記錄' : 'Payment History'}
      </h2>

      <div className="grid grid-cols-3 gap-2 text-xs bg-cream/40 rounded-xl p-3">
        <div>
          <p className="text-ink-soft">{locale === 'zh' ? '已收場租' : 'Rental paid'}</p>
          <p className="font-bold text-base">HK${totalRental.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-ink-soft">{locale === 'zh' ? '已收附加項目' : 'Add-ons paid'}</p>
          <p className="font-bold text-base">HK${totalAddOn.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-ink-soft">{locale === 'zh' ? '已收按金' : 'Deposit paid'}</p>
          <p className="font-bold text-base">HK${totalDeposit.toLocaleString()}</p>
        </div>
      </div>

      {hasUnsplit && adminMode && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800 leading-relaxed">
          <p className="font-semibold mb-1">⚠️ {locale === 'zh' ? '有未拆分嘅付款' : 'Some payments are not split'}</p>
          <p>
            {locale === 'zh'
              ? '撳下面條目嘅 🪄 拆分鈕，輸入「場租 vs 按金」金額。拆完之後系統會自動更新小計、可退按金、已收，所有顯示先會啱。'
              : 'Click the 🪄 Split button on the entry below and enter rental vs deposit amounts. Subtotal / refundable / paid totals will then update.'}
          </p>
        </div>
      )}

      <ul className="space-y-2 text-xs">
        {/* Legacy-only synthetic row — only renders when there are no
         *  logged payments[] entries (so pre-Stripe-webhook-write
         *  bookings still show what was paid). Modern bookings have
         *  one real entry per Stripe charge so this branch is skipped. */}
        {initialPaid > 0 && (
          <li className="border-l-2 border-emerald-400/60 pl-3 py-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono font-bold text-sm">HK${initialPaid.toLocaleString()}</span>
              <span className="text-ink-soft">{METHOD_LABELS[initialMethod]?.[locale] || initialMethod}</span>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-ink-soft mt-0.5">
              {initialRental > 0 && (
                <span>{locale === 'zh' ? '場租 ' : 'Rental '}HK${initialRental.toLocaleString()}</span>
              )}
              {initialAddOn > 0 && (
                <span>{locale === 'zh' ? '附加項目 ' : 'Add-ons '}HK${initialAddOn.toLocaleString()}</span>
              )}
              {initialDeposit > 0 && (
                <span>{locale === 'zh' ? '按金 ' : 'Deposit '}HK${initialDeposit.toLocaleString()}</span>
              )}
            </div>
            <p className="text-ink-soft text-[11px] mt-0.5">
              {locale === 'zh' ? '首次確認付款' : 'Initial confirmation payment'}
              {' · '}
              {fmtRecordedAt(booking.createdAt)}
            </p>
          </li>
        )}
        {payments.map((p, i) => {
          const hasSplit =
            (p.rentalAmount || 0) > 0
            || (p.addOnAmount || 0) > 0
            || (p.depositAmount || 0) > 0;
          const isLegacy = !hasSplit && p.amount > 0;
          // Label each entry by its kind — distinguishes the initial
          // deposit from a later balance payment from an admin top-up.
          const kindLabel = (() => {
            if (!p.kind) return null;
            if (p.kind === 'initial') return locale === 'zh' ? '首期付款' : 'Initial';
            if (p.kind === 'balance') return locale === 'zh' ? '尾數付款' : 'Balance';
            if (p.kind === 'topup') return locale === 'zh' ? '補加付款' : 'Top-up';
            return null;
          })();
          return (
            <li key={i} className="border-l-2 border-pink/40 pl-3 py-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono font-bold text-sm">HK${p.amount.toLocaleString()}</span>
                <span className="text-ink-soft">{METHOD_LABELS[p.method]?.[locale] || p.method}</span>
              </div>
              {hasSplit && (
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-ink-soft mt-0.5">
                  {(p.rentalAmount || 0) > 0 && (
                    <span>{locale === 'zh' ? '場租 ' : 'Rental '}HK${p.rentalAmount.toLocaleString()}</span>
                  )}
                  {(p.addOnAmount || 0) > 0 && (
                    <span>{locale === 'zh' ? '附加項目 ' : 'Add-ons '}HK${p.addOnAmount!.toLocaleString()}</span>
                  )}
                  {(p.depositAmount || 0) > 0 && (
                    <span>{locale === 'zh' ? '按金 ' : 'Deposit '}HK${p.depositAmount.toLocaleString()}</span>
                  )}
                </div>
              )}
              {kindLabel && (
                <p className="text-[11px] text-ink-soft mt-0.5">
                  {kindLabel}
                  {' · '}
                  {fmtRecordedAt(p.recordedAt)}
                </p>
              )}
              {isLegacy && (
                <p className="text-amber-700 text-[11px] mt-0.5 flex items-center gap-1">
                  ⚠️ {locale === 'zh' ? '未拆分（場租 vs 按金）' : 'Not split into rental/deposit'}
                  {adminMode && (
                    <button
                      onClick={() => {
                        setSplittingIdx(i);
                        setRentalInput('');
                        setDepInput('');
                        setErr(null);
                      }}
                      className="ml-1 px-2 py-0.5 rounded-pill bg-pink/10 text-pink text-[10px] font-semibold hover:bg-pink/20 flex items-center gap-1"
                    >
                      <Wand2 size={10} /> {locale === 'zh' ? '拆分' : 'Split'}
                    </button>
                  )}
                </p>
              )}
              {p.note && (
                <p className="text-ink-soft italic mt-0.5">「{p.note}」</p>
              )}
              {/* Standalone timestamp only when the kind-label paragraph
                * isn't already showing one — avoids "首期付款 · 2026-05-20
                * 12:16 / 2026-05-20 12:16" duplicate. */}
              {!kindLabel && (
                <p className="text-ink-soft text-[10px] mt-0.5">{fmtRecordedAt(p.recordedAt)}</p>
              )}
            </li>
          );
        })}
      </ul>

      {/* Split modal for legacy entries */}
      {adminMode && splittingIdx !== null && (
        <div className="fixed inset-0 z-50 bg-charcoal/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-glass-lg max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-lg">
                {locale === 'zh' ? '拆分付款金額' : 'Split Payment'}
              </h3>
              <button
                onClick={() => setSplittingIdx(null)}
                className="w-8 h-8 rounded-full hover:bg-white/60 flex items-center justify-center"
              >
                <XIcon size={14} />
              </button>
            </div>
            <p className="text-sm text-ink-soft mb-4">
              {locale === 'zh'
                ? `總金額 HK$${payments[splittingIdx].amount.toLocaleString()}。請輸入幾多係場租、幾多係按金。`
                : `Total HK$${payments[splittingIdx].amount.toLocaleString()}. Split between rental and deposit.`}
            </p>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs font-semibold text-ink-soft mb-1">
                  {locale === 'zh' ? '場租' : 'Rental'}
                </label>
                <input
                  type="number"
                  value={rentalInput}
                  onChange={(e) => setRentalInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white"
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink-soft mb-1">
                  {locale === 'zh' ? '按金' : 'Deposit'}
                </label>
                <input
                  type="number"
                  value={depInput}
                  onChange={(e) => setDepInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white"
                  placeholder="0"
                />
              </div>
            </div>
            <p className="text-xs text-ink-soft mb-3">
              {locale === 'zh' ? '兩者相加：' : 'Sum: '}
              <span className="font-bold">HK${((parseFloat(rentalInput) || 0) + (parseFloat(depInput) || 0)).toLocaleString()}</span>
              {' / HK$' + payments[splittingIdx].amount.toLocaleString()}
            </p>
            {err && (
              <div className="text-xs bg-rose-50 text-rose-700 rounded-lg px-3 py-2 mb-3">{err}</div>
            )}
            <button
              onClick={handleSplitSubmit}
              disabled={busy}
              className="w-full btn-primary justify-center disabled:opacity-40 flex items-center gap-2"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
              {locale === 'zh' ? '確認拆分' : 'Confirm'}
            </button>
            <p className="text-[11px] text-ink-soft mt-2 leading-relaxed">
              {locale === 'zh'
                ? '拆分後系統會將場租加入小計、按金加入可退按金。已收總額不變。'
                : 'On confirm, rental adds to subtotal, deposit adds to refundable amount. Total paid is unchanged.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
