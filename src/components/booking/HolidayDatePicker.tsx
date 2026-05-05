'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { getHolidaysForMonth, getHoliday } from '@/lib/hkHolidays';

interface HolidayDatePickerProps {
  /** Currently-selected date in ISO `YYYY-MM-DD`, or empty string */
  value: string;
  onChange: (iso: string) => void;
  /** Earliest selectable date (ISO). Days before are disabled. */
  minDate?: string;
  locale: 'zh' | 'en';
}

/**
 * A booking-friendly date picker that highlights:
 *  - Today (pink ring)
 *  - Weekends (Fri/Sat — peak rate)
 *  - Public holidays (red filled chip with name)
 *  - Public holiday eves (orange ring — also peak rate)
 *  - Past dates (disabled, dimmed)
 *
 * Replaces the native `<input type="date">` so the user can see at a
 * glance why a particular day is on the peak tier.
 */
export default function HolidayDatePicker({
  value,
  onChange,
  minDate,
  locale,
}: HolidayDatePickerProps) {
  const [mounted, setMounted] = useState(false);
  // Calendar's currently-displayed month, ISO 'YYYY-MM'
  const [month, setMonth] = useState('');

  useEffect(() => {
    const now = new Date();
    setMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
    setMounted(true);
  }, []);

  // When `value` changes externally, jump the calendar to its month.
  useEffect(() => {
    if (!value) return;
    const ym = value.slice(0, 7);
    if (ym !== month) setMonth(ym);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const navigateMonth = (delta: number) => {
    if (!month) return;
    const [y, m] = month.split('-').map(Number);
    const next = new Date(y, m - 1 + delta);
    setMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`);
  };

  // Holidays for the visible month — keyed by ISO date
  const holidaysMap = useMemo(() => {
    if (!month) return new Map();
    return getHolidaysForMonth(month);
  }, [month]);

  // Build the days array for the month grid (with leading/trailing empties)
  const days = useMemo(() => {
    if (!month) return [] as (number | null)[];
    const [y, m] = month.split('-').map(Number);
    const firstDay = new Date(y, m - 1, 1).getDay();
    const daysInMonth = new Date(y, m, 0).getDate();
    const arr: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) arr.push(null);
    for (let i = 1; i <= daysInMonth; i++) arr.push(i);
    return arr;
  }, [month]);

  if (!mounted || !month) {
    // Static placeholder so SSR + first client render match
    return (
      <div className="glass-card p-5 animate-pulse h-[380px]" aria-busy="true" />
    );
  }

  const [year, monthNum] = month.split('-').map(Number);
  const monthLabel =
    locale === 'zh'
      ? `${year}年${monthNum}月`
      : new Date(year, monthNum - 1).toLocaleDateString('en', {
          month: 'long',
          year: 'numeric',
        });

  const weekdayLabels =
    locale === 'zh'
      ? ['日', '一', '二', '三', '四', '五', '六']
      : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const todayStr = new Date().toISOString().split('T')[0];
  const isoOf = (day: number) =>
    `${year}-${String(monthNum).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  // Holiday on the day AFTER `iso` (used to flag holiday eves)
  const eveHoliday = (iso: string) => {
    const d = new Date(iso);
    d.setDate(d.getDate() + 1);
    return getHoliday(d.toISOString().split('T')[0]);
  };

  const isPastOrBlocked = (iso: string) => {
    if (minDate && iso < minDate) return true;
    return iso < todayStr;
  };

  const monthHolidays = Array.from(holidaysMap.values()) as Array<{
    date: string;
    type: string;
    name: { zh: string; en: string };
  }>;

  return (
    <div className="glass-card p-4 md:p-5">
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={() => navigateMonth(-1)}
          className="w-9 h-9 rounded-full bg-white/60 border border-white/80 flex items-center justify-center hover:bg-white/90 hover:text-pink transition-colors text-ink-soft"
          aria-label="Previous month"
        >
          <ChevronLeft size={16} />
        </button>
        <h3 className="text-base font-bold font-display text-ink">{monthLabel}</h3>
        <button
          type="button"
          onClick={() => navigateMonth(1)}
          className="w-9 h-9 rounded-full bg-white/60 border border-white/80 flex items-center justify-center hover:bg-white/90 hover:text-pink transition-colors text-ink-soft"
          aria-label="Next month"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 mb-1">
        {weekdayLabels.map((d, i) => (
          <div
            key={d}
            className={`text-center py-1 text-[10px] font-bold uppercase tracking-wider ${
              i === 0 || i === 6 ? 'text-pink' : 'text-ink-soft'
            }`}
          >
            {d}
          </div>
        ))}
      </div>

      {/* Days grid */}
      <div className="grid grid-cols-7 gap-1">
        {days.map((day, i) => {
          if (!day) return <div key={i} />;
          const iso = isoOf(day);
          const holiday = holidaysMap.get(iso);
          const isPublicHoliday = holiday?.type === 'public';
          const isFestival = holiday?.type === 'festival';
          const eve = eveHoliday(iso);
          const isHolidayEve = eve?.type === 'public';
          const dow = new Date(iso).getDay();
          const isFriOrSat = dow === 5 || dow === 6;
          const isToday = iso === todayStr;
          const isSelected = iso === value;
          const disabled = isPastOrBlocked(iso);

          // Style precedence: disabled → selected → public holiday → eve → fri/sat → default
          let cls = '';
          let dotCls = '';
          if (disabled) {
            cls = 'text-ink-soft/30 cursor-not-allowed bg-transparent';
          } else if (isSelected) {
            cls = 'bg-gradient-pink text-white font-bold shadow-glow';
          } else if (isPublicHoliday) {
            cls = 'bg-rose-100/80 text-rose-700 font-bold border border-rose-300 hover:bg-rose-200';
            dotCls = 'bg-rose-500';
          } else if (isHolidayEve) {
            cls = 'bg-orange-100/70 text-orange-700 font-semibold border border-orange-300 hover:bg-orange-200';
            dotCls = 'bg-orange-500';
          } else if (isFriOrSat) {
            cls = 'bg-pink/10 text-ink hover:bg-pink/20 font-semibold';
          } else if (isFestival) {
            cls = 'text-ink hover:bg-white/80 font-medium';
            dotCls = 'bg-orange-300';
          } else {
            cls = 'text-ink hover:bg-white/80';
          }

          const ringCls = isToday && !isSelected ? 'ring-2 ring-pink/60' : '';

          return (
            <button
              key={i}
              type="button"
              onClick={() => !disabled && onChange(iso)}
              disabled={disabled}
              title={
                holiday
                  ? holiday.name[locale]
                  : isHolidayEve && eve
                  ? `${locale === 'zh' ? '假期前夕：明日為' : 'Eve of '}${eve.name[locale]}`
                  : undefined
              }
              className={`relative aspect-square rounded-xl text-sm flex flex-col items-center justify-center transition-all ${cls} ${ringCls}`}
            >
              <span>{day}</span>
              {dotCls && (
                <span className={`absolute bottom-1 w-1.5 h-1.5 rounded-full ${dotCls}`} />
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1.5 text-[10px] text-ink-soft pt-3 border-t border-white/50">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-rose-100/80 border border-rose-300" />
          {locale === 'zh' ? '公眾假期' : 'Public Holiday'}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-orange-100/70 border border-orange-300" />
          {locale === 'zh' ? '假期前夕' : 'Holiday Eve'}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-pink/10" />
          {locale === 'zh' ? '週五/六' : 'Fri / Sat'}
        </span>
        <span className="inline-flex items-center gap-1.5 ml-auto text-pink font-medium">
          {locale === 'zh' ? '⭐ 上述日子按高峰價' : '⭐ Peak rate applies'}
        </span>
      </div>

      {/* This-month holiday list */}
      {monthHolidays.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-3 space-y-1"
        >
          <p className="text-[10px] text-ink-soft font-semibold uppercase tracking-wider">
            {locale === 'zh' ? '本月假期' : 'Holidays this month'}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {monthHolidays.map((h) => (
              <button
                key={h.date}
                type="button"
                onClick={() => !isPastOrBlocked(h.date) && onChange(h.date)}
                disabled={isPastOrBlocked(h.date)}
                className={`text-[11px] px-2.5 py-1 rounded-pill font-medium border ${
                  h.type === 'public'
                    ? 'bg-rose-100/80 text-rose-700 border-rose-300'
                    : 'bg-orange-100/70 text-orange-700 border-orange-300'
                } ${isPastOrBlocked(h.date) ? 'opacity-40 cursor-not-allowed' : 'hover:scale-105 transition-transform'}`}
                title={h.date}
              >
                {h.date.slice(8)}/{h.date.slice(5, 7)} · {h.name[locale]}
              </button>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}
