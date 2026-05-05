'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRight, Sparkles, MapPin } from 'lucide-react';
import { motion } from 'framer-motion';
import { getSiteImageByKey } from '@/lib/content';
import Logo from '@/components/layout/Logo';

export default function HeroSection() {
  const t = useTranslations('hero');
  const [heroImage, setHeroImage] = useState<string | null>(null);

  useEffect(() => {
    getSiteImageByKey('hero-main').then((img) => {
      if (img) setHeroImage(img.url);
    });
  }, []);

  return (
    <section className="relative min-h-screen flex items-center pt-28 pb-20 overflow-hidden noise">
      {/* Decorative floating orbs */}
      <div
        className="orb orb-pink animate-float-slow"
        style={{ width: 320, height: 320, top: '-80px', right: '-60px', opacity: 0.85 }}
      />
      <div
        className="orb orb-lavender animate-float-medium"
        style={{ width: 220, height: 220, bottom: '10%', left: '-40px', opacity: 0.75 }}
      />
      <div
        className="orb orb-coral animate-float-fast"
        style={{ width: 140, height: 140, top: '30%', right: '15%', opacity: 0.7 }}
      />
      <div
        className="orb orb-sky animate-float-slow"
        style={{ width: 100, height: 100, top: '15%', left: '15%', opacity: 0.55 }}
      />

      {/* Subtle grid backdrop */}
      <div className="absolute inset-0 bg-grid opacity-60 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)] pointer-events-none" />

      <div className="max-content mx-auto px-6 md:px-12 lg:px-20 w-full relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          {/* LEFT — Glass card with title */}
          <motion.div
            className="lg:col-span-7"
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="glass-card relative p-8 md:p-12 lg:p-14">
              {/* Top status row */}
              <div className="flex flex-wrap items-center gap-2 mb-6">
                <span className="chip-glow">
                  <span className="w-1.5 h-1.5 rounded-full bg-lime animate-pulse-glow" />
                  Live booking
                </span>
                <span className="chip">
                  <MapPin size={12} />4 locations · HK
                </span>
                <span className="chip">
                  <Sparkles size={12} className="text-pink" />
                  Party · Corporate · Family
                </span>
              </div>

              <h1 className="text-display font-display mb-6">
                {(() => {
                  // Split title on em-dash so we can gradient-style the brand portion.
                  const raw = t('title');
                  const parts = raw.split(/[—–-]/).map((p) => p.trim()).filter(Boolean);
                  if (parts.length >= 2) {
                    return (
                      <>
                        <span className="text-gradient-warm">{parts[0]}</span>
                        <br />
                        <span className="text-ink">{parts.slice(1).join(' — ')}</span>
                      </>
                    );
                  }
                  return <span className="text-ink">{raw}</span>;
                })()}
              </h1>

              <p className="text-lg md:text-xl text-ink-soft mb-8 max-w-lg leading-relaxed">
                {t('subtitle')}
              </p>

              <div className="flex flex-wrap items-center gap-3">
                <a href="#collection" className="btn-primary text-base group">
                  {t('cta')}
                  <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                </a>
                <a href="#amenities" className="btn-glass text-base">
                  Explore amenities
                </a>
                <a
                  href="https://www.instagram.com/spacohk"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-glass text-base group"
                  aria-label="Follow SPACO on Instagram"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-pink">
                    <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
                    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/>
                    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>
                  </svg>
                  Follow us
                </a>
              </div>

              {/* Bottom stat strip */}
              <div className="mt-10 pt-6 border-t border-white/50 grid grid-cols-3 gap-4 max-w-md">
                <div>
                  <div className="text-2xl font-bold font-display text-ink">4</div>
                  <div className="text-xs text-ink-soft mt-0.5">Branches</div>
                </div>
                <div>
                  <div className="text-2xl font-bold font-display text-gradient-pink">
                    1k+
                  </div>
                  <div className="text-xs text-ink-soft mt-0.5">Happy parties</div>
                </div>
                <div>
                  <div className="text-2xl font-bold font-display text-ink">24/7</div>
                  <div className="text-xs text-ink-soft mt-0.5">Booking online</div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* RIGHT — Visual showcase: glass frame holding hero image with floating mini cards */}
          <motion.div
            className="lg:col-span-5 relative"
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1, delay: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="relative">
              {/* Main glass image frame */}
              <div className="glass-strong relative aspect-[4/5] rounded-[40px] p-3 overflow-hidden">
                <div className="relative w-full h-full rounded-[32px] overflow-hidden">
                  {heroImage ? (
                    <img
                      src={heroImage}
                      alt="SPACO Venue"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-sunset flex items-center justify-center relative">
                      {/* Inner orb decoration when no image */}
                      <div
                        className="orb orb-lavender animate-spin-slow"
                        style={{ width: 180, height: 180, top: '20%', left: '20%', opacity: 0.9 }}
                      />
                      <div
                        className="orb orb-pink animate-float-medium"
                        style={{ width: 120, height: 120, bottom: '15%', right: '15%', opacity: 0.85 }}
                      />
                      <div className="relative z-10 text-center">
                        <div className="px-8 py-6 rounded-3xl glass-strong backdrop-blur-2xl text-ink">
                          <Logo size={140} showTagline />
                        </div>
                      </div>
                    </div>
                  )}
                  {/* Soft tint over image */}
                  <div className="absolute inset-0 bg-gradient-to-t from-lavender/15 via-transparent to-pink/5 pointer-events-none" />
                </div>
              </div>

            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
