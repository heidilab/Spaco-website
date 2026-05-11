'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import { getVenueBySlug, amenityLabels } from '@/lib/venues';
import { getSiteImages, compareSiteImages } from '@/lib/content';
import { useBranchOverrides } from '@/lib/useBranchOverrides';
import AmenityGrid from '@/components/branches/AmenityGrid';
import { SiteImage } from '@/types';
import { ArrowRight, ArrowLeft, Users, Maximize, Clock, ChevronLeft, ChevronRight, X, Sparkles, MapPin } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// The three SW variants form a single physical branch.
// Order: Room A (smaller) → Room B (premium) → Full floor (combined).
const SW_ROOMS = [
  { slug: 'sheung-wan-a',  imagePrefix: 'sw-a',  gradient: 'bg-gradient-cool',   accent: 'text-sky' },
  { slug: 'sheung-wan-b',  imagePrefix: 'sw-b',  gradient: 'bg-gradient-pink',   accent: 'text-pink' },
  { slug: 'sheung-wan-ab', imagePrefix: 'sw-ab', gradient: 'bg-gradient-sunset', accent: 'text-coral' },
];

interface RoomData {
  slug: string;
  imagePrefix: string;
  gradient: string;
  accent: string;
  venue: NonNullable<ReturnType<typeof getVenueBySlug>>;
  images: SiteImage[];
}

export default function SheungWanBranchPage() {
  const locale = useLocale() as 'zh' | 'en';
  const t = useTranslations('booking');
  const { get: getOverride, getList: getOverrideList } = useBranchOverrides();

  // Resolve all 3 venue records up front
  const rooms = useMemo<RoomData[] | null>(() => {
    const list: RoomData[] = [];
    for (const cfg of SW_ROOMS) {
      const venue = getVenueBySlug(cfg.slug);
      if (!venue) return null;
      list.push({ ...cfg, venue, images: [] });
    }
    return list;
  }, []);

  const [imagesByPrefix, setImagesByPrefix] = useState<Record<string, SiteImage[]>>({});
  const [lightbox, setLightbox] = useState<{ prefix: string; idx: number } | null>(null);

  useEffect(() => {
    if (!rooms) return;
    Promise.all(
      rooms.map(async (r) => {
        // Option C (sw-ab) shares the floor with A + B; skip fetching to
        // avoid showing the same photos a third time.
        if (r.imagePrefix === 'sw-ab') return [r.imagePrefix, [] as SiteImage[]] as const;
        const imgs = await getSiteImages(`branch-${r.imagePrefix}`);
        return [r.imagePrefix, [...imgs].sort(compareSiteImages)] as const;
      })
    ).then((entries) => {
      const map: Record<string, SiteImage[]> = {};
      for (const [k, v] of entries) map[k] = v;
      setImagesByPrefix(map);
    });
  }, [rooms]);

  if (!rooms) {
    return (
      <div className="pt-28 text-center text-ink-soft">
        Loading...
      </div>
    );
  }

  // Lightbox — collected images from the active room
  const lightboxImages = lightbox ? imagesByPrefix[lightbox.prefix] || [] : [];

  return (
    <div className="pt-28 relative overflow-hidden">
      {/* Decorative orbs (page-level) */}
      <div className="orb orb-pink animate-float-slow" style={{ width: 280, height: 280, top: '-60px', right: '-60px', opacity: 0.35 }} />
      <div className="orb orb-lavender animate-float-medium" style={{ width: 200, height: 200, top: '40%', left: '-60px', opacity: 0.3 }} />

      {/* Back link */}
      <div className="max-content mx-auto px-6 md:px-12 lg:px-20 py-6 relative z-10">
        <Link href="/#collection" className="inline-flex items-center gap-2 text-sm text-ink-soft hover:text-pink transition-colors">
          <ArrowLeft size={16} />
          {locale === 'zh' ? '返回所有空間' : 'Back to All Spaces'}
        </Link>
      </div>

      {/* Branch Hero */}
      <section className="px-6 md:px-12 lg:px-20 pb-12 relative z-10">
        <div className="max-content mx-auto">
          <motion.div
            className="glass-card p-8 md:p-12"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex flex-wrap items-center gap-2 mb-5">
              <span className="chip">
                <MapPin size={12} className="text-pink" />
                Sheung Wan 上環
              </span>
              <span className="chip-glow">
                <Sparkles size={12} className="text-lavender" />
                {locale === 'zh' ? '3 種空間配置' : '3 room options'}
              </span>
            </div>
            <h1 className="text-heading font-display mb-4">
              <span className="text-ink">{locale === 'zh' ? '上環海景' : 'Sheung Wan'}</span>
              <span>{' '}</span>
              <span className="text-gradient-warm">{locale === 'zh' ? '旗艦店' : 'Flagship'}</span>
            </h1>
            <p className="text-lg text-ink-soft max-w-2xl">
              {locale === 'zh'
                ? '同一層樓三種佈局：可揀 Room A 寧靜半場、Room B 配備獨立廚房嘅高端體驗，或者租 A+B 全層做大型聚會。'
                : 'One floor, three layouts. Choose Room A for an intimate half-floor, Room B for the premium suite with private kitchen, or book A+B for the full floor.'}
            </p>
          </motion.div>
        </div>
      </section>

      {/* Room sections */}
      <section className="px-6 md:px-12 lg:px-20 pb-16 relative z-10">
        <div className="max-content mx-auto space-y-10">
          {rooms.map((room, idx) => {
            const v = room.venue;
            const imgs = imagesByPrefix[room.imagePrefix] || [];
            const main = imgs[0];
            const gallery = imgs.slice(1, 5);
            const moreCount = Math.max(0, imgs.length - 5);
            // CMS overrides → fallback to hardcoded venue.* values
            const dispName = getOverride(v.id, 'name', locale) || v.name[locale];
            const dispSize = getOverride(v.id, 'size', locale) || v.size;
            const dispDesc = getOverride(v.id, 'description', locale) || v.description[locale];
            // Option C (sw-ab) is the same physical floor as A + B combined,
            // so its photos would duplicate the A/B galleries. Render the
            // detail card full-width without an image side.
            const hideGallery = room.imagePrefix === 'sw-ab';
            return (
              <motion.div
                key={room.slug}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-100px' }}
                transition={{ duration: 0.6, delay: idx * 0.05 }}
              >
                {/* Section anchor for deep-linking from old urls */}
                <div id={room.imagePrefix} />

                <div className={`grid grid-cols-1 ${hideGallery ? '' : 'lg:grid-cols-12'} gap-6 items-stretch`}>
                  {/* Image side */}
                  {!hideGallery && (
                  <div className="lg:col-span-5 space-y-3">
                    {/* Main image */}
                    <button
                      type="button"
                      onClick={() => main && setLightbox({ prefix: room.imagePrefix, idx: 0 })}
                      className="glass-strong relative aspect-[4/3] rounded-[28px] p-2.5 overflow-hidden w-full text-left cursor-pointer hover:shadow-glass-lg transition-shadow"
                    >
                      <div className="relative w-full h-full rounded-[20px] overflow-hidden">
                        {main ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={main.url} alt={dispName} className="w-full h-full object-cover" />
                        ) : (
                          <div className={`w-full h-full ${room.gradient} flex items-center justify-center relative`}>
                            <div className="orb orb-lavender animate-float-medium" style={{ width: 130, height: 130, top: '15%', left: '15%', opacity: 0.7 }} />
                            <div className="orb orb-pink animate-float-fast" style={{ width: 80, height: 80, bottom: '15%', right: '15%', opacity: 0.6 }} />
                            <div className="text-center relative z-10">
                              <div className="w-16 h-16 mx-auto mb-2 rounded-2xl glass-strong flex items-center justify-center backdrop-blur-2xl">
                                <span className="text-base font-bold font-display text-gradient-pink">
                                  {idx === 0 ? 'A' : idx === 1 ? 'B' : 'A+B'}
                                </span>
                              </div>
                              <p className="text-ink-soft text-xs font-medium">{dispSize}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </button>

                    {/* Thumbnail strip */}
                    {gallery.length > 0 && (
                      <div className="grid grid-cols-4 gap-2">
                        {gallery.map((img, i) => (
                          <button
                            key={img.id}
                            type="button"
                            onClick={() => setLightbox({ prefix: room.imagePrefix, idx: i + 1 })}
                            className="aspect-square rounded-2xl overflow-hidden ring-1 ring-white/60 hover:opacity-80 transition-opacity"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={img.url} alt={img.alt || `${dispName} ${i + 2}`} className="w-full h-full object-cover" />
                          </button>
                        ))}
                        {moreCount > 0 && (
                          <button
                            type="button"
                            onClick={() => setLightbox({ prefix: room.imagePrefix, idx: 5 })}
                            className="aspect-square rounded-2xl glass-strong flex items-center justify-center hover:bg-white/80 transition-colors text-sm font-bold text-gradient-pink"
                          >
                            +{moreCount}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  )}

                  {/* Detail side */}
                  <div className={`${hideGallery ? '' : 'lg:col-span-7'} glass-card p-7 md:p-9 flex flex-col`}>
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      <span className={`chip backdrop-blur-md ${room.gradient} text-white border-transparent`}>
                        Option {String.fromCharCode(65 + idx)}
                      </span>
                      {v.subtitle[locale] && (
                        <p className="text-xs font-bold tracking-wider uppercase text-gradient-pink">
                          {v.subtitle[locale]}
                        </p>
                      )}
                    </div>
                    <h2 className="text-2xl md:text-3xl font-bold font-display mb-3 text-ink">
                      {dispName}
                    </h2>
                    <p className="text-ink-soft leading-relaxed mb-5 text-sm md:text-base">
                      {dispDesc}
                    </p>

                    {/* Specs strip */}
                    <div className="grid grid-cols-3 gap-3 mb-5">
                      <div className="bg-white/40 backdrop-blur-md rounded-2xl p-3 border border-white/60">
                        <Users size={14} className="text-pink mb-1" />
                        <p className="text-[10px] text-ink-soft uppercase tracking-wider font-semibold">
                          {locale === 'zh' ? '人數' : 'Capacity'}
                        </p>
                        <p className="text-base font-bold font-display text-ink">{v.capacity.min}-{v.capacity.max}</p>
                      </div>
                      <div className="bg-white/40 backdrop-blur-md rounded-2xl p-3 border border-white/60">
                        <Maximize size={14} className="text-lavender mb-1" />
                        <p className="text-[10px] text-ink-soft uppercase tracking-wider font-semibold">
                          {locale === 'zh' ? '面積' : 'Area'}
                        </p>
                        <p className="text-base font-bold font-display text-ink">{dispSize}</p>
                      </div>
                      <div className="bg-white/40 backdrop-blur-md rounded-2xl p-3 border border-white/60">
                        <Clock size={14} className="text-coral mb-1" />
                        <p className="text-[10px] text-ink-soft uppercase tracking-wider font-semibold">
                          {locale === 'zh' ? '最少時數' : 'Min hrs'}
                        </p>
                        <p className="text-base font-bold font-display text-ink">{v.minHours.weekday}h</p>
                      </div>
                    </div>

                    {/* Amenities — card grid with icons (Switch + board
                     *  games auto-shown when game lists are populated). */}
                    {(() => {
                      const override = getOverride(v.id, 'amenities', locale);
                      const items = override
                        ? override.split(/[、,，]/).map((s) => s.trim()).filter(Boolean)
                        : v.amenities.map((a) => amenityLabels[a]?.[locale] || a);
                      const sw = getOverrideList(v.id, 'switch_games', locale);
                      const bg = getOverrideList(v.id, 'board_games', locale);
                      if (items.length === 0 && sw.length === 0 && bg.length === 0) return null;
                      return (
                        <div className="mb-5">
                          <p className="text-[10px] text-ink-soft uppercase tracking-wider font-semibold mb-2">
                            {locale === 'zh' ? '設施' : 'Amenities'}
                          </p>
                          <AmenityGrid
                            amenities={items}
                            switchGames={sw}
                            boardGames={bg}
                            locale={locale}
                          />
                        </div>
                      );
                    })()}

                    {/* Price + CTA — pushed to bottom */}
                    <div className="mt-auto flex flex-col sm:flex-row sm:items-end justify-between gap-3 pt-4 border-t border-white/50">
                      <div className="flex flex-wrap gap-x-5 gap-y-1">
                        <div>
                          <p className="text-[10px] text-ink-soft uppercase tracking-wider font-semibold">{locale === 'zh' ? '平日' : 'Weekday'}</p>
                          <p className="font-bold font-display text-ink">
                            HK${v.pricing.weekday.perHead}
                            <span className="text-xs font-normal text-ink-soft">/pax</span>
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] text-ink-soft uppercase tracking-wider font-semibold">{locale === 'zh' ? '週末/假日' : 'Weekend / PH'}</p>
                          <p className="font-bold font-display text-gradient-warm">
                            HK${v.pricing.weekend.perHead}
                            <span className="text-xs font-normal text-ink-soft">/pax</span>
                          </p>
                        </div>
                      </div>
                      <Link href={`/book/${room.slug}`} className="btn-primary text-sm whitespace-nowrap">
                        {locale === 'zh' ? `預訂 ${idx === 2 ? 'A+B' : `Room ${String.fromCharCode(65 + idx)}`}` : `Book ${idx === 2 ? 'A+B' : `Room ${String.fromCharCode(65 + idx)}`}`}
                        <ArrowRight size={14} />
                      </Link>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* Lightbox */}
      <AnimatePresence>
        {lightbox && lightboxImages.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-ink/95 backdrop-blur-md z-50 flex items-center justify-center"
            onClick={() => setLightbox(null)}
          >
            <button
              className="absolute top-6 right-6 w-11 h-11 rounded-full glass-dark text-cream hover:bg-pink/30 transition-colors flex items-center justify-center"
              onClick={() => setLightbox(null)}
            >
              <X size={22} />
            </button>
            <button
              className="absolute left-6 top-1/2 -translate-y-1/2 w-12 h-12 glass-dark rounded-full flex items-center justify-center text-cream hover:bg-pink/30 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                setLightbox((prev) =>
                  prev ? { ...prev, idx: Math.max(0, prev.idx - 1) } : prev
                );
              }}
            >
              <ChevronLeft size={24} />
            </button>
            <button
              className="absolute right-6 top-1/2 -translate-y-1/2 w-12 h-12 glass-dark rounded-full flex items-center justify-center text-cream hover:bg-pink/30 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                setLightbox((prev) =>
                  prev ? { ...prev, idx: Math.min(lightboxImages.length - 1, prev.idx + 1) } : prev
                );
              }}
            >
              <ChevronRight size={24} />
            </button>

            <div className="max-w-4xl max-h-[80vh] px-16" onClick={(e) => e.stopPropagation()}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={lightboxImages[lightbox.idx]?.url}
                alt={lightboxImages[lightbox.idx]?.alt || ''}
                className="max-w-full max-h-[80vh] object-contain rounded-2xl"
              />
              <p className="text-cream/50 text-sm text-center mt-4">
                {lightbox.idx + 1} / {lightboxImages.length}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
