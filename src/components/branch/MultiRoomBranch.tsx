'use client';

// Generic multi-space branch page (上環模式). Mirrors the Sheung Wan
// flagship layout (/branches/sheung-wan) so every branch created in
// 分店管理 with several spaces reads the same way: glass hero with chips,
// then one section per space — gallery + lightbox on the left, detail
// card (Option chip, name, description, specs strip, amenities grid,
// prices, book CTA) on the right. The combined / full-floor option comes
// last and, when it has no photos of its own, renders full-width exactly
// like Sheung Wan's A+B (Heidi 2026-10-24).

import { useMemo, useState } from 'react';
import { Link } from '@/i18n/routing';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, ArrowLeft, Users, Maximize, Clock, ChevronLeft, ChevronRight, X, Sparkles, MapPin } from 'lucide-react';
import type { Venue } from '@/types';
import { amenityLabels } from '@/lib/venues';
import AmenityGrid from '@/components/branches/AmenityGrid';
import { isCombinedRoom, optionLetter, orderRooms, roomLabel } from '@/lib/roomOrder';

const GRADIENTS = ['bg-gradient-cool', 'bg-gradient-pink', 'bg-gradient-sunset', 'bg-gradient-warm'];

export default function MultiRoomBranch({ rooms: input, locale }: { rooms: Venue[]; locale: 'zh' | 'en' }) {
  const rooms = useMemo(() => orderRooms(input), [input]);
  const first = rooms[0];
  const branchName = (first.branchName?.[locale] || first.branchName?.zh || first.name[locale]).trim();
  const address = first.address?.[locale] || first.address?.zh || '';
  const [lightbox, setLightbox] = useState<{ roomIdx: number; idx: number } | null>(null);
  const lightboxImages = lightbox ? rooms[lightbox.roomIdx]?.images || [] : [];
  const toList = (raw?: string) => (raw || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const singlesCount = rooms.filter((r) => !isCombinedRoom(r)).length;

  return (
    <div className="pt-28 relative overflow-hidden">
      <div className="orb orb-pink animate-float-slow" style={{ width: 280, height: 280, top: '-60px', right: '-60px', opacity: 0.35 }} />
      <div className="orb orb-lavender animate-float-medium" style={{ width: 200, height: 200, top: '40%', left: '-60px', opacity: 0.3 }} />

      {/* Back link */}
      <div className="max-content mx-auto px-6 md:px-12 lg:px-20 py-6 relative z-10">
        <Link href="/#collection" className="inline-flex items-center gap-2 text-sm text-ink-soft hover:text-pink transition-colors">
          <ArrowLeft size={16} />
          {locale === 'zh' ? '返回所有空間' : 'Back to All Spaces'}
        </Link>
      </div>

      {/* Branch hero */}
      <section className="px-6 md:px-12 lg:px-20 pb-12 relative z-10">
        <div className="max-content mx-auto">
          <motion.div
            className="glass-card p-8 md:p-12"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex flex-wrap items-center gap-2 mb-5">
              {address && (
                <span className="chip">
                  <MapPin size={12} className="text-pink" />
                  {address}
                </span>
              )}
              <span className="chip-glow">
                <Sparkles size={12} className="text-lavender" />
                {locale === 'zh' ? `${rooms.length} 種空間配置` : `${rooms.length} room options`}
              </span>
            </div>
            <h1 className="text-heading font-display mb-4">
              <span className="text-gradient-warm">{branchName}</span>
            </h1>
            <p className="text-lg text-ink-soft max-w-2xl">
              {locale === 'zh'
                ? `同一層樓 ${rooms.length} 種佈局：可以單獨租用 ${singlesCount} 個獨立空間，或者包場做大型聚會。`
                : `One floor, ${rooms.length} layouts: book any of the ${singlesCount} individual spaces, or take the whole floor for a large gathering.`}
            </p>
          </motion.div>
        </div>
      </section>

      {/* Room sections */}
      <section className="px-6 md:px-12 lg:px-20 pb-16 relative z-10">
        <div className="max-content mx-auto space-y-10">
          {rooms.map((v, idx) => {
            const imgs = v.images || [];
            const main = imgs[0];
            const gallery = imgs.slice(1, 5);
            const moreCount = Math.max(0, imgs.length - 5);
            const label = roomLabel(v, locale);
            const letter = optionLetter(rooms, idx);
            const gradient = GRADIENTS[idx % GRADIENTS.length];
            // Combined option without its own photos: full-width detail card
            // (the floor is already shown in the individual rooms' galleries).
            const hideGallery = isCombinedRoom(v) && imgs.length === 0;
            const amenText = v.amenitiesText?.[locale] || '';
            const items = amenText
              ? amenText.split(/[、,，\n]/).map((s) => s.trim()).filter(Boolean)
              : (v.amenities || []).map((a) => amenityLabels[a]?.[locale] || a);
            const sw = toList(v.switchGames?.[locale]);
            const bg = toList(v.boardGames?.[locale]);
            return (
              <motion.div
                key={v.id}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-100px' }}
                transition={{ duration: 0.6, delay: idx * 0.05 }}
              >
                <div id={v.id} />
                <div className={`grid grid-cols-1 ${hideGallery ? '' : 'lg:grid-cols-12'} gap-6 items-stretch`}>
                  {!hideGallery && (
                    <div className="lg:col-span-5 space-y-3">
                      <button
                        type="button"
                        onClick={() => main && setLightbox({ roomIdx: idx, idx: 0 })}
                        className="glass-strong relative aspect-[4/3] rounded-[28px] p-2.5 overflow-hidden w-full text-left cursor-pointer hover:shadow-glass-lg transition-shadow"
                      >
                        <div className="relative w-full h-full rounded-[20px] overflow-hidden">
                          {main ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={main} alt={label} loading={idx === 0 ? 'eager' : 'lazy'} className="w-full h-full object-cover" />
                          ) : (
                            <div className={`w-full h-full ${gradient} flex items-center justify-center relative`}>
                              <div className="orb orb-lavender animate-float-medium" style={{ width: 130, height: 130, top: '15%', left: '15%', opacity: 0.7 }} />
                              <div className="orb orb-pink animate-float-fast" style={{ width: 80, height: 80, bottom: '15%', right: '15%', opacity: 0.6 }} />
                              <div className="text-center relative z-10">
                                <div className="w-16 h-16 mx-auto mb-2 rounded-2xl glass-strong flex items-center justify-center backdrop-blur-2xl">
                                  <span className="text-base font-bold font-display text-gradient-pink">{letter}</span>
                                </div>
                                <p className="text-ink-soft text-xs font-medium">{v.size}</p>
                              </div>
                            </div>
                          )}
                        </div>
                      </button>
                      {gallery.length > 0 && (
                        <div className="grid grid-cols-4 gap-2">
                          {gallery.map((url, i) => (
                            <button
                              key={`${v.id}-${i}`}
                              type="button"
                              onClick={() => setLightbox({ roomIdx: idx, idx: i + 1 })}
                              className="aspect-square rounded-2xl overflow-hidden ring-1 ring-white/60 hover:opacity-80 transition-opacity"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={url} alt={`${label} ${i + 2}`} loading="lazy" className="w-full h-full object-cover" />
                            </button>
                          ))}
                          {moreCount > 0 && (
                            <button
                              type="button"
                              onClick={() => setLightbox({ roomIdx: idx, idx: 5 })}
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
                      <span className={`chip backdrop-blur-md ${gradient} text-white border-transparent`}>
                        Option {letter}
                      </span>
                      {v.subtitle?.[locale] && (
                        <p className="text-xs font-bold tracking-wider uppercase text-gradient-pink">{v.subtitle[locale]}</p>
                      )}
                    </div>
                    <h2 className="text-2xl md:text-3xl font-bold font-display mb-3 text-ink">{label}</h2>
                    {(v.description?.[locale] || v.description?.zh) && (
                      <p className="text-ink-soft leading-relaxed mb-5 text-sm md:text-base">{v.description[locale] || v.description.zh}</p>
                    )}

                    {/* Specs strip */}
                    <div className="grid grid-cols-3 gap-3 mb-5">
                      <div className="bg-white/40 backdrop-blur-md rounded-2xl p-3 border border-white/60">
                        <Users size={14} className="text-pink mb-1" />
                        <p className="text-[10px] text-ink-soft uppercase tracking-wider font-semibold">{locale === 'zh' ? '人數' : 'Capacity'}</p>
                        <p className="text-base font-bold font-display text-ink">{v.capacity.min}-{v.capacity.max}</p>
                      </div>
                      <div className="bg-white/40 backdrop-blur-md rounded-2xl p-3 border border-white/60">
                        <Maximize size={14} className="text-lavender mb-1" />
                        <p className="text-[10px] text-ink-soft uppercase tracking-wider font-semibold">{locale === 'zh' ? '面積' : 'Area'}</p>
                        <p className="text-base font-bold font-display text-ink">{v.size || '—'}</p>
                      </div>
                      <div className="bg-white/40 backdrop-blur-md rounded-2xl p-3 border border-white/60">
                        <Clock size={14} className="text-coral mb-1" />
                        <p className="text-[10px] text-ink-soft uppercase tracking-wider font-semibold">{locale === 'zh' ? '最少時數' : 'Min hrs'}</p>
                        <p className="text-base font-bold font-display text-ink">{v.minHours.weekday}h</p>
                      </div>
                    </div>

                    {(items.length > 0 || sw.length > 0 || bg.length > 0) && (
                      <div className="mb-5">
                        <p className="text-[10px] text-ink-soft uppercase tracking-wider font-semibold mb-2">{locale === 'zh' ? '設施' : 'Amenities'}</p>
                        <AmenityGrid amenities={items} switchGames={sw} boardGames={bg} locale={locale} />
                      </div>
                    )}

                    {/* Price + CTA */}
                    <div className="mt-auto flex flex-col sm:flex-row sm:items-end justify-between gap-3 pt-4 border-t border-white/50">
                      <div className="flex flex-wrap gap-x-5 gap-y-1">
                        <div>
                          <p className="text-[10px] text-ink-soft uppercase tracking-wider font-semibold">{locale === 'zh' ? '平日' : 'Weekday'}</p>
                          <p className="font-bold font-display text-ink">
                            HK${v.pricing.weekday.perHead}<span className="text-xs font-normal text-ink-soft">/pax</span>
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] text-ink-soft uppercase tracking-wider font-semibold">{locale === 'zh' ? '週末/假日' : 'Weekend / PH'}</p>
                          <p className="font-bold font-display text-gradient-warm">
                            HK${v.pricing.weekend.perHead}<span className="text-xs font-normal text-ink-soft">/pax</span>
                          </p>
                        </div>
                      </div>
                      <Link href={`/book/${v.slug}`} className="btn-primary text-sm whitespace-nowrap">
                        {locale === 'zh' ? `預訂 ${label}` : `Book ${label}`}
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
              aria-label={locale === 'zh' ? '關閉' : 'Close'}
            >
              <X size={22} />
            </button>
            <button
              className="absolute left-6 top-1/2 -translate-y-1/2 w-12 h-12 glass-dark rounded-full flex items-center justify-center text-cream hover:bg-pink/30 transition-colors"
              onClick={(e) => { e.stopPropagation(); setLightbox((p) => (p ? { ...p, idx: Math.max(0, p.idx - 1) } : p)); }}
              aria-label={locale === 'zh' ? '上一張' : 'Previous'}
            >
              <ChevronLeft size={24} />
            </button>
            <button
              className="absolute right-6 top-1/2 -translate-y-1/2 w-12 h-12 glass-dark rounded-full flex items-center justify-center text-cream hover:bg-pink/30 transition-colors"
              onClick={(e) => { e.stopPropagation(); setLightbox((p) => (p ? { ...p, idx: Math.min(lightboxImages.length - 1, p.idx + 1) } : p)); }}
              aria-label={locale === 'zh' ? '下一張' : 'Next'}
            >
              <ChevronRight size={24} />
            </button>
            <div className="max-w-4xl max-h-[80vh] px-16" onClick={(e) => e.stopPropagation()}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={lightboxImages[lightbox.idx]} alt="" className="max-w-full max-h-[80vh] object-contain rounded-2xl" />
              <p className="text-cream/50 text-sm text-center mt-4">{lightbox.idx + 1} / {lightboxImages.length}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
