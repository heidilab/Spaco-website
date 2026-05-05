'use client';

import { useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import {
  ArrowRight,
  ShieldCheck,
  Gamepad2,
  Maximize,
  UtensilsCrossed,
  Sparkles,
  PartyPopper,
  Cake,
  Check,
  Clock,
  Palette,
  Image as ImageIcon,
} from 'lucide-react';
import { motion } from 'framer-motion';
import Logo from '@/components/layout/Logo';
import { BIRTHDAY_CWB_PACKAGE } from '@/lib/packages';
import { DECORATION_STYLES } from '@/lib/decorations';
import { getSiteImageByKey } from '@/lib/content';

const benefitIcons = {
  safe: ShieldCheck,
  games: Gamepad2,
  space: Maximize,
  food: UtensilsCrossed,
};

const benefitGradients: Record<string, string> = {
  safe: 'bg-gradient-cool',
  games: 'bg-gradient-pink',
  space: 'bg-gradient-warm',
  food: 'bg-gradient-sunset',
};

const benefitKeys = ['safe', 'games', 'space', 'food'] as const;

export default function FamilyPage() {
  const t = useTranslations('family');
  const locale = useLocale() as 'zh' | 'en';

  const [decorImages, setDecorImages] = useState<Record<string, string>>({});
  const [heroImage, setHeroImage] = useState<string | null>(null);
  useEffect(() => {
    getSiteImageByKey('family-hero').then((img) => {
      if (img) setHeroImage(img.url);
    }).catch(() => { /* fallback to placeholder */ });

    Promise.all(
      DECORATION_STYLES.map(async (d) => {
        const img = await getSiteImageByKey(d.imageKey).catch(() => null);
        return [d.imageKey, img?.url || ''] as const;
      }),
    ).then((entries) => {
      const map: Record<string, string> = {};
      for (const [k, v] of entries) if (v) map[k] = v;
      setDecorImages(map);
    });
  }, []);

  return (
    <div className="pt-28">
      {/* Hero */}
      <section className="section-padding relative overflow-hidden noise">
        <div className="orb orb-pink animate-float-slow" style={{ width: 280, height: 280, top: '-60px', left: '5%', opacity: 0.7 }} />
        <div className="orb orb-coral animate-float-medium" style={{ width: 180, height: 180, bottom: '15%', right: '-40px', opacity: 0.55 }} />
        <div className="orb orb-lavender animate-float-fast" style={{ width: 130, height: 130, top: '20%', left: '40%', opacity: 0.55 }} />
        <div className="absolute inset-0 bg-grid opacity-50 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)] pointer-events-none" />

        <div className="max-content mx-auto relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            {/* Visual on left for variety */}
            <motion.div
              className="lg:col-span-5 lg:order-1 order-2 relative"
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
                    <div className="w-full h-full bg-gradient-sunset flex items-center justify-center">
                      <div className="orb orb-pink animate-spin-slow" style={{ width: 180, height: 180, top: '20%', right: '20%', opacity: 0.85 }} />
                      <div className="orb orb-lavender animate-float-medium" style={{ width: 110, height: 110, bottom: '15%', left: '15%', opacity: 0.75 }} />
                      <div className="relative z-10 px-8 py-6 rounded-3xl glass-strong backdrop-blur-2xl text-ink">
                        <Logo size={120} showTagline />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>

            <motion.div
              className="lg:col-span-7 lg:order-2 order-1"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="glass-card p-8 md:p-12 lg:p-14">
                <span className="chip mb-5">
                  <PartyPopper size={12} className="text-pink" />
                  Family · Kids party
                </span>
                <h1 className="text-heading font-display mb-5">
                  <span className="text-gradient-warm">{t('title')}</span>
                </h1>
                <p className="text-xl text-ink-soft mb-4">{t('subtitle')}</p>
                <p className="text-ink-soft/80 leading-relaxed mb-8 max-w-lg">{t('hero')}</p>
                <Link href={`/book/package/${BIRTHDAY_CWB_PACKAGE.slug}`} className="btn-primary">
                  {t('cta')}
                  <ArrowRight size={18} />
                </Link>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Birthday Package — featured CTA */}
      <section className="px-6 md:px-12 lg:px-20 pb-12 relative z-10">
        <div className="max-content mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="relative overflow-hidden rounded-[36px] bg-gradient-pink p-1 shadow-glow-soft"
          >
            <div className="rounded-[32px] bg-white/15 backdrop-blur-md p-8 md:p-10 relative overflow-hidden">
              {/* Inner orbs */}
              <div className="orb orb-pink animate-float-fast" style={{ width: 180, height: 180, top: '-40px', right: '-40px', opacity: 0.6 }} />
              <div className="orb orb-coral animate-float-medium" style={{ width: 140, height: 140, bottom: '-30px', left: '20%', opacity: 0.5 }} />

              <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
                <div className="lg:col-span-7 text-white">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-pill bg-white/25 backdrop-blur-md text-xs font-bold uppercase tracking-wider mb-4">
                    <Cake size={12} />
                    {locale === 'zh' ? '生日包場套餐' : 'Birthday Package'}
                  </div>
                  <h2 className="text-3xl md:text-4xl font-bold font-display mb-3 leading-tight">
                    {locale === 'zh' ? '銅鑼灣店生日包場' : 'Causeway Bay Birthday Bash'}
                    <span className="block text-2xl md:text-3xl font-display font-normal mt-1 opacity-90">
                      HK${BIRTHDAY_CWB_PACKAGE.price.toLocaleString()}
                      <span className="text-base font-normal ml-2 opacity-75">
                        {locale === 'zh' ? '全包' : 'all-in'}
                      </span>
                    </span>
                  </h2>
                  <p className="text-white/85 text-base mb-5 leading-relaxed">
                    {BIRTHDAY_CWB_PACKAGE.pitch[locale]}
                  </p>

                  {/* Inclusions */}
                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 mb-6">
                    {BIRTHDAY_CWB_PACKAGE.includes[locale].map((item) => (
                      <li key={item} className="flex items-start gap-2 text-sm text-white/90">
                        <Check size={14} className="flex-shrink-0 mt-0.5" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="flex flex-wrap items-center gap-3">
                    <Link href={`/book/package/${BIRTHDAY_CWB_PACKAGE.slug}`} className="inline-flex items-center gap-2 px-7 py-3.5 rounded-pill bg-white text-pink font-bold hover:-translate-y-0.5 transition-transform shadow-lg">
                      {locale === 'zh' ? '預訂生日包場' : 'Book Birthday Package'}
                      <ArrowRight size={16} />
                    </Link>
                    <span className="text-xs text-white/75 inline-flex items-center gap-1">
                      <Clock size={12} />
                      {BIRTHDAY_CWB_PACKAGE.earliestStart}–{BIRTHDAY_CWB_PACKAGE.latestEnd} ·{' '}
                      {BIRTHDAY_CWB_PACKAGE.durationHours}{locale === 'zh' ? '小時' : 'h'}
                    </span>
                  </div>
                </div>

                {/* Right — price callout */}
                <div className="lg:col-span-5 hidden lg:block">
                  <div className="glass-strong rounded-[28px] p-6 text-ink">
                    <p className="text-xs text-ink-soft uppercase tracking-wider font-semibold">
                      {locale === 'zh' ? '套餐費用' : 'Package Fee'}
                    </p>
                    <p className="text-5xl font-bold font-display text-gradient-pink leading-none my-3">
                      ${BIRTHDAY_CWB_PACKAGE.price.toLocaleString()}
                    </p>
                    <p className="text-xs text-ink-soft mb-4">
                      + HK${BIRTHDAY_CWB_PACKAGE.deposit.toLocaleString()}{' '}
                      {locale === 'zh' ? '可退按金' : 'refundable deposit'}
                    </p>
                    <div className="text-xs text-ink-soft space-y-1 border-t border-white/60 pt-3">
                      <p>📍 {locale === 'zh' ? '銅鑼灣店' : 'Causeway Bay only'}</p>
                      <p>⏱️ {locale === 'zh' ? '3 小時固定包場' : 'Fixed 3-hour exclusive'}</p>
                      <p>👥 {locale === 'zh' ? '不限人頭' : 'Unlimited guests'}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Decoration Styles — included free with the birthday package */}
      <section className="section-padding-sm relative overflow-hidden">
        <div className="orb orb-pink animate-float-medium" style={{ width: 200, height: 200, top: '15%', left: '-40px', opacity: 0.3 }} />
        <div className="max-content mx-auto relative z-10">
          <motion.div
            className="mb-8 max-w-2xl"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <span className="chip mb-4">
              <Palette size={12} className="text-pink" />
              {locale === 'zh' ? '佈置款式' : 'Decoration Styles'}
            </span>
            <h2 className="text-heading font-display">
              <span className="text-ink">{locale === 'zh' ? '3 款基本佈置' : '3 free decoration'}</span>
              <span>{' '}</span>
              <span className="text-gradient-pink">{locale === 'zh' ? '免費任揀' : 'styles to choose'}</span>
            </h2>
            <p className="text-ink-soft mt-3">
              {locale === 'zh'
                ? '生日包場套餐包括以下任一款佈置，預訂時揀啱意嘅 colour theme，我哋負責全部設置。'
                : 'The birthday package includes one of the styles below — pick your colour theme during booking, we handle the setup.'}
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {DECORATION_STYLES.map((style, i) => {
              const url = decorImages[style.imageKey];
              return (
                <motion.div
                  key={style.id}
                  className="glass-card p-3 group hover:-translate-y-1 transition-transform duration-500"
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.08 }}
                >
                  <div className="aspect-square rounded-[20px] overflow-hidden mb-4 relative">
                    {url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={url}
                        alt={style.label[locale]}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                      />
                    ) : (
                      <div className={`w-full h-full ${style.fallbackGradient} flex items-center justify-center`}>
                        <div className="text-center">
                          <ImageIcon size={28} className="mx-auto text-white/80 mb-2" />
                          <p className="text-white text-sm font-semibold">{style.label[locale]}</p>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="px-3 pb-3">
                    <p className="text-xs text-pink font-bold uppercase tracking-wider mb-1">
                      {locale === 'zh' ? '免費' : 'Free'}
                    </p>
                    <h3 className="text-xl font-bold font-display text-ink mb-1.5">{style.label[locale]}</h3>
                    <p className="text-sm text-ink-soft leading-relaxed">{style.description[locale]}</p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="section-padding relative overflow-hidden">
        <div className="orb orb-sky animate-float-medium" style={{ width: 240, height: 240, top: '20%', right: '-60px', opacity: 0.35 }} />

        <div className="max-content mx-auto relative z-10">
          <motion.div
            className="mb-12 max-w-2xl"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <span className="chip mb-4">
              <Sparkles size={12} className="text-coral" />
              Built for families
            </span>
            <h2 className="text-heading font-display">
              <span className="text-ink">A safe place to </span>
              <span className="text-gradient-pink">celebrate</span>
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
            <div className="orb orb-coral animate-float-slow" style={{ width: 280, height: 280, top: '-80px', right: '5%', opacity: 0.55 }} />
            <div className="orb orb-pink animate-float-medium" style={{ width: 220, height: 220, bottom: '-60px', left: '8%', opacity: 0.5 }} />
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
