'use client';

import { useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Link, useRouter } from '@/i18n/routing';
import { useParams } from 'next/navigation';
import { getVenueBySlug, amenityLabels } from '@/lib/venues';
import { getSiteImages, compareSiteImages } from '@/lib/content';
import { useBranchOverrides } from '@/lib/useBranchOverrides';
import { getPackagesByVenueId, CATEGORY_LABEL } from '@/lib/packages';
import { SiteImage } from '@/types';
import { ArrowRight, ArrowLeft, Users, Maximize, Clock, ChevronLeft, ChevronRight, X, Check, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { notFound } from 'next/navigation';

// Slugs that should redirect to the unified Sheung Wan branch page.
// The combined page has anchors (#sw-a, #sw-b, #sw-ab) for deep links.
const SW_REDIRECT: Record<string, string> = {
  'sheung-wan-a':  '/branches/sheung-wan#sw-a',
  'sheung-wan-b':  '/branches/sheung-wan#sw-b',
  'sheung-wan-ab': '/branches/sheung-wan#sw-ab',
};

// Map venue slugs to image section prefixes
const slugToPrefix: Record<string, string> = {
  'causeway-bay': 'cwb',
  'wan-chai': 'wc',
  'sheung-wan-a': 'sw-a',
  'sheung-wan-b': 'sw-b',
  'tsim-sha-tsui': 'tst',
  'sheung-wan-ab': 'sw-ab',
};

export default function BranchPage() {
  const params = useParams();
  const router = useRouter();
  const locale = useLocale() as 'zh' | 'en';
  const t = useTranslations('booking');
  const slug = params.slug as string;
  const venue = getVenueBySlug(slug);
  const [venueImages, setVenueImages] = useState<SiteImage[]>([]);
  const [selectedImage, setSelectedImage] = useState<number | null>(null);
  // Pull admin-edited overrides (name / size / description / amenities)
  const { get: getOverride } = useBranchOverrides();

  // Redirect old Sheung Wan single-room URLs to the unified branch page.
  // Done in an effect so SSR still renders something while the client
  // navigates (avoids the brief 'not found' flash from notFound()).
  useEffect(() => {
    const target = SW_REDIRECT[slug];
    if (target) {
      router.replace(target);
    }
  }, [slug, router]);

  useEffect(() => {
    const prefix = slugToPrefix[slug];
    if (prefix) {
      getSiteImages(`branch-${prefix}`).then((imgs) => {
        // Sort by `order` field; fallback to legacy key suffix for old data.
        setVenueImages([...imgs].sort(compareSiteImages));
      });
    }
  }, [slug]);

  // While redirecting an SW slug, render a tiny placeholder
  if (SW_REDIRECT[slug]) {
    return (
      <div className="pt-28 text-center text-ink-soft">
        {locale === 'zh' ? '前往上環海景旗艦店…' : 'Redirecting to Sheung Wan…'}
      </div>
    );
  }

  if (!venue) {
    notFound();
  }

  const mainImage = venueImages[0] || null;
  const galleryImages = venueImages.slice(1);

  // Packages bookable at this branch (e.g. Mahjong @ Wan Chai). Empty for
  // branches with no curated package — section just doesn't render.
  const branchPackages = venue ? getPackagesByVenueId(venue.id) : [];

  // Resolved values: CMS override (if set) → venue.* fallback
  const displayName = getOverride(venue.id, 'name', locale) || venue.name[locale];
  const displaySize = getOverride(venue.id, 'size', locale) || venue.size;
  const displayDescription =
    getOverride(venue.id, 'description', locale) || venue.description[locale];

  return (
    <div className="pt-28 relative overflow-hidden">
      {/* Decorative orbs */}
      <div className="orb orb-pink animate-float-slow" style={{ width: 280, height: 280, top: '-60px', right: '-60px', opacity: 0.4 }} />
      <div className="orb orb-lavender animate-float-medium" style={{ width: 200, height: 200, top: '40%', left: '-60px', opacity: 0.35 }} />

      {/* Back Link */}
      <div className="max-content mx-auto px-6 md:px-12 lg:px-20 py-6 relative z-10">
        <Link href="/#collection" className="inline-flex items-center gap-2 text-sm text-ink-soft hover:text-pink transition-colors">
          <ArrowLeft size={16} />
          {locale === 'zh' ? '返回所有空間' : 'Back to All Spaces'}
        </Link>
      </div>

      {/* Hero */}
      <section className="px-6 md:px-12 lg:px-20 pb-12 relative z-10">
        <div className="max-content mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Image Gallery */}
            <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
              {/* Main Image */}
              <div
                className="glass-strong relative aspect-[4/3] rounded-[32px] p-3 overflow-hidden cursor-pointer"
                onClick={() => mainImage && setSelectedImage(0)}
              >
                <div className="relative w-full h-full rounded-[24px] overflow-hidden">
                {mainImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={mainImage.url} alt={venue.name[locale]} className="w-full h-full object-cover hover:scale-105 transition-transform duration-500" />
                ) : (
                  <div className="w-full h-full bg-gradient-sunset flex items-center justify-center relative">
                    <div className="orb orb-pink animate-float-medium" style={{ width: 160, height: 160, top: '15%', left: '15%', opacity: 0.7 }} />
                    <div className="orb orb-lavender animate-float-fast" style={{ width: 100, height: 100, bottom: '15%', right: '15%', opacity: 0.65 }} />
                    <div className="text-center relative z-10">
                      <div className="w-24 h-24 mx-auto mb-3 rounded-2xl glass-strong flex items-center justify-center backdrop-blur-2xl">
                        <span className="text-3xl font-bold font-display text-gradient-pink">{venue.branch}</span>
                      </div>
                      <p className="text-ink-soft text-sm font-medium">Main Venue Photo</p>
                    </div>
                  </div>
                )}
                </div>
              </div>

              {/* Thumbnail Grid */}
              {galleryImages.length > 0 ? (
                <div className="grid grid-cols-4 gap-2">
                  {galleryImages.slice(0, 8).map((img, i) => (
                    <div
                      key={img.id}
                      className="aspect-square rounded-2xl overflow-hidden cursor-pointer hover:opacity-80 transition-opacity ring-1 ring-white/60"
                      onClick={() => setSelectedImage(i + 1)}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img.url} alt={img.alt || `Photo ${i + 2}`} className="w-full h-full object-cover" />
                    </div>
                  ))}
                  {venueImages.length > 9 && (
                    <div
                      className="aspect-square rounded-2xl overflow-hidden cursor-pointer glass-strong flex items-center justify-center hover:bg-white/80 transition-colors"
                      onClick={() => setSelectedImage(9)}
                    >
                      <span className="text-sm font-bold text-gradient-pink">+{venueImages.length - 9}</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="aspect-square rounded-2xl overflow-hidden glass-card flex items-center justify-center">
                      <p className="text-ink-soft/50 text-xs">Photo {i}</p>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>

            {/* Details */}
            <motion.div initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
              <div>
                {venue.subtitle[locale] && (
                  <p className="text-xs text-gradient-pink font-bold tracking-wider uppercase mb-2">{venue.subtitle[locale]}</p>
                )}
                <h1 className="text-heading font-display text-ink">{displayName}</h1>
              </div>
              <p className="text-ink-soft leading-relaxed">{displayDescription}</p>

              {/* Specs */}
              <div className="grid grid-cols-2 gap-3">
                <div className="glass-card p-5">
                  <div className="w-10 h-10 rounded-2xl bg-gradient-pink flex items-center justify-center text-white shadow-glow mb-3">
                    <Users size={18} />
                  </div>
                  <p className="text-xs text-ink-soft uppercase tracking-wider font-semibold">{locale === 'zh' ? '容納人數' : 'Capacity'}</p>
                  <p className="text-lg font-bold font-display text-ink">{venue.capacity.min}-{venue.capacity.max}</p>
                </div>
                <div className="glass-card p-5">
                  <div className="w-10 h-10 rounded-2xl bg-gradient-cool flex items-center justify-center text-white shadow-glow-purple mb-3">
                    <Maximize size={18} />
                  </div>
                  <p className="text-xs text-ink-soft uppercase tracking-wider font-semibold">{locale === 'zh' ? '場地面積' : 'Area'}</p>
                  <p className="text-lg font-bold font-display text-ink">{displaySize}</p>
                </div>
                <div className="glass-card p-5 col-span-2">
                  <div className="w-10 h-10 rounded-2xl bg-gradient-warm flex items-center justify-center text-white shadow-glow mb-3">
                    <Clock size={18} />
                  </div>
                  <p className="text-xs text-ink-soft uppercase tracking-wider font-semibold">{locale === 'zh' ? '最少預訂時數' : 'Minimum Booking Hours'}</p>
                  <p className="text-lg font-bold font-display text-ink">{venue.minHours.weekday} {locale === 'zh' ? '小時' : 'hours'}</p>
                </div>
              </div>

              {/* Amenities */}
              <div>
                <h3 className="font-bold font-display text-ink mb-3">{locale === 'zh' ? '設施' : 'Amenities'}</h3>
                <div className="flex flex-wrap gap-2">
                  {(() => {
                    const override = getOverride(venue.id, 'amenities', locale);
                    if (override) {
                      // Admin entered free-form text — split by Chinese/English separators
                      const items = override.split(/[、,，]/).map((s) => s.trim()).filter(Boolean);
                      return items.map((label, i) => (
                        <span key={`${label}-${i}`} className="chip">{label}</span>
                      ));
                    }
                    return venue.amenities.map((a) => (
                      <span key={a} className="chip">
                        {amenityLabels[a]?.[locale] || a}
                      </span>
                    ));
                  })()}
                </div>
              </div>

              {/* Price Table */}
              <div className="relative overflow-hidden rounded-[28px] bg-ink text-cream p-6">
                <div className="orb orb-pink animate-float-medium" style={{ width: 180, height: 180, top: '-40px', right: '-30px', opacity: 0.4 }} />
                <div className="orb orb-lavender animate-float-slow" style={{ width: 140, height: 140, bottom: '-30px', left: '-30px', opacity: 0.35 }} />
                <div className="relative z-10">
                  <h3 className="font-bold font-display mb-4">{t('priceTable')}</h3>
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <p className="text-cream/60 text-sm mb-1">
                        {locale === 'zh' ? '星期日至四' : 'Sun - Thu'}
                      </p>
                      <p className="text-2xl font-bold font-display">
                        HK${venue.pricing.weekday.perHead}
                        <span className="text-sm font-normal text-cream/60">
                          /{locale === 'zh' ? '每人每小時' : 'per person/hr'}
                        </span>
                      </p>
                      <p className="text-cream/40 text-xs mt-2">
                        {locale === 'zh'
                          ? `最少 ${venue.minGuests.weekday} 人預訂`
                          : `Min. ${venue.minGuests.weekday} guests`}
                      </p>
                    </div>
                    <div>
                      <p className="text-cream/60 text-sm mb-1">
                        {locale === 'zh' ? '星期五/六/公眾假期及前夕' : 'Fri/Sat/Public Holidays & Eve'}
                      </p>
                      <p className="text-2xl font-bold font-display text-gradient-warm">
                        HK${venue.pricing.weekend.perHead}
                        <span className="text-sm font-normal text-cream/60">
                          /{locale === 'zh' ? '每人每小時' : 'per person/hr'}
                        </span>
                      </p>
                      <p className="text-cream/40 text-xs mt-2">
                        {locale === 'zh'
                          ? `最少 ${venue.minGuests.weekend} 人預訂`
                          : `Min. ${venue.minGuests.weekend} guests`}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Book CTA */}
              <Link href={`/book/${venue.slug}`} className="btn-primary w-full justify-center text-lg py-4">
                {locale === 'zh' ? '立即預訂' : 'Book Now'}
                <ArrowRight size={18} />
              </Link>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Featured Packages — branch-specific bookable packages */}
      {branchPackages.length > 0 && (
        <section className="px-6 md:px-12 lg:px-20 pb-16 relative z-10">
          <div className="max-content mx-auto">
            <div className="mb-8">
              <span className="chip mb-3">
                <Sparkles size={12} className="text-pink" />
                {locale === 'zh' ? '專屬優惠套餐' : 'Featured Packages'}
              </span>
              <h2 className="text-heading font-display text-ink">
                {locale === 'zh' ? '此分店獨家套餐' : 'Exclusive at this branch'}
              </h2>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {branchPackages.map((pkg) => {
                const dayList = (() => {
                  if (pkg.allowedDaysOfWeek.length === 0 || pkg.allowedDaysOfWeek.length === 7) {
                    return locale === 'zh' ? '每日適用' : 'Every day';
                  }
                  // Common case: Sun–Thu (0,1,2,3,4) or Fri–Sat (5,6)
                  const set = pkg.allowedDaysOfWeek.slice().sort((a, b) => a - b).join(',');
                  if (set === '0,1,2,3,4') return locale === 'zh' ? '平日（日至四）' : 'Weekdays (Sun–Thu)';
                  if (set === '5,6') return locale === 'zh' ? '週末（五至六）' : 'Weekends (Fri–Sat)';
                  return locale === 'zh' ? '指定日子' : 'Selected days';
                })();

                return (
                  <motion.div
                    key={pkg.slug}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    className="relative overflow-hidden rounded-[32px] bg-gradient-pink p-1 shadow-glow-soft"
                  >
                    <div className="rounded-[28px] bg-white/15 backdrop-blur-md p-7 md:p-8 relative overflow-hidden">
                      <div className="orb orb-pink animate-float-fast" style={{ width: 160, height: 160, top: '-30px', right: '-30px', opacity: 0.55 }} />
                      <div className="orb orb-coral animate-float-medium" style={{ width: 120, height: 120, bottom: '-30px', left: '15%', opacity: 0.45 }} />

                      <div className="relative z-10 text-white">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-pill bg-white/25 backdrop-blur-md text-xs font-bold uppercase tracking-wider mb-4">
                          {CATEGORY_LABEL[pkg.category][locale]}
                        </div>
                        <h3 className="text-2xl md:text-3xl font-bold font-display mb-2 leading-tight">
                          {pkg.name[locale]}
                        </h3>
                        <p className="text-white/85 text-sm mb-5 leading-relaxed">
                          {pkg.pitch[locale]}
                        </p>

                        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 mb-6">
                          {pkg.includes[locale].map((item) => (
                            <li key={item} className="flex items-start gap-2 text-sm text-white/90">
                              <Check size={14} className="flex-shrink-0 mt-0.5" />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-white/85 mb-5">
                          <span className="inline-flex items-center gap-1">
                            <Clock size={12} />
                            {pkg.earliestStart}–{pkg.latestEnd} · {pkg.durationHours}{locale === 'zh' ? '小時' : 'h'}
                          </span>
                          <span>·</span>
                          <span>{dayList}</span>
                        </div>

                        <div className="flex flex-wrap items-end justify-between gap-4">
                          <div>
                            <p className="text-4xl font-bold font-display leading-none">
                              HK${pkg.price.toLocaleString()}
                            </p>
                            <p className="text-xs text-white/70 mt-1">
                              + HK${pkg.deposit.toLocaleString()}{' '}
                              {locale === 'zh' ? '可退按金' : 'refundable deposit'}
                            </p>
                          </div>
                          <Link
                            href={`/book/package/${pkg.slug}`}
                            className="inline-flex items-center gap-2 px-6 py-3 rounded-pill bg-white text-pink font-bold hover:-translate-y-0.5 transition-transform shadow-lg"
                          >
                            {locale === 'zh' ? '預訂套餐' : 'Book Package'}
                            <ArrowRight size={16} />
                          </Link>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Lightbox */}
      <AnimatePresence>
        {selectedImage !== null && venueImages.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-ink/95 backdrop-blur-md z-50 flex items-center justify-center"
            onClick={() => setSelectedImage(null)}
          >
            <button className="absolute top-6 right-6 w-11 h-11 rounded-full glass-dark text-cream hover:bg-pink/30 transition-colors flex items-center justify-center" onClick={() => setSelectedImage(null)}>
              <X size={22} />
            </button>
            <button
              className="absolute left-6 top-1/2 -translate-y-1/2 w-12 h-12 glass-dark rounded-full flex items-center justify-center text-cream hover:bg-pink/30 transition-colors"
              onClick={(e) => { e.stopPropagation(); setSelectedImage(Math.max(0, (selectedImage || 0) - 1)); }}
            >
              <ChevronLeft size={24} />
            </button>
            <button
              className="absolute right-6 top-1/2 -translate-y-1/2 w-12 h-12 glass-dark rounded-full flex items-center justify-center text-cream hover:bg-pink/30 transition-colors"
              onClick={(e) => { e.stopPropagation(); setSelectedImage(Math.min(venueImages.length - 1, (selectedImage || 0) + 1)); }}
            >
              <ChevronRight size={24} />
            </button>

            <div className="max-w-4xl max-h-[80vh] px-16" onClick={(e) => e.stopPropagation()}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={venueImages[selectedImage]?.url}
                alt={venueImages[selectedImage]?.alt || ''}
                className="max-w-full max-h-[80vh] object-contain rounded-2xl"
              />
              <p className="text-cream/50 text-sm text-center mt-4">
                {(selectedImage || 0) + 1} / {venueImages.length}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
