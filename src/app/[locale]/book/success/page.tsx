'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import { useSearchParams } from 'next/navigation';
import { getBooking } from '@/lib/firestore';
import { venues } from '@/lib/venues';
import { BookingRecord } from '@/types';
import { generateWhatsAppLink } from '@/lib/email';
import { Check, CalendarDays, MessageCircle, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';

export default function BookingSuccessPage() {
  const locale = useLocale() as 'zh' | 'en';
  const searchParams = useSearchParams();
  const bookingId = searchParams.get('booking_id');
  const [booking, setBooking] = useState<BookingRecord | null>(null);

  useEffect(() => {
    if (bookingId) {
      getBooking(bookingId).then(setBooking);
    }
  }, [bookingId]);

  const venue = booking ? venues.find((v) => v.id === booking.venueId) : null;
  const whatsappNumber = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || '85292823060';
  const whatsappMsg = booking
    ? locale === 'zh'
      ? `你好，我已完成預訂付款。\n預訂編號：${bookingId}\n場地：${venue?.name.zh}\n日期：${booking.date}\n時間：${booking.startTime}-${booking.endTime}`
      : `Hi, I've completed my booking payment.\nBooking ID: ${bookingId}\nVenue: ${venue?.name.en}\nDate: ${booking.date}\nTime: ${booking.startTime}-${booking.endTime}`
    : '';

  return (
    <div className="pt-28 min-h-screen flex items-center relative overflow-hidden">
      {/* Celebratory orbs */}
      <div className="orb orb-pink animate-float-slow" style={{ width: 320, height: 320, top: '-80px', right: '-60px', opacity: 0.6 }} />
      <div className="orb orb-lavender animate-float-medium" style={{ width: 240, height: 240, bottom: '-60px', left: '-40px', opacity: 0.55 }} />
      <div className="orb orb-coral animate-float-fast" style={{ width: 140, height: 140, top: '20%', left: '15%', opacity: 0.55 }} />
      <div className="orb orb-sky animate-float-slow" style={{ width: 130, height: 130, bottom: '20%', right: '15%', opacity: 0.5 }} />

      <div className="max-content mx-auto px-6 md:px-12 lg:px-20 py-12 relative z-10 w-full">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-lg mx-auto"
        >
          <div className="glass-card p-8 md:p-10 text-center">
            {/* Success Icon */}
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
              className="w-20 h-20 rounded-full bg-gradient-pink flex items-center justify-center mx-auto mb-6 shadow-glow"
            >
              <Check size={36} className="text-white" strokeWidth={3} />
            </motion.div>

            <h1 className="text-heading font-display mb-3">
              <span className="text-gradient-warm">
                {locale === 'zh' ? '預約成功！' : 'Booking Confirmed!'}
              </span>
            </h1>
            <p className="text-ink-soft mb-8">
              {locale === 'zh'
                ? '感謝你的預訂，場地密碼將於活動前 1-2 天發送。'
                : 'Thank you for your booking. The venue access code will be sent 1-2 days before your event.'}
            </p>

            {/* Booking Summary */}
            {booking && venue && (
              <div className="bg-white/40 backdrop-blur-md rounded-2xl p-5 border border-white/60 text-left mb-8">
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-ink-soft">{locale === 'zh' ? '預訂編號' : 'Booking ID'}</span>
                    <span className="font-mono font-medium text-ink">{bookingId?.slice(0, 8)}...</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-soft">{locale === 'zh' ? '場地' : 'Venue'}</span>
                    <span className="font-medium text-ink">{venue.name[locale]}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-soft">{locale === 'zh' ? '日期' : 'Date'}</span>
                    <span className="font-medium text-ink">{booking.date}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-soft">{locale === 'zh' ? '時間' : 'Time'}</span>
                    <span className="font-medium text-ink">{booking.startTime} - {booking.endTime}</span>
                  </div>
                  <div className="flex justify-between border-t border-white/60 pt-3">
                    <span className="text-ink-soft">{locale === 'zh' ? '總額' : 'Total'}</span>
                    <span className="font-bold text-lg font-display text-gradient-pink">HK${booking.pricing.subtotal.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="space-y-3">
              <a
                href={generateWhatsAppLink(whatsappNumber, whatsappMsg)}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-[#25D366] text-white rounded-pill font-semibold hover:-translate-y-0.5 transition-transform shadow-glow"
                style={{ boxShadow: '0 10px 30px -8px rgba(37, 211, 102, 0.55)' }}
              >
                <MessageCircle size={18} />
                {locale === 'zh' ? 'WhatsApp 聯繫我們' : 'Contact Us on WhatsApp'}
              </a>

              <Link href="/my-bookings" className="w-full flex items-center justify-center gap-2 btn-glass">
                <CalendarDays size={18} />
                {locale === 'zh' ? '查看我的預訂' : 'View My Bookings'}
              </Link>

              <Link href="/" className="w-full flex items-center justify-center gap-2 px-6 py-3 text-sm text-ink-soft hover:text-pink transition-colors">
                {locale === 'zh' ? '返回首頁' : 'Back to Home'}
                <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
