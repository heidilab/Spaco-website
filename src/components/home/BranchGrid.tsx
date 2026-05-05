'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { motion } from 'framer-motion';
import { ArrowUpRight, MapPin } from 'lucide-react';
import SplitHeading from '@/components/ui/SplitHeading';
import { getSiteImageByKey } from '@/lib/content';

// Slot keys here MUST match the admin content sections in
// src/app/[locale]/admin/content/page.tsx (`branches-grid` section).
const branches = [
  { key: 'cwb',       slug: 'causeway-bay',  gradient: 'bg-gradient-pink',    orb: 'orb-pink',     imageKey: 'branch-hero-cwb' },
  { key: 'wanchai',   slug: 'wan-chai',      gradient: 'bg-gradient-warm',    orb: 'orb-coral',    imageKey: 'branch-hero-wc' },
  { key: 'sheungwan', slug: 'sheung-wan',    gradient: 'bg-gradient-cool',    orb: 'orb-sky',      imageKey: 'branch-hero-sw' },
  { key: 'tst',       slug: 'tsim-sha-tsui', gradient: 'bg-gradient-sunset',  orb: 'orb-lavender', imageKey: 'branch-hero-tst' },
];

export default function BranchGrid() {
  const t = useTranslations('branches');
  const [images, setImages] = useState<Record<string, string>>({});

  useEffect(() => {
    // Load all 4 branch hero images in parallel; missing ones fall back to gradient
    Promise.all(
      branches.map(async (b) => {
        const img = await getSiteImageByKey(b.imageKey).catch(() => null);
        return [b.imageKey, img?.url || ''] as const;
      })
    ).then((entries) => {
      const map: Record<string, string> = {};
      for (const [k, v] of entries) {
        if (v) map[k] = v;
      }
      setImages(map);
    });
  }, []);

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
              4 locations · Hong Kong
            </span>
            <h2 className="text-heading font-display mb-3">
              <SplitHeading text={t('title')} accentClassName="text-gradient-warm" />
            </h2>
            <p className="text-lg text-ink-soft max-w-xl">{t('subtitle')}</p>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {branches.map((branch, i) => {
            const heroUrl = images[branch.imageKey];
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
                          alt={t(branch.key)}
                          className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                        />
                        {/* Tint to keep text readable */}
                        <div className="absolute inset-0 bg-gradient-to-t from-ink/40 via-ink/10 to-transparent" />
                      </>
                    ) : (
                      <>
                        {/* Gradient base fallback */}
                        <div className={`absolute inset-0 ${branch.gradient}`} />
                        <div
                          className={`orb ${branch.orb} animate-float-slow group-hover:scale-110 transition-transform duration-700`}
                          style={{ width: 200, height: 200, top: '-30px', right: '-30px', opacity: 0.7 }}
                        />
                        <div
                          className={`orb ${branch.orb} animate-float-medium`}
                          style={{ width: 100, height: 100, bottom: '20%', left: '-20px', opacity: 0.5 }}
                        />
                      </>
                    )}

                    {/* Glass overlay at bottom */}
                    <div className="absolute inset-x-3 bottom-3 glass-strong rounded-[24px] p-5 z-10">
                      <div className="flex items-end justify-between gap-3">
                        <div>
                          <p className="text-[10px] uppercase tracking-widest text-ink-soft font-semibold mb-1">
                            Branch 0{i + 1}
                          </p>
                          <h3 className="text-lg font-bold font-display text-ink leading-tight">
                            {t(branch.key)}
                          </h3>
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
