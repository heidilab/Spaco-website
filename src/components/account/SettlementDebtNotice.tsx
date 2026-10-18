'use client';

/**
 * Login warning for unpaid post-event settlement debt (Heidi 2026-10-18).
 * Shown once per browser session after sign-in, and again whenever the
 * customer opens a booking page, until the debt is paid. The booking APIs
 * enforce the block server-side; this only explains it and links straight
 * to the existing balance payment page (KPay or FPS).
 */
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useLocale } from 'next-intl';
import { AlertTriangle } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { useAuth } from '@/contexts/AuthContext';
import { getUserBookings } from '@/lib/firestore';
import { getVenueById } from '@/lib/venues';
import { outstandingDebts, type OutstandingDebt } from '@/lib/settlementDebt';

const isBookingPath = (path: string) =>
  /\/book\//.test(path) && !/\/(pay-balance|pay-offline|success)(\/|$)/.test(path);

export default function SettlementDebtNotice() {
  const locale = useLocale() as 'zh' | 'en';
  const zh = locale === 'zh';
  const pathname = usePathname() || '';
  const { user } = useAuth();
  const [debts, setDebts] = useState<OutstandingDebt[]>([]);
  const [open, setOpen] = useState(false);

  const onAdmin = /^\/(zh|en)\/admin(\/|$)/.test(pathname);
  const onPaymentPage = /\/(pay-balance|pay-offline)(\/|$)/.test(pathname);

  useEffect(() => {
    let active = true;
    if (!user || onAdmin) { setDebts([]); setOpen(false); return; }
    getUserBookings(user.uid)
      .then((bookings) => {
        if (!active) return;
        // Preview stamps bookings isTest; production ignores test debts.
        const preview = !/^(www\.)?spacohk\.com$/.test(window.location.hostname);
        const found = outstandingDebts(bookings, { includeTest: preview });
        setDebts(found);
        if (!found.length || onPaymentPage) { setOpen(false); return; }
        let seen = false;
        try { seen = sessionStorage.getItem(`spaco-debt-notice-${user.uid}`) === '1'; } catch { /* private mode */ }
        setOpen(!seen || isBookingPath(pathname));
      })
      .catch(() => { /* never block the page on a failed read; the server still enforces */ });
    return () => { active = false; };
  }, [user, pathname, onAdmin, onPaymentPage]);

  if (!open || !debts.length || !user) return null;

  const dismiss = () => {
    try { sessionStorage.setItem(`spaco-debt-notice-${user.uid}`, '1'); } catch { /* ignore */ }
    setOpen(false);
  };
  const total = debts.reduce((s, d) => s + d.amount, 0);

  return (
    <>
      <div className="fixed inset-0 bg-charcoal/50 z-[80]" onClick={dismiss} />
      <div role="alertdialog" aria-modal="true" aria-labelledby="debt-notice-title"
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[81] w-[calc(100%-2rem)] max-w-md glass-strong rounded-3xl p-6 sm:p-8 shadow-glass-lg">
        <div className="flex items-start gap-3 mb-4">
          <AlertTriangle className="text-rose-500 shrink-0 mt-0.5" size={22} aria-hidden="true" />
          <div>
            <h2 id="debt-notice-title" className="text-lg font-bold text-ink">
              {zh ? '你有未補回嘅款項' : 'You have an unpaid balance'}
            </h2>
            <p className="text-sm text-ink-soft mt-1 leading-relaxed">
              {zh
                ? `以下已完場訂單結算後，按金不足以抵扣加時／賠償等費用，尚欠 HK$${total.toLocaleString()}。請立即補回；補款前無法預約新訂單。`
                : `After settlement, the deposit did not cover extra charges on the booking(s) below. HK$${total.toLocaleString()} is outstanding. Please pay now; new bookings are unavailable until it is paid.`}
            </p>
          </div>
        </div>
        <ul className="space-y-3 mb-5">
          {debts.map((d) => {
            const venue = d.venueId ? getVenueById(d.venueId) : undefined;
            return (
              <li key={d.bookingId} className="rounded-2xl border border-rose-200 bg-rose-50/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm">
                    <div className="font-semibold text-ink">{venue?.name[locale] || d.branchSlug || ''}</div>
                    <div className="text-ink-soft">{d.date} · #{d.bookingId.slice(0, 8)}</div>
                  </div>
                  <div className="text-right font-bold text-rose-700">HK${d.amount.toLocaleString()}</div>
                </div>
                {d.branchSlug && (
                  <Link href={`/book/${d.branchSlug}/pay-balance/${d.bookingId}`} onClick={() => setOpen(false)}
                    className="mt-3 w-full btn-primary justify-center text-sm min-h-11">
                    {zh ? '立即補款' : 'Pay now'}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
        <button onClick={dismiss} className="w-full btn-outline justify-center text-sm min-h-11">
          {zh ? '稍後處理' : 'Later'}
        </button>
      </div>
    </>
  );
}
