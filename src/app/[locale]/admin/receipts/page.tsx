'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import { getAllBookings, getBooking, updateBookingStatus } from '@/lib/firestore';
import { doc, updateDoc, arrayUnion, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { tryGenerateLockPasscode } from '@/lib/lockPasscodeClient';
import { cancelBooking } from '@/lib/cancelBooking';
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
    try {
      // 'awaiting_review' = customer uploaded receipt, awaiting admin verify.
      // 'awaiting_payment' = chose offline payment but no receipt yet —
      // those should still surface here so admin can chase them.
      const [review, awaiting] = await Promise.all([
        getAllBookings('awaiting_review'),
        getAllBookings('awaiting_payment'),
      ]);
      // Show receipts uploaded first (highest priority for admin), then
      // awaiting-payment offline bookings without receipt yet.
      setBookings([
        ...review,
        ...awaiting.filter((b) => b.paymentMethod !== 'stripe' && !b.receiptUrl),
      ]);
    } catch (err) {
      console.error('[admin/receipts] load failed:', err);
      setBookings([]);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (bookingId: string) => {
    // Re-read the booking — Heidi reported that approving a BALANCE
    // receipt left both balanceDue and payments[] untouched, so the
    // booking still showed "未付尾數" with no new audit row. Fix:
    //   1. Detect whether this is a balance receipt (paymentVerifiedAt
    //      already set + balanceDue > 0) or an initial deposit receipt.
    //   2. Append a payments[] entry split into the three buckets
    //      (場租 / 附加項目 / 按金) using bucket-fill in opposite
    //      directions: initial fills 按金 → 場租 → 附加項目 (front
    //      end first), balance fills 附加項目 → 場租 → 按金 (back
    //      end first) so the same booking's two charges don't both
    //      target the same bucket. PaymentHistory's synth row
    //      handles whatever's still missing.
    //   3. For balance: also clear balanceDue + stamp balancePaidAt.
    const booking = await getBooking(bookingId);
    if (!booking) {
      console.warn('[handleApprove] booking missing:', bookingId);
      return;
    }

    const isBalanceReceipt =
      !!booking.paymentVerifiedAt && (booking.balanceDue ?? 0) > 0;
    const paidAmount = isBalanceReceipt
      ? (booking.balanceDue ?? 0)
      : (booking.pricing.deposit || 0);

    if (paidAmount > 0) {
      // Per-bucket capacity = bucket total − already-logged amount.
      // Synth (in PaymentHistory) fills whatever neither this nor a
      // future entry covers, so we don't subtract synth here.
      const baseCharge = booking.pricing.baseCharge || 0;
      const addOnTotal = booking.pricing.addOnTotal || 0;
      const securityDeposit = booking.pricing.securityDeposit || 0;
      const loggedRental = (booking.payments || []).reduce((s, p) => s + (p.rentalAmount || 0), 0);
      const loggedAddOn = (booking.payments || []).reduce((s, p) => s + (p.addOnAmount || 0), 0);
      const loggedDeposit = (booking.payments || []).reduce((s, p) => s + (p.depositAmount || 0), 0);
      let capRental = Math.max(0, baseCharge - loggedRental);
      let capAddOn = Math.max(0, addOnTotal - loggedAddOn);
      let capDeposit = Math.max(0, securityDeposit - loggedDeposit);

      let rentalAmount = 0;
      let addOnAmount = 0;
      let depositAmount = 0;
      let remaining = paidAmount;
      if (isBalanceReceipt) {
        // Balance fills the END buckets first — the customer's initial
        // payment was already against deposit + rental, so what's
        // left is typically post-edit add-ons.
        addOnAmount = Math.min(remaining, capAddOn); remaining -= addOnAmount; capAddOn -= addOnAmount;
        rentalAmount = Math.min(remaining, capRental); remaining -= rentalAmount; capRental -= rentalAmount;
        depositAmount = Math.min(remaining, capDeposit); remaining -= depositAmount; capDeposit -= depositAmount;
      } else {
        // Initial fills the FOUNDATIONAL buckets first — refundable
        // deposit + venue rental cover the booking's commitment;
        // anything left spills into add-ons.
        depositAmount = Math.min(remaining, capDeposit); remaining -= depositAmount; capDeposit -= depositAmount;
        rentalAmount = Math.min(remaining, capRental); remaining -= rentalAmount; capRental -= rentalAmount;
        addOnAmount = Math.min(remaining, capAddOn); remaining -= addOnAmount; capAddOn -= addOnAmount;
      }
      // Edge case — if buckets are full but customer somehow paid
      // more, dump the overflow into add-ons so the entry total still
      // matches paidAmount exactly.
      addOnAmount += remaining;

      const update: Record<string, unknown> = {
        status: 'confirmed',
        paymentVerifiedAt: serverTimestamp(),
        payments: arrayUnion({
          rentalAmount,
          addOnAmount,
          depositAmount,
          amount: paidAmount,
          method: (booking.paymentMethod || 'fps') as 'fps' | 'bank' | 'stripe' | 'cash' | 'other',
          kind: isBalanceReceipt ? 'balance' : 'initial',
          note: null,
          recordedBy: 'admin-receipt-approve',
          recordedAt: new Date().toISOString(),
        }),
        updatedAt: serverTimestamp(),
      };
      if (isBalanceReceipt) {
        update.balanceDue = 0;
        update.balancePaidAt = serverTimestamp();
      }
      await updateDoc(doc(db, 'bookings', bookingId), update);
    } else {
      // No amount to record (rare — corrupt booking). Just flip status.
      await updateBookingStatus(bookingId, 'confirmed');
    }

    // Send the booking-confirmation email (mirrors Stripe webhook flow).
    fetch('/api/email/payment-confirmed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId }),
    }).catch((err) => console.warn('[payment-confirmed email] failed:', err));
    // Staff notification — same email the Stripe webhook fires when a
    // payment lands. Without this, offline payments were silently confirmed
    // and admin/CS never got the "new confirmed booking" email.
    fetch('/api/admin/notify-booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId }),
    }).catch((err) => console.warn('[notify-booking] failed:', err));
    // Sync Google Calendar — use booking-edit-followup syncOnly path,
    // which handles BOTH cases: updates the existing event if one is
    // already pushed (so cleared balanceDue / new add-ons / refreshed
    // pricing reflect on the calendar), or creates a fresh event if
    // none exists yet. The older /api/google/push-booking POST was a
    // no-op on already-pushed events, so a balance-receipt approval
    // never refreshed the "⚠️ 未找清尾數" warning.
    fetch('/api/admin/booking-edit-followup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId, syncOnly: true }),
    }).catch((err) => console.warn('[gcal sync] failed:', err));
    // Trigger TTLock passcode generation. The API does eligibility checking,
    // so this no-ops when the booking is > 2 days out (cron picks it up).
    // Failures are non-fatal — admin can retry from the booking detail page.
    tryGenerateLockPasscode(bookingId).catch((err) =>
      console.warn('[ttlock] post-approve generate failed:', err),
    );
    await loadBookings();
  };

  const handleReject = async (bookingId: string) => {
    await cancelBooking(bookingId);
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
