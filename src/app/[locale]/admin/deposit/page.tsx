'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { getAllBookings, updateBookingDepositRefund, creditLoyaltyPoints } from '@/lib/firestore';
import { BookingRecord } from '@/types';
import { venues } from '@/lib/venues';
import { Calculator, Check, Search, AlertCircle, Plus, Minus } from 'lucide-react';

const fixedDeductions = [
  { id: 'oven', label: { zh: '沒有關閉焗爐', en: 'Oven not turned off' }, amount: 2000 },
  { id: 'ac', label: { zh: '沒有關閉冷氣', en: 'AC not turned off' }, amount: 800 },
  { id: 'lights', label: { zh: '沒有關閉電燈', en: 'Lights not turned off' }, amount: 500 },
  { id: 'cookware', label: { zh: '沒有清洗爐具', en: 'Cookware not cleaned' }, amount: 500 },
  { id: 'mess', label: { zh: '嘔吐物/場地髒亂', en: 'Vomit/venue mess' }, amount: 800 },
  { id: 'ballpit', label: { zh: '波波池飲食違規', en: 'Ball pit food violation' }, amount: 1500 },
];

interface DynamicDeduction {
  label: string;
  amount: number;
}

export default function AdminDepositPage() {
  const locale = useLocale() as 'zh' | 'en';
  const [bookings, setBookings] = useState<BookingRecord[]>([]);
  const [selectedBooking, setSelectedBooking] = useState<BookingRecord | null>(null);
  const [selectedFixed, setSelectedFixed] = useState<string[]>([]);
  const [dynamicDeductions, setDynamicDeductions] = useState<DynamicDeduction[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    // Load both 'confirmed' (booking happened, awaiting deposit refund) AND
    // 'completed' (already settled, in case admin needs to revisit). Failing
    // queries should not stall the page: catch and log so loading flips off.
    Promise.all([
      getAllBookings('confirmed').catch((e) => { console.error(e); return []; }),
      getAllBookings('completed').catch((e) => { console.error(e); return []; }),
    ])
      .then(([confirmed, completed]) => setBookings([...confirmed, ...completed]))
      .finally(() => setLoading(false));
  }, []);

  const toggleFixed = (id: string) => {
    setSelectedFixed((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const addDynamic = () => {
    setDynamicDeductions([...dynamicDeductions, { label: '', amount: 0 }]);
  };

  const updateDynamic = (index: number, field: 'label' | 'amount', value: string | number) => {
    const updated = [...dynamicDeductions];
    if (field === 'amount') {
      updated[index].amount = Number(value);
    } else {
      updated[index].label = value as string;
    }
    setDynamicDeductions(updated);
  };

  const removeDynamic = (index: number) => {
    setDynamicDeductions(dynamicDeductions.filter((_, i) => i !== index));
  };

  const totalDeductions = () => {
    const fixedTotal = selectedFixed.reduce((sum, id) => {
      const item = fixedDeductions.find((d) => d.id === id);
      return sum + (item?.amount || 0);
    }, 0);
    const dynamicTotal = dynamicDeductions.reduce((sum, d) => sum + d.amount, 0);
    return fixedTotal + dynamicTotal;
  };

  const refundAmount = () => {
    if (!selectedBooking) return 0;
    return Math.max(0, selectedBooking.pricing.deposit - totalDeductions());
  };

  const handleSubmit = async () => {
    if (!selectedBooking) return;
    setSaving(true);

    const deductions = [
      ...selectedFixed.map((id) => {
        const item = fixedDeductions.find((d) => d.id === id)!;
        return { label: item.label[locale], amount: item.amount };
      }),
      ...dynamicDeductions.filter((d) => d.label && d.amount > 0),
    ];

    await updateBookingDepositRefund(selectedBooking.id, {
      amount: refundAmount(),
      deductions,
    });

    // Auto-credit loyalty points: $1 spent = 1 pt. Spending = rental
    // + add-ons (subtotal) PLUS any deducted security deposit (kept
    // by SPACO counts as additional spending per product spec).
    if (selectedBooking.userId) {
      const points = selectedBooking.pricing.subtotal + totalDeductions();
      await creditLoyaltyPoints(selectedBooking.userId, points);
    }

    setSaving(false);
    setSuccess(true);
    setTimeout(() => {
      setSuccess(false);
      setSelectedBooking(null);
      setSelectedFixed([]);
      setDynamicDeductions([]);
    }, 2000);
  };

  const filteredBookings = bookings.filter((b) => {
    if (!search) return true;
    const s = search.toLowerCase();
    const venue = venues.find((v) => v.id === b.venueId);
    return b.id.toLowerCase().includes(s) || b.date.includes(s) || venue?.name[locale].toLowerCase().includes(s);
  });

  return (
    <div>
      <h1 className="text-heading mb-8">{locale === 'zh' ? '按金結算' : 'Deposit Settlement'}</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left: Select Booking */}
        <div>
          <h2 className="text-lg font-bold mb-4">
            {locale === 'zh' ? '選擇已確認的預訂' : 'Select Confirmed Booking'}
          </h2>

          <div className="relative mb-4">
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={locale === 'zh' ? '搜尋...' : 'Search...'}
              className="w-full pl-11 pr-4 py-3 rounded-xl border border-charcoal/10 bg-white focus:outline-none focus:border-accent"
            />
          </div>

          {loading ? (
            <div className="animate-pulse text-muted">Loading...</div>
          ) : (
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {filteredBookings.map((booking) => {
                const venue = venues.find((v) => v.id === booking.venueId);
                const isSelected = selectedBooking?.id === booking.id;
                return (
                  <button
                    key={booking.id}
                    onClick={() => {
                      setSelectedBooking(booking);
                      setSelectedFixed([]);
                      setDynamicDeductions([]);
                      setSuccess(false);
                    }}
                    className={`w-full text-left p-4 rounded-2xl border transition-colors ${
                      isSelected ? 'border-accent bg-accent/5' : 'border-charcoal/5 bg-white hover:bg-cream'
                    }`}
                  >
                    <p className="font-medium">{venue?.name[locale]}</p>
                    <p className="text-sm text-muted">
                      {booking.date} | {booking.startTime}-{booking.endTime} | {booking.guestCount} {locale === 'zh' ? '人' : 'pax'}
                    </p>
                    <p className="text-sm font-semibold mt-1">
                      {locale === 'zh' ? '按金' : 'Deposit'}: HK${booking.pricing.deposit.toLocaleString()}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Deduction Calculator */}
        <div>
          {!selectedBooking ? (
            <div className="glass-card p-12 text-center">
              <Calculator size={48} className="mx-auto mb-4 text-charcoal/20" />
              <p className="text-muted">
                {locale === 'zh' ? '請先選擇預訂' : 'Select a booking to begin'}
              </p>
            </div>
          ) : success ? (
            <div className="bg-green-50 rounded-2xl p-12 text-center border border-green-200">
              <Check size={48} className="mx-auto mb-4 text-green-500" />
              <p className="text-green-700 font-semibold text-lg">
                {locale === 'zh' ? '按金結算完成！' : 'Deposit settlement complete!'}
              </p>
            </div>
          ) : (
            <div className="glass-card p-6 space-y-6">
              {/* Deposit Info */}
              <div className="bg-cream rounded-xl p-4">
                <p className="text-sm text-muted">{locale === 'zh' ? '原始按金' : 'Original Deposit'}</p>
                <p className="text-3xl font-bold">HK${selectedBooking.pricing.deposit.toLocaleString()}</p>
              </div>

              {/* Fixed Deductions */}
              <div>
                <h3 className="font-bold mb-3">{locale === 'zh' ? '固定扣費' : 'Fixed Deductions'}</h3>
                <div className="space-y-2">
                  {fixedDeductions.map((item) => (
                    <label
                      key={item.id}
                      className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-colors ${
                        selectedFixed.includes(item.id)
                          ? 'border-red-300 bg-red-50'
                          : 'border-charcoal/5 hover:bg-cream'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={selectedFixed.includes(item.id)}
                          onChange={() => toggleFixed(item.id)}
                          className="w-4 h-4 accent-red-500"
                        />
                        <span className="text-sm">{item.label[locale]}</span>
                      </div>
                      <span className="text-sm font-medium text-red-500">-HK${item.amount.toLocaleString()}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Dynamic Deductions */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold">{locale === 'zh' ? '自訂扣費' : 'Custom Deductions'}</h3>
                  <button onClick={addDynamic} className="flex items-center gap-1 text-sm text-accent hover:underline">
                    <Plus size={14} /> {locale === 'zh' ? '新增' : 'Add'}
                  </button>
                </div>
                {dynamicDeductions.map((item, i) => (
                  <div key={i} className="flex gap-2 mb-2">
                    <input
                      type="text"
                      value={item.label}
                      onChange={(e) => updateDynamic(i, 'label', e.target.value)}
                      placeholder={locale === 'zh' ? '扣費項目' : 'Description'}
                      className="flex-1 px-3 py-2 rounded-xl border border-charcoal/10 text-sm focus:outline-none focus:border-accent"
                    />
                    <input
                      type="number"
                      value={item.amount || ''}
                      onChange={(e) => updateDynamic(i, 'amount', e.target.value)}
                      placeholder="$"
                      className="w-24 px-3 py-2 rounded-xl border border-charcoal/10 text-sm focus:outline-none focus:border-accent"
                    />
                    <button onClick={() => removeDynamic(i)} className="w-10 h-10 rounded-xl bg-red-50 text-red-500 flex items-center justify-center">
                      <Minus size={14} />
                    </button>
                  </div>
                ))}
              </div>

              {/* Summary */}
              <div className="border-t border-charcoal/5 pt-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted">{locale === 'zh' ? '總扣費' : 'Total Deductions'}</span>
                  <span className="font-medium text-red-500">-HK${totalDeductions().toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-lg font-bold">
                  <span>{locale === 'zh' ? '退還金額' : 'Refund Amount'}</span>
                  <span className="text-green-600">HK${refundAmount().toLocaleString()}</span>
                </div>
              </div>

              {totalDeductions() > selectedBooking.pricing.deposit && (
                <div className="flex items-start gap-2 p-3 bg-red-50 rounded-xl text-sm text-red-600">
                  <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                  {locale === 'zh' ? '扣費超過按金總額，客人需額外付款。' : 'Deductions exceed deposit. Customer owes additional payment.'}
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={saving}
                className="w-full btn-primary justify-center py-3.5 disabled:opacity-50"
              >
                {saving ? '...' : (locale === 'zh' ? '確認結算並退還按金' : 'Confirm & Process Refund')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
