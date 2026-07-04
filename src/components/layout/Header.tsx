'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/routing';
import { useEffect, useRef, useState } from 'react';
import { Menu, X, Globe, LogIn, ChevronDown } from 'lucide-react';
import { useLocale } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import UserMenu from '@/components/auth/UserMenu';
import AuthModal from '@/components/auth/AuthModal';
import { LogoInline } from '@/components/layout/Logo';
import WhatsAppCTA from '@/components/layout/WhatsAppCTA';

// Branches surfaced in the Spaces dropdown — keep in sync with BranchGrid
const BRANCH_LINKS = [
  { slug: 'causeway-bay',  label: { zh: '銅鑼灣店',       en: 'Causeway Bay' } },
  { slug: 'wan-chai',      label: { zh: '灣仔店',         en: 'Wan Chai' } },
  { slug: 'tsim-sha-tsui', label: { zh: '尖沙咀店',       en: 'Tsim Sha Tsui' } },
  { slug: 'sheung-wan',    label: { zh: '上環海景旗艦店', en: 'Sheung Wan Flagship' } },
];

export default function Header() {
  const t = useTranslations('nav');
  const locale = useLocale() as 'zh' | 'en';
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [spacesOpen, setSpacesOpen] = useState(false);
  const [mobileSpacesOpen, setMobileSpacesOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const spacesRef = useRef<HTMLDivElement>(null);

  // Close the desktop dropdown when clicking outside it
  useEffect(() => {
    if (!spacesOpen) return;
    const handler = (e: MouseEvent) => {
      if (spacesRef.current && !spacesRef.current.contains(e.target as Node)) {
        setSpacesOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [spacesOpen]);

  const toggleLocale = () => {
    const newLocale = locale === 'zh' ? 'en' : 'zh';
    router.replace(pathname, { locale: newLocale });
  };

  // Non-Spaces nav links — Spaces gets its own dropdown UI
  const navLinks = [
    { href: '/corporate',         label: t('corporate') },
    { href: '/corporate-package', label: t('corporatePackage') },
    { href: '/family',            label: t('family') },
    { href: '/articles',          label: locale === 'zh' ? '文章分享' : 'Articles' },
    { href: '/guidelines',        label: t('guidelines') },
    { href: '/faq',               label: t('faq') },
  ];

  return (
    <>
      <header className="fixed top-4 left-4 right-4 z-50 flex justify-center pointer-events-none">
        <div className="glass-strong rounded-pill pointer-events-auto w-full max-w-6xl px-4 md:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <Link href="/" className="pl-2 text-ink hover:text-pink transition-colors" aria-label="SPACO home">
              <LogoInline size={26} />
            </Link>

            {/* Desktop Nav */}
            <nav className="hidden md:flex items-center gap-6">
              {/* Spaces dropdown */}
              <div className="relative" ref={spacesRef}>
                <button
                  type="button"
                  onClick={() => setSpacesOpen((v) => !v)}
                  onMouseEnter={() => setSpacesOpen(true)}
                  className={`text-sm font-medium transition-colors inline-flex items-center gap-1 ${
                    spacesOpen ? 'text-pink' : 'text-ink-soft hover:text-pink'
                  }`}
                  aria-expanded={spacesOpen}
                  aria-haspopup="menu"
                >
                  {t('spaces')}
                  <ChevronDown
                    size={14}
                    className={`transition-transform ${spacesOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {spacesOpen && (
                  <div
                    onMouseLeave={() => setSpacesOpen(false)}
                    className="absolute top-full left-1/2 -translate-x-1/2 mt-3 min-w-[260px] glass-strong rounded-2xl shadow-glass-lg p-2"
                    role="menu"
                  >
                    {/* "All spaces" link first */}
                    <Link
                      href="/#collection"
                      onClick={() => setSpacesOpen(false)}
                      className="block px-4 py-2.5 rounded-xl text-sm font-semibold text-ink hover:bg-gradient-pink hover:text-white transition-colors"
                      role="menuitem"
                    >
                      {locale === 'zh' ? '🌟 所有派對空間' : '🌟 All Party Spaces'}
                    </Link>
                    <div className="my-1 border-t border-white/50" />
                    {BRANCH_LINKS.map((b) => (
                      <Link
                        key={b.slug}
                        href={`/branches/${b.slug}`}
                        onClick={() => setSpacesOpen(false)}
                        className="block px-4 py-2.5 rounded-xl text-sm text-ink-soft hover:bg-white/70 hover:text-ink transition-colors"
                        role="menuitem"
                      >
                        {b.label[locale]}
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-sm font-medium text-ink-soft hover:text-pink transition-colors"
                >
                  {link.label}
                </Link>
              ))}
            </nav>

            {/* Right Actions */}
            <div className="hidden md:flex items-center gap-2">
              <button
                onClick={toggleLocale}
                className="flex items-center gap-1.5 text-sm font-medium text-ink-soft hover:text-pink transition-colors px-3 py-1.5 rounded-pill hover:bg-white/50"
              >
                <Globe size={14} />
                {locale === 'zh' ? 'EN' : '中文'}
              </button>

              {!loading && (
                <>
                  {user ? (
                    <UserMenu />
                  ) : (
                    <button
                      onClick={() => setAuthModalOpen(true)}
                      className="flex items-center gap-1.5 text-sm font-medium text-ink-soft hover:text-pink transition-colors px-3 py-1.5 rounded-pill hover:bg-white/50"
                    >
                      <LogIn size={14} />
                      {locale === 'zh' ? '登入' : 'Log In'}
                    </button>
                  )}
                </>
              )}

              <WhatsAppCTA source="navbar_desktop" />
            </div>

            {/* Mobile Menu Button */}
            <button
              className="md:hidden"
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              {mobileOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>

          {/* Mobile Nav */}
          {mobileOpen && (
            <div className="md:hidden pb-6 border-t border-charcoal/10">
              <nav className="flex flex-col gap-1 pt-4">
                {/* Spaces accordion */}
                <button
                  onClick={() => setMobileSpacesOpen((v) => !v)}
                  className="flex items-center justify-between text-lg font-medium py-2"
                >
                  <span>{t('spaces')}</span>
                  <ChevronDown
                    size={18}
                    className={`transition-transform ${mobileSpacesOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {mobileSpacesOpen && (
                  <div className="pl-3 pb-2 space-y-1">
                    <Link
                      href="/#collection"
                      onClick={() => {
                        setMobileSpacesOpen(false);
                        setMobileOpen(false);
                      }}
                      className="block py-1.5 text-sm font-semibold text-pink"
                    >
                      🌟 {locale === 'zh' ? '所有派對空間' : 'All Party Spaces'}
                    </Link>
                    {BRANCH_LINKS.map((b) => (
                      <Link
                        key={b.slug}
                        href={`/branches/${b.slug}`}
                        onClick={() => {
                          setMobileSpacesOpen(false);
                          setMobileOpen(false);
                        }}
                        className="block py-1.5 text-sm text-ink-soft"
                      >
                        {b.label[locale]}
                      </Link>
                    ))}
                  </div>
                )}

                {navLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="text-lg font-medium py-2"
                    onClick={() => setMobileOpen(false)}
                  >
                    {link.label}
                  </Link>
                ))}
                <button
                  onClick={() => {
                    toggleLocale();
                    setMobileOpen(false);
                  }}
                  className="flex items-center gap-2 text-lg font-medium text-charcoal/70 pt-2"
                >
                  <Globe size={18} />
                  {locale === 'zh' ? 'English' : '繁體中文'}
                </button>

                {!loading && !user && (
                  <button
                    onClick={() => {
                      setAuthModalOpen(true);
                      setMobileOpen(false);
                    }}
                    className="flex items-center gap-2 text-lg font-medium"
                  >
                    <LogIn size={18} />
                    {locale === 'zh' ? '登入 / 註冊' : 'Log In / Sign Up'}
                  </button>
                )}

                {user && (
                  <div className="pt-2">
                    <UserMenu />
                  </div>
                )}

                <div className="mt-3" onClick={() => setMobileOpen(false)}>
                  <WhatsAppCTA
                    source="navbar_mobile"
                    className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-pill bg-[#25D366] text-white font-semibold text-base hover:opacity-90 transition-opacity shadow-md"
                  />
                </div>
              </nav>
            </div>
          )}
        </div>
      </header>

      {/* Auth Modal */}
      <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} />
    </>
  );
}
