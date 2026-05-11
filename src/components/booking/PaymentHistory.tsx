// Renders a booking's payments[] audit log. Used on both the admin
// booking detail page and the customer-facing /my-bookings/[id] page,
// so it has to handle the BookingRecord.payments entry shape exactly.

import type { BookingRecord } from '@/types';
import { CreditCard } from 'lucide-react';

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
}: {
  booking: BookingRecord;
  locale: 'zh' | 'en';
}) {
  const payments = booking.payments || [];
  if (payments.length === 0) return null;

  const totalRental = payments.reduce((s, p) => s + (p.rentalAmount || 0), 0);
  const totalDeposit = payments.reduce((s, p) => s + (p.depositAmount || 0), 0);

  return (
    <div className="glass-card p-6 space-y-3 text-sm">
      <h2 className="font-bold flex items-center gap-2">
        <CreditCard size={16} className="text-pink" />
        {locale === 'zh' ? '付款記錄' : 'Payment History'}
      </h2>

      <div className="grid grid-cols-2 gap-2 text-xs bg-cream/40 rounded-xl p-3">
        <div>
          <p className="text-ink-soft">{locale === 'zh' ? '已收場租' : 'Rental paid'}</p>
          <p className="font-bold text-base">HK${totalRental.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-ink-soft">{locale === 'zh' ? '已收按金' : 'Deposit paid'}</p>
          <p className="font-bold text-base">HK${totalDeposit.toLocaleString()}</p>
        </div>
      </div>

      <ul className="space-y-2 text-xs">
        {payments.map((p, i) => (
          <li key={i} className="border-l-2 border-pink/40 pl-3 py-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono font-bold text-sm">HK${p.amount.toLocaleString()}</span>
              <span className="text-ink-soft">{METHOD_LABELS[p.method]?.[locale] || p.method}</span>
            </div>
            <div className="flex items-baseline gap-3 text-ink-soft mt-0.5">
              {(p.rentalAmount || 0) > 0 && (
                <span>{locale === 'zh' ? '場租 ' : 'Rental '}HK${p.rentalAmount.toLocaleString()}</span>
              )}
              {(p.depositAmount || 0) > 0 && (
                <span>{locale === 'zh' ? '按金 ' : 'Deposit '}HK${p.depositAmount.toLocaleString()}</span>
              )}
            </div>
            {p.note && (
              <p className="text-ink-soft italic mt-0.5">「{p.note}」</p>
            )}
            <p className="text-ink-soft text-[10px] mt-0.5">{fmtRecordedAt(p.recordedAt)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
