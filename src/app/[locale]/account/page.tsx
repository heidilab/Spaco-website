'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import { useAuth } from '@/contexts/AuthContext';
import { getUserProfile, getUserBookings, updateUserProfile } from '@/lib/firestore';
import { isValidHkPhone, normalizeHkPhone } from '@/lib/whatsapp';
import { UserProfile, BookingRecord } from '@/types';
import { venues } from '@/lib/venues';
import AuthModal from '@/components/auth/AuthModal';
import { User, Sparkles, CalendarDays, Save, Clock, Users as UsersIcon } from 'lucide-react';
import { motion } from 'framer-motion';

const statusLabels: Record<string, { zh: string; en: string }> = {
  pending: { zh: '待付款', en: 'Pending payment' },
  awaiting_payment: { zh: '待付款', en: 'Awaiting Payment' },
  awaiting_review: { zh: '待核實', en: 'Awaiting Review' },
  confirmed: { zh: '已確認', en: 'Confirmed' },
  completed: { zh: '已完成', en: 'Completed' },
  cancelled: { zh: '已取消', en: 'Cancelled' },
};

export default function AccountPage() {
  const locale = useLocale() as 'zh' | 'en';
  const { user, loading: authLoading } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [bookings, setBookings] = useState<BookingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [authModalOpen, setAuthModalOpen] = useState(false);

  // Editable fields
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsappPhone, setWhatsappPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    Promise.all([getUserProfile(user.uid), getUserBookings(user.uid)]).then(([p, bs]) => {
      if (p) {
        const profile = p as unknown as UserProfile;
        setProfile(profile);
        setDisplayName(profile.displayName || '');
        setPhone(profile.phone || '');
        setWhatsappPhone(profile.whatsappPhone || '');
      }
      setBookings(bs);
      setLoading(false);
    });
  }, [user, authLoading]);

  if (authLoading || loading) {
    return (
      <div className="pt-28 min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-ink-soft">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="pt-28 min-h-screen relative overflow-hidden">
        <div className="orb orb-pink animate-float-slow" style={{ width: 280, height: 280, top: '-60px', right: '-60px', opacity: 0.5 }} />
        <div className="max-content mx-auto px-6 md:px-12 lg:px-20 py-16 text-center relative z-10">
          <div className="glass-card p-10 max-w-md mx-auto">
            <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-gradient-pink flex items-center justify-center text-white shadow-glow">
              <User size={28} />
            </div>
            <h1 className="text-heading font-display mb-4">
              <span className="text-gradient-warm">{locale === 'zh' ? '請先登入' : 'Please Log In'}</span>
            </h1>
            <button onClick={() => setAuthModalOpen(true)} className="btn-primary">
              {locale === 'zh' ? '登入 / 註冊' : 'Log In / Sign Up'}
            </button>
          </div>
          <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} />
        </div>
      </div>
    );
  }

  async function handleSave() {
    if (!user) return;
    setError(null);
    setSaved(false);

    const wa = whatsappPhone.trim();
    if (wa && !isValidHkPhone(wa)) {
      setError(locale === 'zh' ? 'WhatsApp 號碼格式不正確' : 'Invalid WhatsApp number format');
      return;
    }
    setSaving(true);
    try {
      await updateUserProfile(user.uid, {
        displayName: displayName.trim(),
        phone: phone.trim(),
        whatsappPhone: wa ? normalizeHkPhone(wa) || wa : '',
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      console.error(err);
      setError(locale === 'zh' ? '儲存失敗' : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pt-28 pb-20 min-h-screen relative overflow-hidden">
      <div className="orb orb-pink animate-float-slow" style={{ width: 280, height: 280, top: '-60px', right: '-60px', opacity: 0.4 }} />
      <div className="max-content mx-auto px-6 md:px-12 lg:px-20 relative z-10">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl mx-auto space-y-6">
          <div className="mb-6">
            <span className="chip mb-3">
              <User size={12} className="text-pink" />
              Account
            </span>
            <h1 className="text-heading font-display">
              <span className="text-ink">{locale === 'zh' ? '會員' : 'My'}</span>
              <span>{' '}</span>
              <span className="text-gradient-pink">{locale === 'zh' ? '中心' : 'Account'}</span>
            </h1>
          </div>

          {/* Loyalty points */}
          <div className="glass-card p-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-gradient-pink flex items-center justify-center text-white">
                <Sparkles size={20} />
              </div>
              <div>
                <p className="text-xs text-ink-soft">{locale === 'zh' ? '會員積分結餘' : 'Loyalty Points'}</p>
                <p className="text-2xl font-bold font-display text-gradient-pink">{(profile?.loyaltyPoints || 0).toLocaleString()}</p>
              </div>
            </div>
            <p className="text-xs text-ink-soft text-right max-w-[140px]">
              {locale === 'zh' ? '$1 等於 1 分。下次預訂可抵扣現金。' : '$1 = 1 point. Redeemable on next booking.'}
            </p>
          </div>

          {/* My bookings — inline preview of the 3 most recent visible bookings.
              Mirrors my-bookings page filtering: hide pending+no-payment-method,
              cancelled, and offline-awaiting bookings whose 30-min hold expired. */}
          <div className="glass-card p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-lg flex items-center gap-2">
                <CalendarDays size={18} className="text-pink" />
                {locale === 'zh' ? '我的預訂' : 'My Bookings'}
              </h2>
              <Link
                href="/my-bookings"
                className="text-xs text-pink font-semibold hover:underline"
              >
                {locale === 'zh' ? '查看全部 →' : 'View all →'}
              </Link>
            </div>

            {(() => {
              const now = Date.now();
              const visible = bookings.filter((b) => {
                if (b.status === 'pending' && !b.paymentMethod) return false;
                if (b.status === 'cancelled') return false;
                const isOfflineAwaiting =
                  b.status === 'awaiting_payment' &&
                  b.paymentMethod !== 'stripe' &&
                  !b.receiptUrl;
                if (
                  isOfflineAwaiting &&
                  typeof b.pendingExpiresAt === 'number' &&
                  b.pendingExpiresAt <= now
                )
                  return false;
                return true;
              });
              if (visible.length === 0) {
                return (
                  <p className="text-sm text-ink-soft text-center py-6">
                    {locale === 'zh' ? '暫無預訂記錄' : 'No bookings yet'}
                  </p>
                );
              }
              return (
                <div className="space-y-2">
                  {visible.slice(0, 3).map((b) => {
                    const venue = venues.find((v) => v.id === b.venueId);
                    return (
                      <Link
                        key={b.id}
                        href="/my-bookings"
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3 rounded-xl bg-white/60 border border-charcoal/10 hover:border-accent transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm truncate">
                            {venue?.name[locale] || b.venueId}
                          </p>
                          <div className="flex flex-wrap gap-3 text-xs text-ink-soft mt-1">
                            <span className="flex items-center gap-1">
                              <CalendarDays size={11} /> {b.date}
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock size={11} /> {b.startTime}–{b.endTime}
                            </span>
                            <span className="flex items-center gap-1">
                              <UsersIcon size={11} /> {b.guestCount} {locale === 'zh' ? '人' : 'pax'}
                            </span>
                          </div>
                        </div>
                        <span className="text-xs px-2.5 py-1 rounded-pill bg-white/70 border border-charcoal/10 text-ink-soft self-start sm:self-auto">
                          {statusLabels[b.status]?.[locale] || b.status}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              );
            })()}
          </div>

          {/* Profile edit */}
          <div className="glass-card p-7 space-y-4">
            <h2 className="font-bold text-lg">{locale === 'zh' ? '個人資料' : 'Profile'}</h2>

            <Field
              label={locale === 'zh' ? '電郵地址' : 'Email'}
              value={profile?.email || user.email || ''}
              onChange={() => {}}
              disabled
              hint={locale === 'zh' ? '電郵地址不可修改' : 'Email cannot be changed'}
            />
            <Field
              label={locale === 'zh' ? '顯示名稱' : 'Display name'}
              value={displayName}
              onChange={setDisplayName}
              placeholder={locale === 'zh' ? '你想我哋點稱呼你' : 'How we should call you'}
            />
            <Field
              label={locale === 'zh' ? 'WhatsApp 號碼' : 'WhatsApp'}
              value={whatsappPhone}
              onChange={setWhatsappPhone}
              placeholder="+852 9XXXXXXX"
              hint={locale === 'zh' ? '場地密碼會 send 去呢個號碼及 email' : 'Venue passcode will be sent to this number and your email'}
            />

            {error && <p className="text-sm text-rose-500">{error}</p>}
            {saved && <p className="text-sm text-emerald-600">{locale === 'zh' ? '已儲存 ✓' : 'Saved ✓'}</p>}

            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-accent text-white px-6 py-2.5 rounded-lg font-semibold hover:bg-accent/90 transition-colors flex items-center gap-2 disabled:opacity-40"
            >
              <Save size={16} />
              {saving ? (locale === 'zh' ? '儲存中…' : 'Saving…') : (locale === 'zh' ? '儲存變更' : 'Save changes')}
            </button>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  disabled,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-ink-soft mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full px-4 py-2.5 rounded-lg border border-charcoal/15 bg-white/60 text-sm focus:outline-none focus:border-accent disabled:opacity-60 disabled:cursor-not-allowed"
      />
      {hint && <p className="text-xs text-ink-soft mt-1">{hint}</p>}
    </div>
  );
}
