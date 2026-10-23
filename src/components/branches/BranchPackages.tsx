'use client';

// 「此分店獨家套餐」 section shared by the single-space branch page and the
// multi-space (上環模式) page, so a branch created in 分店管理 shows the same
// package card as Causeway Bay (HART birthday package, Heidi 2026-10-24).

import { Link } from '@/i18n/routing';
import { motion } from 'framer-motion';
import { ArrowRight, Check, Clock, Sparkles } from 'lucide-react';
import { CATEGORY_LABEL, type EventPackage } from '@/lib/packages';

export default function BranchPackages({ packages, locale }: { packages: EventPackage[]; locale: 'zh' | 'en' }) {
  if (packages.length === 0) return null;
  return (
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
          {packages.map((pkg) => {
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
                        {pkg.latestEnd
                          ? `${pkg.earliestStart}–${pkg.latestEnd}`
                          : (locale === 'zh' ? `${pkg.earliestStart} 起（24 小時）` : `From ${pkg.earliestStart} (24h)`)}
                        {' · '}{pkg.durationHours}{locale === 'zh' ? '小時' : 'h'}
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
  );
}
