'use client';

// Renders a booking's payments[] audit log. Used on both the admin
// booking detail page and the customer-facing /my-bookings/[id] page,
// so it has to handle the BookingRecord.payments entry shape exactly.
// When `adminMode` is set, legacy entries (those without a
// rental/deposit split) get a "拆分" button so admin can retroactively
// attribute the money.

import { useState } from 'react';
import type { BookingRecord } from '@/types';
import { CreditCard, Wand2, X as XIcon, Loader2, Check, Undo2 } from 'lucide-react';

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
  // Freeze-synth action — converts the live-computed initial row
  // into a permanent payments[] entry so pricing edits stop moving
  // the historical record.
  const [freezingSynth, setFreezingSynth] = useState(false);
  const [freezeMsg, setFreezeMsg] = useState<string | null>(null);
  // KPay refund state (admin-only). A KPay payment carries kpayOrderNo —
  // the original transaction's orderNo, which is what /v1/refund needs.
  const [refundingOrderNo, setRefundingOrderNo] = useState<string | null>(null);
  const [refundMax, setRefundMax] = useState(0);
  const [refundAmtInput, setRefundAmtInput] = useState('');
  const [refundBusy, setRefundBusy] = useState(false);
  const [refundResult, setRefundResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Heidi 2026-05-23 spec dropped per-bucket payment tracking — new
  // entries only carry `amount`, no rental/addon/deposit split. The
  // old "未拆分嘅付款" warning + 🪄 split modal were tied to that legacy
  // model and just confused CS now. Keep `hasUnsplit = false` so the
  // warning never renders (and the split modal stays inert).
  const hasUnsplit = false;

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
  // writing audit entries).
  //
  // Compute the EFFECTIVE grand total from primitive fields
  // (baseCharge + addOnTotal − promoDiscount + securityDeposit) so
  // the math is correct regardless of whether `pricing.subtotal` was
  // stored PRE-promo (venue page / admin/bookings/new post commit
  // e1900f0) or POST-promo (legacy updateBookingPricing /
  // booking-cleanup-fix output). Using primitives sidesteps the
  // convention-drift entirely.
  //
  // Earlier this code used `pricing.subtotal + securityDeposit` on
  // the assumption that subtotal was always POST-promo. After the
  // PRE-promo storage was restored, that produced a phantom synth
  // row equal to promoDiscount on every booking with a promo applied
  // (e.g. #asQzC4PU: real Stripe $7,000, but grandTotal computed as
  // $7,500 from PRE-promo subtotal, so a phantom $500 synth appeared
  // and 已收總額 inflated to $7,500).
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
  const promoDiscountForGrandTotal = booking.promoDiscount || 0;
  const grandTotal = Math.max(
    0,
    (booking.pricing.baseCharge || 0)
      + (booking.pricing.addOnTotal || 0)
      - promoDiscountForGrandTotal,
  ) + (booking.pricing.securityDeposit || 0);
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
  // whatever's left. Every bucket is capped at its `remaining*` value
  // (= bucket total − amount already logged in payments[]) so a
  // logged FPS payment in the add-on bucket doesn't get double-
  // counted by an overflow dump into addOn — the bug Heidi flagged
  // on #hlJJh9K5 where 已收附加項目 displayed \$1,280 (\$640 phantom
  // synth + \$640 real FPS) when only \$640 was actually paid.
  let remaining = synthAmount;
  const initialDeposit = Math.min(remaining, remainingDeposit);
  remaining -= initialDeposit;
  const initialRental = Math.min(remaining, remainingRental);
  remaining -= initialRental;
  const initialAddOn = Math.min(remaining, remainingAddOn);
  remaining -= initialAddOn;
  // Anything still left = OVERPAYMENT — synth amount exceeds the
  // booking's expected grandTotal across all three buckets. Means
  // pricing.subtotal / pricing.securityDeposit are out of sync with
  // what the customer actually paid (data corruption). Surface a
  // warning below instead of silently double-counting.
  const overflowPaid = remaining;

  const initialPaid = initialDeposit + initialRental + initialAddOn;
  const initialMethod = (booking.paymentMethod || 'stripe') as 'stripe' | 'fps' | 'bank' | 'cash' | 'other';

  // Nothing to show? Bail early.
  if (payments.length === 0 && initialPaid === 0) return null;

  const totalRental = loggedRentalSum + initialRental;
  const totalAddOn = loggedAddOnSum + initialAddOn;
  const totalDeposit = loggedDepositSum + initialDeposit;

  /** Materialise the synth row into a permanent payments[] entry.
   *  After this fires, the synth disappears (logged covers paid) and
   *  pricing edits stop moving the displayed number — Heidi's
   *  "過去式不會改變" semantic. Safe to fail when the synth is
   *  overpaying its buckets (corrupt pricing) — the endpoint refuses
   *  and asks admin to fix subtotal/deposit first. */
  async function handleFreezeSynth() {
    setFreezingSynth(true);
    setFreezeMsg(null);
    try {
      const res = await fetch('/api/admin/booking-freeze-synth-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId: booking.id,
          method: booking.paymentMethod || 'stripe',
          kind: 'initial',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Server returns a friendly Chinese message for OVERPAYMENT.
        throw new Error(data?.message || data?.error || 'Freeze failed');
      }
      setFreezeMsg(locale === 'zh' ? '✓ 已凍結為永久付款記錄' : '✓ Frozen as permanent record');
      onUpdated?.();
    } catch (e) {
      setFreezeMsg(
        (locale === 'zh' ? '失敗：' : 'Failed: ')
        + (e instanceof Error ? e.message : 'unknown'),
      );
    } finally {
      setFreezingSynth(false);
    }
  }

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

  // Refunds already issued against this booking's KPay payments.
  const refundsLog =
    (booking as { kpayRefunds?: Array<{
      amount: number;
      state: number;
      stateDesc?: string | null;
      refundOutTradeNo?: string;
      recordedAt?: unknown;
    }> }).kpayRefunds || [];

  async function handleRefundSubmit() {
    if (!refundingOrderNo) return;
    const amt = parseFloat(refundAmtInput) || 0;
    if (amt <= 0) {
      setRefundResult({ ok: false, msg: locale === 'zh' ? '請輸入有效金額' : 'Enter a valid amount' });
      return;
    }
    setRefundBusy(true);
    setRefundResult(null);
    try {
      const res = await fetch('/api/kpay/refund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId: booking.id,
          kpayOrderNo: refundingOrderNo,
          refundAmount: amt,
        }),
      });
      const data = await res.json();
      // result: 1=pending 2=success 3=failed. code 10000 = request accepted.
      const success = res.ok && data.ok && data.result === 2;
      const pending = res.ok && data.ok && data.result === 1;
      if (success) {
        setRefundResult({
          ok: true,
          msg: (locale === 'zh' ? '✓ 退款成功 HK$' : '✓ Refunded HK$')
            + amt.toLocaleString()
            + (data.refundOrderNo ? `（${data.refundOrderNo}）` : ''),
        });
        onUpdated?.();
      } else if (pending) {
        setRefundResult({
          ok: true,
          msg: locale === 'zh' ? '退款處理中，請稍後查看結果' : 'Refund pending — check back shortly',
        });
        onUpdated?.();
      } else {
        // Failure — surface KPay's reason (e.g. 退款餘額不足).
        const reason = data.reason || data.message || data.error
          || (locale === 'zh' ? '退款失敗' : 'Refund failed');
        setRefundResult({ ok: false, msg: reason });
      }
    } catch (e) {
      setRefundResult({ ok: false, msg: e instanceof Error ? e.message : 'unknown' });
    } finally {
      setRefundBusy(false);
    }
  }

  return (
    <div className="glass-card p-6 space-y-3 text-sm">
      <h2 className="font-bold flex items-center gap-2">
        <CreditCard size={16} className="text-pink" />
        {locale === 'zh' ? '付款記錄' : 'Payment History'}
      </h2>

      <div className="flex items-baseline justify-between bg-cream/40 rounded-xl p-3">
        <p className="text-xs text-ink-soft">
          {locale === 'zh' ? '已收總額' : 'Total received'}
        </p>
        <p className="font-bold text-lg">
          HK${(
            payments.reduce((s, p) => s + (p.amount || 0), 0)
            + initialPaid
          ).toLocaleString()}
        </p>
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

      {/* Overpayment warning — the synth amount exceeded what the
       *  three buckets could absorb (rental + add-on + deposit caps).
       *  Usually means `pricing.subtotal` / `pricing.securityDeposit`
       *  got bumped by 「記錄額外付款」 when they shouldn't have, leaving
       *  `grandTotal − balanceDue` higher than the actual cost. Tell
       *  admin to repair via the booking edit panel's subtotal /
       *  deposit override fields. */}
      {overflowPaid > 0 && adminMode && (
        <div className="rounded-xl bg-rose-50 border border-rose-200 px-3 py-2.5 text-xs text-rose-800 leading-relaxed">
          <p className="font-semibold mb-1">⚠️ {locale === 'zh'
            ? `付款記錄超出張單 HK$${overflowPaid.toLocaleString()}`
            : `Payments exceed bill total by HK$${overflowPaid.toLocaleString()}`}</p>
          <p>
            {locale === 'zh'
              ? '可能係之前撳咗「記錄額外付款」嚟確認客人交尾數（嗰粒掣會加大張單）。請去編輯預訂 panel，喺「消費小計」/「可退按金」override 嗰度修返正確金額，呢個警告會自動消失。'
              : 'Likely caused by "Record extra charge" being used to settle a balance (that button inflates the bill). Repair via the consumption-subtotal / deposit override fields in the booking edit panel — this warning clears once the numbers reconcile.'}
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
              {locale === 'zh' ? '首次確認付款（推算）' : 'Initial confirmation payment (derived)'}
              {' · '}
              {fmtRecordedAt(booking.createdAt)}
            </p>
            {/* Freeze synth into a real payments[] entry — admin one-
             *  clicks and this ephemeral derived row becomes a
             *  permanent record. After freeze the synth disappears
             *  (logged covers paid) and pricing edits no longer move
             *  the displayed number. Heidi's spec: 付款記錄應該不會
             *  隨時更改, 過去式不會改變. */}
            {adminMode && !overflowPaid && (
              <button
                type="button"
                onClick={handleFreezeSynth}
                disabled={freezingSynth}
                className="mt-1.5 px-2 py-0.5 rounded-pill bg-emerald-500/10 text-emerald-700 text-[10px] font-semibold hover:bg-emerald-500/20 disabled:opacity-40 flex items-center gap-1"
                title={locale === 'zh'
                  ? '將呢條推算嘅付款記錄寫入 payments[]，成為永久不變嘅歷史記錄。之後嘅 pricing 編輯都唔會再改動到呢一筆。'
                  : 'Write this derived row to payments[] as a permanent record. Pricing edits won\'t move it after freeze.'}
              >
                <Check size={10} />
                {freezingSynth
                  ? (locale === 'zh' ? '凍結中…' : 'Freezing…')
                  : (locale === 'zh' ? '凍結為永久記錄' : 'Freeze as permanent record')}
              </button>
            )}
            {freezeMsg && (
              <p className="mt-1 text-[10px] text-ink-soft">{freezeMsg}</p>
            )}
          </li>
        )}
        {payments.map((p, i) => {
          // Label each entry by its kind — distinguishes the initial
          // deposit from a later balance payment from an admin top-up.
          const kindLabel = (() => {
            if (!p.kind) return null;
            if (p.kind === 'initial') return locale === 'zh' ? '首期付款' : 'Initial';
            if (p.kind === 'balance') return locale === 'zh' ? '尾數付款' : 'Balance';
            if (p.kind === 'topup') return locale === 'zh' ? '補加付款' : 'Top-up';
            return null;
          })();
          const kpayOrderNo = (p as { kpayOrderNo?: string }).kpayOrderNo;
          return (
            <li key={i} className="border-l-2 border-pink/40 pl-3 py-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono font-bold text-sm">HK${p.amount.toLocaleString()}</span>
                <span className="text-ink-soft">{METHOD_LABELS[p.method]?.[locale] || p.method}</span>
              </div>
              {/* Per-entry bucket breakdown intentionally omitted per
               *  Heidi's 2026-05-23 spec — every entry just shows
               *  amount + method + date. */}
              {kindLabel && (
                <p className="text-[11px] text-ink-soft mt-0.5">
                  {kindLabel}
                  {' · '}
                  {fmtRecordedAt(p.recordedAt)}
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
              {/* KPay refund — only for KPay card/QR payments (those carry
               *  kpayOrderNo). Refunds against the original transaction's
               *  orderNo via /api/kpay/refund. */}
              {adminMode && kpayOrderNo && (
                <button
                  type="button"
                  onClick={() => {
                    setRefundingOrderNo(kpayOrderNo);
                    setRefundMax(p.amount);
                    setRefundAmtInput(String(p.amount));
                    setRefundResult(null);
                  }}
                  className="mt-1.5 px-2 py-0.5 rounded-pill bg-rose-500/10 text-rose-700 text-[10px] font-semibold hover:bg-rose-500/20 flex items-center gap-1"
                  title={locale === 'zh'
                    ? '透過 KPay 退款此筆交易（退回原付款方式）。退全額可能因手續費而餘額不足。'
                    : 'Refund this KPay transaction to the original payment method. Full refund may fail on fee balance.'}
                >
                  <Undo2 size={10} />
                  {locale === 'zh' ? '退款' : 'Refund'}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {/* KPay refunds issued against this booking. */}
      {refundsLog.length > 0 && (
        <div className="border-t border-charcoal/10 pt-3 space-y-1.5">
          <p className="text-xs font-semibold text-ink-soft">
            {locale === 'zh' ? '退款記錄' : 'Refunds'}
          </p>
          <ul className="space-y-1.5 text-xs">
            {refundsLog.map((r, i) => {
              const ok = r.state === 2;
              return (
                <li key={i} className={`border-l-2 pl-3 py-1 ${ok ? 'border-emerald-400/60' : 'border-rose-400/60'}`}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono font-bold">−HK${(r.amount || 0).toLocaleString()}</span>
                    <span className={ok ? 'text-emerald-700' : 'text-rose-700'}>
                      {ok
                        ? (locale === 'zh' ? '退款成功' : 'Refunded')
                        : (locale === 'zh' ? '退款失敗' : 'Failed')}
                    </span>
                  </div>
                  {r.stateDesc && <p className="text-ink-soft mt-0.5">{r.stateDesc}</p>}
                  <p className="text-ink-soft text-[10px] mt-0.5">{fmtRecordedAt(r.recordedAt)}</p>
                </li>
              );
            })}
          </ul>
        </div>
      )}

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

      {/* KPay refund modal */}
      {adminMode && refundingOrderNo !== null && (
        <div className="fixed inset-0 z-50 bg-charcoal/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-glass-lg max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <Undo2 size={18} className="text-rose-600" />
                {locale === 'zh' ? 'KPay 退款' : 'KPay Refund'}
              </h3>
              <button
                onClick={() => { setRefundingOrderNo(null); setRefundResult(null); }}
                className="w-8 h-8 rounded-full hover:bg-white/60 flex items-center justify-center"
              >
                <XIcon size={14} />
              </button>
            </div>
            <p className="text-sm text-ink-soft mb-1">
              {locale === 'zh'
                ? `原交易金額 HK$${refundMax.toLocaleString()}。輸入退款金額：`
                : `Original amount HK$${refundMax.toLocaleString()}. Enter refund amount:`}
            </p>
            <input
              type="number"
              value={refundAmtInput}
              onChange={(e) => setRefundAmtInput(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white mb-2"
              placeholder="0"
            />
            <p className="text-[11px] text-ink-soft mb-3 leading-relaxed">
              {locale === 'zh'
                ? '⚠️ KPay 會先扣手續費，退全額時可能顯示「退款餘額不足」。退款結果會透過 webhook 記錄喺下面「退款記錄」。'
                : '⚠️ KPay deducts fees first, so a full refund may report insufficient balance. The result is recorded under Refunds via webhook.'}
            </p>
            {refundResult && (
              <div className={`text-xs rounded-lg px-3 py-2 mb-3 ${refundResult.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                {refundResult.msg}
              </div>
            )}
            <button
              onClick={handleRefundSubmit}
              disabled={refundBusy}
              className="w-full justify-center disabled:opacity-40 flex items-center gap-2 bg-rose-600 text-white py-3 rounded-xl font-bold hover:bg-rose-700"
            >
              {refundBusy ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />}
              {locale === 'zh' ? '確認退款' : 'Confirm Refund'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
