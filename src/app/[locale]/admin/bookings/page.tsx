'use client';

import { useEffect, useMemo, useState, useRef, type ReactNode } from 'react';
import { useLocale } from 'next-intl';
import { getAllBookings, updateBookingStatus, updateBookingBalance, getAllUsers } from '@/lib/firestore';
import { tryGenerateLockPasscode, resendLockPasscode } from '@/lib/lockPasscodeClient';
import { cancelBooking } from '@/lib/cancelBooking';
import { BookingRecord, BookingDraft } from '@/types';
import { venues } from '@/lib/venues';
import { formatAddOnsForStaff } from '@/lib/pricing';
import { MARKETING_CHANNEL_LABELS, MarketingChannel } from '@/types';
import {
  Search, Check, X as XIcon, MessageCircle, Plus, Link2, Copy, RotateCw,
  Calendar, Inbox, ListChecks, Key, DollarSign, Send, Package,
  MapPin, ChevronDown,
} from 'lucide-react';
import { buildWhatsAppLink, formatHkPhone } from '@/lib/whatsapp';
import { Link } from '@/i18n/routing';
import {
  listBookingDrafts, cancelBookingDraft, recreateBookingDraft, buildClaimUrl,
  isDraftExpired, DRAFT_TTL_HOURS,
} from '@/lib/bookingDrafts';
import { useAuth } from '@/contexts/AuthContext';

type View = 'bookings' | 'drafts';

// Filter options shown in the booking-list dropdown. 'pending' is
// omitted on purpose — customer-flow bookings now skip that state
// (see lib/bookingCheckoutDraft.ts). Legacy pending rows still get
// auto-swept to 'payment_not_completed' by the expire cron within 15
// minutes of deploy.
const statusOptions = [
  'all',
  'awaiting_payment',
  'awaiting_review',
  'confirmed',
  'completed',
  'payment_not_completed',
  'cancelled',
];
const statusLabels: Record<string, { zh: string; en: string }> = {
  all: { zh: '全部', en: 'All' },
  // Kept for the rare legacy row that hasn't been swept yet — never
  // surfaced as a filter option but still rendered as a chip if seen.
  pending: { zh: '待處理', en: 'Pending' },
  awaiting_payment: { zh: '待付款', en: 'Awaiting Payment' },
  awaiting_review: { zh: '待核實入數', en: 'Awaiting Review' },
  confirmed: { zh: '已確認', en: 'Confirmed' },
  completed: { zh: '已完成', en: 'Completed' },
  payment_not_completed: { zh: '沒有完成付款', en: 'Payment Not Completed' },
  cancelled: { zh: '已取消', en: 'Cancelled' },
};
const statusColors: Record<string, string> = {
  pending: 'bg-amber-100/80 text-amber-700 border-amber-200',
  awaiting_payment: 'bg-orange-100/80 text-orange-700 border-orange-200',
  awaiting_review: 'bg-violet-100/80 text-violet-700 border-violet-200',
  confirmed: 'bg-emerald-100/80 text-emerald-700 border-emerald-200',
  completed: 'bg-sky-100/80 text-sky-700 border-sky-200',
  payment_not_completed: 'bg-stone-100/80 text-stone-700 border-stone-200',
  cancelled: 'bg-rose-100/80 text-rose-700 border-rose-200',
};

export default function AdminBookingsPage() {
  const locale = useLocale() as 'zh' | 'en';
  const { user } = useAuth();
  const [view, setView] = useState<View>('bookings');
  const [bookings, setBookings] = useState<BookingRecord[]>([]);
  const [filteredBookings, setFilteredBookings] = useState<BookingRecord[]>([]);
  const [drafts, setDrafts] = useState<BookingDraft[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [draftsLoading, setDraftsLoading] = useState(false);
  // userId → displayName, populated once on mount from the users collection
  // so the bookings table can show customer names without N round-trips.
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  // Venue multi-select filter. `null` means "all venues" (the default —
  // avoids needing to know venues.length before render). Once admin
  // touches the dropdown, this flips to a Set of selected venue ids.
  const [selectedVenues, setSelectedVenues] = useState<Set<string> | null>(null);
  const [venueFilterOpen, setVenueFilterOpen] = useState(false);

  useEffect(() => {
    loadBookings();
    loadDrafts();
    loadUserNames();
  }, []);

  const loadBookings = async () => {
    const data = await getAllBookings();
    setBookings(data);
    setFilteredBookings(data);
    setLoading(false);
  };

  // One-shot user-profile fetch so booking rows can show customer names.
  // Lightweight: only the displayName is kept; we don't hold profiles.
  const loadUserNames = async () => {
    try {
      const users = await getAllUsers();
      const map: Record<string, string> = {};
      for (const u of users as Array<{ uid: string; displayName?: string; email?: string }>) {
        const name = u.displayName || u.email?.split('@')[0] || '';
        if (name) map[u.uid] = name;
      }
      setUserNames(map);
    } catch (err) {
      console.warn('[admin/bookings] user-name load failed:', err);
    }
  };

  const loadDrafts = async () => {
    setDraftsLoading(true);
    try {
      const data = await listBookingDrafts();
      setDrafts(data);
    } finally {
      setDraftsLoading(false);
    }
  };

  // Draft counts (used in tab badges)
  const pendingDraftCount = useMemo(
    () => drafts.filter((d) => d.status === 'pending' && !isDraftExpired(d)).length,
    [drafts],
  );

  useEffect(() => {
    let filtered = bookings;
    if (statusFilter !== 'all') {
      filtered = filtered.filter((b) => b.status === statusFilter);
    }
    if (selectedVenues) {
      filtered = filtered.filter((b) => selectedVenues.has(b.venueId));
    }
    if (search) {
      const s = search.toLowerCase();
      // Normalise the phone search term so "9282 3060", "92823060",
      // "+852 9282-3060" all match the same booking. Strip every
      // non-digit so we compare digits-only against the booking's
      // stored whatsappPhone (which usually has the +852 prefix).
      const sDigits = s.replace(/\D/g, '');
      filtered = filtered.filter((b) => {
        const customerName = (userNames[b.userId] || '').toLowerCase();
        const phone = (b.whatsappPhone || '').replace(/\D/g, '');
        return b.venueId.toLowerCase().includes(s)
          || b.date.includes(s)
          || b.id.toLowerCase().includes(s)
          || customerName.includes(s)
          || (sDigits.length >= 4 && phone.includes(sDigits));
      });
    }
    setFilteredBookings(filtered);
  }, [statusFilter, search, selectedVenues, userNames, bookings]);

  const handleStatusChange = async (bookingId: string, newStatus: string) => {
    if (newStatus === 'cancelled') {
      // Cancel is IRREVERSIBLE — confirm before firing. Captures the
      // current admin's uid / email / displayName as the cancelledBy
      // audit fields so mis-clicks can be traced (Heidi's 2026-05-23
      // spec post the awaiting_payment / 沒有完成付款 wash-up).
      const booking = bookings.find((b) => b.id === bookingId);
      const label = booking
        ? `${booking.date} ${booking.startTime} · ${booking.venueId} · #${bookingId.slice(0, 8)}`
        : `#${bookingId.slice(0, 8)}`;
      if (!confirm(
        locale === 'zh'
          ? `⚠️ 確定取消預訂？\n\n${label}\n\n取消後不能還原。會即時釋放時段、移除 Google Calendar event、通知客人。`
          : `⚠️ Cancel this booking?\n\n${label}\n\nCannot be undone. Slot is released, gcal event removed, and customer is notified immediately.`,
      )) return;
      await cancelBooking(bookingId, {
        uid: user?.uid,
        email: user?.email || undefined,
        displayName: user?.displayName || undefined,
      });
    } else {
      await updateBookingStatus(bookingId, newStatus);
    }
    // If transitioning into 'confirmed' (manual approve), trigger:
    //   • TTLock passcode generation (no-op if > 2 days out)
    //   • Push to Google Calendar (idempotent — no-op if already pushed)
    //   • Staff notification email to CS + spacohk@gmail.com
    // All non-blocking; status flip is the source of truth.
    if (newStatus === 'confirmed') {
      tryGenerateLockPasscode(bookingId).catch((err) =>
        console.warn('[ttlock] post-confirm generate failed:', err),
      );
      fetch('/api/google/push-booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId }),
      }).catch(() => { /* gcal disconnected — fine */ });
      fetch('/api/admin/notify-booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId }),
      }).catch((err) => console.warn('[notify] staff email failed:', err));
    }
    await loadBookings();
  };

  // ─── Balance / lock-passcode admin actions ───
  // Mark a booking's balance paid → set balanceDue=0 and trigger immediate
  // passcode generation (no-op if not yet within 2-day window).
  const handleMarkBalancePaid = async (bookingId: string) => {
    if (!confirm(locale === 'zh' ? '確認客人已付清尾數？' : 'Confirm balance paid in full?')) return;
    await updateBookingBalance(bookingId, 0);
    tryGenerateLockPasscode(bookingId).catch((err) =>
      console.warn('[ttlock] balance-paid generate failed:', err),
    );
    await loadBookings();
  };

  // Manual "generate now" — for the rare case that a booking is within
  // window, fully paid, but the cron hasn't run yet (or earlier failure).
  const handleGenerateNow = async (bookingId: string) => {
    try {
      const r = await tryGenerateLockPasscode(bookingId);
      const action = r?.result?.action || 'unknown';
      const reason = r?.result?.reason || '';
      alert(`${locale === 'zh' ? '結果' : 'Result'}: ${action} (${reason})`);
    } catch (err) {
      alert(
        (locale === 'zh' ? '失敗：' : 'Failed: ') +
        (err instanceof Error ? err.message : String(err)),
      );
    }
    await loadBookings();
  };

  const handleResendPasscode = async (bookingId: string) => {
    try {
      await resendLockPasscode(bookingId);
      alert(locale === 'zh' ? '已重發密碼 email' : 'Passcode email resent');
    } catch (err) {
      alert(
        (locale === 'zh' ? '失敗：' : 'Failed: ') +
        (err instanceof Error ? err.message : String(err)),
      );
    }
    await loadBookings();
  };

  return (
    <div>
      <div className="mb-8 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <span className="chip mb-3">
            <Search size={12} className="text-pink" />
            Bookings
          </span>
          <h1 className="text-heading font-display text-ink">
            {locale === 'zh' ? '預訂管理' : 'Booking Management'}
          </h1>
        </div>
        <Link
          href="/admin/bookings/new"
          className="btn-primary self-start sm:self-end"
        >
          <Plus size={16} />
          {locale === 'zh' ? '新增預訂連結' : 'New booking link'}
        </Link>
      </div>

      {/* View tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setView('bookings')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-pill text-sm font-medium transition-all border-2 ${
            view === 'bookings'
              ? 'bg-gradient-pink text-white border-transparent shadow-glow'
              : 'bg-white/85 text-ink border-charcoal/15 hover:border-pink/60'
          }`}
        >
          <ListChecks size={16} />
          {locale === 'zh' ? '已確認預訂' : 'Bookings'}
          <span className={`text-xs px-1.5 py-0.5 rounded-full ${view === 'bookings' ? 'bg-white/25' : 'bg-charcoal/10'}`}>
            {bookings.length}
          </span>
        </button>
        <button
          onClick={() => setView('drafts')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-pill text-sm font-medium transition-all border-2 ${
            view === 'drafts'
              ? 'bg-gradient-pink text-white border-transparent shadow-glow'
              : 'bg-white/85 text-ink border-charcoal/15 hover:border-pink/60'
          }`}
        >
          <Link2 size={16} />
          {locale === 'zh' ? '預訂連結' : 'Booking Links'}
          {pendingDraftCount > 0 && (
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${view === 'drafts' ? 'bg-white/25' : 'bg-amber-200/80 text-amber-800'}`}>
              {pendingDraftCount} {locale === 'zh' ? '待 claim' : 'pending'}
            </span>
          )}
        </button>
      </div>

      {/* Filters — only for bookings view */}
      {view === 'bookings' && (
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-soft z-10" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={locale === 'zh' ? '搜尋預訂 ID、場地、客人名、電話...' : 'Search booking ID, venue, customer, phone...'}
              className="w-full pl-11 pr-4 py-3 rounded-pill border border-white/70 bg-white/60 backdrop-blur-md focus:outline-none focus:border-pink/40 focus:bg-white/80 text-ink placeholder:text-ink-soft/60"
            />
          </div>
          {/* Venue multi-select dropdown.
           *  - Default state (selectedVenues === null) treats as "all selected"
           *    so the count starts at venues.length.
           *  - Clicking a checkbox initialises the Set with all-except-toggled.
           *  - Selecting nothing returns to "all" (cleaner mental model than
           *    "0 selected = nothing shown"). */}
          <VenueFilterDropdown
            locale={locale}
            open={venueFilterOpen}
            setOpen={setVenueFilterOpen}
            selectedVenues={selectedVenues}
            setSelectedVenues={setSelectedVenues}
          />
          <div className="flex flex-wrap gap-2">
            {statusOptions.map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-4 py-2 rounded-pill text-sm font-medium transition-all border ${
                  statusFilter === status
                    ? 'bg-gradient-pink text-white border-transparent shadow-glow'
                    : 'bg-white/50 text-ink-soft border-white/70 hover:bg-white/80 hover:text-ink backdrop-blur-md'
                }`}
              >
                {statusLabels[status][locale]}
              </button>
            ))}
          </div>
        </div>
      )}

      {view === 'drafts' && (
        <DraftsTable
          drafts={drafts}
          loading={draftsLoading}
          locale={locale}
          staffUid={user?.uid}
          onChange={loadDrafts}
        />
      )}

      {/* Bookings Table */}
      {view === 'bookings' && (loading ? (
        <div className="animate-pulse text-ink-soft p-8 text-center">Loading...</div>
      ) : filteredBookings.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <p className="text-ink-soft">{locale === 'zh' ? '暫無預訂記錄' : 'No bookings found'}</p>
        </div>
      ) : (
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/40">
                  <th className="text-left px-6 py-4 text-xs font-semibold text-ink-soft uppercase tracking-wider">
                    {locale === 'zh' ? '場地' : 'Venue'}
                  </th>
                  <th className="text-left px-6 py-4 text-xs font-semibold text-ink-soft uppercase tracking-wider">
                    {locale === 'zh' ? '日期' : 'Date'}
                  </th>
                  <th className="text-left px-6 py-4 text-xs font-semibold text-ink-soft uppercase tracking-wider">
                    {locale === 'zh' ? '時間' : 'Time'}
                  </th>
                  <th className="text-left px-6 py-4 text-xs font-semibold text-ink-soft uppercase tracking-wider">
                    {locale === 'zh' ? '人數' : 'Guests'}
                  </th>
                  <th className="text-left px-6 py-4 text-xs font-semibold text-ink-soft uppercase tracking-wider">
                    {locale === 'zh' ? '金額' : 'Amount'}
                  </th>
                  <th className="text-left px-6 py-4 text-xs font-semibold text-ink-soft uppercase tracking-wider">
                    {locale === 'zh' ? '狀態' : 'Status'}
                  </th>
                  <th className="text-left px-6 py-4 text-xs font-semibold text-ink-soft uppercase tracking-wider">
                    {locale === 'zh' ? '操作' : 'Actions'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  // Render bookings with a thin divider whenever the
                  // createdAt date changes between consecutive rows.
                  // The list is already sorted by createdAt desc (see
                  // getAllBookings), so the divider naturally appears at
                  // the boundary of each "下單日" group. The divider is
                  // injected as a single-cell <tr> spanning all 7 columns
                  // — a hairline + inline date label, NOT a full row of
                  // data (per Heidi's spec).
                  let lastCreatedAtKey: string | null = null;
                  const out: ReactNode[] = [];
                  filteredBookings.forEach((booking) => {
                    const venue = venues.find((v) => v.id === booking.venueId);
                    const createdAtKey = formatCreatedAtDate(booking.createdAt);
                    if (createdAtKey && createdAtKey !== lastCreatedAtKey) {
                      out.push(
                        <tr key={`sep-${booking.id}`} className="bg-pink/[0.04]">
                          <td colSpan={7} className="px-6 py-1 border-y border-pink/30">
                            <span className="text-[11px] font-semibold text-pink/80 uppercase tracking-wider">
                              {locale === 'zh' ? `下單日 · ${createdAtKey}` : `Placed · ${createdAtKey}`}
                            </span>
                          </td>
                        </tr>,
                      );
                      lastCreatedAtKey = createdAtKey;
                    }
                    out.push(
                    <tr key={booking.id} className="border-b border-white/40 last:border-0 hover:bg-white/40 transition-colors cursor-pointer" onClick={(e) => {
                      // Ignore clicks that originate inside the actions cell
                      // (buttons + WhatsApp link) — they have their own handlers.
                      const target = e.target as HTMLElement;
                      if (target.closest('button') || target.closest('a')) return;
                      window.location.href = `/${locale}/admin/bookings/${booking.id}`;
                    }}>
                      <td className="px-6 py-4">
                        <Link href={`/admin/bookings/${booking.id}`} className="font-medium text-sm text-ink hover:text-pink hover:underline">
                          {venue?.name[locale] || booking.venueId}
                        </Link>
                        {/* Customer name — small line under the venue.
                         *  Fetched once on mount via getAllUsers + the
                         *  userNames map (avoids one Firestore round-trip
                         *  per row). Falls back gracefully when the user
                         *  has no profile yet (still shows venue). */}
                        {userNames[booking.userId] && (
                          <div className="text-[11px] text-ink-soft mt-0.5 truncate max-w-[260px]">
                            {userNames[booking.userId]}
                          </div>
                        )}
                        {/* Add-ons chip — surfaces supplier-orderable items
                         *  in the row so staff don't need to click into the
                         *  detail page to see what to order. */}
                        {booking.addOns && booking.addOns.length > 0 && (
                          <div
                            className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-pill text-[10px] font-medium border bg-violet-50 text-violet-700 border-violet-200 max-w-[260px] truncate"
                            title={formatAddOnsForStaff(booking.addOns, locale)}
                          >
                            <Package size={10} className="shrink-0" />
                            <span className="truncate">{formatAddOnsForStaff(booking.addOns, locale)}</span>
                          </div>
                        )}
                        {/* Marketing channel chip — first-time customers
                         *  show the channel they selected, repeat
                         *  customers show "Loyalty Member". */}
                        {booking.marketingChannel && (
                          <div className={`mt-1 ml-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-pill text-[10px] font-medium border ${
                            booking.marketingChannel === 'loyalty_member'
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : 'bg-sky-50 text-sky-700 border-sky-200'
                          }`}>
                            {booking.marketingChannel === 'loyalty_member'
                              ? (locale === 'zh' ? '🌟 老會員' : '🌟 Loyalty Member')
                              : `📣 ${MARKETING_CHANNEL_LABELS[booking.marketingChannel as MarketingChannel][locale]}${booking.marketingChannelOther ? `: ${booking.marketingChannelOther}` : ''}`}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-ink">{booking.date}</td>
                      <td className="px-6 py-4 text-sm text-ink">{booking.startTime} - {booking.endTime}</td>
                      <td className="px-6 py-4 text-sm text-ink">{booking.guestCount}</td>
                      <td className="px-6 py-4 text-sm font-bold font-display text-gradient-pink">
                        {(() => {
                          // 「金額」 logic varies by booking lifecycle:
                          //   • completed (deposit settled) → 結算訂單總額
                          //       = sum(payments) − depositRefund.amount
                          //     i.e. what customer actually paid NET of the
                          //     deposit refunded back. Reflects the final
                          //     real total per Heidi's 2026-06-22 spec.
                          //   • pre-settlement (confirmed / awaiting…)
                          //       = subtotal − promo − points + consumed
                          //         deposit (forfeited portion that SPACO
                          //         keeps; deductions ≤ securityDeposit).
                          //     Until the deposit is settled the
                          //     refundable portion isn't SPACO's revenue
                          //     yet, so we don't include it.
                          if (booking.status === 'completed' && booking.depositRefund) {
                            const paymentsSum = (booking.payments || []).reduce(
                              (s, p) => s + (p.amount || 0),
                              0,
                            );
                            const refunded = (booking.depositRefund as { amount?: number })?.amount || 0;
                            const finalTotal = Math.max(0, paymentsSum - refunded);
                            return `HK$${finalTotal.toLocaleString()}`;
                          }
                          const subtotal = booking.pricing?.subtotal || 0;
                          const promo = booking.promoDiscount || 0;
                          const pts = booking.pointsDiscount || 0;
                          const consumed = (
                            (booking.depositRefund as { deductions?: { amount: number }[] } | null)?.deductions
                            || []
                          ).reduce((s, d) => s + (d.amount || 0), 0);
                          const securityDeposit = booking.pricing?.securityDeposit || 0;
                          const forfeitedDeposit = Math.min(consumed, securityDeposit);
                          const total = Math.max(0, subtotal - promo - pts) + forfeitedDeposit;
                          return `HK$${total.toLocaleString()}`;
                        })()}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1.5">
                          <span className={`inline-flex w-fit px-3 py-1 rounded-pill text-xs font-medium border ${statusColors[booking.status] || 'bg-white/60 text-ink-soft border-white/70'}`}>
                            {statusLabels[booking.status]?.[locale] || booking.status}
                          </span>
                          {/* Balance-due badge — shows for high-value bookings still owing */}
                          {(booking.balanceDue ?? 0) > 0 && (
                            <span className="inline-flex w-fit items-center gap-1 px-2 py-0.5 rounded-pill text-[10px] font-semibold border bg-rose-50 text-rose-700 border-rose-200">
                              <DollarSign size={10} />
                              {locale === 'zh' ? '欠尾數 HK$' : 'Balance HK$'}{booking.balanceDue!.toLocaleString()}
                            </span>
                          )}
                          {/* Passcode badge — green if issued, yellow if pending */}
                          {booking.lockPasscode?.passcode ? (
                            <span
                              className="inline-flex w-fit items-center gap-1 px-2 py-0.5 rounded-pill text-[10px] font-mono font-semibold border bg-emerald-50 text-emerald-700 border-emerald-200"
                              title={`${booking.lockPasscode.passcode}# · ${locale === 'zh' ? 'lockId' : 'lockId'} ${booking.lockPasscode.lockId}`}
                            >
                              <Key size={10} />
                              {booking.lockPasscode.passcode}#
                            </span>
                          ) : booking.status === 'confirmed' && (booking.balanceDue ?? 0) === 0 && (
                            <span className="inline-flex w-fit items-center gap-1 px-2 py-0.5 rounded-pill text-[10px] font-medium border bg-amber-50 text-amber-700 border-amber-200">
                              <Key size={10} />
                              {locale === 'zh' ? '密碼待生成' : 'Passcode pending'}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex gap-1 flex-wrap">
                          {/* WhatsApp 一鍵聯絡 */}
                          {booking.whatsappPhone && (() => {
                            const v = venues.find((vn) => vn.id === booking.venueId);
                            const msg = locale === 'zh'
                              ? `你好，關於你 ${booking.date} ${booking.startTime}-${booking.endTime} 喺 ${v?.name.zh || booking.venueId} 嘅預訂…`
                              : `Hi, regarding your booking on ${booking.date} ${booking.startTime}-${booking.endTime} at ${v?.name.en || booking.venueId}…`;
                            return (
                              <a
                                href={buildWhatsAppLink(booking.whatsappPhone, msg)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="w-8 h-8 rounded-xl bg-[#25D366]/15 text-[#075E54] flex items-center justify-center hover:bg-[#25D366]/30 transition-colors"
                                title={`${locale === 'zh' ? '聯絡' : 'Contact'} ${formatHkPhone(booking.whatsappPhone)}`}
                              >
                                <MessageCircle size={14} />
                              </a>
                            );
                          })()}
                          {(booking.status === 'pending' || booking.status === 'awaiting_payment') && (
                            <button
                              onClick={() => handleStatusChange(booking.id, 'confirmed')}
                              className="w-8 h-8 rounded-xl bg-emerald-100/80 text-emerald-700 flex items-center justify-center hover:bg-emerald-200 transition-colors"
                              title={locale === 'zh' ? '確認' : 'Confirm'}
                            >
                              <Check size={14} />
                            </button>
                          )}
                          {booking.status !== 'cancelled' && booking.status !== 'completed' && (
                            <button
                              onClick={() => handleStatusChange(booking.id, 'cancelled')}
                              className="w-8 h-8 rounded-xl bg-rose-100/80 text-rose-700 flex items-center justify-center hover:bg-rose-200 transition-colors"
                              title={locale === 'zh' ? '取消' : 'Cancel'}
                            >
                              <XIcon size={14} />
                            </button>
                          )}
                          {/* Mark balance paid — only when there is an outstanding balance */}
                          {booking.status === 'confirmed' && (booking.balanceDue ?? 0) > 0 && (
                            <button
                              onClick={() => handleMarkBalancePaid(booking.id)}
                              className="w-8 h-8 rounded-xl bg-emerald-100/80 text-emerald-700 flex items-center justify-center hover:bg-emerald-200 transition-colors"
                              title={locale === 'zh' ? '標記尾數已付' : 'Mark balance paid'}
                            >
                              <DollarSign size={14} />
                            </button>
                          )}
                          {/* Manual "generate passcode now" — confirmed + paid + no passcode */}
                          {booking.status === 'confirmed' &&
                           (booking.balanceDue ?? 0) === 0 &&
                           !booking.lockPasscode?.passcode && (
                            <button
                              onClick={() => handleGenerateNow(booking.id)}
                              className="w-8 h-8 rounded-xl bg-violet-100/80 text-violet-700 flex items-center justify-center hover:bg-violet-200 transition-colors"
                              title={locale === 'zh' ? '即時生成門鎖密碼' : 'Generate lock passcode now'}
                            >
                              <Key size={14} />
                            </button>
                          )}
                          {/* Resend passcode email — passcode exists */}
                          {booking.lockPasscode?.passcode && (
                            <button
                              onClick={() => handleResendPasscode(booking.id)}
                              className="w-8 h-8 rounded-xl bg-sky-100/80 text-sky-700 flex items-center justify-center hover:bg-sky-200 transition-colors"
                              title={locale === 'zh' ? '重發密碼 email' : 'Resend passcode email'}
                            >
                              <Send size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>,
                    );
                  });
                  return out;
                })()}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// DraftsTable — staff-initiated booking links
// ────────────────────────────────────────────────────────────

interface DraftsTableProps {
  drafts: BookingDraft[];
  loading: boolean;
  locale: 'zh' | 'en';
  staffUid?: string;
  onChange: () => void | Promise<void>;
}

function DraftsTable({ drafts, loading, locale, staffUid, onChange }: DraftsTableProps) {
  const [statusFilter, setStatusFilter] = useState<'pending' | 'claimed' | 'expired_or_cancelled' | 'all'>('pending');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const counts = useMemo(() => ({
    pending: drafts.filter((d) => d.status === 'pending' && !isDraftExpired(d)).length,
    claimed: drafts.filter((d) => d.status === 'claimed').length,
    other: drafts.filter((d) => d.status === 'cancelled' || (d.status === 'pending' && isDraftExpired(d))).length,
  }), [drafts]);

  const filtered = useMemo(() => {
    return drafts.filter((d) => {
      const expired = isDraftExpired(d);
      if (statusFilter === 'pending') return d.status === 'pending' && !expired;
      if (statusFilter === 'claimed') return d.status === 'claimed';
      if (statusFilter === 'expired_or_cancelled') {
        return d.status === 'cancelled' || (d.status === 'pending' && expired);
      }
      return true;
    });
  }, [drafts, statusFilter]);

  const handleCopy = async (id: string) => {
    const url = buildClaimUrl(id, locale);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      window.prompt(locale === 'zh' ? '複製此連結' : 'Copy link', url);
    }
  };

  const handleCancel = async (id: string) => {
    if (!confirm(locale === 'zh' ? '確定取消此連結？' : 'Cancel this link?')) return;
    setBusyId(id);
    try {
      await cancelBookingDraft(id);
      await onChange();
    } finally {
      setBusyId(null);
    }
  };

  const handleRecreate = async (draft: BookingDraft) => {
    if (!staffUid) return;
    setBusyId(draft.id);
    try {
      const newId = await recreateBookingDraft(draft, staffUid);
      await onChange();
      // Auto-copy the new link so CS can paste straight to WhatsApp.
      const url = buildClaimUrl(newId, locale);
      try {
        await navigator.clipboard.writeText(url);
        alert((locale === 'zh' ? '✅ 新連結已建立並複製。\n' : '✅ New link created & copied.\n') + url);
      } catch {
        alert((locale === 'zh' ? '✅ 新連結：\n' : '✅ New link:\n') + url);
      }
    } finally {
      setBusyId(null);
    }
  };

  const buildWaUrl = (draft: BookingDraft) => {
    const claimUrl = buildClaimUrl(draft.id, locale);
    const v = venues.find((vn) => vn.id === draft.venueId);
    const customerLabel = draft.customerName || (locale === 'zh' ? '你' : 'you');
    const message =
      locale === 'zh'
        ? `Hi ${customerLabel}！我哋幫你預備好咗 SPACO 嘅預訂（${v?.name.zh || draft.venueId} · ${draft.date} ${draft.startTime}-${draft.endTime}），請撳呢條 link 確認同付款：\n${claimUrl}\n\n⚠️ 重要事項：\n• 連結於 ${DRAFT_TTL_HOURS} 小時後失效\n• 本店不設任何留位形式，一切以付款作確認，先到先得\n• 如所訂之日子時間已被其他客人預訂，連結會即時失效`
        : `Hi ${customerLabel}! Your SPACO booking is ready (${v?.name.en || draft.venueId} · ${draft.date} ${draft.startTime}-${draft.endTime}). Tap to confirm & pay:\n${claimUrl}\n\n⚠️ Important:\n• Link expires in ${DRAFT_TTL_HOURS} hours\n• No slot reservation — first to pay confirms\n• Link invalidates if the slot is booked first`;
    if (draft.customerWhatsapp) {
      const num = draft.customerWhatsapp.replace(/^\+/, '');
      return `https://wa.me/${num}?text=${encodeURIComponent(message)}`;
    }
    return `https://wa.me/?text=${encodeURIComponent(message)}`;
  };

  return (
    <>
      {/* Sub-filter chips */}
      <div className="flex flex-wrap gap-2 mb-6">
        {([
          { id: 'pending', label: { zh: '待 claim', en: 'Pending' }, count: counts.pending },
          { id: 'claimed', label: { zh: '已 claim', en: 'Claimed' }, count: counts.claimed },
          { id: 'expired_or_cancelled', label: { zh: '已失效/已取消', en: 'Expired / Cancelled' }, count: counts.other },
          { id: 'all', label: { zh: '全部', en: 'All' }, count: drafts.length },
        ] as const).map((s) => (
          <button
            key={s.id}
            onClick={() => setStatusFilter(s.id)}
            className={`px-4 py-2 rounded-pill text-sm font-medium transition-all border ${
              statusFilter === s.id
                ? 'bg-gradient-pink text-white border-transparent shadow-glow'
                : 'bg-white/50 text-ink-soft border-white/70 hover:bg-white/80 hover:text-ink backdrop-blur-md'
            }`}
          >
            {s.label[locale]} <span className="opacity-70 ml-1">{s.count}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="animate-pulse text-ink-soft p-8 text-center">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Inbox size={28} className="text-ink-soft mx-auto mb-3" />
          <p className="text-ink-soft">{locale === 'zh' ? '冇符合嘅連結' : 'No links match'}</p>
        </div>
      ) : (
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/40">
                  <th className="text-left px-5 py-4 text-xs font-semibold text-ink-soft uppercase tracking-wider">{locale === 'zh' ? '客人' : 'Customer'}</th>
                  <th className="text-left px-5 py-4 text-xs font-semibold text-ink-soft uppercase tracking-wider">{locale === 'zh' ? '場地 / 時段' : 'Venue / Slot'}</th>
                  <th className="text-left px-5 py-4 text-xs font-semibold text-ink-soft uppercase tracking-wider">{locale === 'zh' ? '金額' : 'Amount'}</th>
                  <th className="text-left px-5 py-4 text-xs font-semibold text-ink-soft uppercase tracking-wider">{locale === 'zh' ? '狀態' : 'Status'}</th>
                  <th className="text-left px-5 py-4 text-xs font-semibold text-ink-soft uppercase tracking-wider">{locale === 'zh' ? '操作' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => {
                  const v = venues.find((vn) => vn.id === d.venueId);
                  const expired = isDraftExpired(d);
                  const isPending = d.status === 'pending' && !expired;
                  const isClaimed = d.status === 'claimed';
                  const total = d.pricing.subtotal + (d.pricing.securityDeposit ?? 0);
                  return (
                    <tr key={d.id} className="border-b border-white/40 last:border-0 hover:bg-white/40 transition-colors align-top">
                      <td className="px-5 py-4">
                        <p className="font-medium text-sm text-ink">
                          {d.customerName || <span className="italic text-ink-soft/60">{locale === 'zh' ? '未填' : '—'}</span>}
                        </p>
                        {d.customerWhatsapp && (
                          <p className="text-[11px] text-ink-soft mt-0.5">{formatHkPhone(d.customerWhatsapp)}</p>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <p className="text-sm font-medium text-ink">{v?.name[locale] || d.venueId}</p>
                        <p className="text-[11px] text-ink-soft mt-0.5 inline-flex items-center gap-1">
                          <Calendar size={10} /> {d.date} · {d.startTime}-{d.endTime} · {d.guestCount}{locale === 'zh' ? '人' : 'pax'}
                        </p>
                      </td>
                      <td className="px-5 py-4 text-sm font-bold font-display text-gradient-pink">
                        HK${total.toLocaleString()}
                      </td>
                      <td className="px-5 py-4">
                        {isPending ? (
                          <span className="px-3 py-1 rounded-pill text-xs font-medium border bg-amber-100/80 text-amber-700 border-amber-200">
                            {locale === 'zh' ? '待 claim' : 'Pending'}
                          </span>
                        ) : isClaimed ? (
                          <span className="px-3 py-1 rounded-pill text-xs font-medium border bg-emerald-100/80 text-emerald-700 border-emerald-200">
                            {locale === 'zh' ? '已 claim' : 'Claimed'}
                          </span>
                        ) : expired ? (
                          <span className="px-3 py-1 rounded-pill text-xs font-medium border bg-rose-100/80 text-rose-700 border-rose-200">
                            {locale === 'zh' ? '已過期' : 'Expired'}
                          </span>
                        ) : (
                          <span className="px-3 py-1 rounded-pill text-xs font-medium border bg-rose-100/80 text-rose-700 border-rose-200">
                            {locale === 'zh' ? '已取消' : 'Cancelled'}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap gap-1">
                          {isPending && (
                            <>
                              <button
                                onClick={() => handleCopy(d.id)}
                                className="w-8 h-8 rounded-xl bg-sky-100/80 text-sky-700 flex items-center justify-center hover:bg-sky-200"
                                title={locale === 'zh' ? '複製連結' : 'Copy link'}
                              >
                                {copiedId === d.id ? <Check size={14} /> : <Copy size={14} />}
                              </button>
                              <a
                                href={buildWaUrl(d)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="w-8 h-8 rounded-xl bg-[#25D366]/15 text-[#075E54] flex items-center justify-center hover:bg-[#25D366]/30"
                                title={locale === 'zh' ? 'WhatsApp 發送' : 'Send via WhatsApp'}
                              >
                                <MessageCircle size={14} />
                              </a>
                              <button
                                onClick={() => handleCancel(d.id)}
                                disabled={busyId === d.id}
                                className="w-8 h-8 rounded-xl bg-rose-100/80 text-rose-700 flex items-center justify-center hover:bg-rose-200 disabled:opacity-50"
                                title={locale === 'zh' ? '取消連結' : 'Cancel link'}
                              >
                                <XIcon size={14} />
                              </button>
                            </>
                          )}
                          {(expired || d.status === 'cancelled') && (
                            <button
                              onClick={() => handleRecreate(d)}
                              disabled={busyId === d.id}
                              className="inline-flex items-center gap-1 px-3 h-8 rounded-xl bg-pink/15 text-pink text-xs font-semibold hover:bg-pink/25 disabled:opacity-50"
                              title={locale === 'zh' ? '重新建立連結' : 'Recreate link'}
                            >
                              <RotateCw size={12} />
                              {locale === 'zh' ? '重新建立' : 'Recreate'}
                            </button>
                          )}
                          {isClaimed && d.bookingId && (
                            <span className="inline-flex items-center gap-1 px-3 h-8 rounded-xl bg-emerald-50 text-emerald-700 text-xs font-medium">
                              <Check size={12} />
                              {locale === 'zh' ? `Booking #${d.bookingId.slice(0, 6)}` : `Booking #${d.bookingId.slice(0, 6)}`}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

// ────────────────────────────────────────────────────────────
// Helpers + sub-components
// ────────────────────────────────────────────────────────────

/** Convert a Firestore Timestamp / Date / ISO string into a HKT yyyy-mm-dd
 *  key suitable for grouping bookings by 下單日. Uses local-time
 *  components instead of toISOString().slice(0,10) so a booking placed at
 *  HKT 00:30 doesn't get bucketed into the previous UTC day. */
function formatCreatedAtDate(value: unknown): string | null {
  if (!value) return null;
  let d: Date | null = null;
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    try { d = (value as { toDate: () => Date }).toDate(); } catch { d = null; }
  } else if (value instanceof Date) {
    d = value;
  } else if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) d = parsed;
  }
  if (!d) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

interface VenueFilterDropdownProps {
  locale: 'zh' | 'en';
  open: boolean;
  setOpen: (open: boolean) => void;
  /** `null` = "all venues" (default state — counts as everything selected,
   *  no filter applied). A Set explicitly lists which venue ids to show. */
  selectedVenues: Set<string> | null;
  setSelectedVenues: (next: Set<string> | null) => void;
}

function VenueFilterDropdown({
  locale, open, setOpen, selectedVenues, setSelectedVenues,
}: VenueFilterDropdownProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Click-outside to close. Bound only while the dropdown is open so we
  // don't keep a global mousedown listener around for the whole session.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, setOpen]);

  const totalCount = venues.length;
  const selectedCount = selectedVenues === null ? totalCount : selectedVenues.size;
  const allSelected = selectedVenues === null || selectedVenues.size === totalCount;

  function toggleVenue(id: string) {
    // Initialise from "all" — copy every venue then remove the toggled one.
    const base = selectedVenues ?? new Set(venues.map((v) => v.id));
    const next = new Set(base);
    if (next.has(id)) next.delete(id); else next.add(id);
    // Collapse back to "all" when admin re-selects every venue (cleaner
    // than carrying around a full Set that means the same thing).
    if (next.size === totalCount) {
      setSelectedVenues(null);
    } else {
      setSelectedVenues(next);
    }
  }

  function selectAll() { setSelectedVenues(null); }
  function clearAll() { setSelectedVenues(new Set()); }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 px-4 py-3 rounded-pill border text-sm font-medium transition-all backdrop-blur-md ${
          allSelected
            ? 'bg-white/50 text-ink-soft border-white/70 hover:bg-white/80 hover:text-ink'
            : 'bg-pink/10 text-pink border-pink/30 hover:bg-pink/20'
        }`}
        title={locale === 'zh' ? '篩選場地' : 'Filter venues'}
      >
        <MapPin size={14} />
        {allSelected
          ? (locale === 'zh' ? '所有場地' : 'All venues')
          : (locale === 'zh'
              ? `已選 ${selectedCount} 個場地`
              : `${selectedCount} venues`)}
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-20 mt-2 right-0 sm:left-0 w-64 rounded-2xl bg-white shadow-xl border border-charcoal/10 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-charcoal/10 bg-charcoal/[0.02]">
            <span className="text-[11px] font-semibold text-ink-soft uppercase tracking-wider">
              {locale === 'zh' ? '篩選場地' : 'Filter venues'}
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={selectAll}
                className="text-[11px] text-pink hover:underline"
              >
                {locale === 'zh' ? '全選' : 'All'}
              </button>
              <span className="text-ink-soft text-[11px]">·</span>
              <button
                type="button"
                onClick={clearAll}
                className="text-[11px] text-ink-soft hover:text-charcoal hover:underline"
              >
                {locale === 'zh' ? '清空' : 'None'}
              </button>
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {venues.map((v) => {
              const checked = selectedVenues === null || selectedVenues.has(v.id);
              return (
                <label
                  key={v.id}
                  className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-pink/5 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleVenue(v.id)}
                    className="rounded border-charcoal/30 text-pink focus:ring-pink"
                  />
                  <span className="text-ink truncate">{v.name[locale]}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
