'use client';

import { useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import {
  ArrowRight,
  LayoutGrid,
  Monitor,
  UtensilsCrossed,
  Lock,
  Sparkles,
  Briefcase,
} from 'lucide-react';
import { motion } from 'framer-motion';
import Logo from '@/components/layout/Logo';
import { getSiteImageByKey } from '@/lib/content';

const benefitIcons = {
  flexible: LayoutGrid,
  av: Monitor,
  catering: UtensilsCrossed,
  privacy: Lock,
};

const benefitGradients: Record<string, string> = {
  flexible: 'bg-gradient-pink',
  av: 'bg-gradient-cool',
  catering: 'bg-gradient-warm',
  privacy: 'bg-gradient-sunset',
};

const benefitKeys = ['flexible', 'av', 'catering', 'privacy'] as const;

export default function CorporatePage() {
  const t = useTranslations('corporate');
  const locale = useLocale();

  const [heroImage, setHeroImage] = useState<string | null>(null);
  useEffect(() => {
    getSiteImageByKey('corporate-hero').then((img) => {
      if (img) setHeroImage(img.url);
    }).catch(() => { /* fallback to placeholder */ });
  }, []);

  return (
    <div className="pt-28">
      {/* Hero */}
      <section className="section-padding relative overflow-hidden noise">
        {/* Decorative orbs */}
        <div className="orb orb-lavender animate-float-slow" style={{ width: 280, height: 280, top: '-60px', right: '5%', opacity: 0.7 }} />
        <div className="orb orb-sky animate-float-medium" style={{ width: 180, height: 180, bottom: '15%', left: '-40px', opacity: 0.55 }} />
        <div className="orb orb-coral animate-float-fast" style={{ width: 130, height: 130, top: '20%', right: '40%', opacity: 0.55 }} />
        <div className="absolute inset-0 bg-grid opacity-50 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)] pointer-events-none" />

        <div className="max-content mx-auto relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            <motion.div
              className="lg:col-span-7"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="glass-card p-8 md:p-12 lg:p-14">
                <span className="chip mb-5">
                  <Briefcase size={12} className="text-lavender" />
                  Corporate Events
                </span>
                <h1 className="text-heading font-display mb-5">
                  <span className="text-gradient-warm">{t('title')}</span>
                </h1>
                <p className="text-xl text-ink-soft mb-4">{t('subtitle')}</p>
                <p className="text-ink-soft/80 leading-relaxed mb-8 max-w-lg">{t('hero')}</p>
                <Link href="/#collection" className="btn-primary">
                  {t('cta')}
                  <ArrowRight size={18} />
                </Link>
              </div>
            </motion.div>

            <motion.div
              className="lg:col-span-5 relative"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2 }}
            >
              <div className="glass-strong relative aspect-[4/5] rounded-[40px] p-3 overflow-hidden">
                <div className="relative w-full h-full rounded-[32px] overflow-hidden">
                  {heroImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={heroImage} alt={t('title')} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-gradient-cool flex items-center justify-center">
                      <div className="orb orb-lavender animate-spin-slow" style={{ width: 180, height: 180, top: '20%', left: '20%', opacity: 0.85 }} />
                      <div className="orb orb-pink animate-float-medium" style={{ width: 110, height: 110, bottom: '15%', right: '15%', opacity: 0.75 }} />
                      <div className="relative z-10 px-8 py-6 rounded-3xl glass-strong backdrop-blur-2xl text-ink">
                        <Logo size={120} showTagline />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="section-padding relative overflow-hidden">
        <div className="orb orb-pink animate-float-medium" style={{ width: 240, height: 240, top: '20%', left: '-60px', opacity: 0.35 }} />

        <div className="max-content mx-auto relative z-10">
          <motion.div
            className="mb-12 max-w-2xl"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <span className="chip mb-4">
              <Sparkles size={12} className="text-pink" />
              Why corporates choose us
            </span>
            <h2 className="text-heading font-display">
              <span className="text-ink">Built for </span>
              <span className="text-gradient-pink">business</span>
            </h2>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {benefitKeys.map((key, i) => {
              const Icon = benefitIcons[key];
              return (
                <motion.div
                  key={key}
                  className="glass-card p-7 group hover:-translate-y-1 transition-transform duration-500"
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.08 }}
                >
                  <div className={`w-14 h-14 rounded-2xl ${benefitGradients[key]} flex items-center justify-center text-white shadow-glow mb-5`}>
                    <Icon size={26} />
                  </div>
                  <h3 className="text-lg font-bold font-display mb-2 text-ink">{t(`benefits.${key}.title`)}</h3>
                  <p className="text-ink-soft text-sm leading-relaxed">{t(`benefits.${key}.desc`)}</p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA Banner */}
      <section className="section-padding-sm">
        <div className="max-content mx-auto">
          <motion.div
            className="relative overflow-hidden rounded-[32px] bg-ink text-cream p-12 md:p-16 text-center"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <div className="orb orb-pink animate-float-slow" style={{ width: 280, height: 280, top: '-80px', left: '5%', opacity: 0.55 }} />
            <div className="orb orb-lavender animate-float-medium" style={{ width: 220, height: 220, bottom: '-60px', right: '8%', opacity: 0.5 }} />
            <div className="relative z-10">
              <h2 className="text-heading font-display mb-6">{t('cta')}</h2>
              <Link href="/#collection" className="btn-primary text-base">
                {locale === 'zh' ? '探索場地' : 'Explore Venues'}
                <ArrowRight size={18} />
              </Link>
            </div>
          </motion.div>
        </div>
      </section>
    </div>
  );
}
