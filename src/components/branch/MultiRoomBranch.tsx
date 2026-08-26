'use client';

// Generic multi-space branch page (上環模式 for NEW branches). Renders
// the branch hero + one card per bookable space with photos, pricing,
// capacity, facilities and a book CTA. The original Sheung Wan page
// (/branches/sheung-wan) stays custom; every future multi-space branch
// gets this page automatically at /branches/[branchKey].

import { useState } from 'react';
import { Link } from '@/i18n/routing';
import { motion } from 'framer-motion';
import { MapPin, Users, Clock, ArrowRight, ChevronLeft, ChevronRight, X as XIcon } from 'lucide-react';
import { Venue } from '@/types';
import { amenityLabels } from '@/lib/venues';

export default function MultiRoomBranch({ rooms, locale }: { rooms: Venue[]; locale: 'zh' | 'en' }) {
  const first = rooms[0];
  const branchName = first.branchName?.[locale] || first.branchName?.zh || first.name[locale];
  const [lightbox, setLightbox] = useState<{ roomIdx: number; imgIdx: number } | null>(null);

  const toList = (raw?: string) => (raw || '').split('\n').map((s) => s.trim()).filter(Boolean);

  return (
    <div className="pt-28 pb-20 relative overflow-hidden">
      <div className="orb orb-pink animate-float-slow" style={{ width: 280, height: 280, top: '-40px', left: '5%', opacity: 0.4 }} />
      <div className="orb orb-lavender animate-float-medium" style={{ width: 200, height: 200, top: '35%', right: '-50px', opacity: 0.35 }} />

      <div className="max-content mx-auto px-6 md:px-12 lg:px-20 relative z-10">
        {/* Hero */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-10">
          <h1 className="text-3xl md:text-5xl font-bold font-display text-ink mb-3">{branchName}</h1>
          <p className="flex items-center gap-1.5 text-ink-soft text-sm">
            <MapPin size={14} className="shrink-0" />
            {first.address[locale] || first.address.zh}
          </p>
          <p className="text-ink-soft mt-3 max-w-2xl leading-relaxed">
            {locale === 'zh'
              ? `${branchName}提供 ${rooms.length} 種空間配置，可獨立租用或組合包場。`
              : `${branchName} offers ${rooms.length} space configurations — book individually or combined.`}
          </p>
        </motion.div>

        {/* Room cards */}
        <div className="space-y-8">
          {rooms.map((room, ri) => {
            const label = room.roomLabel?.[locale] || room.roomLabel?.zh || room.name[locale];
            const amenText = room.amenitiesText?.[locale] || '';
            const amenities = amenText
              ? amenText.split(/[、,，\n]/).map((s) => s.trim()).filter(Boolean)
              : room.amenities.map((a) => amenityLabels[a]?.[locale] || a);
            const sw = toList(room.switchGames?.[locale]);
            const bg = toList(room.boardGames?.[locale]);
            return (
              <motion.div
                key={room.id}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                className="glass-card p-5 md:p-7"
              >
                <div className="grid md:grid-cols-2 gap-6">
                  {/* Photos */}
                  <div>
                    {room.images?.[0] ? (
                      <button type="button" onClick={() => setLightbox({ roomIdx: ri, imgIdx: 0 })} className="block w-full">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={room.images[0]} alt={label} className="w-full aspect-[4/3] object-cover rounded-2xl" />
                      </button>
                    ) : (
                      <div className="w-full aspect-[4/3] rounded-2xl bg-gradient-sunset flex items-center justify-center">
                        <span className="text-2xl font-bold font-display text-white/80">{label}</span>
                      </div>
                    )}
                    {room.images && room.images.length > 1 && (
                      <div className="flex gap-2 mt-2 overflow-x-auto">
                        {room.images.slice(1, 6).map((url, ii) => (
                          <button key={ii} type="button" onClick={() => setLightbox({ roomIdx: ri, imgIdx: ii + 1 })} className="shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={url} alt="" className="w-20 h-14 object-cover rounded-lg" />
                          </button>
                        ))}
                        {room.images.length > 6 && (
                          <span className="shrink-0 w-20 h-14 rounded-lg bg-charcoal/10 flex items-center justify-center text-xs font-bold text-ink-soft">
                            +{room.images.length - 6}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex flex-col">
                    <h2 className="text-2xl font-bold font-display text-ink">{label}</h2>
                    {room.size && <p className="text-xs text-ink-soft mt-0.5">{room.size}</p>}
                    <p className="text-sm text-ink-soft mt-2 leading-relaxed">{room.description[locale] || room.description.zh}</p>

                    <div className="grid grid-cols-3 gap-3 my-4">
                      <div className="rounded-xl bg-white/60 p-3 text-center">
                        <Users size={14} className="mx-auto text-accent mb-1" />
                        <p className="text-sm font-bold">{room.capacity.min}–{room.capacity.max}</p>
                        <p className="text-[10px] text-ink-soft">{locale === 'zh' ? '人數' : 'Guests'}</p>
                      </div>
                      <div className="rounded-xl bg-white/60 p-3 text-center">
                        <p className="text-sm font-bold mt-4">${room.pricing.weekday.perHead}/${room.pricing.weekend.perHead}</p>
                        <p className="text-[10px] text-ink-soft">{locale === 'zh' ? '平日/週末 每位每小時' : 'Wkday/wkend $/hd/hr'}</p>
                      </div>
                      <div className="rounded-xl bg-white/60 p-3 text-center">
                        <Clock size={14} className="mx-auto text-accent mb-1" />
                        <p className="text-sm font-bold">{room.minHours.weekday}h</p>
                        <p className="text-[10px] text-ink-soft">{locale === 'zh' ? '最少鐘數' : 'Min hours'}</p>
                      </div>
                    </div>

                    {amenities.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-4">
                        {amenities.slice(0, 10).map((a, ai) => (
                          <span key={ai} className="chip bg-white/70 text-[11px]">{a}</span>
                        ))}
                        {sw.length > 0 && <span className="chip bg-violet-100 text-violet-800 text-[11px]">Switch ×{sw.length}</span>}
                        {bg.length > 0 && <span className="chip bg-amber-100 text-amber-800 text-[11px]">{locale === 'zh' ? '桌遊' : 'Board games'} ×{bg.length}</span>}
                      </div>
                    )}

                    <div className="mt-auto">
                      <Link
                        href={`/book/${room.slug}`}
                        className="inline-flex items-center gap-2 px-6 py-3 rounded-pill bg-gradient-pink text-white font-bold text-sm hover:shadow-lg transition-shadow"
                      >
                        {locale === 'zh' ? `預訂${label}` : `Book ${label}`}
                        <ArrowRight size={15} />
                      </Link>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Lightbox */}
      {lightbox && rooms[lightbox.roomIdx]?.images?.length > 0 && (
        <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-6" onClick={() => setLightbox(null)}>
          <button className="absolute top-5 right-5 text-white" onClick={() => setLightbox(null)}><XIcon size={26} /></button>
          <button
            className="absolute left-4 text-white/80 hover:text-white"
            onClick={(e) => { e.stopPropagation(); setLightbox({ ...lightbox, imgIdx: Math.max(0, lightbox.imgIdx - 1) }); }}
          ><ChevronLeft size={30} /></button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={rooms[lightbox.roomIdx].images[lightbox.imgIdx]}
            alt=""
            className="max-h-[85vh] max-w-full rounded-2xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            className="absolute right-4 text-white/80 hover:text-white"
            onClick={(e) => { e.stopPropagation(); setLightbox({ ...lightbox, imgIdx: Math.min(rooms[lightbox.roomIdx].images.length - 1, lightbox.imgIdx + 1) }); }}
          ><ChevronRight size={30} /></button>
        </div>
      )}
    </div>
  );
}
