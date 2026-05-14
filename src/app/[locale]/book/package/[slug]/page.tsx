'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import { useParams, notFound } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  ArrowLeft, ArrowRight, Calendar, Clock, Sparkles, Check,
  AlertCircle, MessageCircle, Palette, Image as ImageIcon, Plus, Minus, Users,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { getUserProfile, updateUserWhatsapp } from '@/lib/firestore';
import { getVenueBySlug } from '@/lib/venues';
import { getPackageBySlug, CATEGORY_LABEL } from '@/lib/packages';
import HolidayDatePicker from '@/components/booking/HolidayDatePicker';
import {
  isValidHkPhone, formatHkPhone, normalizeHkPhone,
} from '@/lib/whatsapp';
import { DECORATION_STYLES, type DecorationId } from '@/lib/decorations';
import { getSiteImageByKey } from '@/lib/content';

/**
 * Helper: turn an HH:mm string into total minutes since 00:00.
 */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}
function toHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export default function PackageBookingPage() {
  const params = useParams();
  const locale = useLocale() as 'zh' | 'en';
  const { user } = useAuth();
  const slug = params.slug as string;
  const pkg = getPackageBySlug(slug);

  if (!pkg) notFound();

  const venue = getVenueBySlug(
    // map venue id → slug
    pkg.venueId === 'cwb' ? 'causeway-bay'
    : pkg.venueId === 'wanchai' ? 'wan-chai'
    : pkg.venueId === 'tst' ? 'tsim-sha-tsui'
    : pkg.venueId === 'sw-a' ? 'sheung-wan-a'
    : pkg.venueId === 'sw-b' ? 'sheung-wan-b'
    : pkg.venueId === 'sw-ab' ? 'sheung-wan-ab'
    : ''
  );

  // ===== Date / time =====
  const [selectedDate, setSelectedDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [minDate, setMinDate] = useState('');

  useEffect(() => {
    const d = new Date();
    if (pkg.minAdvanceDays) d.setDate(d.getDate() + pkg.minAdvanceDays);
    setMinDate(d.toISOString().split('T')[0]);
  }, [pkg.minAdvanceDays]);

  // Allowed start time options: from earliestStart up to
  // (latestEnd − durationHours), in 30-minute increments.
  const startTimeOptions = useMemo(() => {
    const out: string[] = [];
    const earliest = toMinutes(pkg.earliestStart);
    const latestStart = toMinutes(pkg.latestEnd) - pkg.durationHours * 60;
    for (let m = earliest; m <= latestStart; m += 30) {
      out.push(toHHMM(m));
    }
    return out;
  }, [pkg]);

  // Default start time = first option (so something is selected by default)
  useEffect(() => {
    if (!startTime && startTimeOptions.length > 0) {
      setStartTime(startTimeOptions[0]);
    }
  }, [startTimeOptions, startTime]);

  // Computed end time = start + durationHours
  const endTime = useMemo(() => {
    if (!startTime) return '';
    return toHHMM(toMinutes(startTime) + pkg.durationHours * 60);
  }, [startTime, pkg.durationHours]);

  // Day-of-week guard
  const isDayAllowed = useMemo(() => {
    if (!selectedDate) return true;
    if (pkg.allowedDaysOfWeek.length === 0) return true;
    return pkg.allowedDaysOfWeek.includes(new Date(selectedDate).getDay());
  }, [selectedDate, pkg.allowedDaysOfWeek]);

  // ===== WhatsApp =====
  const [whatsappPhone, setWhatsappPhone] = useState('');
  const [savedWhatsappPhone, setSavedWhatsappPhone] = useState('');
  const [whatsappConfirmed, setWhatsappConfirmed] = useState(false);

  useEffect(() => {
    if (!user) return;
    getUserProfile(user.uid).then((p) => {
      if (!p) return;
      const stored = (p as { whatsappPhone?: string }).whatsappPhone || '';
      if (stored) {
        setSavedWhatsappPhone(stored);
        setWhatsappPhone(stored);
      }
    });
  }, [user]);

  const isWhatsappValid = isValidHkPhone(whatsappPhone);
  const whatsappReady =
    isWhatsappValid &&
    (whatsappConfirmed ||
      normalizeHkPhone(whatsappPhone) !== normalizeHkPhone(savedWhatsappPhone) ||
      !savedWhatsappPhone);

  // ===== Terms =====
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  // ===== Decoration style (required for birthday package only) =====
  const requiresDecoration = pkg.category === 'birthday';
  const [decorationStyle, setDecorationStyle] = useState<DecorationId | null>(null);
  const [decorImages, setDecorImages] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!requiresDecoration) return;
    Promise.all(
      DECORATION_STYLES.map(async (d) => {
        const img = await getSiteImageByKey(d.imageKey).catch(() => null);
        return [d.imageKey, img?.url || ''] as const;
      }),
    ).then((entries) => {
      const map: Record<string, string> = {};
      for (const [k, v] of entries) if (v) map[k] = v;
      setDecorImages(map);
    });
  }, [requiresDecoration]);

  // ===== Add-ons (e.g. BBQ catering for the corporate package) =====
  // Map of addOn.id → guest count (0 = not selected)
  const [addOnGuests, setAddOnGuests] = useState<Record<string, number>>({});
  const addOnTotal = useMemo(() => {
    if (!pkg.addOns) return 0;
    return pkg.addOns.reduce((sum, a) => {
      const n = addOnGuests[a.id] || 0;
      return sum + n * a.pricePerPerson;
    }, 0);
  }, [pkg.addOns, addOnGuests]);

  // ===== Guest count (extra-pax surcharge) =====
  // Defaults to the package's basePax (e.g. 4 for the mahjong table).
  // Each guest above basePax is charged the package's extraPaxPrice.
  const [guestCount, setGuestCount] = useState<number>(pkg.basePax || 1);
  const extraPaxCharge = useMemo(() => {
    if (pkg.basePax == null || pkg.extraPaxPrice == null) return 0;
    return Math.max(0, guestCount - pkg.basePax) * pkg.extraPaxPrice;
  }, [pkg.basePax, pkg.extraPaxPrice, guestCount]);

  // ===== Totals =====
  const total = pkg.price + extraPaxCharge + pkg.deposit + addOnTotal;

  // ===== Proceed gate =====
  const canProceed =
    !!selectedDate && !!startTime && isDayAllowed && agreedToTerms && whatsappReady &&
    (!requiresDecoration || !!decorationStyle);

  // ===== Submit (placeholder until full payment flow) =====
  const handleProceed = async () => {
    if (!canProceed) return;
    if (user && whatsappReady) {
      const e164 = normalizeHkPhone(whatsappPhone);
      if (e164) {
        try { await updateUserWhatsapp(user.uid, e164); } catch { /* non-blocking */ }
      }
    }
    // Booking submission not yet wired — see project TODOs.
  };

  return (
    <div className="pt-28 pb-20 relative overflow-hidden">
      {/* Decorative orbs (party vibe) */}
      <div className="orb orb-pink animate-float-slow" style={{ width: 300, height: 300, top: '-60px', left: '5%', opacity: 0.5 }} />
      <div className="orb orb-coral animate-float-medium" style={{ width: 200, height: 200, top: '40%', right: '-40px', opacity: 0.45 }} />
      <div className="orb orb-lavender animate-float-fast" style={{ width: 160, height: 160, bottom: '10%', left: '10%', opacity: 0.4 }} />

      <div className="max-content mx-auto px-6 md:px-12 lg:px-20 relative z-10">
        {/* Back — route based on package category */}
        <div className="py-6">
          {pkg.category === 'birthday' ? (
            <Link href="/family" className="inline-flex items-center gap-2 text-sm text-ink-soft hover:text-pink transition-colors">
              <ArrowLeft size={16} />
              {locale === 'zh' ? '返回親子派對' : 'Back to Family'}
            </Link>
          ) : pkg.category === 'corporate' ? (
            <Link href="/corporate-package" className="inline-flex items-center gap-2 text-sm text-ink-soft hover:text-pink transition-colors">
              <ArrowLeft size={16} />
              {locale === 'zh' ? '返回企業包場' : 'Back to Corporate Package'}
            </Link>
          ) : (
            <Link href={venue ? `/branches/${venue.slug}` : '/'} className="inline-flex items-center gap-2 text-sm text-ink-soft hover:text-pink transition-colors">
              <ArrowLeft size={16} />
              {locale === 'zh' ? '返回分店' : 'Back to Branch'}
            </Link>
          )}
        </div>

        {/* Hero */}
        <div className="mb-10">
          <span className="chip mb-3">
            <Sparkles size={12} className="text-pink" />
            {CATEGORY_LABEL[pkg.category][locale]}
          </span>
          <h1 className="text-heading font-display">
            <span className="text-ink">{pkg.name[locale].split(' ')[0]}</span>
            <span>{' '}</span>
            <span className="text-gradient-pink">{pkg.name[locale].split(' ').slice(1).join(' ')}</span>
          </h1>
          <p className="text-lg text-ink-soft mt-3">{pkg.shortDesc[locale]}</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* LEFT — Date + time + WhatsApp */}
          <div className="lg:col-span-2 space-y-6">
            {/* Date */}
            <div className="glass-card p-7 md:p-8">
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                <Calendar size={20} className="text-pink" />
                {locale === 'zh' ? '揀活動日期' : 'Select Date'}
              </h2>
              <HolidayDatePicker
                value={selectedDate}
                onChange={setSelectedDate}
                minDate={minDate}
                locale={locale}
              />
              {pkg.minAdvanceDays && (
                <p className="mt-3 text-xs text-ink-soft">
                  {locale === 'zh'
                    ? `※ 此套餐需要最少 ${pkg.minAdvanceDays} 日前預訂`
                    : `※ This package requires booking at least ${pkg.minAdvanceDays} days in advance`}
                </p>
              )}
              {selectedDate && !isDayAllowed && (
                <p className="mt-3 text-sm text-rose-600 font-medium">
                  {locale === 'zh' ? '⚠️ 此套餐唔接受揀呢一日，請揀其他日子。' : '⚠️ This package is not available on the chosen day.'}
                </p>
              )}
            </div>

            {/* Start time */}
            <div className="glass-card p-7 md:p-8">
              <h2 className="text-xl font-bold mb-2 flex items-center gap-2">
                <Clock size={20} className="text-lavender" />
                {locale === 'zh' ? '揀開始時間' : 'Start Time'}
              </h2>
              <p className="text-xs text-ink-soft mb-4">
                {locale === 'zh'
                  ? `每節 ${pkg.durationHours} 小時固定．最早 ${pkg.earliestStart}．最遲 ${pkg.latestEnd} 完結`
                  : `${pkg.durationHours}-hour fixed slot · earliest ${pkg.earliestStart} · latest end ${pkg.latestEnd}`}
              </p>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                {startTimeOptions.map((t) => {
                  const sel = t === startTime;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setStartTime(t)}
                      className={`py-2.5 px-3 rounded-pill text-sm font-medium transition-all border ${
                        sel
                          ? 'bg-gradient-pink text-white border-transparent shadow-glow'
                          : 'bg-white/60 text-ink border-white/80 hover:bg-white/90 backdrop-blur-md'
                      }`}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
              {startTime && (
                <div className="mt-4 p-3 rounded-2xl bg-pink/10 border border-pink/20 text-sm">
                  <span className="text-ink-soft">{locale === 'zh' ? '活動時段：' : 'Session: '}</span>
                  <span className="font-bold text-ink">{startTime} – {endTime}</span>
                  <span className="text-ink-soft ml-2">({pkg.durationHours} {locale === 'zh' ? '小時' : 'hours'})</span>
                </div>
              )}
            </div>

            {/* Guest count — only shown for packages that charge per-extra-pax
                (e.g. the mahjong package: 4 included, +$300 each extra). */}
            {pkg.basePax != null && pkg.extraPaxPrice != null && (
              <div className="glass-card p-7 md:p-8">
                <h2 className="text-xl font-bold mb-2 flex items-center gap-2">
                  <Users size={20} className="text-pink" />
                  {locale === 'zh' ? '人數' : 'Guests'}
                </h2>
                <p className="text-xs text-ink-soft mb-4">
                  {locale === 'zh'
                    ? `套餐包括 ${pkg.basePax} 人，每位加 $${pkg.extraPaxPrice}`
                    : `Package includes ${pkg.basePax} pax; each extra +$${pkg.extraPaxPrice}`}
                </p>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setGuestCount(Math.max(pkg.basePax || 1, guestCount - 1))}
                    className="p-2 rounded-xl bg-white/80 border border-white/90"
                    aria-label="Decrease"
                  >
                    <Minus size={14} />
                  </button>
                  <input
                    type="number"
                    min={pkg.basePax}
                    value={guestCount}
                    onChange={(e) => setGuestCount(Math.max(pkg.basePax || 1, parseInt(e.target.value) || pkg.basePax || 1))}
                    className="w-20 px-3 py-2 rounded-xl bg-white/80 border border-white/90 text-ink text-sm font-bold text-center"
                  />
                  <button
                    type="button"
                    onClick={() => setGuestCount(guestCount + 1)}
                    className="p-2 rounded-xl bg-white/80 border border-white/90"
                    aria-label="Increase"
                  >
                    <Plus size={14} />
                  </button>
                  {extraPaxCharge > 0 && (
                    <span className="text-sm text-ink-soft ml-2">
                      {locale === 'zh' ? `額外 ` : `+`}<span className="font-bold text-pink">HK${extraPaxCharge.toLocaleString()}</span>
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Decoration style picker — required, free choice of 3 (birthday only) */}
            {requiresDecoration && (
            <div className="glass-card p-7 md:p-8">
              <h2 className="text-xl font-bold mb-2 flex items-center gap-2">
                <Palette size={20} className="text-pink" />
                {locale === 'zh' ? '揀佈置款式' : 'Decoration Style'}
                <span className="text-rose-500 text-sm">*</span>
              </h2>
              <p className="text-xs text-ink-soft mb-4">
                {locale === 'zh'
                  ? '套餐免費包基本佈置，請揀一款 colour theme（3 款全部免費）。'
                  : 'Basic decoration is included free — pick one of the 3 colour themes below.'}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {DECORATION_STYLES.map((style) => {
                  const sel = decorationStyle === style.id;
                  const url = decorImages[style.imageKey];
                  return (
                    <button
                      key={style.id}
                      type="button"
                      onClick={() => setDecorationStyle(style.id)}
                      className={`relative text-left rounded-2xl overflow-hidden transition-all border-2 ${
                        sel
                          ? 'border-pink shadow-glow ring-2 ring-pink/30'
                          : 'border-white/70 hover:border-pink/50'
                      }`}
                    >
                      <div className="aspect-square overflow-hidden bg-cream">
                        {url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={url} alt={style.label[locale]} className="w-full h-full object-cover" />
                        ) : (
                          <div className={`w-full h-full ${style.fallbackGradient} flex items-center justify-center`}>
                            <ImageIcon size={28} className="text-white/80" />
                          </div>
                        )}
                      </div>
                      <div className="p-3 bg-white/80 backdrop-blur-md">
                        <p className="font-bold text-ink text-sm">{style.label[locale]}</p>
                        <p className="text-[11px] text-ink-soft leading-snug mt-0.5">{style.description[locale]}</p>
                      </div>
                      {sel && (
                        <div className="absolute top-2 right-2 w-7 h-7 rounded-full bg-gradient-pink flex items-center justify-center shadow-glow">
                          <Check size={14} className="text-white" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            )}

            {/* Optional Add-ons (e.g. BBQ catering for corporate) */}
            {pkg.addOns && pkg.addOns.length > 0 && (
              <div className="glass-card p-7 md:p-8">
                <h2 className="text-xl font-bold mb-2 flex items-center gap-2">
                  <Plus size={20} className="text-coral" />
                  {locale === 'zh' ? '可選加購' : 'Optional Add-ons'}
                </h2>
                <p className="text-xs text-ink-soft mb-4">
                  {locale === 'zh'
                    ? '揀啱嘅加購服務，按人數計算費用。'
                    : 'Pick add-ons; pricing scales with guest count.'}
                </p>
                <div className="space-y-3">
                  {pkg.addOns.map((addOn) => {
                    const count = addOnGuests[addOn.id] || 0;
                    const enabled = count > 0;
                    return (
                      <div
                        key={addOn.id}
                        className={`rounded-2xl border p-4 transition-colors ${
                          enabled ? 'border-coral bg-coral/5' : 'border-white/80 bg-white/40'
                        }`}
                      >
                        <label className="flex items-start gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={enabled}
                            onChange={(e) => {
                              setAddOnGuests((prev) => ({
                                ...prev,
                                [addOn.id]: e.target.checked ? Math.max(prev[addOn.id] || 12, 12) : 0,
                              }));
                            }}
                            className="w-5 h-5 mt-0.5 flex-shrink-0 accent-coral"
                          />
                          <div className="flex-1">
                            <div className="flex items-center justify-between gap-3">
                              <p className="font-bold text-ink text-sm">{addOn.label[locale]}</p>
                              <p className="text-sm font-bold text-coral">
                                +HK${addOn.pricePerPerson}
                                <span className="text-xs font-normal text-ink-soft">
                                  /{locale === 'zh' ? '位' : 'person'}
                                </span>
                              </p>
                            </div>
                            {addOn.description && (
                              <p className="text-xs text-ink-soft mt-1">{addOn.description[locale]}</p>
                            )}
                          </div>
                        </label>
                        {enabled && (
                          <div className="mt-3 pl-8 flex items-center gap-3">
                            <label className="text-xs text-ink-soft">
                              {locale === 'zh' ? '人數' : 'Guests'}
                            </label>
                            <input
                              type="number"
                              min={1}
                              max={50}
                              value={count}
                              onChange={(e) => {
                                const n = Math.max(1, Math.min(50, parseInt(e.target.value) || 0));
                                setAddOnGuests((prev) => ({ ...prev, [addOn.id]: n }));
                              }}
                              className="w-20 px-3 py-1.5 rounded-xl bg-white/80 border border-white/90 text-ink text-sm font-medium"
                            />
                            <span className="text-xs text-ink-soft">
                              = HK${(count * addOn.pricePerPerson).toLocaleString()}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* WhatsApp + Terms */}
            <div className="glass-card p-7 md:p-8 space-y-5">
              {/* WhatsApp */}
              <div>
                <label className="text-xs text-ink-soft font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <MessageCircle size={12} className="text-emerald-600" />
                  {locale === 'zh' ? 'WhatsApp 聯絡電話' : 'WhatsApp Contact'}
                  <span className="text-rose-500">*</span>
                </label>
                {savedWhatsappPhone && !whatsappConfirmed && normalizeHkPhone(whatsappPhone) === normalizeHkPhone(savedWhatsappPhone) && (
                  <div className="mb-3 p-3 rounded-xl bg-amber-100/80 border border-amber-300 text-xs text-amber-800">
                    <p className="font-semibold mb-1.5">
                      {locale === 'zh' ? '請核對你的 WhatsApp 號碼' : 'Please confirm your WhatsApp number'}
                    </p>
                    <p className="mb-2">
                      {locale === 'zh' ? '上次預訂使用：' : 'Last used: '}
                      <span className="font-mono">{formatHkPhone(savedWhatsappPhone)}</span>
                    </p>
                    <button
                      type="button"
                      onClick={() => setWhatsappConfirmed(true)}
                      className="px-3 py-1 rounded-pill bg-emerald-500 text-white text-xs font-semibold hover:bg-emerald-600"
                    >
                      ✓ {locale === 'zh' ? '確認號碼正確' : 'Confirm number'}
                    </button>
                  </div>
                )}
                <input
                  type="tel"
                  value={whatsappPhone}
                  onChange={(e) => {
                    setWhatsappPhone(e.target.value);
                    setWhatsappConfirmed(false);
                  }}
                  placeholder={locale === 'zh' ? '例如：9282 3060' : 'e.g. 9282 3060'}
                  className="w-full px-4 py-3 rounded-xl bg-white/60 backdrop-blur-md border border-white/80 text-ink"
                />
                {whatsappPhone && !isWhatsappValid && (
                  <p className="text-xs text-rose-600 mt-2 flex items-center gap-1">
                    <AlertCircle size={12} />
                    {locale === 'zh' ? '請輸入有效嘅香港電話號碼（8 位數字）' : 'Please enter a valid HK phone number (8 digits)'}
                  </p>
                )}
                {isWhatsappValid && whatsappReady && (
                  <p className="text-xs text-emerald-600 mt-2">
                    ✓ {formatHkPhone(whatsappPhone)} {locale === 'zh' ? '已確認' : 'confirmed'}
                  </p>
                )}
              </div>

              {/* Terms */}
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreedToTerms}
                  onChange={(e) => setAgreedToTerms(e.target.checked)}
                  className="w-5 h-5 mt-0.5 flex-shrink-0 accent-pink"
                />
                <span className="text-sm text-ink-soft">
                  {locale === 'zh' ? (
                    <>
                      我已閱讀並同意遵守
                      <Link href="/guidelines" className="text-pink underline hover:text-pink/80" target="_blank">
                        預訂須知
                      </Link>
                      <span className="text-rose-500 ml-1">*</span>
                    </>
                  ) : (
                    <>
                      I have read and agree to the{' '}
                      <Link href="/guidelines" className="text-pink underline hover:text-pink/80" target="_blank">
                        Booking Guidelines
                      </Link>
                      <span className="text-rose-500 ml-1">*</span>
                    </>
                  )}
                </span>
              </label>
            </div>
          </div>

          {/* RIGHT — Sticky package summary */}
          <div className="lg:col-span-1">
            <motion.div
              className="glass-strong rounded-3xl p-6 lg:sticky lg:top-28"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <p className="text-xs text-ink-soft uppercase tracking-wider font-semibold mb-1">
                {CATEGORY_LABEL[pkg.category][locale]}
              </p>
              <h3 className="text-lg font-bold font-display text-ink mb-4">
                {venue?.name[locale] || pkg.venueId}
              </h3>

              {/* Inclusions */}
              <ul className="space-y-2 mb-6">
                {pkg.includes[locale].map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-ink-soft">
                    <Check size={14} className="text-emerald-500 flex-shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>

              {/* Price breakdown */}
              <div className="bg-white/40 backdrop-blur-md rounded-2xl border border-white/60 p-4 space-y-2 mb-5">
                <div className="flex justify-between text-sm">
                  <span className="text-ink-soft">
                    {locale === 'zh' ? '套餐費用' : 'Package fee'}
                    {pkg.basePax != null && (
                      <span className="text-xs opacity-70 ml-1">
                        ({locale === 'zh' ? `包括 ${pkg.basePax} 人` : `${pkg.basePax} pax incl.`})
                      </span>
                    )}
                  </span>
                  <span className="font-bold text-ink">HK${pkg.price.toLocaleString()}</span>
                </div>
                {extraPaxCharge > 0 && pkg.basePax != null && pkg.extraPaxPrice != null && (
                  <div className="flex justify-between text-sm">
                    <span className="text-ink-soft">
                      {locale === 'zh'
                        ? `額外 ${guestCount - pkg.basePax} 人 × $${pkg.extraPaxPrice}`
                        : `+${guestCount - pkg.basePax} pax × $${pkg.extraPaxPrice}`}
                    </span>
                    <span className="font-medium text-ink">HK${extraPaxCharge.toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-ink-soft">{locale === 'zh' ? '可退按金' : 'Refundable deposit'}</span>
                  <span className="font-medium text-ink">HK${pkg.deposit.toLocaleString()}</span>
                </div>
                {pkg.addOns?.map((a) => {
                  const n = addOnGuests[a.id] || 0;
                  if (n === 0) return null;
                  return (
                    <div key={a.id} className="flex justify-between text-sm">
                      <span className="text-ink-soft">
                        {a.label[locale]} × {n}
                      </span>
                      <span className="font-medium text-ink">
                        HK${(n * a.pricePerPerson).toLocaleString()}
                      </span>
                    </div>
                  );
                })}
                <div className="border-t border-white/60 pt-2 flex justify-between items-baseline">
                  <span className="text-sm text-ink-soft">{locale === 'zh' ? '總計（首期）' : 'Total (upfront)'}</span>
                  <span className="font-bold font-display text-2xl text-gradient-pink">
                    HK${total.toLocaleString()}
                  </span>
                </div>
              </div>

              <p className="text-xs text-ink-soft mb-4 leading-relaxed">
                {pkg.category === 'birthday'
                  ? (locale === 'zh'
                      ? '⓵ 套餐已包氣球佈置同無酒精飲品任飲，不限人頭。⓶ 按金將於活動結束後 24 小時內退還（如無扣款）。'
                      : '⓵ Includes balloon decor & unlimited soft drinks, no per-head charge. ⓶ Deposit refunded within 24 hours of event end (no deductions).')
                  : (locale === 'zh'
                      ? '⓵ 套餐已包場地包場同無酒精飲品任飲。⓶ 按金將於活動結束後 24 小時內退還（如無扣款）。'
                      : '⓵ Includes venue exclusive & unlimited soft drinks. ⓶ Deposit refunded within 24 hours of event end (no deductions).')}
              </p>

              {/* Proceed */}
              <button
                onClick={handleProceed}
                disabled={!canProceed}
                className="btn-primary w-full justify-center text-base disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {locale === 'zh' ? '繼續預訂' : 'Continue to Payment'}
                <ArrowRight size={16} />
              </button>
              {!canProceed && selectedDate && (
                <p className="mt-2 text-xs text-rose-600 text-center">
                  {requiresDecoration && !decorationStyle
                    ? (locale === 'zh' ? '請揀佈置款式' : 'Please choose a decoration style')
                    : !whatsappReady
                    ? (locale === 'zh' ? '請填寫並確認 WhatsApp 號碼' : 'Please confirm WhatsApp number')
                    : !agreedToTerms
                    ? (locale === 'zh' ? '請先同意預訂須知' : 'Please agree to the Booking Guidelines')
                    : !isDayAllowed
                    ? (locale === 'zh' ? '此日期唔接受' : 'This date is not allowed')
                    : ''}
                </p>
              )}
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}
