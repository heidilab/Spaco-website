'use client';

import { useTranslations } from 'next-intl';

export default function Marquee() {
  const t = useTranslations('marquee');
  const text = t('text');

  return (
    <div className="relative py-5 overflow-hidden bg-gradient-pink">
      <div className="animate-marquee whitespace-nowrap flex">
        {[...Array(8)].map((_, i) => (
          <span key={i} className="text-sm font-semibold tracking-[0.25em] mx-8 text-white inline-flex items-center gap-3">
            {text}
            <span className="w-1.5 h-1.5 rounded-full bg-white/70" />
          </span>
        ))}
      </div>
      {/* fade edges */}
      <div className="absolute inset-y-0 left-0 w-20 bg-gradient-to-r from-pink to-transparent pointer-events-none" />
      <div className="absolute inset-y-0 right-0 w-20 bg-gradient-to-l from-lavender to-transparent pointer-events-none" />
    </div>
  );
}
