'use client';

import { useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import { ArrowRight, Users } from 'lucide-react';
import { motion } from 'framer-motion';
import { Venue } from '@/types';
import { getSiteImageByKey } from '@/lib/content';

interface VenueCardProps {
  venue: Venue;
  index: number;
}

export default function VenueCard({ venue, index }: VenueCardProps) {
  const t = useTranslations('collection');
  const locale = useLocale() as 'zh' | 'en';
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const isLarge = index % 3 === 0;

  // Resolve filter card image. Priority:
  //   1) explicit `card-{cwb|wc|sw|tst}` slot (admin-uploaded card image)
  //   2) first photo of the branch's photo gallery (cover)
  //   3) legacy slot key `${prefix}-1`
  useEffect(() => {
    const branchPrefix = venue.id.startsWith('sw-')
      ? 'sw'
      : venue.id === 'wanchai' ? 'wc' : venue.id;
    const cardKey = `card-${branchPrefix}`;

    (async () => {
      // 1) explicit card slot
      const cardImg = await getSiteImageByKey(cardKey).catch(() => null);
      if (cardImg) { setImageUrl(cardImg.url); return; }

      // 2) cover from branch gallery. sw-ab has no gallery of its own
      //    (shares the floor with sw-a + sw-b) — fall back to sw-a's photos.
      const sectionKey = venue.id === 'sw-ab'
        ? 'branch-sw-a'
        : `branch-${venue.id.replace('wanchai', 'wc')}`;
      const list = await import('@/lib/content').then((m) => m.getSiteImages(sectionKey)).catch(() => []);
      if (list && list.length > 0) {
        const { compareSiteImages } = await import('@/lib/content');
        const sorted = [...list].sort(compareSiteImages);
        if (sorted[0]) { setImageUrl(sorted[0].url); return; }
      }

      // 3) legacy fixed-slot key
      const legacyKey = `${venue.id.replace('wanchai', 'wc')}-1`;
      const legacy = await getSiteImageByKey(legacyKey).catch(() => null);
      if (legacy) setImageUrl(legacy.url);
    })();
  }, [venue.id]);

  // All Sheung Wan variants link to the unified branch page
  const isSheungWan = ['sw-a', 'sw-b', 'sw-ab'].includes(venue.id);
  const detailHref = isSheungWan
    ? '/branches/sheung-wan'
    : `/branches/${venue.slug}`;
  // When dedupe-displayed, show the branch name instead of the variant name
  const displayName = isSheungWan
    ? { zh: '上環海景旗艦店', en: 'Sheung Wan' }[locale]
    : venue.name[locale];
  const displaySubtitle = isSheungWan
    ? { zh: '3 種空間配置', en: '3 room options' }[locale]
    : venue.subtitle[locale];
  // SW capacity range = aggregate across all 3 rooms (6 - 100)
  const capacityRange = isSheungWan ? '6-100' : `${venue.capacity.min}-${venue.capacity.max}`;

  return (
    <motion.div
      className={`${isLarge ? 'md:col-span-2' : 'md:col-span-1'}`}
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay: index * 0.1 }}
    >
      <Link href={detailHref}>
        <div className="group glass-card cursor-pointer hover:-translate-y-1 hover:shadow-glass-lg transition-all duration-500 p-3">
          <div className={`relative overflow-hidden rounded-[20px] ${isLarge ? 'aspect-[16/9]' : 'aspect-[4/3]'}`}>
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={venue.name[locale]}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
              />
            ) : (
              <div className="w-full h-full bg-gradient-sunset group-hover:scale-105 transition-transform duration-700 flex items-center justify-center relative">
                <div className="orb orb-lavender animate-float-medium" style={{ width: 140, height: 140, top: '10%', left: '15%', opacity: 0.7 }} />
                <div className="orb orb-pink animate-float-fast" style={{ width: 80, height: 80, bottom: '15%', right: '20%', opacity: 0.6 }} />
                <div className="text-center relative z-10">
                  <div className="w-14 h-14 mx-auto mb-2 rounded-2xl glass-strong flex items-center justify-center backdrop-blur-2xl">
                    <span className="text-lg font-bold font-display text-gradient-pink">{venue.branch}</span>
                  </div>
                  <p className="text-ink-soft text-xs font-medium">{venue.size}</p>
                </div>
              </div>
            )}
            {/* Floating capacity chip on image */}
            <div className="absolute top-3 left-3 chip backdrop-blur-2xl bg-white/70 text-xs">
              <Users size={12} />
              {capacityRange}
            </div>
            <div className="absolute inset-0 bg-gradient-to-t from-ink/30 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          </div>

          <div className="p-4 pt-5">
            {displaySubtitle && (
              <p className="text-xs text-gradient-pink font-bold tracking-wider uppercase mb-1.5">
                {displaySubtitle}
              </p>
            )}
            <h3 className="text-xl font-bold font-display mb-3 text-ink">{displayName}</h3>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-ink-soft">
                {t('from')} <span className="font-bold text-ink">HK${venue.pricing.weekday.perHead}</span>/{t('people')}
              </span>
              <span className="flex items-center gap-1 text-sm font-semibold text-ink group-hover:text-pink transition-colors">
                {t('viewDetails')}
                <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
              </span>
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
