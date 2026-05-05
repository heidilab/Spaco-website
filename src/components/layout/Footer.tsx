'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { ArrowRight, Mail } from 'lucide-react';
import Logo from '@/components/layout/Logo';

export default function Footer() {
  const t = useTranslations('footer');
  const nav = useTranslations('nav');

  return (
    <footer className="relative text-cream overflow-hidden bg-ink">
      {/* Decorative orbs */}
      <div className="orb orb-pink animate-float-slow" style={{ width: 280, height: 280, top: '-80px', right: '10%', opacity: 0.35 }} />
      <div className="orb orb-lavender animate-float-medium" style={{ width: 200, height: 200, bottom: '20%', left: '5%', opacity: 0.3 }} />

      {/* Newsletter */}
      <div className="section-padding-sm relative z-10">
        <div className="max-content mx-auto">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 py-12 border-b border-cream/10">
            <h3 className="text-heading font-display">
              {t('subscribe')}
            </h3>
            <div className="flex w-full md:w-auto bg-white/5 backdrop-blur-md border border-white/10 rounded-pill p-1.5">
              <input
                type="email"
                placeholder={t('emailPlaceholder')}
                className="bg-transparent text-cream placeholder:text-cream/40 px-5 py-2.5 focus:outline-none w-full md:w-72"
              />
              <button className="btn-primary text-sm">
                {t('subscribeBtn')}
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Footer Content */}
      <div className="px-6 md:px-12 lg:px-20 pb-12">
        <div className="max-content mx-auto grid grid-cols-1 md:grid-cols-3 gap-12">
          {/* About */}
          <div>
            <div className="mb-5">
              <Logo size={120} showTagline variant="invert" />
            </div>
            <p className="text-cream/60 text-sm leading-relaxed">
              {t('aboutText')}
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h4 className="text-xl font-bold mb-4">{t('quickLinks')}</h4>
            <nav className="flex flex-col gap-3">
              <Link href="/" className="text-cream/60 hover:text-cream text-sm transition-colors">
                {nav('spaces')}
              </Link>
              <Link href="/corporate" className="text-cream/60 hover:text-cream text-sm transition-colors">
                {nav('corporate')}
              </Link>
              <Link href="/family" className="text-cream/60 hover:text-cream text-sm transition-colors">
                {nav('family')}
              </Link>
              <Link href="/faq" className="text-cream/60 hover:text-cream text-sm transition-colors">
                {nav('faq')}
              </Link>
            </nav>
          </div>

          {/* Contact */}
          <div>
            <h4 className="text-xl font-bold mb-4">{t('contact')}</h4>
            <div className="flex flex-col gap-3 text-sm text-cream/60">
              <p>{t('phone')}: +852 9282 3060</p>
              <p>{t('email')}: spacohk@gmail.com</p>
            </div>
            <div className="flex gap-4 mt-6">
              <a href="https://www.instagram.com/spacohk" target="_blank" rel="noopener noreferrer" className="text-cream/40 hover:text-cream transition-colors" aria-label="Instagram">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
              </a>
              <a href="https://www.facebook.com/share/18Z2XRamLy/?mibextid=wwXIfr" target="_blank" rel="noopener noreferrer" className="text-cream/40 hover:text-cream transition-colors" aria-label="Facebook">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>
              </a>
              <a href="#" className="text-cream/40 hover:text-cream transition-colors" aria-label="Email">
                <Mail size={20} />
              </a>
            </div>
          </div>
        </div>

        {/* Bottom */}
        <div className="max-content mx-auto mt-12 pt-8 border-t border-cream/10 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-cream/40 text-xs">{t('copyright')}</p>
          <div className="flex gap-6 text-xs text-cream/40">
            <a href="#" className="hover:text-cream transition-colors">{t('terms')}</a>
            <a href="#" className="hover:text-cream transition-colors">{t('privacy')}</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
