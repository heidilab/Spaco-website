'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import { useAuth } from '@/contexts/AuthContext';
import { getUserProfile, updateUserProfile } from '@/lib/firestore';
import { isValidHkPhone, normalizeHkPhone } from '@/lib/whatsapp';
import { UserProfile } from '@/types';
import AuthModal from '@/components/auth/AuthModal';
import { User, Sparkles, CalendarDays, Save } from 'lucide-react';
import { motion } from 'framer-motion';

export default function AccountPage() {
  const locale = useLocale() as 'zh' | 'en';
  const { user, loading: authLoading } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
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
    getUserProfile(user.uid).then((p) => {
      if (p) {
        const profile = p as unknown as UserProfile;
        setProfile(profile);
        setDisplayName(profile.displayName || '');
        setPhone(profile.phone || '');
        setWhatsappPhone(profile.whatsappPhone || '');
      }
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

          {/* Quick links */}
          <Link
            href="/my-bookings"
            className="glass-card p-5 flex items-center justify-between hover:-translate-y-0.5 transition-transform"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-white/60 flex items-center justify-center">
                <CalendarDays size={18} className="text-pink" />
              </div>
              <p className="font-semibold">{locale === 'zh' ? '我的預訂' : 'My Bookings'}</p>
            </div>
            <span className="text-ink-soft text-sm">→</span>
          </Link>

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
              label={locale === 'zh' ? '聯絡電話' : 'Phone'}
              value={phone}
              onChange={setPhone}
              placeholder="+852 9XXXXXXX"
            />
            <Field
              label={locale === 'zh' ? 'WhatsApp 號碼' : 'WhatsApp'}
              value={whatsappPhone}
              onChange={setWhatsappPhone}
              placeholder="+852 9XXXXXXX"
              hint={locale === 'zh' ? '預訂確認、場地密碼會 send 去呢個號碼' : 'Booking confirmations and venue passcodes will go here'}
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
