'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import { motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import { getSiteImages, compareSiteImages } from '@/lib/content';
import { SiteImage } from '@/types';

/**
 * Special-offer promo section on the homepage. Pulls images from the
 * `homepage-promos` section in Firestore — each image carries an optional
 * `linkUrl` set by the admin (set in /admin/content). 4:5 portrait cards.
 *
 * If no promos are uploaded the entire section is hidden — this matches
 * how the branch grid degrades gracefully.
 */
export default function PromoSection() {
  const locale = useLocale() as 'zh' | 'en';
  const [promos, setPromos] = useState<SiteImage[]>([]);

  useEffect(() => {
    getSiteImages('homepage-promos')
      .then((imgs) => setPromos([...imgs].sort(compareSiteImages)))
      .catch(() => { /* silent fallback — section just hides */ });
  }, []);

  if (promos.length === 0) return null;

  return (
    <section className="section-padding relative overflow-hidden">
      {/* Decorative orbs */}
      <div className="orb orb-pink animate-float-slow" style={{ width: 280, height: 280, top: '-60px', left: '5%', opacity: 0.4 }} />
      <div className="orb orb-coral animate-float-medium" style={{ width: 200, height: 200, bottom: '15%', right: '-40px', opacity: 0.4 }} />

      <div className="max-content mx-auto relative z-10">
        <motion.div
          className="mb-10 max-w-2xl"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <span className="chip mb-4">
            <Sparkles size={12} className="text-pink" />
            {locale === 'zh' ? '限定優惠' : 'Limited Time'}
          </span>
          <h2 className="text-heading font-display">
            {locale === 'zh' ? (
              <>
                <span className="text-ink">特別優惠 </span>
                <span className="text-gradient-pink">Package</span>
              </>
            ) : (
              <>
                <span className="text-ink">Special </span>
                <span className="text-gradient-pink">Offers</span>
              </>
            )}
          </h2>
          <p className="text-lg text-ink-soft mt-3">
            {locale === 'zh'
              ? '精選包場套餐，期間限定優惠，按下即可了解詳情。'
              : 'Curated exclusive-rental packages — tap any card for details.'}
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8 lg:gap-10">
          {promos.map((promo, i) => {
            // Empty linkUrl = no destination set yet — render as a non-link
            // (still visible, just doesn't navigate). Avoids dead links.
            const href = promo.linkUrl?.trim() || '';

            // Alternating tilt for an organic photo-collage feel — each card
            // sits at -1°, 0°, +1° in a 3-up layout. Hover straightens it.
            const tiltDeg = (i % 3 === 0 ? -1 : i % 3 === 2 ? 1 : 0);

            const card = (
              <motion.div
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08, ease: [0.22, 1, 0.36, 1] }}
                style={{ ['--tilt' as string]: `${tiltDeg}deg` }}
                className="group relative cursor-pointer transition-transform duration-500 hover:-translate-y-2"
              >
                {/* Decorative orb glow that intensifies on hover */}
                <div className="orb orb-pink absolute -top-6 -right-6 w-32 h-32 opacity-0 group-hover:opacity-70 transition-opacity duration-500 pointer-events-none -z-10" />
                <div className="orb orb-coral absolute -bottom-4 -left-4 w-24 h-24 opacity-0 group-hover:opacity-60 transition-opacity duration-500 pointer-events-none -z-10" />

                {/* Sparkle accent — top-right corner sticker */}
                <div className="absolute -top-3 -right-3 z-20 w-12 h-12 rounded-full bg-gradient-pink shadow-glow flex items-center justify-center text-white opacity-90 group-hover:scale-110 group-hover:rotate-12 transition-all duration-500">
                  <Sparkles size={18} fill="white" />
                </div>

                {/* Outer gradient frame — softly colored ring around the polaroid */}
                <div
                  className="rounded-[32px] bg-gradient-to-br from-pink/50 via-coral/40 to-lavender/45 p-[2.5px] shadow-glass-lg group-hover:shadow-glow transition-shadow duration-500"
                  style={{ transform: `rotate(${tiltDeg}deg)`, transformOrigin: 'center' }}
                >
                  {/* Inner white frosted padding (polaroid border) */}
                  <div className="rounded-[30px] bg-white/85 backdrop-blur-md p-2.5 md:p-3">
                    {/* Image with inner rounded corners */}
                    <div className="relative aspect-[4/5] rounded-[22px] overflow-hidden bg-cream">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={promo.url}
                        alt={promo.alt || `Promo ${i + 1}`}
                        className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-700"
                      />
                      {/* Subtle sheen on hover for tactile feedback */}
                      <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/0 to-white/15 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
                    </div>
                  </div>
                </div>
              </motion.div>
            );

            // Internal links (start with `/`) use next-intl Link so locale
            // is preserved; everything else (https URLs, anchors) uses a
            // plain anchor tag with `target="_blank"` for external safety.
            if (!href) {
              return <div key={promo.id}>{card}</div>;
            }
            if (href.startsWith('/')) {
              return (
                <Link key={promo.id} href={href} className="block">
                  {card}
                </Link>
              );
            }
            return (
              <a
                key={promo.id}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="block"
              >
                {card}
              </a>
            );
          })}
        </div>
      </div>
    </section>
  );
}
