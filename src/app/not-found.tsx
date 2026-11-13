import type { Metadata } from 'next';
import NotFoundTitle from '@/components/NotFoundTitle';

// Fallback 404 for addresses outside /zh and /en (e.g. /foo). Those never
// reach [locale]/layout.tsx's document shell — it calls notFound() for an
// unknown locale — and the root layout renders children only, so this
// page must bring its own <html>/<body>. No Header / Footer here: they
// need the next-intl provider from the locale layout. Addresses under
// /zh or /en use [locale]/not-found.tsx instead.

const TITLE = '找不到頁面 Page not found | SPACO';

// Next itself adds <meta name="robots" content="noindex"> to not-found responses.
export const metadata: Metadata = { title: TITLE };

export default function RootNotFound() {
  return (
    <html lang="zh-HK">
      <body className="font-sans antialiased">
        <NotFoundTitle title={TITLE} />
        <main className="min-h-screen flex items-center justify-center px-6 py-16">
          <div className="glass-card p-8 md:p-12 text-center max-w-xl w-full">
            <p className="font-display text-2xl font-bold tracking-tight mb-6">SPACO</p>
            <h1 className="text-heading font-display mb-2">
              <span className="text-gradient-warm">找不到呢個頁面</span>
            </h1>
            <p className="text-lg text-ink-soft mb-8">Page not found</p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              {/* Plain anchors: a full document load into the locale layout. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/zh" className="btn-primary">返回首頁</a>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/en" className="btn-glass">English Home</a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
