'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { useParams } from 'next/navigation';
import { useRouter } from '@/i18n/routing';
import { useAuth } from '@/contexts/AuthContext';
import { getBooking, updateBookingReceiptUploaded } from '@/lib/firestore';
import { storage } from '@/lib/firebase';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { BookingRecord } from '@/types';
import { PAYMENT_DETAILS } from '@/lib/paymentDetails';
import { generateWhatsAppLink } from '@/lib/email';
import { Copy, Check, Upload, MessageCircle, Clock } from 'lucide-react';
import { motion } from 'framer-motion';

export default function PayOfflinePage() {
  const locale = useLocale() as 'zh' | 'en';
  const params = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const bookingId = params.id as string;

  const [booking, setBooking] = useState<BookingRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadDone, setUploadDone] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Live countdown until pendingExpiresAt
  const [now, setNow] = useState<number>(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.push('/');
      return;
    }
    getBooking(bookingId)
      .then((b) => {
        if (!b) setError(locale === 'zh' ? '找不到預訂記錄' : 'Booking not found');
        else if (b.userId !== user.uid) setError(locale === 'zh' ? '無權查看此預訂' : 'Not authorized');
        else setBooking(b);
      })
      .finally(() => setLoading(false));
  }, [bookingId, user, authLoading, router, locale]);

  if (authLoading || loading) {
    return <div className="pt-28 min-h-screen flex items-center justify-center"><div className="animate-pulse text-ink-soft">Loading...</div></div>;
  }
  if (error || !booking) {
    return <div className="pt-28 min-h-screen flex items-center justify-center"><p className="text-rose-500">{error || 'Error'}</p></div>;
  }

  const expiresAt = typeof booking.pendingExpiresAt === 'number' ? booking.pendingExpiresAt : 0;
  const msLeft = Math.max(0, expiresAt - now);
  const expired = expiresAt > 0 && msLeft === 0;
  const minsLeft = Math.floor(msLeft / 60000);
  const secsLeft = Math.floor((msLeft % 60000) / 1000);

  // Detect whether this is a BALANCE payment (50% deposit case where
  // the customer already paid the upfront via Stripe/FPS and now owes
  // the remainder) vs an INITIAL deposit payment.
  //
  // Mirrors the receipt-approve flow in admin/receipts so the customer
  // sees the SAME number the admin will clear when the screenshot is
  // approved — previously this page always showed `pricing.deposit`
  // (upfront amount), which meant a customer paying balance saw the
  // wrong figure (e.g. balance $8,300 but page showed deposit $7,300)
  // and risked transferring too little. The receipt-approve path then
  // cleared balanceDue=0 silently regardless of the amount actually
  // received, hiding the shortfall.
  const isBalancePayment =
    booking.status === 'confirmed' && (booking.balanceDue ?? 0) > 0;
  const amountDue = isBalancePayment
    ? (booking.balanceDue ?? 0)
    : (booking.pricing.deposit || 0);
  const amountLabelZh = isBalancePayment ? '尾數' : '應付金額';
  const amountLabelEn = isBalancePayment ? 'Balance' : 'Amount due';
  const paymentNounZh = isBalancePayment ? '尾數' : '線下付款';
  const paymentNounEn = isBalancePayment ? 'balance' : 'offline payment';

  const whatsappMsg =
    locale === 'zh'
      ? `你好，我已完成${paymentNounZh}付款。\n預訂編號：${bookingId}\n金額：HK$${amountDue.toLocaleString()}\n（已附上付款截圖）`
      : `Hi, I've completed the ${paymentNounEn}.\nBooking ID: ${bookingId}\nAmount: HK$${amountDue.toLocaleString()}\n(Receipt attached)`;
  const whatsappLink = generateWhatsAppLink(PAYMENT_DETAILS.fps.digitsOnly, whatsappMsg);

  function copy(label: string, value: string) {
    navigator.clipboard.writeText(value).then(() => {
      setCopiedField(label);
      setTimeout(() => setCopiedField(null), 1500);
    });
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !booking) return;
    setError(null);
    setUploading(true);
    try {
      const filename = `${Date.now()}-${file.name.replace(/[^\w.-]/g, '_')}`;
      const path = `receipts/${booking.id}/${filename}`;
      const ref = storageRef(storage, path);
      await uploadBytes(ref, file);
      const url = await getDownloadURL(ref);
      await updateBookingReceiptUploaded(booking.id, url);
      // Fire-and-forget — admin/CS get an email so they know to review the
      // receipt. Failure shouldn't block the customer-facing success state.
      fetch('/api/admin/notify-receipt-pending', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id }),
      }).catch((err) => console.warn('[notify-receipt-pending] failed:', err));
      setUploadDone(true);
    } catch (err) {
      console.error(err);
      setError(locale === 'zh' ? '上載失敗，請重試' : 'Upload failed, please retry');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="pt-28 pb-20 relative overflow-hidden">
      <div className="orb orb-pink animate-float-slow" style={{ width: 280, height: 280, top: '-60px', right: '-60px', opacity: 0.4 }} />
      <div className="max-content mx-auto px-6 md:px-12 lg:px-20 relative z-10">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl mx-auto space-y-6">
          <div>
            <h1 className="text-heading font-display">
              <span className="text-gradient-pink">{locale === 'zh' ? '線下付款' : 'Offline Payment'}</span>
            </h1>
            <p className="text-ink-soft mt-2 text-sm">
              {locale === 'zh' ? amountLabelZh : amountLabelEn}：
              <span className="font-bold text-ink ml-1">HK${amountDue.toLocaleString()}</span>
            </p>
          </div>

          {/* Hold timer warning */}
          {expiresAt > 0 && (
            <div className={`rounded-xl p-4 text-sm flex items-start gap-3 ${expired ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-800'}`}>
              <Clock size={18} className="mt-0.5 flex-shrink-0" />
              <div className="space-y-1">
                {expired ? (
                  <p className="font-semibold">{locale === 'zh' ? '此預約已逾時（30 分鐘）' : 'This booking has expired (30 min hold)'}</p>
                ) : (
                  <p className="font-semibold">
                    {locale === 'zh' ? `預約暫留：${minsLeft} 分 ${secsLeft.toString().padStart(2, '0')} 秒` : `Hold expires in: ${minsLeft}m ${secsLeft.toString().padStart(2, '0')}s`}
                  </p>
                )}
                <p className="text-xs">
                  {locale === 'zh'
                    ? '請於 30 分鐘內完成付款，否則預約會自動取消而不另行通知。你亦可離開此頁面，稍後登入會員中心上載付款截圖。'
                    : 'Complete payment within 30 minutes or the booking will be auto-cancelled. You can also leave this page and upload your receipt later from your account.'}
                </p>
              </div>
            </div>
          )}

          {/* Payment instructions */}
          <div className="glass-card p-7 space-y-4">
            <h2 className="font-bold text-lg">{locale === 'zh' ? '付款方式' : 'Payment Methods'}</h2>

            <div className="space-y-3">
              <DetailRow label="FPS" value={PAYMENT_DETAILS.fps.display} copiedField={copiedField} onCopy={copy} field="fps" />
              <DetailRow
                label={locale === 'zh' ? '銀行' : 'Bank'}
                value={PAYMENT_DETAILS.bank.name}
                copiedField={copiedField}
                onCopy={copy}
                field="bankName"
              />
              <DetailRow
                label={locale === 'zh' ? '戶口號碼' : 'Account No.'}
                value={PAYMENT_DETAILS.bank.accountNumber}
                copiedField={copiedField}
                onCopy={copy}
                field="accountNumber"
              />
              <DetailRow
                label={locale === 'zh' ? '戶口名稱' : 'Name'}
                value={PAYMENT_DETAILS.bank.accountHolder}
                copiedField={copiedField}
                onCopy={copy}
                field="accountHolder"
              />
              <DetailRow
                label={locale === 'zh' ? '預訂編號' : 'Booking ID'}
                value={booking.id}
                copiedField={copiedField}
                onCopy={copy}
                field="bookingId"
              />
            </div>
          </div>

          {/* Upload */}
          <div className="glass-card p-7 space-y-4">
            <h2 className="font-bold text-lg">{locale === 'zh' ? '上載付款截圖' : 'Upload Payment Screenshot'}</h2>

            {uploadDone ? (
              <div className="rounded-xl bg-emerald-50 p-4 text-emerald-700 text-sm flex items-center gap-2">
                <Check size={18} />
                {locale === 'zh' ? '已收到截圖！我們核實後會 send confirmation email。' : 'Receipt received! We\'ll email you once verified.'}
              </div>
            ) : (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={handleUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={uploading || expired}
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full bg-accent text-white py-4 rounded-xl font-bold text-base hover:bg-accent/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Upload size={18} />
                  {uploading
                    ? (locale === 'zh' ? '上載中…' : 'Uploading…')
                    : (locale === 'zh' ? '揀選截圖檔案' : 'Choose file')}
                </button>
                <p className="text-xs text-ink-soft text-center">
                  {locale === 'zh' ? '或者經 WhatsApp 傳送畀我哋（請附上訂單編號）' : 'Or send via WhatsApp (include booking ID)'}
                </p>
                <a
                  href={whatsappLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#25D366] text-white rounded-xl font-semibold hover:opacity-90"
                >
                  <MessageCircle size={18} />
                  {locale === 'zh' ? 'WhatsApp 通知付款' : 'Notify via WhatsApp'}
                </a>
              </>
            )}

            {error && <p className="text-sm text-rose-500">{error}</p>}
          </div>

          {uploadDone && (
            <button
              onClick={() => router.push('/my-bookings')}
              className="w-full py-3 text-sm text-ink-soft hover:text-pink"
            >
              {locale === 'zh' ? '返回我的預訂' : 'Back to my bookings'}
            </button>
          )}
        </motion.div>
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  copiedField,
  onCopy,
  field,
}: {
  label: string;
  value: string;
  copiedField: string | null;
  onCopy: (label: string, value: string) => void;
  field: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex-1 min-w-0">
        <p className="text-xs text-ink-soft">{label}</p>
        <p className="font-mono font-medium text-ink text-sm break-all">{value}</p>
      </div>
      <button
        type="button"
        onClick={() => onCopy(field, value)}
        className="px-3 py-2 rounded-lg bg-white/60 border border-charcoal/15 text-xs text-ink-soft hover:text-accent flex items-center gap-1 flex-shrink-0"
      >
        {copiedField === field ? <Check size={14} /> : <Copy size={14} />}
        {copiedField === field ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
