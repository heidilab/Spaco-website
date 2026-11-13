import type { Metadata } from 'next';
import { getLocale } from 'next-intl/server';
import { ArrowRight, Compass } from 'lucide-react';
import { Link } from '@/i18n/routing';
import NotFoundTitle from '@/components/NotFoundTitle';

// Localized 404 — rendered inside [locale]/layout.tsx (Header / Footer)
// for unknown addresses (via [...rest]/page.tsx) and for notFound() calls
// from pages, e.g. an unknown or 落架 venue on /branches/[slug].
// Not listed in sitemap.ts; Next itself adds <meta name="robots"
// content="noindex"> to every not-found response.

const COPY = {
  zh: {
    title: '找不到呢個頁面',
    body: '條連結可能打錯咗，或者呢個頁面已經搬走／落架。你可以返回首頁，或者睇吓我哋所有空間。',
    home: '返回首頁',
    spaces: '睇吓所有空間',
  },
  en: {
    title: 'Page not found',
    body: 'The link may be mistyped, or this page has moved or is no longer available. Head back to the homepage, or browse all our spaces.',
    home: 'Back to Home',
    spaces: 'View All Spaces',
  },
} as const;

async function currentLocale(): Promise<'zh' | 'en'> {
  return (await getLocale()) === 'en' ? 'en' : 'zh';
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await currentLocale();
  return { title: `${COPY[locale].title} | SPACO` };
}

export default async function LocaleNotFound() {
  const locale = await currentLocale();
  const t = COPY[locale];

  return (
    <div className="pt-28 relative overflow-hidden">
      <NotFoundTitle title={`${t.title} | SPACO`} />
      <div className="orb orb-pink animate-float-slow" style={{ width: 280, height: 280, top: '-60px', right: '-60px', opacity: 0.35 }} />
      <div className="orb orb-lavender animate-float-medium" style={{ width: 200, height: 200, top: '40%', left: '-60px', opacity: 0.3 }} />

      <section className="px-6 md:px-12 lg:px-20 py-16 md:py-24 relative z-10">
        <div className="max-w-2xl mx-auto">
          <div className="glass-card p-8 md:p-12 text-center">
            <span className="chip-glow mb-5">
              <Compass size={12} className="text-lavender" />
              404
            </span>
            <h1 className="text-heading font-display mb-4">
              <span className="text-gradient-warm">{t.title}</span>
            </h1>
            <p className="text-lg text-ink-soft mb-8">{t.body}</p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link href="/" className="btn-primary">
                {t.home}
                <ArrowRight size={16} />
              </Link>
              <Link href="/#collection" className="btn-glass">
                {t.spaces}
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
