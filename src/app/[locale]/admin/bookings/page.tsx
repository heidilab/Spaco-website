'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { getAllBookings, updateBookingStatus, updateBookingBalance } from '@/lib/firestore';
import { tryGenerateLockPasscode, revokeLockPasscode, resendLockPasscode } from '@/lib/lockPasscodeClient';
import { BookingRecord, BookingDraft } from '@/types';
import { venues } from '@/lib/venues';
import { formatAddOnsForStaff } from '@/lib/pricing';
import {
  Search, Check, X as XIcon, MessageCircle, Plus, Link2, Copy, RotateCw,
  Calendar, Inbox, ListChecks, Key, DollarSign, Send, Package,
} from 'lucide-react';
import { buildWhatsAppLink, formatHkPhone } from '@/lib/whatsapp';
import { Link } from '@/i18n/routing';
import {
  listBookingDrafts, cancelBookingDraft, recreateBookingDraft, buildClaimUrl,
  isDraftExpired, DRAFT_TTL_HOURS,
} from '@/lib/bookingDrafts';
import { useAuth } from '@/contexts/AuthContext';

type View = 'bookings' | 'drafts';

const statusOptions = ['all', 'pending', 'awaiting_payment', 'awaiting_review', 'confirmed', 'completed', 'cancelled'];
const statusLabels: Record<string, { zh: string; en: string }> = {
  all: { zh: '全部', en: 'All' },
  pending: { zh: '待處理', en: 'Pending' },
  awaiting_payment: { zh: '待付款', en: 'Awaiting Payment' },
  awaiting_review: { zh: '待核實入數', en: 'Awaiting Review' },
  confirmed: { zh: '已確認', en: 'Confirmed' },
  completed: { zh: '已完成', en: 'Completed' },
  cancelled: { zh: '已取消', en: 'Cancelled' },
};
const statusColors: Record<string, string> = {
  pending: 'bg-amber-100/80 text-amber-700 border-amber-200',
  awaiting_payment: 'bg-orange-100/80 text-orange-700 border-orange-200',
  awaiting_review: 'bg-violet-100/80 text-violet-700 border-violet-200',
  confirmed: 'bg-emerald-100/80 text-emerald-700 border-emerald-200',
  completed: 'bg-sky-100/80 text-sky-700 border-sky-200',
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

  useEffect(() => {
    loadBookings();
    loadDrafts();
  }, []);

  const loadBookings = async () => {
    const data = await getAllBookings();
    setBookings(data);
    setFilteredBookings(data);
    setLoading(false);
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
    if (search) {
      const s = search.toLowerCase();
      filtered = filtered.filter((b) =>
        b.venueId.toLowerCase().includes(s) ||
        b.date.includes(s) ||
        b.id.toLowerCase().includes(s)
      );
    }
    setFilteredBookings(filtered);
  }, [statusFilter, search, bookings]);

  const handleStatusChange = async (bookingId: string, newStatus: string) => {
    await updateBookingStatus(bookingId, newStatus);
    // If cancelled, also remove from Google Calendar + revoke any TTLock
    // passcode that was already issued (non-blocking, errors logged).
    if (newStatus === 'cancelled') {
      fetch(`/api/google/push-booking?bookingId=${encodeURIComponent(bookingId)}`, {
        method: 'DELETE',
      }).catch(() => { /* gcal disconnected — fine */ });
      revokeLockPasscode(bookingId).catch((err) =>
        console.warn('[ttlock] revoke on cancel failed:', err),
      );
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
              placeholder={locale === 'zh' ? '搜尋預訂 ID、場地...' : 'Search booking ID, venue...'}
              className="w-full pl-11 pr-4 py-3 rounded-pill border border-white/70 bg-white/60 backdrop-blur-md focus:outline-none focus:border-pink/40 focus:bg-white/80 text-ink placeholder:text-ink-soft/60"
            />
          </div>
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
                {filteredBookings.map((booking) => {
                  const venue = venues.find((v) => v.id === booking.venueId);
                  return (
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
                      </td>
                      <td className="px-6 py-4 text-sm text-ink">{booking.date}</td>
                      <td className="px-6 py-4 text-sm text-ink">{booking.startTime} - {booking.endTime}</td>
                      <td className="px-6 py-4 text-sm text-ink">{booking.guestCount}</td>
                      <td className="px-6 py-4 text-sm font-bold font-display text-gradient-pink">HK${booking.pricing?.subtotal?.toLocaleString() || 0}</td>
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
                              title={`${booking.lockPasscode.passcode} · ${locale === 'zh' ? 'lockId' : 'lockId'} ${booking.lockPasscode.lockId}`}
                            >
                              <Key size={10} />
                              {booking.lockPasscode.passcode}
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
                    </tr>
                  );
                })}
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
                  const total = d.pricing.subtotal + d.pricing.deposit;
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
