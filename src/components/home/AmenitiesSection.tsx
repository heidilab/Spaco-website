'use client';

import { useTranslations } from 'next-intl';
import { motion } from 'framer-motion';
import { Music, ChefHat, Armchair, Sun, Flame, Gamepad2, Sparkles } from 'lucide-react';
import SplitHeading from '@/components/ui/SplitHeading';

const amenityIcons = {
  audio: Music,
  kitchen: ChefHat,
  furniture: Armchair,
  lighting: Sun,
  bbq: Flame,
  games: Gamepad2,
};

// Each amenity gets its own gradient — keeps the page colorful & energetic
const amenityGradient: Record<string, string> = {
  audio: 'bg-gradient-pink',
  kitchen: 'bg-gradient-warm',
  furniture: 'bg-gradient-cool',
  lighting: 'bg-gradient-sunset',
  bbq: 'bg-gradient-warm',
  games: 'bg-gradient-pink',
};

const amenityKeys = ['audio', 'kitchen', 'furniture', 'lighting', 'bbq', 'games'] as const;

export default function AmenitiesSection() {
  const t = useTranslations('amenities');

  return (
    <section id="amenities" className="section-padding relative overflow-hidden">
      {/* Background orbs */}
      <div className="orb orb-pink animate-float-slow" style={{ width: 300, height: 300, top: '-60px', left: '40%', opacity: 0.3 }} />
      <div className="orb orb-sky animate-float-medium" style={{ width: 200, height: 200, bottom: '10%', right: '5%', opacity: 0.4 }} />

      <div className="max-content mx-auto relative z-10">
        <motion.div
          className="mb-14 max-w-2xl"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <span className="chip mb-4">
            <Sparkles size={12} className="text-lavender" />
            What's included
          </span>
          <h2 className="text-heading font-display mb-3">
            <SplitHeading text={t('title')} accentClassName="text-gradient-pink" />
          </h2>
          <p className="text-lg text-ink-soft">{t('subtitle')}</p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {amenityKeys.map((key, index) => {
            const Icon = amenityIcons[key];
            return (
              <motion.div
                key={key}
                className="glass-card group relative p-6 hover:-translate-y-1 transition-transform duration-500"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.06 }}
              >
                {/* Top row: gradient icon + number */}
                <div className="flex items-start justify-between mb-5">
                  <div
                    className={`w-14 h-14 rounded-2xl ${amenityGradient[key]} flex items-center justify-center text-white shadow-glow`}
                  >
                    <Icon size={26} />
                  </div>
                  <span className="text-4xl font-bold font-display text-ink/10 group-hover:text-gradient-pink transition-colors">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                </div>

                <h3 className="text-xl font-bold font-display mb-2 text-ink">
                  {t(`items.${key}.title`)}
                </h3>
                <p className="text-ink-soft text-sm leading-relaxed">
                  {t(`items.${key}.desc`)}
                </p>

                {/* Hover accent border */}
                <div className="absolute inset-0 rounded-3xl border-2 border-pink/0 group-hover:border-pink/30 transition-colors pointer-events-none" />
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
