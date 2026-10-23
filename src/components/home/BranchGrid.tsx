'use client';

import { useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import { motion } from 'framer-motion';
import { ArrowUpRight, MapPin } from 'lucide-react';
import SplitHeading from '@/components/ui/SplitHeading';
import { getSiteImageByKey } from '@/lib/content';
import { useBranchDirectory } from '@/lib/branchDirectory';

// Branch list comes from 分店管理 (registry) — a new branch shows up here
// automatically (HART, 2026-10-24). The original four keep their 內容管理
// hero-image slots (`branches-grid` section); newer branches use the first
// photo uploaded on the venue in 分店管理, else a gradient.
const LEGACY_IMAGE_KEY: Record<string, string> = {
  cwb: 'branch-hero-cwb',
  wanchai: 'branch-hero-wc',
  'sheung-wan': 'branch-hero-sw',
  tst: 'branch-hero-tst',
};
const PALETTE = [
  { gradient: 'bg-gradient-pink',   orb: 'orb-pink' },
  { gradient: 'bg-gradient-warm',   orb: 'orb-coral' },
  { gradient: 'bg-gradient-cool',   orb: 'orb-sky' },
  { gradient: 'bg-gradient-sunset', orb: 'orb-lavender' },
];

export default function BranchGrid() {
  const t = useTranslations('branches');
  const locale = useLocale() as 'zh' | 'en';
  const { branches } = useBranchDirectory();
  const [images, setImages] = useState<Record<string, string>>({});

  useEffect(() => {
    // 內容管理 hero images for the legacy branches; missing ones fall back
    // to the venue photo or gradient.
    Promise.all(
      Object.entries(LEGACY_IMAGE_KEY).map(async ([key, imageKey]) => {
        const img = await getSiteImageByKey(imageKey).catch(() => null);
        return [key, img?.url || ''] as const;
      })
    ).then((entries) => {
      const map: Record<string, string> = {};
      for (const [k, v] of entries) if (v) map[k] = v;
      setImages(map);
    });
  }, []);

  const count = branches.length;
  const colsClass = count >= 5 ? 'lg:grid-cols-5' : count === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-4';

  return (
    <section className="section-padding relative overflow-hidden">
      {/* Background grid */}
      <div className="absolute inset-0 bg-grid opacity-50 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)] pointer-events-none" />

      <div className="max-content mx-auto relative z-10">
        <motion.div
          className="mb-12 flex flex-col md:flex-row md:items-end justify-between gap-4"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <div>
            <span className="chip mb-4">
              <MapPin size={12} className="text-coral" />
              {count} locations · Hong Kong
            </span>
            <h2 className="text-heading font-display mb-3">
              <SplitHeading text={t('title')} accentClassName="text-gradient-warm" />
            </h2>
            <p className="text-lg text-ink-soft max-w-xl">{t('subtitle', { count })}</p>
          </div>
        </motion.div>

        <div className={`grid grid-cols-1 sm:grid-cols-2 ${colsClass} gap-5`}>
          {branches.map((branch, i) => {
            const heroUrl = images[branch.key] || branch.coverImage;
            const palette = PALETTE[i % PALETTE.length];
            const name = branch.name[locale] || branch.name.zh;
            return (
              <motion.div
                key={branch.key}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
              >
                <Link href={`/branches/${branch.slug}`}>
                  <div className="group relative aspect-[3/4] rounded-[32px] overflow-hidden cursor-pointer hover:-translate-y-1 transition-all duration-500 shadow-glass-lg">
                    {heroUrl ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={heroUrl}
                          alt={name}
                          loading="lazy"
                          decoding="async"
                          className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                        />
                        {/* Tint to keep text readable */}
                        <div className="absolute inset-0 bg-gradient-to-t from-ink/40 via-ink/10 to-transparent" />
                      </>
                    ) : (
                      <>
                        {/* Gradient base fallback */}
                        <div className={`absolute inset-0 ${palette.gradient}`} />
                        <div
                          className={`orb ${palette.orb} animate-float-slow group-hover:scale-110 transition-transform duration-700`}
                          style={{ width: 200, height: 200, top: '-30px', right: '-30px', opacity: 0.7 }}
                        />
                        <div
                          className={`orb ${palette.orb} animate-float-medium`}
                          style={{ width: 100, height: 100, bottom: '20%', left: '-20px', opacity: 0.5 }}
                        />
                      </>
                    )}

                    {/* Glass overlay at bottom */}
                    <div className="absolute inset-x-3 bottom-3 glass-strong rounded-[24px] p-5 z-10">
                      <div className="flex items-end justify-between gap-3">
                        <div>
                          <p className="text-[10px] uppercase tracking-widest text-ink-soft font-semibold mb-1">
                            Branch {String(i + 1).padStart(2, '0')}
                          </p>
                          <h3 className="text-lg font-bold font-display text-ink leading-tight">
                            {name}
                          </h3>
                          {branch.rooms.length > 1 && (
                            <p className="text-xs text-ink-soft mt-1">
                              {locale === 'zh' ? `${branch.rooms.length} 個空間` : `${branch.rooms.length} spaces`}
                            </p>
                          )}
                        </div>
                        <div className="w-10 h-10 rounded-full bg-ink text-white flex items-center justify-center group-hover:bg-gradient-pink transition-all flex-shrink-0">
                          <ArrowUpRight size={18} className="group-hover:rotate-45 transition-transform" />
                        </div>
                      </div>
                    </div>

                    {/* Subtle noise texture (only over gradient fallback) */}
                    {!heroUrl && (
                      <div className="absolute inset-0 mix-blend-overlay opacity-20 pointer-events-none"
                           style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' /%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")" }}
                      />
                    )}
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
