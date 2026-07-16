'use client';

import { adminApiFetch } from '@/lib/adminApiFetch';
import { useEffect, useState, useMemo } from 'react';
import { useLocale } from 'next-intl';
import Link from 'next/link';
import {
  getBookingsForMonth,
  createSharedBlockedSlot,
  getBlockedSlotsForMonth,
  getCalendarEventsForMonth,
  deleteBlockedSlot,
  getAllUsers,
} from '@/lib/firestore';
import { BookingRecord, BlockedSlot, CalendarEvent } from '@/types';
import { venues } from '@/lib/venues';
import { formatAddOnsForStaff } from '@/lib/pricing';
import {
  ChevronLeft, ChevronRight, Lock, Calendar, Eye, Truck, Trash2,
  ExternalLink, Plus, X, Package,
} from 'lucide-react';
import { getHolidaysForMonth, Holiday } from '@/lib/hkHolidays';

const timeSlots = Array.from({ length: 14 }, (_, i) => `${String(i + 10).padStart(2, '0')}:00`);

// Sheung Wan group — sw-a / sw-b / sw-ab share one physical floor.
// Heidi's 2026-06 ask: collapse to a single 上環店 filter so the day view
// shows all three rooms' bookings together (otherwise picking sw-a hides
// any sw-b or sw-ab booking on the same day, which is misleading since
// they all reserve the same physical space).
const SW_GROUP_ID = 'sw-group';
const SW_GROUP_IDS = ['sw-a', 'sw-b', 'sw-ab'];
function isSwGroupVenue(id: string): boolean {
  return SW_GROUP_IDS.includes(id);
}

type AddType = 'block' | 'site_visit' | 'delivery';

type DayItem =
  | { kind: 'booking'; sortTime: string; data: BookingRecord }
  | { kind: 'block';   sortTime: string; data: BlockedSlot }
  | { kind: 'gcal';    sortTime: string; data: BlockedSlot }
  | { kind: 'event';   sortTime: string; data: CalendarEvent };

// Map venue id to a short, cleaner-friendly tag for display
function venueTag(venueId: string): string {
  if (venueId === 'cwb') return 'CWB';
  if (venueId === 'wanchai') return 'WC';
  if (venueId === 'tst') return 'TST';
  if (venueId === 'sw-a') return 'SW-A';
  if (venueId === 'sw-b') return 'SW-B';
  if (venueId === 'sw-ab') return 'SW';
  return venueId.toUpperCase();
}

// Booking customer identifier — prefer member display name (most
// helpful for CS scanning the day view), fall back to phone last-4
// when the profile has no name, then short booking id.
function bookingIdent(b: BookingRecord, userNames?: Record<string, string>): string {
  const name = userNames?.[b.userId];
  if (name) return name;
  if (b.whatsappPhone) {
    const digits = b.whatsappPhone.replace(/\D/g, '');
    if (digits.length >= 4) return digits.slice(-4);
  }
  return b.id.slice(0, 4);
}

export default function AdminCalendarPage() {
  const locale = useLocale() as 'zh' | 'en';
  const [mounted, setMounted] = useState(false);
  const [currentMonth, setCurrentMonth] = useState<string>('');
  const [todayStr, setTodayStr] = useState<string>('');
  const [selectedVenue, setSelectedVenue] = useState('all');
  const [bookings, setBookings] = useState<BookingRecord[]>([]);
  const [blockedSlots, setBlockedSlots] = useState<BlockedSlot[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  // Day summary modal — shown when admin clicks any day cell
  const [summaryDate, setSummaryDate] = useState<string | null>(null);

  // Add modal — opened from day summary "+ Add" button
  const [addModal, setAddModal] = useState<{ date: string } | null>(null);
  const [addType, setAddType] = useState<AddType>('block');
  const [addStart, setAddStart] = useState('10:00');
  const [addEnd, setAddEnd] = useState('14:00');
  const [addVenue, setAddVenue] = useState<string>('cwb');
  const [addNotes, setAddNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Details modal — opened from clicking an item in the day summary
  const [detailsModal, setDetailsModal] = useState<DayItem | null>(null);

  useEffect(() => {
    const now = new Date();
    setCurrentMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
    setTodayStr(now.toISOString().split('T')[0]);
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!currentMonth) return;
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMonth, selectedVenue]);

  const loadData = async () => {
    setLoading(true);
    // Pull uid → displayName once so the day-view popup can label
    // bookings by member name (Heidi's 2026-05-23 spec — CS scans
    // by name, not phone digits). Fire in parallel with the rest.
    const namesPromise = getAllUsers().then((users) => {
      const map: Record<string, string> = {};
      for (const u of users as Array<{ uid: string; displayName?: string; email?: string }>) {
        const name = u.displayName || u.email?.split('@')[0] || '';
        if (name) map[u.uid] = name;
      }
      return map;
    });
    if (selectedVenue === 'all') {
      const [bookingData, allSlots, eventData, names] = await Promise.all([
        getBookingsForMonth(currentMonth),
        Promise.all(venues.map((v) => getBlockedSlotsForMonth(v.id, currentMonth))),
        getCalendarEventsForMonth(currentMonth),
        namesPromise,
      ]);
      setBookings(bookingData);
      setBlockedSlots(allSlots.flat());
      setCalendarEvents(eventData);
      setUserNames(names);
    } else if (selectedVenue === SW_GROUP_ID) {
      // 上環店 (group): pull all 3 sub-rooms' slots + filter bookings/events.
      const [bookingData, swSlots, eventData, names] = await Promise.all([
        getBookingsForMonth(currentMonth),
        Promise.all(SW_GROUP_IDS.map((vid) => getBlockedSlotsForMonth(vid, currentMonth))),
        getCalendarEventsForMonth(currentMonth),
        namesPromise,
      ]);
      setBookings(bookingData.filter((b) => isSwGroupVenue(b.venueId)));
      setBlockedSlots(swSlots.flat());
      setCalendarEvents(eventData.filter((e) => isSwGroupVenue(e.venueId)));
      setUserNames(names);
    } else {
      const [bookingData, slotData, eventData, names] = await Promise.all([
        getBookingsForMonth(currentMonth),
        getBlockedSlotsForMonth(selectedVenue, currentMonth),
        getCalendarEventsForMonth(currentMonth),
        namesPromise,
      ]);
      setBookings(bookingData.filter((b) => b.venueId === selectedVenue));
      setBlockedSlots(slotData);
      setCalendarEvents(eventData.filter((e) => e.venueId === selectedVenue));
      setUserNames(names);
    }
    setLoading(false);
  };

  const calendarDays = useMemo(() => {
    if (!currentMonth) return [];
    const [year, month] = currentMonth.split('-').map(Number);
    const firstDay = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    const days: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(i);
    return days;
  }, [currentMonth]);

  const monthLabel = useMemo(() => {
    if (!currentMonth) return '';
    const [year, month] = currentMonth.split('-').map(Number);
    const date = new Date(year, month - 1);
    return locale === 'zh'
      ? `${year}年${month}月`
      : date.toLocaleDateString('en', { month: 'long', year: 'numeric' });
  }, [currentMonth, locale]);

  const holidaysMap = useMemo(() => {
    if (!currentMonth) return new Map<string, Holiday>();
    return getHolidaysForMonth(currentMonth);
  }, [currentMonth]);

  const getDateString = (day: number) => `${currentMonth}-${String(day).padStart(2, '0')}`;

  // Build the list of items for a single day, deduping gcal events by
  // googleEventId (one Google event = one row, even if it spawned 3 SW
  // venue variants in blocked_slots). Sorted by start time.
  const getDayItems = useMemo(() => {
    return (date: string): DayItem[] => {
      const items: DayItem[] = [];
      // Master calendar shows only LIVE bookings — Heidi's 2026-05-23
      // spec: cancelled / payment_not_completed shouldn't clutter the
      // day-view popup since they don't reserve the slot anymore.
      bookings
        .filter((b) =>
          b.date === date
          && b.status !== 'cancelled'
          && b.status !== 'payment_not_completed',
        )
        .forEach((b) => items.push({ kind: 'booking', sortTime: b.startTime, data: b }));

      blockedSlots
        .filter((s) => s.date === date && s.reason === 'admin_block')
        .forEach((s) => items.push({ kind: 'block', sortTime: s.startTime, data: s }));

      // Dedupe gcal: one row per googleEventId. Prefer the sw-ab variant for
      // SW (full floor) so the venue label is most informative; otherwise
      // take the first occurrence.
      const gcalByEventId = new Map<string, BlockedSlot>();
      blockedSlots
        .filter((s) => s.date === date && s.reason === 'gcal' && s.googleEventId)
        .forEach((s) => {
          const existing = gcalByEventId.get(s.googleEventId!);
          if (!existing) {
            gcalByEventId.set(s.googleEventId!, s);
          } else if (s.venueId === 'sw-ab') {
            // Prefer the full-floor variant as the representative row
            gcalByEventId.set(s.googleEventId!, s);
          }
        });
      gcalByEventId.forEach((s) =>
        items.push({ kind: 'gcal', sortTime: s.startTime, data: s }),
      );

      calendarEvents
        .filter((e) => e.date === date)
        .forEach((e) => items.push({ kind: 'event', sortTime: e.startTime, data: e }));

      return items.sort((a, b) => a.sortTime.localeCompare(b.sortTime));
    };
  }, [bookings, blockedSlots, calendarEvents]);

  const navigateMonth = (delta: number) => {
    if (!currentMonth) return;
    const [year, month] = currentMonth.split('-').map(Number);
    const newDate = new Date(year, month - 1 + delta);
    setCurrentMonth(`${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, '0')}`);
  };

  const openAddFromSummary = () => {
    if (!summaryDate) return;
    setAddType('block');
    setAddStart('10:00');
    setAddEnd('14:00');
    // For the SW group filter, default the new-block target to sw-ab
    // (full floor) since blocking the whole space is most common; admin
    // can pick a sub-room from the venue picker. 'all' falls back to CWB.
    setAddVenue(
      selectedVenue === 'all' ? 'cwb'
        : selectedVenue === SW_GROUP_ID ? 'sw-ab'
          : selectedVenue,
    );
    setAddNotes('');
    setSubmitError(null);
    setAddModal({ date: summaryDate });
  };

  const handleSubmitAdd = async () => {
    if (!addModal) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      // 'sw-group' isn't a real venue id — admin picks a specific sub-room
      // via addVenue from the dropdown below (which always shows for SW group).
      const targetVenue =
        selectedVenue === 'all' || selectedVenue === SW_GROUP_ID
          ? addVenue
          : selectedVenue;
      if (addType === 'block') {
        await createSharedBlockedSlot({
          venueId: targetVenue,
          date: addModal.date,
          startTime: addStart,
          endTime: addEnd,
          reason: 'admin_block',
          bookingId: null,
        });
      } else {
        const res = await adminApiFetch('/api/calendar-events', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            type: addType,
            venueId: targetVenue,
            date: addModal.date,
            startTime: addStart,
            endTime: addEnd,
            notes: addNotes,
          }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || `HTTP ${res.status}`);
        }
      }
      setAddModal(null);
      await loadData();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteItem = async () => {
    if (!detailsModal) return;
    setSubmitting(true);
    try {
      if (detailsModal.kind === 'block') {
        await deleteBlockedSlot(detailsModal.data.id);
      } else if (detailsModal.kind === 'event') {
        const res = await adminApiFetch(`/api/calendar-events/${detailsModal.data.id}`, { method: 'DELETE' });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || `HTTP ${res.status}`);
        }
      }
      setDetailsModal(null);
      await loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const weekdays = locale === 'zh'
    ? ['日', '一', '二', '三', '四', '五', '六']
    : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  if (!mounted) {
    return (
      <div>
        <div className="mb-8">
          <span className="chip mb-3">Calendar</span>
          <h1 className="text-heading font-display text-ink">{locale === 'zh' ? '總日曆' : 'Master Calendar'}</h1>
        </div>
        <div className="animate-pulse text-ink-soft p-8 text-center">Loading...</div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <span className="chip mb-3">Calendar</span>
        <h1 className="text-heading font-display text-ink">{locale === 'zh' ? '總日曆' : 'Master Calendar'}</h1>
      </div>

      {/* Controls */}
      <div className="flex flex-col md:flex-row gap-4 mb-6">
        <select
          value={selectedVenue}
          onChange={(e) => setSelectedVenue(e.target.value)}
          className="px-5 py-3 rounded-pill bg-white/70 backdrop-blur-md border border-white/80 text-ink focus:outline-none focus:border-pink/50 focus:bg-white"
        >
          <option value="all">{locale === 'zh' ? '全部分店' : 'All Venues'}</option>
          {/* Hide the 3 SW sub-rooms — they're shown as a single 上環店 entry
              below since they share one physical floor (Heidi 2026-06). */}
          {venues
            .filter((v) => !isSwGroupVenue(v.id))
            .map((v) => (
              <option key={v.id} value={v.id}>{v.name[locale]}</option>
            ))}
          <option value={SW_GROUP_ID}>{locale === 'zh' ? '上環店' : 'Sheung Wan'}</option>
        </select>

        <div className="flex items-center gap-4 ml-auto">
          <button onClick={() => navigateMonth(-1)} className="w-10 h-10 rounded-xl bg-white/60 backdrop-blur-md border border-white/70 flex items-center justify-center hover:bg-cream transition-colors">
            <ChevronLeft size={18} />
          </button>
          <span className="text-lg font-bold min-w-[160px] text-center">{monthLabel}</span>
          <button onClick={() => navigateMonth(1)} className="w-10 h-10 rounded-xl bg-white/60 backdrop-blur-md border border-white/70 flex items-center justify-center hover:bg-cream transition-colors">
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-2 mb-6 text-sm">
        <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-green-400" /> {locale === 'zh' ? '已確認' : 'Confirmed'}</span>
        <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-yellow-400" /> {locale === 'zh' ? '待處理' : 'Pending'}</span>
        <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-gray-400" /> {locale === 'zh' ? '已封鎖' : 'Blocked'}</span>
        <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-blue-300" /> {locale === 'zh' ? 'Google 日曆' : 'Google Calendar'}</span>
        <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-purple-300" /> Site Visit</span>
        <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-orange-300" /> Delivery</span>
        <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-rose-500" /> {locale === 'zh' ? '公眾假期' : 'Public Holiday'}</span>
      </div>

      {/* Calendar Grid */}
      {loading ? (
        <div className="animate-pulse text-muted p-8 text-center">Loading...</div>
      ) : (
        <div className="glass-card overflow-hidden">
          <div className="grid grid-cols-7 border-b border-charcoal/5">
            {weekdays.map((day) => (
              <div key={day} className="text-center py-3 text-xs font-semibold text-muted uppercase">{day}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {calendarDays.map((day, i) => {
              if (!day) return <div key={i} className="min-h-[130px] border-b border-r border-charcoal/5 bg-charcoal/[0.02]" />;
              const dateStr = getDateString(day);
              const items = getDayItems(dateStr);
              const isToday = todayStr !== '' && dateStr === todayStr;
              const holiday = holidaysMap.get(dateStr);
              const isPublicHoliday = holiday?.type === 'public';
              return (
                <div
                  key={i}
                  className={`min-h-[130px] border-b border-r border-charcoal/5 p-2 cursor-pointer transition-colors ${
                    isToday ? 'bg-pink/10' : isPublicHoliday ? 'bg-rose-50/60 hover:bg-rose-100/60' : 'hover:bg-white/40'
                  }`}
                  onClick={() => setSummaryDate(dateStr)}
                >
                  <div className="flex items-baseline justify-between mb-1">
                    <span className={`text-sm font-medium ${
                      isToday ? 'text-pink font-bold' : isPublicHoliday ? 'text-rose-600 font-bold' : 'text-ink'
                    }`}>
                      {day}
                    </span>
                    {holiday && (
                      <span
                        title={holiday.name[locale]}
                        className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full leading-none truncate max-w-[68%] ${
                          holiday.type === 'public' ? 'bg-rose-500 text-white' : 'bg-orange-300 text-orange-900'
                        }`}
                      >
                        {holiday.name[locale]}
                      </span>
                    )}
                  </div>
                  <div className="space-y-1">
                    {items.slice(0, 4).map((item, idx) => (
                      <DayItemPill key={`${item.kind}-${idx}`} item={item} userNames={userNames} />
                    ))}
                    {items.length > 4 && (
                      <div className="text-[10px] text-ink-soft px-1.5">
                        +{items.length - 4} {locale === 'zh' ? '更多' : 'more'}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Day summary modal */}
      {summaryDate && (
        <DaySummaryModal
          date={summaryDate}
          items={getDayItems(summaryDate)}
          locale={locale}
          holiday={holidaysMap.get(summaryDate)}
          userNames={userNames}
          onClose={() => setSummaryDate(null)}
          onAdd={openAddFromSummary}
          onItemClick={(item) => setDetailsModal(item)}
        />
      )}

      {/* Add modal */}
      {addModal && (
        <AddModal
          date={addModal.date}
          locale={locale}
          selectedVenue={selectedVenue}
          addType={addType}
          setAddType={setAddType}
          addStart={addStart}
          setAddStart={setAddStart}
          addEnd={addEnd}
          setAddEnd={setAddEnd}
          addVenue={addVenue}
          setAddVenue={setAddVenue}
          addNotes={addNotes}
          setAddNotes={setAddNotes}
          submitting={submitting}
          submitError={submitError}
          onSubmit={handleSubmitAdd}
          onClose={() => !submitting && setAddModal(null)}
        />
      )}

      {/* Details modal */}
      {detailsModal && (
        <DetailsModal
          item={detailsModal}
          locale={locale}
          submitting={submitting}
          onClose={() => setDetailsModal(null)}
          onDelete={handleDeleteItem}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Day cell pill — informative single line
// ──────────────────────────────────────────────────────────

function DayItemPill({ item, userNames }: { item: DayItem; userNames?: Record<string, string> }) {
  if (item.kind === 'booking') {
    const b = item.data;
    const cls =
      b.status === 'confirmed'   ? 'bg-green-100 text-green-700' :
      b.status === 'pending'     ? 'bg-yellow-100 text-yellow-700' :
      b.status === 'cancelled'   ? 'bg-red-50 text-red-500 line-through opacity-60' :
                                   'bg-gray-100 text-gray-600';
    return (
      <div className={`text-[10px] px-1.5 py-0.5 rounded truncate ${cls}`}>
        {b.startTime} {venueTag(b.venueId)} · {bookingIdent(b, userNames)}
      </div>
    );
  }
  if (item.kind === 'block') {
    return (
      <div className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 flex items-center gap-1 truncate" title="Manual block">
        <Lock size={8} className="shrink-0" />
        <span className="truncate">{item.data.startTime} {venueTag(item.data.venueId)}</span>
      </div>
    );
  }
  if (item.kind === 'gcal') {
    const s = item.data;
    const venueLabel = s.venueId === 'sw-ab' ? 'SW' : venueTag(s.venueId);
    return (
      <div className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 flex items-center gap-1 truncate" title={s.googleEventTitle || 'Google Calendar'}>
        <Calendar size={8} className="shrink-0" />
        <span className="truncate">
          {s.startTime} {venueLabel}
          {s.googleEventTitle ? ` · ${s.googleEventTitle}` : ''}
        </span>
      </div>
    );
  }
  // event: site_visit | delivery
  const ev = item.data;
  const isVisit = ev.type === 'site_visit';
  const cls = isVisit ? 'bg-purple-100 text-purple-700' : 'bg-orange-100 text-orange-700';
  const Icon = isVisit ? Eye : Truck;
  const label = isVisit ? 'Site visit' : 'Delivery';
  return (
    <div className={`text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1 truncate ${cls}`} title={ev.notes || label}>
      <Icon size={8} className="shrink-0" />
      <span className="truncate">
        {ev.startTime} {venueTag(ev.venueId)} · {label}
        {ev.notes ? ` ${ev.notes}` : ''}
      </span>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Day summary modal — list every item for the day, click to drill
// ──────────────────────────────────────────────────────────

function DaySummaryModal({
  date, items, locale, holiday, userNames, onClose, onAdd, onItemClick,
}: {
  date: string;
  items: DayItem[];
  locale: 'zh' | 'en';
  holiday?: Holiday;
  userNames: Record<string, string>;
  onClose: () => void;
  onAdd: () => void;
  onItemClick: (item: DayItem) => void;
}) {
  const dateObj = new Date(date + 'T00:00:00');
  const weekday = locale === 'zh'
    ? ['日', '一', '二', '三', '四', '五', '六'][dateObj.getDay()]
    : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dateObj.getDay()];
  const dateLabel = locale === 'zh'
    ? `${dateObj.getFullYear()}年${dateObj.getMonth() + 1}月${dateObj.getDate()}日`
    : dateObj.toLocaleDateString('en', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <>
      <div className="fixed inset-0 bg-charcoal/50 z-50" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 glass-strong rounded-3xl p-6 shadow-glass-lg w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
        <div className="flex items-start justify-between mb-1">
          <div>
            <h3 className="text-lg font-bold font-display text-ink">{dateLabel}</h3>
            <p className="text-sm text-ink-soft">
              {locale === 'zh' ? `星期${weekday}` : weekday}
              {holiday && <span className="ml-2 text-rose-500">· {holiday.name[locale]}</span>}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-white/60 flex items-center justify-center">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto -mx-2 px-2 mt-3">
          {items.length === 0 ? (
            <p className="text-sm text-ink-soft text-center py-8">
              {locale === 'zh' ? '當日無排程' : 'Nothing scheduled'}
            </p>
          ) : (
            <ul className="space-y-2">
              {items.map((item, idx) => (
                <li key={idx}>
                  <button
                    onClick={() => onItemClick(item)}
                    className="w-full text-left p-3 rounded-2xl bg-white/60 hover:bg-white/90 transition-colors flex items-start gap-3"
                  >
                    <SummaryItemDot item={item} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink">
                        <SummaryItemTitle item={item} locale={locale} userNames={userNames} />
                      </p>
                      <SummaryItemMeta item={item} locale={locale} />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4 pt-4 border-t border-charcoal/10">
          <button onClick={onAdd} className="w-full btn-primary justify-center">
            <Plus size={16} />
            {locale === 'zh' ? '新增排程' : 'Add event'}
          </button>
        </div>
      </div>
    </>
  );
}

function SummaryItemDot({ item }: { item: DayItem }) {
  let cls = 'bg-gray-400';
  if (item.kind === 'booking') {
    cls = item.data.status === 'confirmed' ? 'bg-green-400'
      : item.data.status === 'pending' ? 'bg-yellow-400'
      : item.data.status === 'cancelled' ? 'bg-red-400'
      : 'bg-gray-400';
  } else if (item.kind === 'block') {
    cls = 'bg-gray-500';
  } else if (item.kind === 'gcal') {
    cls = 'bg-blue-400';
  } else if (item.kind === 'event') {
    cls = item.data.type === 'site_visit' ? 'bg-purple-400' : 'bg-orange-400';
  }
  return <span className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${cls}`} />;
}

function SummaryItemTitle({ item, locale, userNames }: { item: DayItem; locale: 'zh' | 'en'; userNames?: Record<string, string> }) {
  const timeRange = `${item.sortTime}–${
    item.kind === 'booking' ? item.data.endTime
    : item.kind === 'event' ? item.data.endTime
    : (item.data as BlockedSlot).endTime
  }`;
  if (item.kind === 'booking') {
    return <>{timeRange}  <span className="font-semibold">{venueTag(item.data.venueId)}</span>  · {bookingIdent(item.data, userNames)}  · {item.data.guestCount}p</>;
  }
  if (item.kind === 'block') {
    return <>{timeRange}  <span className="font-semibold">{venueTag(item.data.venueId)}</span>  · {locale === 'zh' ? '人手封鎖' : 'Manual block'}</>;
  }
  if (item.kind === 'gcal') {
    const s = item.data;
    const venueLabel = s.venueId === 'sw-ab' ? 'SW' : venueTag(s.venueId);
    return <>{timeRange}  <span className="font-semibold">{venueLabel}</span>  · {s.googleEventTitle || 'Google Calendar'}</>;
  }
  // event
  const ev = item.data;
  const label = ev.type === 'site_visit' ? 'Site visit' : 'Delivery';
  return <>{timeRange}  <span className="font-semibold">{venueTag(ev.venueId)}</span>  · {label}</>;
}

function SummaryItemMeta({ item, locale }: { item: DayItem; locale: 'zh' | 'en' }) {
  if (item.kind === 'booking') {
    const b = item.data;
    const status = b.status === 'confirmed' ? (locale === 'zh' ? '已確認' : 'Confirmed')
      : b.status === 'pending' ? (locale === 'zh' ? '待處理' : 'Pending')
      : b.status === 'cancelled' ? (locale === 'zh' ? '已取消' : 'Cancelled')
      : b.status;
    const addOnsLine = formatAddOnsForStaff(b.addOns, locale);
    return (
      <>
        <p className="text-xs text-ink-soft mt-0.5">
          {b.whatsappPhone || '—'} · {status}
        </p>
        {addOnsLine && (
          <p className="text-xs text-violet-700 mt-1 flex items-start gap-1">
            <Package size={11} className="mt-0.5 shrink-0" />
            <span className="line-clamp-2">{addOnsLine}</span>
          </p>
        )}
      </>
    );
  }
  if (item.kind === 'gcal') {
    return item.data.googleEventDescription
      ? <p className="text-xs text-ink-soft mt-0.5 line-clamp-2 whitespace-pre-line">{item.data.googleEventDescription}</p>
      : null;
  }
  if (item.kind === 'event') {
    return item.data.notes
      ? <p className="text-xs text-ink-soft mt-0.5 line-clamp-2 whitespace-pre-line">{item.data.notes}</p>
      : null;
  }
  return null;
}

// ──────────────────────────────────────────────────────────
// Add modal (extracted)
// ──────────────────────────────────────────────────────────

function AddModal(props: {
  date: string;
  locale: 'zh' | 'en';
  selectedVenue: string;
  addType: AddType; setAddType: (t: AddType) => void;
  addStart: string;  setAddStart: (s: string) => void;
  addEnd: string;    setAddEnd: (s: string) => void;
  addVenue: string;  setAddVenue: (s: string) => void;
  addNotes: string;  setAddNotes: (s: string) => void;
  submitting: boolean;
  submitError: string | null;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const {
    date, locale, selectedVenue,
    addType, setAddType, addStart, setAddStart, addEnd, setAddEnd,
    addVenue, setAddVenue, addNotes, setAddNotes,
    submitting, submitError, onSubmit, onClose,
  } = props;

  return (
    <>
      <div className="fixed inset-0 bg-charcoal/50 z-[60]" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[60] glass-strong rounded-3xl p-8 shadow-glass-lg w-full max-w-md mx-4">
        <h3 className="text-lg font-bold font-display mb-1 text-ink">
          {locale === 'zh' ? '新增排程' : 'Add event'}
        </h3>
        <p className="text-sm text-ink-soft mb-4">{date}</p>

        <div className="grid grid-cols-3 gap-2 mb-5 p-1 bg-white/40 rounded-2xl">
          <TypeTab active={addType === 'block'} onClick={() => setAddType('block')} icon={<Lock size={14} />} label={locale === 'zh' ? '封鎖' : 'Block'} />
          <TypeTab active={addType === 'site_visit'} onClick={() => setAddType('site_visit')} icon={<Eye size={14} />} label="Site Visit" />
          <TypeTab active={addType === 'delivery'} onClick={() => setAddType('delivery')} icon={<Truck size={14} />} label="Delivery" />
        </div>

        {(selectedVenue === 'all' || selectedVenue === SW_GROUP_ID) && (
          <div className="mb-4">
            <label className="text-sm text-ink-soft mb-1 block">{locale === 'zh' ? '分店' : 'Venue'}</label>
            <select value={addVenue} onChange={(e) => setAddVenue(e.target.value)} className="w-full px-4 py-2.5 rounded-pill bg-white/70 backdrop-blur-md border border-white/80 text-ink">
              {/* When 上環店 filter is active, narrow the picker to the 3 SW
                  sub-rooms so admin chooses A / B / A+B for the manual block. */}
              {venues
                .filter((v) => selectedVenue === SW_GROUP_ID ? isSwGroupVenue(v.id) : true)
                .map((v) => (
                  <option key={v.id} value={v.id}>{v.name[locale]}</option>
                ))}
            </select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="text-sm text-ink-soft mb-1 block">{locale === 'zh' ? '開始' : 'Start'}</label>
            <select value={addStart} onChange={(e) => setAddStart(e.target.value)} className="w-full px-4 py-2.5 rounded-pill bg-white/70 backdrop-blur-md border border-white/80 text-ink">
              {timeSlots.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm text-ink-soft mb-1 block">{locale === 'zh' ? '結束' : 'End'}</label>
            <select value={addEnd} onChange={(e) => setAddEnd(e.target.value)} className="w-full px-4 py-2.5 rounded-pill bg-white/70 backdrop-blur-md border border-white/80 text-ink">
              {timeSlots.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        {addType !== 'block' && (
          <div className="mb-4">
            <label className="text-sm text-ink-soft mb-1 block">{locale === 'zh' ? '備註' : 'Notes'}</label>
            <textarea
              value={addNotes}
              onChange={(e) => setAddNotes(e.target.value)}
              rows={2}
              className="w-full px-4 py-2.5 rounded-2xl bg-white/70 backdrop-blur-md border border-white/80 text-ink"
              placeholder={addType === 'site_visit'
                ? (locale === 'zh' ? '客人姓名 / 聯絡 / 備註…' : 'Customer name / contact / notes…')
                : (locale === 'zh' ? '送貨內容 / 對方聯絡…' : 'Delivery content / contact…')}
            />
          </div>
        )}

        {addType !== 'block' && (
          <p className="text-[11px] text-ink-soft mb-4 leading-relaxed">
            {locale === 'zh'
              ? '⚠️ Site Visit / Delivery 唔會 block 客人預訂，會 push 上 Google Calendar 畀 cleaner 睇。'
              : '⚠️ Site Visit / Delivery do NOT block customer bookings — pushed to Google Calendar for cleaner visibility.'}
          </p>
        )}

        {submitError && <p className="text-xs text-red-600 mb-3">{submitError}</p>}

        <div className="flex gap-3">
          <button onClick={onSubmit} disabled={submitting} className="flex-1 btn-primary justify-center">
            {submitting ? (locale === 'zh' ? '處理中…' : 'Saving…') : (locale === 'zh' ? '確認' : 'Confirm')}
          </button>
          <button onClick={onClose} disabled={submitting} className="flex-1 btn-outline justify-center">
            {locale === 'zh' ? '取消' : 'Cancel'}
          </button>
        </div>
      </div>
    </>
  );
}

function TypeTab({
  active, onClick, icon, label,
}: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium transition-colors ${
        active ? 'bg-white text-ink shadow-sm' : 'text-ink-soft hover:bg-white/60'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

// ──────────────────────────────────────────────────────────
// Details modal (per-item drill-in)
// ──────────────────────────────────────────────────────────

function DetailsModal({
  item, locale, submitting, onClose, onDelete,
}: {
  item: DayItem;
  locale: 'zh' | 'en';
  submitting: boolean;
  onClose: () => void;
  onDelete: () => void;
}) {
  const venueName = (venueId: string) =>
    venues.find((v) => v.id === venueId)?.name[locale] || venueId;

  return (
    <>
      <div className="fixed inset-0 bg-charcoal/50 z-[70]" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[70] glass-strong rounded-3xl p-8 shadow-glass-lg w-full max-w-md mx-4">
        {item.kind === 'booking' && (
          <BookingDetails booking={item.data} venueName={venueName} locale={locale} onClose={onClose} />
        )}
        {item.kind === 'block' && (
          <BlockDetails slot={item.data} venueName={venueName} locale={locale} submitting={submitting} onClose={onClose} onDelete={onDelete} />
        )}
        {item.kind === 'gcal' && (
          <GcalDetails slot={item.data} venueName={venueName} locale={locale} onClose={onClose} />
        )}
        {item.kind === 'event' && (
          <EventDetails event={item.data} venueName={venueName} locale={locale} submitting={submitting} onClose={onClose} onDelete={onDelete} />
        )}
      </div>
    </>
  );
}

function BookingDetails({
  booking, venueName, locale, onClose,
}: {
  booking: BookingRecord;
  venueName: (id: string) => string;
  locale: 'zh' | 'en';
  onClose: () => void;
}) {
  const statusLabel = booking.status === 'confirmed' ? (locale === 'zh' ? '已確認' : 'Confirmed')
    : booking.status === 'pending' ? (locale === 'zh' ? '待處理' : 'Pending')
    : booking.status === 'cancelled' ? (locale === 'zh' ? '已取消' : 'Cancelled')
    : booking.status;
  return (
    <>
      <h3 className="text-lg font-bold font-display mb-1 text-ink">
        {locale === 'zh' ? '預約' : 'Booking'}
      </h3>
      <p className="text-sm text-ink-soft mb-5">{booking.date} · {booking.startTime}–{booking.endTime}</p>
      <Row label={locale === 'zh' ? '分店' : 'Venue'}>{venueName(booking.venueId)}</Row>
      <Row label={locale === 'zh' ? '人數' : 'Guests'}>{booking.guestCount}</Row>
      <Row label={locale === 'zh' ? '狀態' : 'Status'}>{statusLabel}</Row>
      {booking.whatsappPhone && <Row label="WhatsApp">{booking.whatsappPhone}</Row>}
      <div className="flex gap-3 mt-5">
        <Link href={`/${locale}/admin/bookings/${booking.id}`} className="flex-1 btn-primary justify-center">
          <ExternalLink size={14} />
          {locale === 'zh' ? '查看詳情' : 'View'}
        </Link>
        <button onClick={onClose} className="flex-1 btn-outline justify-center">
          {locale === 'zh' ? '關閉' : 'Close'}
        </button>
      </div>
    </>
  );
}

function BlockDetails({
  slot, venueName, locale, submitting, onClose, onDelete,
}: {
  slot: BlockedSlot;
  venueName: (id: string) => string;
  locale: 'zh' | 'en';
  submitting: boolean;
  onClose: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <h3 className="text-lg font-bold font-display mb-1 text-ink flex items-center gap-2">
        <Lock size={16} /> {locale === 'zh' ? '人手封鎖' : 'Manual Block'}
      </h3>
      <p className="text-sm text-ink-soft mb-5">{slot.date} · {slot.startTime}–{slot.endTime}</p>
      <Row label={locale === 'zh' ? '分店' : 'Venue'}>{venueName(slot.venueId)}</Row>
      <div className="flex gap-3 mt-5">
        <button onClick={onDelete} disabled={submitting}
          className="flex-1 px-5 py-3 rounded-pill bg-red-50 text-red-600 hover:bg-red-100 transition-colors flex items-center justify-center gap-2 font-medium">
          <Trash2 size={14} />
          {locale === 'zh' ? '刪除' : 'Delete'}
        </button>
        <button onClick={onClose} className="flex-1 btn-outline justify-center">
          {locale === 'zh' ? '關閉' : 'Close'}
        </button>
      </div>
    </>
  );
}

function GcalDetails({
  slot, venueName, locale, onClose,
}: {
  slot: BlockedSlot;
  venueName: (id: string) => string;
  locale: 'zh' | 'en';
  onClose: () => void;
}) {
  const venueLabel = slot.venueId === 'sw-ab' ? (venues.find((v) => v.id === 'sw-ab')?.name[locale] || 'SW') : venueName(slot.venueId);
  return (
    <>
      <h3 className="text-lg font-bold font-display mb-1 text-ink flex items-center gap-2">
        <Calendar size={16} /> Google Calendar
      </h3>
      <p className="text-sm text-ink-soft mb-5">{slot.date} · {slot.startTime}–{slot.endTime}</p>
      {slot.googleEventTitle && <Row label={locale === 'zh' ? '標題' : 'Title'}>{slot.googleEventTitle}</Row>}
      <Row label={locale === 'zh' ? '分店' : 'Venue'}>{venueLabel}</Row>
      {slot.googleEventDescription && (
        <div className="mt-3">
          <p className="text-xs uppercase tracking-wider text-ink-soft mb-1">{locale === 'zh' ? '詳情' : 'Details'}</p>
          <p className="text-sm text-ink whitespace-pre-line">{slot.googleEventDescription}</p>
        </div>
      )}
      <p className="text-xs text-ink-soft mt-4 leading-relaxed">
        {locale === 'zh'
          ? '此項由 Google Calendar 同步而來，請喺 Google Calendar 度修改/刪除。'
          : 'Synced from Google Calendar — manage it directly in Google Calendar.'}
      </p>
      <div className="flex gap-3 mt-5">
        <a href="https://calendar.google.com/" target="_blank" rel="noopener" className="flex-1 btn-primary justify-center">
          <ExternalLink size={14} />
          {locale === 'zh' ? '開 Google Calendar' : 'Open Google Calendar'}
        </a>
        <button onClick={onClose} className="flex-1 btn-outline justify-center">
          {locale === 'zh' ? '關閉' : 'Close'}
        </button>
      </div>
    </>
  );
}

function EventDetails({
  event, venueName, locale, submitting, onClose, onDelete,
}: {
  event: CalendarEvent;
  venueName: (id: string) => string;
  locale: 'zh' | 'en';
  submitting: boolean;
  onClose: () => void;
  onDelete: () => void;
}) {
  const isVisit = event.type === 'site_visit';
  return (
    <>
      <h3 className="text-lg font-bold font-display mb-1 text-ink flex items-center gap-2">
        {isVisit ? <Eye size={16} /> : <Truck size={16} />}
        {isVisit ? 'Site Visit' : 'Delivery'}
      </h3>
      <p className="text-sm text-ink-soft mb-5">{event.date} · {event.startTime}–{event.endTime}</p>
      <Row label={locale === 'zh' ? '分店' : 'Venue'}>{venueName(event.venueId)}</Row>
      {event.notes && (
        <div className="mt-3">
          <p className="text-xs uppercase tracking-wider text-ink-soft mb-1">{locale === 'zh' ? '備註' : 'Notes'}</p>
          <p className="text-sm text-ink whitespace-pre-line">{event.notes}</p>
        </div>
      )}
      <Row label={locale === 'zh' ? 'Google 同步' : 'Google sync'}>
        {event.googleEventId ? '✓' : '—'}
      </Row>
      <div className="flex gap-3 mt-5">
        <button onClick={onDelete} disabled={submitting}
          className="flex-1 px-5 py-3 rounded-pill bg-red-50 text-red-600 hover:bg-red-100 transition-colors flex items-center justify-center gap-2 font-medium">
          <Trash2 size={14} />
          {locale === 'zh' ? '刪除' : 'Delete'}
        </button>
        <button onClick={onClose} className="flex-1 btn-outline justify-center">
          {locale === 'zh' ? '關閉' : 'Close'}
        </button>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between items-start py-2 border-b border-charcoal/5 last:border-0 gap-4">
      <span className="text-xs uppercase tracking-wider text-ink-soft shrink-0">{label}</span>
      <span className="text-sm text-ink text-right break-words">{children}</span>
    </div>
  );
}
