'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import { getAllBookings, updateBookingStatus, deleteBlockedSlotsByBooking } from '@/lib/firestore';
import { tryGenerateLockPasscode, revokeLockPasscode } from '@/lib/lockPasscodeClient';
import { BookingRecord } from '@/types';
import { venues } from '@/lib/venues';
import { Check, X, Eye, Clock, AlertCircle } from 'lucide-react';

export default function AdminReceiptsPage() {
  const locale = useLocale() as 'zh' | 'en';
  const { hasPermission } = useAuth();
  const [bookings, setBookings] = useState<BookingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewingReceipt, setViewingReceipt] = useState<string | null>(null);
  const canAccess = hasPermission('bookings');

  useEffect(() => {
    if (!canAccess) return;
    loadBookings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccess]);

  const loadBookings = async () => {
    const data = await getAllBookings('awaiting_payment');
    setBookings(data);
    setLoading(false);
  };

  const handleApprove = async (bookingId: string) => {
    await updateBookingStatus(bookingId, 'confirmed');
    // Trigger TTLock passcode generation. The API does eligibility checking,
    // so this no-ops when the booking is > 2 days out (cron picks it up).
    // Failures are non-fatal — admin can retry from the booking detail page.
    tryGenerateLockPasscode(bookingId).catch((err) =>
      console.warn('[ttlock] post-approve generate failed:', err),
    );
    await loadBookings();
  };

  const handleReject = async (bookingId: string) => {
    await updateBookingStatus(bookingId, 'cancelled');
    await deleteBlockedSlotsByBooking(bookingId);
    // If a passcode somehow already exists (shouldn't for awaiting_payment,
    // but defensive), revoke it on TTLock so the door access is killed.
    revokeLockPasscode(bookingId).catch(() => { /* no-op */ });
    await loadBookings();
  };

  if (!canAccess) {
    return <div className="text-center py-20 text-muted">{locale === 'zh' ? '無權限存取' : 'Access Denied'}</div>;
  }

  // Check for expired bookings (>24hrs since creation)
  const now = Date.now();
  const isExpired = (booking: BookingRecord) => {
    if (!booking.createdAt) return false;
    const created = (booking.createdAt as { seconds: number }).seconds * 1000;
    return now - created > 24 * 60 * 60 * 1000;
  };

  return (
    <div>
      <h1 className="text-heading mb-8">
        {locale === 'zh' ? '待確認入數紙' : 'Pending Receipts'}
      </h1>

      {loading ? (
        <div className="animate-pulse text-muted">Loading...</div>
      ) : bookings.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Check size={48} className="mx-auto mb-4 text-green-300" />
          <p className="text-muted">
            {locale === 'zh' ? '暫無待確認的入數紙' : 'No pending receipts'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {bookings.map((booking) => {
            const venue = venues.find((v) => v.id === booking.venueId);
            const expired = isExpired(booking);
            const createdAt = booking.createdAt
              ? new Date((booking.createdAt as { seconds: number }).seconds * 1000)
              : null;
            const deadline = createdAt
              ? new Date(createdAt.getTime() + 24 * 60 * 60 * 1000)
              : null;

            return (
              <div key={booking.id} className={`glass-card p-6 ${expired ? 'border border-red-300/60 bg-red-50/40' : ''}`}>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <h3 className="font-bold text-lg">{venue?.name[locale] || booking.venueId}</h3>
                      {expired && (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-600">
                          <AlertCircle size={12} /> {locale === 'zh' ? '已超時' : 'Expired'}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-4 text-sm text-muted">
                      <span>{booking.date}</span>
                      <span>{booking.startTime} - {booking.endTime}</span>
                      <span>{booking.guestCount} {locale === 'zh' ? '人' : 'pax'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted">
                      <Clock size={12} />
                      {deadline && (
                        <span>
                          {locale === 'zh' ? '截止：' : 'Deadline: '}
                          {deadline.toLocaleString(locale === 'zh' ? 'zh-HK' : 'en-HK')}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-xl font-bold">HK${booking.pricing.subtotal.toLocaleString()}</p>
                      <p className="text-xs text-muted">
                        {locale === 'zh' ? '按金' : 'Deposit'}: HK${booking.pricing.deposit.toLocaleString()}
                      </p>
                    </div>

                    <div className="flex gap-2">
                      {booking.receiptUrl && (
                        <button
                          onClick={() => setViewingReceipt(booking.receiptUrl)}
                          className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center hover:bg-blue-100 transition-colors"
                          title={locale === 'zh' ? '查看入數紙' : 'View Receipt'}
                        >
                          <Eye size={16} />
                        </button>
                      )}
                      <button
                        onClick={() => handleApprove(booking.id)}
                        className="w-10 h-10 rounded-xl bg-green-50 text-green-600 flex items-center justify-center hover:bg-green-100 transition-colors"
                        title={locale === 'zh' ? '確認' : 'Approve'}
                      >
                        <Check size={16} />
                      </button>
                      <button
                        onClick={() => handleReject(booking.id)}
                        className="w-10 h-10 rounded-xl bg-red-50 text-red-600 flex items-center justify-center hover:bg-red-100 transition-colors"
                        title={locale === 'zh' ? '拒絕' : 'Reject'}
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Receipt Viewer Modal */}
      {viewingReceipt && (
        <>
          <div className="fixed inset-0 bg-charcoal/50 z-50" onClick={() => setViewingReceipt(null)} />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 max-w-lg w-full mx-4">
            <div className="glass-strong rounded-3xl p-4 shadow-glass-lg">
              <div className="flex justify-between items-center mb-4 px-2">
                <h3 className="font-bold">{locale === 'zh' ? '入數紙截圖' : 'Payment Receipt'}</h3>
                <button onClick={() => setViewingReceipt(null)} className="w-8 h-8 rounded-lg bg-cream flex items-center justify-center">
                  <X size={16} />
                </button>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={viewingReceipt} alt="Receipt" className="w-full rounded-2xl" />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
