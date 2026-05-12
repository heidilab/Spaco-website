'use client';

import { useTranslations, useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import { useParams } from 'next/navigation';
import { useState, useMemo, useEffect } from 'react';
import { getVenueBySlug } from '@/lib/venues';
import { addOns, calculatePricing, noBBQVenues, freeDrinksVenues, hotpotVenues, bbqStandardPriceByVenue, bbqStandardMenu, bbqPremiumMenu, hotpotStandardMenu, hotpotSeafoodMenu, hotpotSoupBases, calcShishaPrice, SHISHA_STAFF_SETUP_FEE, SHISHA_MAX_PIPES } from '@/lib/pricing';
import type { AddOnOptions } from '@/types';
import {
  ArrowLeft, ArrowRight, Calendar, Clock, Users,
  Plus, Minus, AlertCircle, Check, Info, MessageCircle,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { notFound } from 'next/navigation';
import SplitHeading from '@/components/ui/SplitHeading';
import { getHoliday } from '@/lib/hkHolidays';
import HolidayDatePicker from '@/components/booking/HolidayDatePicker';
import { useAuth } from '@/contexts/AuthContext';
import { getUserProfile, updateUserWhatsapp, createBooking } from '@/lib/firestore';
import { isValidHkPhone, formatHkPhone, normalizeHkPhone } from '@/lib/whatsapp';
import AuthModal from '@/components/auth/AuthModal';
import { useRouter } from '@/i18n/routing';
import { PAYMENT_DETAILS } from '@/lib/paymentDetails';

export default function BookingPage() {
  const params = useParams();
  const locale = useLocale() as 'zh' | 'en';
  const t = useTranslations('booking');
  const { user } = useAuth();
  const router = useRouter();
  const slug = params.branchSlug as string;
  const venue = getVenueBySlug(slug);

  if (!venue) {
    notFound();
  }

  // Booking state
  const [selectedDate, setSelectedDate] = useState('');
  const [startTime, setStartTime] = useState('14:00');
  const [endTime, setEndTime] = useState('19:00');
  // Set min-date on client only — avoids SSR / client time mismatch
  const [minDate, setMinDate] = useState<string>('');
  useEffect(() => {
    setMinDate(new Date().toISOString().split('T')[0]);
  }, []);
  // Adults / children split. Children (1–9 yo) count as 0.5 adult-equivalent
  // for the minimum-charge check and pay half on per-head charges (rental,
  // BBQ, hotpot, drinks). Total head count = adults + children.
  const [adultCount, setAdultCount] = useState(venue.minGuests.weekday);
  const [childCount, setChildCount] = useState(0);
  const guestCount = adultCount + childCount;
  const adultEquiv = adultCount + 0.5 * childCount;
  const [selectedAddOns, setSelectedAddOns] = useState<{ id: string; quantity: number; options?: AddOnOptions }[]>([]);
  const [hasBYOFood, setHasBYOFood] = useState(false);
  const [, setShowGrillWarning] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [expandedMenu, setExpandedMenu] = useState<string | null>(null);
  const [selectedSoupBases, setSelectedSoupBases] = useState<string[]>([]);

  // WhatsApp contact — required for booking confirmation. Pre-filled from
  // the user's saved profile so they can confirm or edit on each new booking.
  const [whatsappPhone, setWhatsappPhone] = useState('');
  const [savedWhatsappPhone, setSavedWhatsappPhone] = useState('');
  // True once the user has explicitly confirmed (or changed) the saved number
  const [whatsappConfirmed, setWhatsappConfirmed] = useState(false);

  // Booking submission state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);

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
  // The customer must either confirm a previously-saved number unchanged,
  // or supply a brand-new valid number.
  const whatsappReady =
    isWhatsappValid && (whatsappConfirmed || normalizeHkPhone(whatsappPhone) !== normalizeHkPhone(savedWhatsappPhone) || !savedWhatsappPhone);

  // Determine if peak day — charged at weekend rate.
  // Peak = Fri/Sat OR a HK public holiday OR the day BEFORE a public holiday.
  const isWeekend = useMemo(() => {
    if (!selectedDate) return false;
    const day = new Date(selectedDate).getDay();
    if (day === 5 || day === 6) return true;
    // Public holiday itself
    const todayHoliday = getHoliday(selectedDate);
    if (todayHoliday?.type === 'public') return true;
    // Day before a public holiday (eve)
    const next = new Date(selectedDate);
    next.setDate(next.getDate() + 1);
    const nextStr = next.toISOString().split('T')[0];
    const nextHoliday = getHoliday(nextStr);
    if (nextHoliday?.type === 'public') return true;
    return false;
  }, [selectedDate]);

  // For UI labelling — distinguish the actual reason for peak pricing
  const peakReason = useMemo(() => {
    if (!selectedDate) return null;
    const day = new Date(selectedDate).getDay();
    if (day === 5) return 'friday';
    if (day === 6) return 'saturday';
    if (getHoliday(selectedDate)?.type === 'public') return 'holiday';
    const next = new Date(selectedDate);
    next.setDate(next.getDate() + 1);
    if (getHoliday(next.toISOString().split('T')[0])?.type === 'public') return 'holiday-eve';
    return null;
  }, [selectedDate]);

  // Whole-day difference between today and the selected booking date.
  // Returns Infinity if no date selected, so add-ons aren't blocked
  // before the user picks a day.
  const daysUntilBooking = useMemo(() => {
    if (!selectedDate) return Infinity;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(selectedDate);
    target.setHours(0, 0, 0, 0);
    return Math.round((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  }, [selectedDate]);

  // BBQ / Hotpot / Shisha must be ordered at least 2 calendar days
  // before the booking date (e.g. ordering today for tomorrow → blocked).
  const tooSoonForExtras = daysUntilBooking < 2;

  // Add-on ids that require 2-day advance ordering (food / shisha)
  const needsAdvanceIds = useMemo(
    () => new Set(['bbq-standard', 'bbq-premium', 'bbq-grill', 'hotpot-standard', 'hotpot-seafood', 'hotpot-extra-soup', 'shisha']),
    []
  );

  // If the date moves to within 2 days, automatically deselect anything
  // that needs advance ordering — and surface a one-time warning.
  useEffect(() => {
    if (!tooSoonForExtras) return;
    setSelectedAddOns((prev) => prev.filter((a) => !needsAdvanceIds.has(a.id)));
    setHasBYOFood(false);
  }, [tooSoonForExtras, needsAdvanceIds]);

  // Auto-adjust guest count when date changes
  const minGuests = isWeekend ? venue.minGuests.weekend : venue.minGuests.weekday;
  const minHours = isWeekend ? venue.minHours.weekend : venue.minHours.weekday;

  // When date changes (and weekday/weekend tier with it), bump adult count
  // up so adult-equivalent meets the new minimum. Children count unchanged.
  useEffect(() => {
    if (!selectedDate) return;
    setAdultCount((prevAdults) => {
      const equiv = prevAdults + 0.5 * childCount;
      if (equiv >= minGuests) return prevAdults;
      // Need (minGuests - 0.5 × childCount) adults at minimum.
      return Math.ceil(minGuests - 0.5 * childCount);
    });
  }, [selectedDate, minGuests, childCount]);

  // Calculate hours. Cross-midnight (end-time at or before start-time) is
  // treated as a next-day end, so 19:00 → 02:00 = 7 hours.
  const isOvernight = useMemo(() => {
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    return eh * 60 + em <= sh * 60 + sm;
  }, [startTime, endTime]);

  const hours = useMemo(() => {
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    const endMinutes = (isOvernight ? eh + 24 : eh) * 60 + em;
    return Math.max(1, (endMinutes - sh * 60 - sm) / 60);
  }, [startTime, endTime, isOvernight]);

  // End date (YYYY-MM-DD) when the booking crosses midnight. We assemble
  // the date from local components — toISOString() rolls back to UTC and
  // would land on the previous day for HKT users.
  const endDate = useMemo(() => {
    if (!selectedDate || !isOvernight) return null;
    const d = new Date(`${selectedDate}T00:00:00`);
    d.setDate(d.getDate() + 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }, [selectedDate, isOvernight]);

  // Pricing calculation
  const pricing = useMemo(() => {
    return calculatePricing(venue, isWeekend, Math.max(hours, minHours), guestCount, selectedAddOns, childCount);
  }, [venue, isWeekend, hours, minHours, guestCount, childCount, selectedAddOns]);

  // Add-on toggle
  const toggleAddOn = (id: string) => {
    const existing = selectedAddOns.find((a) => a.id === id);
    if (existing) {
      setSelectedAddOns(selectedAddOns.filter((a) => a.id !== id));
    } else {
      if (id === 'bbq-standard' || id === 'bbq-premium') {
        setSelectedAddOns([
          ...selectedAddOns.filter((a) => a.id !== 'bbq-standard' && a.id !== 'bbq-premium' && a.id !== 'bbq-grill'),
          { id, quantity: 1 },
        ]);
      } else {
        setSelectedAddOns([...selectedAddOns, { id, quantity: 1 }]);
      }
    }
  };

  // BYO Food handler
  const handleBYOFood = (checked: boolean) => {
    setHasBYOFood(checked);
    const hasBBQPackage = selectedAddOns.some(
      (a) => a.id === 'bbq-standard' || a.id === 'bbq-premium'
    );
    if (checked && !hasBBQPackage) {
      setShowGrillWarning(true);
      if (!selectedAddOns.find((a) => a.id === 'bbq-grill')) {
        setSelectedAddOns([...selectedAddOns, { id: 'bbq-grill', quantity: 1 }]);
      }
    } else {
      setShowGrillWarning(false);
    }
  };

  // Grill quantity
  const grillQuantity = selectedAddOns.find((a) => a.id === 'bbq-grill')?.quantity || 0;
  const setGrillQuantity = (qty: number) => {
    if (qty <= 0) {
      if (hasBYOFood) return;
      setSelectedAddOns(selectedAddOns.filter((a) => a.id !== 'bbq-grill'));
    } else {
      const capped = Math.min(qty, 2);
      const existing = selectedAddOns.find((a) => a.id === 'bbq-grill');
      if (existing) {
        setSelectedAddOns(selectedAddOns.map((a) => a.id === 'bbq-grill' ? { ...a, quantity: capped } : a));
      } else {
        setSelectedAddOns([...selectedAddOns, { id: 'bbq-grill', quantity: capped }]);
      }
    }
  };

  // ─── Shisha state helpers ───
  // Shisha customer model:
  //   • Pipes: 1 or 2 (max 2 simultaneous per venue)
  //   • Heads: ≥ pipes count. Each pipe needs at least 1 head to start;
  //     extra heads (heads - pipes) are pre-paid for mid-session swaps
  //     at $250 each.
  //   • Each head has its own flavor.
  //   • Optional flat staff-setup fee (+$180).
  // We persist `quantity = heads` on the addOns entry (so existing display
  // surfaces keep working with their ×N suffix) and `options.pipes` on
  // top of that.
  const shishaCatalogEntry = addOns.find((a) => a.id === 'shisha');
  const shishaEntry = selectedAddOns.find((a) => a.id === 'shisha');
  const shishaHeads = shishaEntry?.quantity || 0;
  const shishaPipes = shishaEntry?.options?.pipes || (shishaHeads > 0 ? Math.min(SHISHA_MAX_PIPES, shishaHeads) : 0);
  const shishaFlavors = shishaEntry?.options?.flavors || [];
  const shishaStaffSetup = !!shishaEntry?.options?.staffSetup;

  function writeShisha(next: { pipes: number; heads: number; flavors: string[]; staffSetup: boolean }) {
    if (next.heads === 0) {
      setSelectedAddOns(selectedAddOns.filter((a) => a.id !== 'shisha'));
      return;
    }
    const updated = {
      id: 'shisha',
      quantity: next.heads,
      options: {
        pipes: next.pipes,
        flavors: next.flavors,
        staffSetup: next.staffSetup,
      },
    };
    if (shishaEntry) {
      setSelectedAddOns(selectedAddOns.map((a) => a.id === 'shisha' ? updated : a));
    } else {
      setSelectedAddOns([...selectedAddOns, updated]);
    }
  }

  function setShishaPipes(nextPipes: number) {
    const pipes = Math.max(1, Math.min(SHISHA_MAX_PIPES, Math.floor(nextPipes)));
    // Heads must always be ≥ pipes. If user picks 2 pipes but had only 1
    // head, bump heads up. Otherwise keep existing heads.
    const heads = Math.max(pipes, shishaHeads);
    const prevFlavors = shishaFlavors;
    const flavors = Array.from({ length: heads }, (_, i) => prevFlavors[i] || 'A');
    writeShisha({ pipes, heads, flavors, staffSetup: shishaStaffSetup });
  }

  function setShishaHeads(nextHeads: number) {
    const heads = Math.max(0, Math.min(10, Math.floor(nextHeads)));
    if (heads === 0) {
      writeShisha({ pipes: 0, heads: 0, flavors: [], staffSetup: false });
      return;
    }
    // Floor pipes to current selection (or 1 for first add); ceil to heads
    // when heads is being lowered below current pipes count.
    const pipes = Math.max(1, Math.min(heads, shishaPipes || 1));
    const flavors = Array.from({ length: heads }, (_, i) => shishaFlavors[i] || 'A');
    writeShisha({ pipes, heads, flavors, staffSetup: shishaStaffSetup });
  }

  function setShishaFlavor(idx: number, flavorId: string) {
    if (!shishaEntry) return;
    const flavors = [...shishaFlavors];
    flavors[idx] = flavorId;
    writeShisha({ pipes: shishaPipes, heads: shishaHeads, flavors, staffSetup: shishaStaffSetup });
  }

  function toggleShishaStaffSetup() {
    if (!shishaEntry) return;
    writeShisha({ pipes: shishaPipes, heads: shishaHeads, flavors: shishaFlavors, staffSetup: !shishaStaffSetup });
  }

  // Time slot options
  const timeSlots = Array.from({ length: 24 }, (_, i) => {
    const h = String(i).padStart(2, '0');
    return `${h}:00`;
  });

  // Start time options: 10:00 → 23:00 (24-hour venue, allow late-night starts).
  const startTimeOptions = timeSlots.slice(10, 24);

  // End time options: 11:00 → 23:00 same-day, plus 00:00 → 06:00 next-day
  // (labelled "翌日" so customers see they're crossing midnight).
  const endTimeOptions: { value: string; label: string; nextDay: boolean }[] = [
    ...timeSlots.slice(11, 24).map((t) => ({ value: t, label: t, nextDay: false })),
    ...timeSlots.slice(0, 7).map((t) => ({
      value: t,
      label: locale === 'zh' ? `${t}（翌日）` : `${t} (next day)`,
      nextDay: true,
    })),
  ];

  // Filter add-ons based on venue
  const visibleAddOns = addOns.filter((a) => {
    if (a.id === 'shisha') return false;
    // Hide BBQ packages for venues without BBQ
    if ((a.id === 'bbq-standard' || a.id === 'bbq-premium' || a.id === 'bbq-grill') && noBBQVenues.includes(venue.id)) return false;
    // Hide drinks for venues with free drinks
    if (a.id === 'drinks' && freeDrinksVenues.includes(venue.id)) return false;
    return true;
  });

  // Can proceed check
  const canProceed = selectedDate && hours >= minHours && adultEquiv >= minGuests && agreedToTerms && whatsappReady;

  return (
    <div className="pt-28 pb-20 relative overflow-hidden">
      {/* Decorative orbs */}
      <div className="orb orb-pink animate-float-slow" style={{ width: 280, height: 280, top: '-60px', right: '-60px', opacity: 0.4 }} />
      <div className="orb orb-lavender animate-float-medium" style={{ width: 220, height: 220, top: '40%', left: '-60px', opacity: 0.35 }} />

      <div className="max-content mx-auto px-6 md:px-12 lg:px-20 relative z-10">
        {/* Back */}
        <div className="py-6">
          <Link
            href={`/branches/${venue.slug}`}
            className="inline-flex items-center gap-2 text-sm text-ink-soft hover:text-pink transition-colors"
          >
            <ArrowLeft size={16} />
            {venue.name[locale]}
          </Link>
        </div>

        <div className="mb-10">
          <span className="chip mb-3">
            <Calendar size={12} className="text-pink" />
            {t('title')}
          </span>
          <h1 className="text-heading font-display">
            <SplitHeading text={venue.name[locale]} accentClassName="text-gradient-pink" />
          </h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left: Booking Form */}
          <div className="lg:col-span-2 space-y-8">
            {/* Date Selection */}
            <div className="glass-card p-7 md:p-8">
              <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                <Calendar size={20} className="text-accent" />
                {t('selectDate')}
              </h2>
              <HolidayDatePicker
                value={selectedDate}
                onChange={setSelectedDate}
                minDate={minDate}
                locale={locale}
              />
              {selectedDate && (
                <div className="mt-3 text-sm space-y-1">
                  <p className="text-pink font-medium">
                    {isWeekend
                      ? (locale === 'zh' ? '🌟 高峰日收費（星期五/六/公眾假期及前夕）' : '🌟 Peak rate (Fri / Sat / Public Holiday & Eve)')
                      : (locale === 'zh' ? '平日收費（星期日至四）' : 'Weekday rate (Sun - Thu)')}
                  </p>
                  {peakReason === 'holiday' && (() => {
                    const h = getHoliday(selectedDate);
                    return h ? (
                      <p className="text-xs text-rose-600 font-medium">
                        {locale === 'zh' ? `📅 公眾假期：${h.name.zh}` : `📅 Public Holiday: ${h.name.en}`}
                      </p>
                    ) : null;
                  })()}
                  {peakReason === 'holiday-eve' && (() => {
                    const next = new Date(selectedDate);
                    next.setDate(next.getDate() + 1);
                    const h = getHoliday(next.toISOString().split('T')[0]);
                    return h ? (
                      <p className="text-xs text-rose-600 font-medium">
                        {locale === 'zh' ? `🎉 假期前夕：明日為${h.name.zh}` : `🎉 Holiday Eve: Tomorrow is ${h.name.en}`}
                      </p>
                    ) : null;
                  })()}
                  <p className="text-ink-soft">
                    {locale === 'zh' ? `最少預訂 ${minHours} 小時，最少 ${minGuests} 人` : `Min. ${minHours} hours, min. ${minGuests} guests`}
                  </p>
                </div>
              )}
            </div>

            {/* Time Selection */}
            <div className="glass-card p-7 md:p-8">
              <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                <Clock size={20} className="text-accent" />
                {t('selectTime')}
              </h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-muted mb-2 block">{t('startTime')}</label>
                  <select
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-charcoal/10 focus:outline-none focus:border-accent"
                  >
                    {startTimeOptions.map((time) => (
                      <option key={time} value={time}>{time}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm text-muted mb-2 block">{t('endTime')}</label>
                  <select
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-charcoal/10 focus:outline-none focus:border-accent"
                  >
                    {endTimeOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {isOvernight && endDate && (
                <div className="mt-4 p-4 bg-blue-50 rounded-xl flex items-start gap-3">
                  <Info size={18} className="text-blue-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-blue-700">
                    {locale === 'zh'
                      ? `此預訂跨越凌晨：${selectedDate} ${startTime} → ${endDate} ${endTime}，共 ${hours} 小時`
                      : `Overnight booking: ${selectedDate} ${startTime} → ${endDate} ${endTime} · ${hours} hours`}
                  </p>
                </div>
              )}

              {hours < minHours && (
                <div className="mt-4 p-4 bg-red-50 rounded-xl flex items-start gap-3">
                  <AlertCircle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-600">
                    {locale === 'zh'
                      ? `最低預訂時數為 ${minHours} 小時`
                      : `Minimum booking is ${minHours} hours`}
                  </p>
                </div>
              )}
            </div>

            {/* Guest Count — adults + children split */}
            <div className="glass-card p-7 md:p-8">
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                <Users size={20} className="text-accent" />
                {locale === 'zh' ? '預約人數' : 'Number of Guests'}
              </h2>

              {/* Adult stepper */}
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="font-semibold">{locale === 'zh' ? '成人' : 'Adults'}</p>
                  <p className="text-xs text-muted">{locale === 'zh' ? '10 歲或以上' : 'Age 10+'}</p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      // Floor the adult count so adult-equiv stays ≥ minGuests.
                      const floor = Math.max(0, Math.ceil(minGuests - 0.5 * childCount));
                      setAdultCount(Math.max(floor, adultCount - 1));
                    }}
                    disabled={adultCount <= Math.max(0, Math.ceil(minGuests - 0.5 * childCount))}
                    className="w-10 h-10 rounded-xl border border-charcoal/10 flex items-center justify-center hover:bg-cream transition-colors disabled:opacity-30"
                  >
                    <Minus size={16} />
                  </button>
                  <span className="text-2xl font-bold w-12 text-center">{adultCount}</span>
                  <button
                    onClick={() => setAdultCount(adultCount + 1)}
                    className="w-10 h-10 rounded-xl border border-charcoal/10 flex items-center justify-center hover:bg-cream transition-colors"
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </div>

              {/* Child stepper */}
              <div className="flex items-center justify-between border-t border-white/40 pt-4">
                <div>
                  <p className="font-semibold">{locale === 'zh' ? '小童' : 'Children'}</p>
                  <p className="text-xs text-muted">
                    {locale === 'zh' ? '1-9 歲（半價：場租／燒烤／火鍋／飲品）' : 'Age 1–9 (half-price: rental / BBQ / hotpot / drinks)'}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setChildCount(Math.max(0, childCount - 1))}
                    disabled={childCount <= 0}
                    className="w-10 h-10 rounded-xl border border-charcoal/10 flex items-center justify-center hover:bg-cream transition-colors disabled:opacity-30"
                  >
                    <Minus size={16} />
                  </button>
                  <span className="text-2xl font-bold w-12 text-center">{childCount}</span>
                  <button
                    onClick={() => setChildCount(childCount + 1)}
                    className="w-10 h-10 rounded-xl border border-charcoal/10 flex items-center justify-center hover:bg-cream transition-colors"
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </div>

              {/* Summary line */}
              <div className="mt-4 p-3 rounded-xl bg-cream/40 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-ink-soft">{locale === 'zh' ? '總人數' : 'Total guests'}</span>
                  <span className="font-semibold">{guestCount} {locale === 'zh' ? '人' : 'pax'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-soft">
                    {locale === 'zh' ? '計價人數（小童 ½）' : 'Charged equivalent (kids ½)'}
                  </span>
                  <span className={`font-semibold ${adultEquiv < minGuests ? 'text-rose-600' : ''}`}>
                    {adultEquiv} {locale === 'zh' ? `／ 最少 ${minGuests}` : `/ min ${minGuests}`}
                  </span>
                </div>
              </div>
              {adultEquiv < minGuests && (
                <p className="mt-2 text-xs text-rose-600 flex items-start gap-1">
                  <AlertCircle size={12} className="mt-0.5 shrink-0" />
                  {locale === 'zh'
                    ? `未達最低消費。需要 ${minGuests} 人計價（成人 + 小童 × 0.5）。`
                    : `Below minimum charge. Need ${minGuests} adult-equivalent (adults + children × 0.5).`}
                </p>
              )}
            </div>

            {/* Add-ons */}
            <div className={`glass-card p-7 md:p-8 ${tooSoonForExtras ? 'pointer-events-none opacity-60' : ''}`}>
              <h2 className="text-xl font-bold mb-6">{t('addOns')}</h2>

              {/* 2-day advance notice */}
              {tooSoonForExtras && selectedDate && (
                <div className="mb-5 p-4 rounded-2xl bg-rose-100/80 border border-rose-200 text-sm text-rose-700 pointer-events-auto">
                  <p className="font-semibold mb-1">
                    {locale === 'zh'
                      ? `⏰ 加購服務需活動日 2 日前預訂`
                      : '⏰ Add-on services require 2-day advance booking'}
                  </p>
                  <p className="text-xs leading-relaxed">
                    {locale === 'zh'
                      ? `BBQ 套餐／火鍋套餐／Shisha 等加購均需於活動日期前最少 2 日訂購。揀返一個 ${new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0]} 之後嘅日期就可以加購。`
                      : `BBQ packages, hotpot packages and shisha must be ordered at least 2 days in advance. Choose a date on or after ${new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0]} to enable add-ons.`}
                  </p>
                </div>
              )}

              <div className="space-y-4">
                {/* BBQ Standard Package */}
                {visibleAddOns.some((a) => a.id === 'bbq-standard') && (() => {
                  const isSelected = selectedAddOns.some((a) => a.id === 'bbq-standard');
                  const isExpanded = expandedMenu === 'bbq-standard';
                  const price = bbqStandardPriceByVenue[venue.id] || 158;
                  return (
                    <div className={`rounded-2xl border transition-all ${isSelected ? 'border-accent bg-accent/5' : 'border-charcoal/5'}`}>
                      <div className="flex items-center justify-between p-5">
                        <div className="flex-1" onClick={() => toggleAddOn('bbq-standard')} role="button">
                          <p className="font-semibold">{locale === 'zh' ? 'BBQ 標準套餐（肉類及丸）' : 'BBQ Standard (Meat & Balls)'}</p>
                          <p className="text-sm text-muted mt-1">{locale === 'zh' ? `每位 +$${price}` : `$${price}/pax`}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <button onClick={() => setExpandedMenu(isExpanded ? null : 'bbq-standard')} className="text-xs text-accent hover:underline">
                            {isExpanded ? (locale === 'zh' ? '收起菜單' : 'Hide Menu') : (locale === 'zh' ? '查看菜單' : 'View Menu')}
                          </button>
                          <div onClick={() => toggleAddOn('bbq-standard')} role="button" className={`w-6 h-6 rounded-full border-2 flex items-center justify-center cursor-pointer ${isSelected ? 'border-accent bg-accent' : 'border-charcoal/20'}`}>
                            {isSelected && <Check size={14} className="text-white" />}
                          </div>
                        </div>
                      </div>
                      {isExpanded && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} className="px-5 pb-5 border-t border-charcoal/5">
                          <div className="pt-4 grid grid-cols-2 gap-x-4 gap-y-1">
                            {bbqStandardMenu[locale].map((item, i) => (
                              <p key={i} className="text-sm text-charcoal/70">• {item}</p>
                            ))}
                          </div>
                          <div className="mt-4 space-y-1">
                            {bbqStandardMenu.notes[locale].map((note, i) => (
                              <p key={i} className="text-[11px] text-muted">《{note}》</p>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </div>
                  );
                })()}

                {/* BBQ Premium Package */}
                {visibleAddOns.some((a) => a.id === 'bbq-premium') && (() => {
                  const isSelected = selectedAddOns.some((a) => a.id === 'bbq-premium');
                  const isExpanded = expandedMenu === 'bbq-premium';
                  return (
                    <div className={`rounded-2xl border transition-all ${isSelected ? 'border-accent bg-accent/5' : 'border-charcoal/5'}`}>
                      <div className="flex items-center justify-between p-5">
                        <div className="flex-1" onClick={() => toggleAddOn('bbq-premium')} role="button">
                          <p className="font-semibold">{locale === 'zh' ? 'BBQ 豪華套餐（海鮮、肉類、丸及蔬菜）' : 'BBQ Premium (Seafood, Meat & Veggies)'}</p>
                          <p className="text-sm text-muted mt-1">{locale === 'zh' ? '統一每位 +$328' : '$328/pax'}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <button onClick={() => setExpandedMenu(isExpanded ? null : 'bbq-premium')} className="text-xs text-accent hover:underline">
                            {isExpanded ? (locale === 'zh' ? '收起菜單' : 'Hide Menu') : (locale === 'zh' ? '查看菜單' : 'View Menu')}
                          </button>
                          <div onClick={() => toggleAddOn('bbq-premium')} role="button" className={`w-6 h-6 rounded-full border-2 flex items-center justify-center cursor-pointer ${isSelected ? 'border-accent bg-accent' : 'border-charcoal/20'}`}>
                            {isSelected && <Check size={14} className="text-white" />}
                          </div>
                        </div>
                      </div>
                      {isExpanded && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} className="px-5 pb-5 border-t border-charcoal/5">
                          <div className="pt-4 grid grid-cols-2 gap-x-4 gap-y-1">
                            {bbqPremiumMenu[locale].map((item, i) => (
                              <p key={i} className="text-sm text-charcoal/70">• {item}</p>
                            ))}
                          </div>
                          <div className="mt-4 space-y-1">
                            {bbqPremiumMenu.notes[locale].map((note, i) => (
                              <p key={i} className="text-[11px] text-muted">《{note}》</p>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </div>
                  );
                })()}

                {/* Hotpot Standard */}
                {hotpotVenues.includes(venue.id) && (() => {
                  const isSelected = selectedAddOns.some((a) => a.id === 'hotpot-standard');
                  const isExpanded = expandedMenu === 'hotpot-standard';
                  const hasHotpotPackage = selectedAddOns.some((a) => a.id === 'hotpot-standard' || a.id === 'hotpot-seafood');
                  return (
                    <div className={`rounded-2xl border transition-all ${isSelected ? 'border-accent bg-accent/5' : 'border-charcoal/5'}`}>
                      <div className="flex items-center justify-between p-5">
                        <div className="flex-1" onClick={() => {
                          if (isSelected) {
                            setSelectedAddOns(selectedAddOns.filter((a) => a.id !== 'hotpot-standard' && a.id !== 'hotpot-extra-soup'));
                            setSelectedSoupBases([]);
                          } else {
                            setSelectedAddOns([...selectedAddOns.filter((a) => a.id !== 'hotpot-standard' && a.id !== 'hotpot-seafood' && a.id !== 'hotpot-extra-soup'), { id: 'hotpot-standard', quantity: 1 }]);
                            setSelectedSoupBases([]);
                          }
                        }} role="button">
                          <p className="font-semibold">{locale === 'zh' ? '火鍋標準套餐' : 'Hotpot Standard'}</p>
                          <p className="text-sm text-muted mt-1">{locale === 'zh' ? '每位 +$168（須最少三日前預訂）' : '$168/pax (min. 3 days advance)'}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <button onClick={() => setExpandedMenu(isExpanded ? null : 'hotpot-standard')} className="text-xs text-accent hover:underline">
                            {isExpanded ? (locale === 'zh' ? '收起菜單' : 'Hide') : (locale === 'zh' ? '查看菜單' : 'Menu')}
                          </button>
                          <div onClick={() => {
                            if (isSelected) {
                              setSelectedAddOns(selectedAddOns.filter((a) => a.id !== 'hotpot-standard' && a.id !== 'hotpot-extra-soup'));
                              setSelectedSoupBases([]);
                            } else {
                              setSelectedAddOns([...selectedAddOns.filter((a) => a.id !== 'hotpot-standard' && a.id !== 'hotpot-seafood' && a.id !== 'hotpot-extra-soup'), { id: 'hotpot-standard', quantity: 1 }]);
                              setSelectedSoupBases([]);
                            }
                          }} role="button" className={`w-6 h-6 rounded-full border-2 flex items-center justify-center cursor-pointer ${isSelected ? 'border-accent bg-accent' : 'border-charcoal/20'}`}>
                            {isSelected && <Check size={14} className="text-white" />}
                          </div>
                        </div>
                      </div>
                      {isExpanded && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} className="px-5 pb-5 border-t border-charcoal/5">
                          <div className="pt-4 grid grid-cols-2 gap-x-4 gap-y-1">
                            {hotpotStandardMenu[locale].map((item, i) => (
                              <p key={i} className="text-sm text-charcoal/70">• {item}</p>
                            ))}
                          </div>
                          <div className="mt-4 space-y-1">
                            {hotpotStandardMenu.notes[locale].map((note, i) => (
                              <p key={i} className="text-[11px] text-muted">《{note}》</p>
                            ))}
                          </div>
                        </motion.div>
                      )}
                      {/* Soup Base Selection */}
                      {isSelected && (
                        <div className="px-5 pb-5 border-t border-charcoal/5">
                          <p className="text-sm font-semibold pt-4 mb-3">{locale === 'zh' ? '選擇湯底' : 'Select Soup Base'}</p>
                          <div className="flex flex-wrap gap-2 mb-3">
                            {hotpotSoupBases[locale].map((soup, i) => (
                              <button
                                key={i}
                                onClick={() => {
                                  const maxBases = guestCount >= 15 ? 2 : 1;
                                  if (selectedSoupBases.includes(soup)) {
                                    setSelectedSoupBases(selectedSoupBases.filter((s) => s !== soup));
                                  } else if (selectedSoupBases.length < maxBases) {
                                    setSelectedSoupBases([...selectedSoupBases, soup]);
                                  } else if (maxBases === 1) {
                                    setSelectedSoupBases([soup]);
                                  }
                                }}
                                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                                  selectedSoupBases.includes(soup) ? 'bg-charcoal text-cream' : 'bg-cream text-charcoal/70 hover:bg-charcoal/10'
                                }`}
                              >
                                {soup}
                              </button>
                            ))}
                          </div>
                          <p className="text-xs text-muted">
                            {guestCount >= 15
                              ? (locale === 'zh' ? '15人或以上可免費選兩個湯底' : '15+ guests: 2 free soup bases')
                              : (locale === 'zh' ? '如需第二個湯底，每個 +$108' : 'Extra soup base: +$108 each')}
                          </p>
                          {guestCount < 15 && selectedSoupBases.length >= 1 && (
                            <label className="flex items-center gap-2 mt-3 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={selectedAddOns.some((a) => a.id === 'hotpot-extra-soup')}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedAddOns([...selectedAddOns, { id: 'hotpot-extra-soup', quantity: 1 }]);
                                  } else {
                                    setSelectedAddOns(selectedAddOns.filter((a) => a.id !== 'hotpot-extra-soup'));
                                  }
                                }}
                                className="w-4 h-4 accent-accent"
                              />
                              <span className="text-sm">{locale === 'zh' ? '加購額外湯底 (+$108)' : 'Add extra soup base (+$108)'}</span>
                            </label>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Hotpot Seafood */}
                {hotpotVenues.includes(venue.id) && (() => {
                  const isSelected = selectedAddOns.some((a) => a.id === 'hotpot-seafood');
                  const isExpanded = expandedMenu === 'hotpot-seafood';
                  return (
                    <div className={`rounded-2xl border transition-all ${isSelected ? 'border-accent bg-accent/5' : 'border-charcoal/5'}`}>
                      <div className="flex items-center justify-between p-5">
                        <div className="flex-1" onClick={() => {
                          if (isSelected) {
                            setSelectedAddOns(selectedAddOns.filter((a) => a.id !== 'hotpot-seafood' && a.id !== 'hotpot-extra-soup'));
                            setSelectedSoupBases([]);
                          } else {
                            setSelectedAddOns([...selectedAddOns.filter((a) => a.id !== 'hotpot-standard' && a.id !== 'hotpot-seafood' && a.id !== 'hotpot-extra-soup'), { id: 'hotpot-seafood', quantity: 1 }]);
                            setSelectedSoupBases([]);
                          }
                        }} role="button">
                          <p className="font-semibold">{locale === 'zh' ? '海鮮火鍋套餐' : 'Seafood Hotpot'}</p>
                          <p className="text-sm text-muted mt-1">{locale === 'zh' ? '每位 +$348（須最少三日前預訂）' : '$348/pax (min. 3 days advance)'}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <button onClick={() => setExpandedMenu(isExpanded ? null : 'hotpot-seafood')} className="text-xs text-accent hover:underline">
                            {isExpanded ? (locale === 'zh' ? '收起菜單' : 'Hide') : (locale === 'zh' ? '查看菜單' : 'Menu')}
                          </button>
                          <div onClick={() => {
                            if (isSelected) {
                              setSelectedAddOns(selectedAddOns.filter((a) => a.id !== 'hotpot-seafood' && a.id !== 'hotpot-extra-soup'));
                              setSelectedSoupBases([]);
                            } else {
                              setSelectedAddOns([...selectedAddOns.filter((a) => a.id !== 'hotpot-standard' && a.id !== 'hotpot-seafood' && a.id !== 'hotpot-extra-soup'), { id: 'hotpot-seafood', quantity: 1 }]);
                              setSelectedSoupBases([]);
                            }
                          }} role="button" className={`w-6 h-6 rounded-full border-2 flex items-center justify-center cursor-pointer ${isSelected ? 'border-accent bg-accent' : 'border-charcoal/20'}`}>
                            {isSelected && <Check size={14} className="text-white" />}
                          </div>
                        </div>
                      </div>
                      {isExpanded && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} className="px-5 pb-5 border-t border-charcoal/5">
                          <div className="pt-4 grid grid-cols-2 gap-x-4 gap-y-1">
                            {hotpotSeafoodMenu[locale].map((item, i) => (
                              <p key={i} className="text-sm text-charcoal/70">• {item}</p>
                            ))}
                          </div>
                          <div className="mt-4 space-y-1">
                            {hotpotSeafoodMenu.notes[locale].map((note, i) => (
                              <p key={i} className="text-[11px] text-muted">《{note}》</p>
                            ))}
                          </div>
                        </motion.div>
                      )}
                      {/* Soup Base Selection */}
                      {isSelected && (
                        <div className="px-5 pb-5 border-t border-charcoal/5">
                          <p className="text-sm font-semibold pt-4 mb-3">{locale === 'zh' ? '選擇湯底' : 'Select Soup Base'}</p>
                          <div className="flex flex-wrap gap-2 mb-3">
                            {hotpotSoupBases[locale].map((soup, i) => (
                              <button
                                key={i}
                                onClick={() => {
                                  const maxBases = guestCount >= 15 ? 2 : 1;
                                  if (selectedSoupBases.includes(soup)) {
                                    setSelectedSoupBases(selectedSoupBases.filter((s) => s !== soup));
                                  } else if (selectedSoupBases.length < maxBases) {
                                    setSelectedSoupBases([...selectedSoupBases, soup]);
                                  } else if (maxBases === 1) {
                                    setSelectedSoupBases([soup]);
                                  }
                                }}
                                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                                  selectedSoupBases.includes(soup) ? 'bg-charcoal text-cream' : 'bg-cream text-charcoal/70 hover:bg-charcoal/10'
                                }`}
                              >
                                {soup}
                              </button>
                            ))}
                          </div>
                          <p className="text-xs text-muted">
                            {guestCount >= 15
                              ? (locale === 'zh' ? '15人或以上可免費選兩個湯底' : '15+ guests: 2 free soup bases')
                              : (locale === 'zh' ? '如需第二個湯底，每個 +$108' : 'Extra soup base: +$108 each')}
                          </p>
                          {guestCount < 15 && selectedSoupBases.length >= 1 && (
                            <label className="flex items-center gap-2 mt-3 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={selectedAddOns.some((a) => a.id === 'hotpot-extra-soup')}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedAddOns([...selectedAddOns, { id: 'hotpot-extra-soup', quantity: 1 }]);
                                  } else {
                                    setSelectedAddOns(selectedAddOns.filter((a) => a.id !== 'hotpot-extra-soup'));
                                  }
                                }}
                                className="w-4 h-4 accent-accent"
                              />
                              <span className="text-sm">{locale === 'zh' ? '加購額外湯底 (+$108)' : 'Add extra soup base (+$108)'}</span>
                            </label>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* BYO Food */}
                {!noBBQVenues.includes(venue.id) && (
                  <div className={`p-5 rounded-2xl border transition-all ${
                    hasBYOFood ? 'border-accent bg-accent/5' : 'border-charcoal/5'
                  }`}>
                    <label className="flex items-center justify-between cursor-pointer">
                      <div>
                        <p className="font-semibold">{t('byoFood')}</p>
                        <p className="text-sm text-muted mt-1">{t('byoFoodNote')}</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={hasBYOFood}
                        onChange={(e) => handleBYOFood(e.target.checked)}
                        className="w-5 h-5 accent-accent"
                      />
                    </label>

                    {/* Forced BBQ Grill Rental */}
                    {hasBYOFood && !selectedAddOns.some((a) => a.id === 'bbq-standard' || a.id === 'bbq-premium') && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        className="mt-4 pt-4 border-t border-charcoal/5"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-semibold">
                              {locale === 'zh' ? 'BBQ 爐租用' : 'BBQ Grill Rental'} — HK$500/{locale === 'zh' ? '個' : 'unit'}
                            </p>
                            <p className="text-xs text-muted">{locale === 'zh' ? '最多 2 個' : 'Max 2 units'}</p>
                          </div>
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => setGrillQuantity(grillQuantity - 1)}
                              disabled={grillQuantity <= 1}
                              className="w-8 h-8 rounded-lg border border-charcoal/10 flex items-center justify-center disabled:opacity-30"
                            >
                              <Minus size={14} />
                            </button>
                            <span className="font-bold w-6 text-center">{grillQuantity}</span>
                            <button
                              onClick={() => setGrillQuantity(grillQuantity + 1)}
                              disabled={grillQuantity >= 2}
                              className="w-8 h-8 rounded-lg border border-charcoal/10 flex items-center justify-center disabled:opacity-30"
                            >
                              <Plus size={14} />
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </div>
                )}

                {/* Drinks */}
                {visibleAddOns
                  .filter((a) => a.id === 'drinks')
                  .map((addOn) => {
                    const isSelected = selectedAddOns.some((a) => a.id === addOn.id);
                    return (
                      <button
                        key={addOn.id}
                        onClick={() => toggleAddOn(addOn.id)}
                        className={`w-full flex items-center justify-between p-5 rounded-2xl border transition-all text-left ${
                          isSelected
                            ? 'border-accent bg-accent/5'
                            : 'border-charcoal/5 hover:border-charcoal/20'
                        }`}
                      >
                        <div>
                          <p className="font-semibold">{addOn.name[locale]}</p>
                          <p className="text-sm text-muted mt-1">{addOn.description?.[locale]}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-bold">+HK${addOn.pricePerUnit}/{locale === 'zh' ? '位' : 'pax'}</span>
                          <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                            isSelected ? 'border-accent bg-accent' : 'border-charcoal/20'
                          }`}>
                            {isSelected && <Check size={14} className="text-white" />}
                          </div>
                        </div>
                      </button>
                    );
                  })}

                {/* TST free drinks note */}
                {freeDrinksVenues.includes(venue.id) && (
                  <div className="p-4 bg-green-50 rounded-2xl flex items-start gap-3">
                    <Check size={18} className="text-green-500 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-green-700">
                      {locale === 'zh' ? '此場地已包無酒精飲品任飲' : 'This venue includes complimentary non-alcoholic drinks'}
                    </p>
                  </div>
                )}

                {/* Shisha Package — pipes + heads + per-head flavor selection */}
                {shishaCatalogEntry && (
                  <div className={`p-5 rounded-2xl border ${shishaHeads > 0 ? 'border-accent bg-accent/5' : 'border-charcoal/5'}`}>
                    <div className="mb-4">
                      <p className="font-semibold">{shishaCatalogEntry.name[locale]}</p>
                      <p className="text-sm text-muted mt-1">{shishaCatalogEntry.description?.[locale]}</p>
                      <p className="text-xs text-ink-soft mt-2">
                        {locale === 'zh'
                          ? '* 由外部供應商提供。需活動 2 日前預訂。'
                          : '* Provided by outside vendor. Order ≥ 2 days ahead.'}
                      </p>
                    </div>

                    {/* Pipes selector — 1 or 2 pill buttons */}
                    <div className="flex items-center justify-between gap-3 py-3 border-t border-white/40">
                      <div>
                        <p className="font-semibold text-sm">{locale === 'zh' ? '水煙支數' : 'Pipes'}</p>
                        <p className="text-xs text-ink-soft mt-0.5">
                          {locale === 'zh' ? '可同時開幾多支（場地最多 2 支）' : `How many simultaneous pipes (max ${SHISHA_MAX_PIPES})`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {[1, 2].map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => setShishaPipes(n)}
                            disabled={tooSoonForExtras}
                            className={`px-4 py-1.5 rounded-pill text-sm font-semibold border transition disabled:opacity-30 ${
                              shishaPipes === n
                                ? 'bg-gradient-pink text-white border-transparent shadow-glow'
                                : 'bg-white/70 text-ink-soft border-charcoal/15 hover:bg-white'
                            }`}
                          >
                            {n} {locale === 'zh' ? '支' : `pipe${n > 1 ? 's' : ''}`}
                          </button>
                        ))}
                        {shishaHeads > 0 && (
                          <button
                            type="button"
                            onClick={() => setShishaHeads(0)}
                            className="px-3 py-1.5 rounded-pill text-xs font-medium bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200"
                          >
                            {locale === 'zh' ? '取消' : 'Remove'}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Heads stepper — only shown when pipes is selected */}
                    {shishaHeads > 0 && (
                      <div className="flex items-center justify-between gap-3 py-3 border-t border-white/40">
                        <div>
                          <p className="font-semibold text-sm">{locale === 'zh' ? '煙頭數' : 'Heads (total)'}</p>
                          <p className="text-xs text-ink-soft mt-0.5">
                            {locale === 'zh'
                              ? `最少 ${shishaPipes} 個（每支水煙最少 1 個頭）；額外每個 +$250`
                              : `Min ${shishaPipes} (each pipe needs 1); extras +$250 each`}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => setShishaHeads(shishaHeads - 1)}
                            disabled={shishaHeads <= shishaPipes || tooSoonForExtras}
                            className="w-8 h-8 rounded-full border border-charcoal/20 flex items-center justify-center hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            <Minus size={14} />
                          </button>
                          <span className="w-6 text-center font-semibold">{shishaHeads}</span>
                          <button
                            type="button"
                            onClick={() => setShishaHeads(shishaHeads + 1)}
                            disabled={shishaHeads >= 10 || tooSoonForExtras}
                            className="w-8 h-8 rounded-full border border-charcoal/20 flex items-center justify-center hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Per-head flavor pickers + setup + subtotal — when heads chosen */}
                    {shishaHeads > 0 && (
                      <div className="mt-3 space-y-3 border-t border-white/40 pt-4">
                        <p className="text-xs font-semibold text-ink-soft uppercase tracking-wider">
                          {locale === 'zh' ? '每個煙頭揀口味' : 'Pick a flavor per head'}
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {Array.from({ length: shishaHeads }, (_, i) => (
                            <label key={i} className="flex items-center gap-2 text-sm">
                              <span className="w-12 text-ink-soft shrink-0">
                                #{i + 1}
                              </span>
                              <select
                                value={shishaFlavors[i] || 'A'}
                                onChange={(e) => setShishaFlavor(i, e.target.value)}
                                className="flex-1 px-2 py-1.5 rounded-lg border border-charcoal/15 bg-white text-sm focus:outline-none focus:border-accent"
                              >
                                {shishaCatalogEntry.variants?.map((v) => (
                                  <option key={v.id} value={v.id}>{v.name[locale]}</option>
                                ))}
                              </select>
                            </label>
                          ))}
                        </div>

                        {/* Staff setup option */}
                        <label className="flex items-center gap-3 mt-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={shishaStaffSetup}
                            onChange={toggleShishaStaffSetup}
                            className="w-4 h-4"
                          />
                          <span className="text-sm">
                            {locale === 'zh'
                              ? `需要員工協助 setup（+HK$${SHISHA_STAFF_SETUP_FEE}）`
                              : `Staff setup help (+HK$${SHISHA_STAFF_SETUP_FEE})`}
                          </span>
                        </label>

                        {/* Live price preview */}
                        <div className="flex items-center justify-between pt-2 border-t border-white/40">
                          <span className="text-sm text-ink-soft">
                            {locale === 'zh' ? '小計' : 'Subtotal'}
                          </span>
                          <span className="font-bold">
                            HK${calcShishaPrice(shishaPipes, shishaHeads, shishaStaffSetup).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right: Pricing Summary (Sticky) */}
          <div className="lg:col-span-1">
            <div className="sticky top-24 bg-charcoal text-cream rounded-3xl p-8">
              <h2 className="text-xl font-bold mb-6">{t('summary')}</h2>

              {/* Breakdown */}
              <div className="space-y-4 mb-6">
                {pricing.breakdown.map((item, i) => (
                  <div key={i} className="flex items-start justify-between text-sm">
                    <span className="text-cream/70 flex-1 mr-4">{item.label[locale]}</span>
                    <span className="font-medium whitespace-nowrap">
                      {item.amount === 0 ? (locale === 'zh' ? '免費' : 'Free') : `HK$${item.amount.toLocaleString()}`}
                    </span>
                  </div>
                ))}
              </div>

              <div className="border-t border-cream/10 pt-4 mb-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-cream/70">{t('subtotal')}</span>
                  <span>HK${pricing.subtotal.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-cream/70">
                    {locale === 'zh' ? '按金（活動後退還）' : 'Security deposit (refunded after event)'}
                  </span>
                  <span>HK${pricing.securityDeposit.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-lg font-bold pt-2 border-t border-cream/10">
                  <span>{locale === 'zh' ? '總計' : 'Grand total'}</span>
                  <span>HK${pricing.grandTotal.toLocaleString()}</span>
                </div>
              </div>

              {/* Amount due now (highlighted) */}
              <div className="bg-cream/10 rounded-2xl p-5 mb-3">
                <div className="flex justify-between font-bold mb-2">
                  <span>
                    {pricing.canInstallment
                      ? (locale === 'zh' ? '應付（50% 確認預約）' : 'Due now (50% to confirm)')
                      : (locale === 'zh' ? '應付（全數確認預約）' : 'Due now (full to confirm)')}
                  </span>
                  <span>HK${pricing.deposit.toLocaleString()}</span>
                </div>
                <p className="text-xs text-cream/50">
                  {locale === 'zh'
                    ? '按金將於活動結束後 24 小時內退還（詳情請參閱預訂須知）'
                    : 'Security deposit will be refunded within 24 hours after the event'}
                </p>
              </div>

              {pricing.canInstallment && (
                <div className="bg-amber-500/15 text-amber-100 rounded-2xl p-4 mb-6 text-sm">
                  <p className="font-semibold mb-1">
                    {locale === 'zh' ? `尾數 HK$${(pricing.grandTotal - pricing.deposit).toLocaleString()}` : `Balance HK$${(pricing.grandTotal - pricing.deposit).toLocaleString()}`}
                  </p>
                  <p className="text-xs opacity-90">
                    {locale === 'zh' ? '須於活動前 2 日繳清，方可獲發場地門鎖密碼。' : 'Due 2 days before the event for venue passcode delivery.'}
                  </p>
                </div>
              )}

              {/* Installment Notice */}
              {pricing.canInstallment && (
                <div className="bg-accent/20 rounded-2xl p-4 mb-6 flex items-start gap-3">
                  <Info size={16} className="text-accent flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">{t('installment')}</p>
                    <p className="text-xs text-cream/60 mt-1">{t('installmentNote')}</p>
                  </div>
                </div>
              )}

              {/* WhatsApp Contact (required for booking confirmation) */}
              <div className="mb-5 p-4 rounded-2xl bg-white/10 border border-white/20">
                <label className="text-xs text-cream/70 font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <MessageCircle size={12} className="text-emerald-400" />
                  {locale === 'zh' ? 'WhatsApp 聯絡電話' : 'WhatsApp Contact'}
                  <span className="text-red-400">*</span>
                </label>
                {savedWhatsappPhone && !whatsappConfirmed && normalizeHkPhone(whatsappPhone) === normalizeHkPhone(savedWhatsappPhone) && (
                  <div className="mb-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200">
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
                    <span className="text-cream/50 ml-2">
                      {locale === 'zh' ? '或喺下面修改' : 'or edit below'}
                    </span>
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
                  className="w-full px-4 py-3 rounded-xl bg-cream/10 text-cream placeholder:text-cream/30 border border-cream/20 focus:outline-none focus:border-accent"
                />
                {whatsappPhone && !isWhatsappValid && (
                  <p className="text-xs text-red-400 mt-2 flex items-center gap-1">
                    <AlertCircle size={12} />
                    {locale === 'zh' ? '請輸入有效嘅香港電話號碼（8 位數字）' : 'Please enter a valid HK phone number (8 digits)'}
                  </p>
                )}
                {isWhatsappValid && whatsappReady && (
                  <p className="text-xs text-emerald-400 mt-2">
                    ✓ {formatHkPhone(whatsappPhone)} {locale === 'zh' ? '已確認' : 'confirmed'}
                  </p>
                )}
                <p className="text-[11px] text-cream/40 mt-2">
                  {locale === 'zh'
                    ? '我們會用此號碼以 WhatsApp 聯絡你確認預訂、發送場地密碼及處理當日查詢。'
                    : 'We will use this number on WhatsApp to confirm your booking, send the venue access code, and handle day-of enquiries.'}
                </p>
              </div>

              {/* Terms Agreement */}
              <label className="flex items-start gap-3 mb-6 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreedToTerms}
                  onChange={(e) => setAgreedToTerms(e.target.checked)}
                  className="w-5 h-5 accent-accent mt-0.5 flex-shrink-0"
                />
                <span className="text-sm text-cream/70">
                  {locale === 'zh' ? (
                    <>
                      我已閱讀並同意遵守
                      <Link href="/guidelines" className="text-accent underline hover:text-accent/80" target="_blank">
                        預訂須知
                      </Link>
                      <span className="text-red-400 ml-1">*</span>
                    </>
                  ) : (
                    <>
                      I have read and agree to the{' '}
                      <Link href="/guidelines" className="text-accent underline hover:text-accent/80" target="_blank">
                        Booking Guidelines
                      </Link>
                      <span className="text-red-400 ml-1">*</span>
                    </>
                  )}
                </span>
              </label>

              {/* CTA */}
              <button
                className="w-full bg-accent text-white py-4 rounded-xl font-bold text-lg hover:bg-accent/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                disabled={!canProceed || isSubmitting}
                onClick={async () => {
                  if (!user) {
                    setAuthModalOpen(true);
                    return;
                  }
                  setSubmitError(null);
                  setIsSubmitting(true);
                  try {
                    const e164 = normalizeHkPhone(whatsappPhone);
                    if (e164) {
                      try { await updateUserWhatsapp(user.uid, e164); } catch { /* non-blocking */ }
                    }

                    const balanceDue = Math.max(0, pricing.grandTotal - pricing.deposit);
                    const pendingExpiresAt =
                      Date.now() + PAYMENT_DETAILS.pendingHoldMinutes * 60 * 1000;
                    const bookingId = await createBooking({
                      userId: user.uid,
                      whatsappPhone: e164 || undefined,
                      venueId: venue.id,
                      branchSlug: slug,
                      date: selectedDate,
                      startTime,
                      endTime,
                      // Spread conditionally — Firestore's client SDK rejects
                      // explicit `undefined` field values, so a same-day
                      // booking can't pass `endDate: undefined`.
                      ...(endDate ? { endDate } : {}),
                      hours,
                      guestCount,
                      adultCount,
                      childCount,
                      isWeekend,
                      addOns: selectedAddOns,
                      hasBYOFood,
                      pricing: {
                        baseCharge: pricing.baseCharge,
                        addOnTotal: pricing.addOnTotal,
                        subtotal: pricing.subtotal,
                        securityDeposit: pricing.securityDeposit,
                        deposit: pricing.deposit,
                      },
                      status: 'pending',
                      paymentMethod: null,
                      receiptUrl: null,
                      balanceDue,
                      pendingExpiresAt,
                      depositRefund: null,
                    });

                    // Hand off to the confirmation page — it collects refund
                    // details and the chosen payment method before any charge.
                    router.push(`/book/${slug}/confirm/${bookingId}`);
                  } catch (err) {
                    console.error('Booking submission failed:', err);
                    setSubmitError(
                      locale === 'zh'
                        ? '預訂提交失敗，請稍後再試或聯絡客服。'
                        : 'Booking submission failed. Please try again or contact support.'
                    );
                    setIsSubmitting(false);
                  }
                }}
              >
                {isSubmitting
                  ? (locale === 'zh' ? '處理中…' : 'Processing…')
                  : t('proceed')}
                {!isSubmitting && <ArrowRight size={18} />}
              </button>

              {selectedDate && !whatsappReady && (
                <p className="text-xs text-red-400 mt-3 text-center">
                  {locale === 'zh' ? '請填寫並確認 WhatsApp 聯絡號碼' : 'Please fill in and confirm your WhatsApp number'}
                </p>
              )}
              {!agreedToTerms && selectedDate && whatsappReady && (
                <p className="text-xs text-red-400 mt-3 text-center">
                  {locale === 'zh' ? '請先同意預訂須知' : 'Please agree to the Booking Guidelines'}
                </p>
              )}
              {submitError && (
                <p className="text-xs text-red-500 mt-3 text-center">{submitError}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} />
    </div>
  );
}
