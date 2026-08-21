import Script from 'next/script';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { routing } from '@/i18n/routing';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { AuthProvider } from '@/contexts/AuthContext';
import VisitTracker from '@/components/VisitTracker';
import { buildMetadata } from '@/lib/seo';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

// Site-wide metadata defaults; per-page layouts override individual fields
// via their own generateMetadata.
export async function generateMetadata({
  params,
}: { params: { locale: string } }): Promise<Metadata> {
  return buildMetadata({
    pageId: '__none',
    locale: params.locale as 'zh' | 'en',
    path: '/',
  });
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  const { locale } = params;
  if (!(routing.locales as readonly string[]).includes(locale)) {
    notFound();
  }

  const messages = await getMessages();

  // Google Ads / Analytics gtag — only emitted when the env var is set.
  // We use NEXT_PUBLIC_GOOGLE_ADS_ID (e.g. "AW-1234567890" or "G-XXXX")
  // so conversion-tracking on the WhatsApp CTA works without redeploys.
  const gtagId = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;
  const GTM_ID = 'GTM-MLZ5CBQ6';

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/* Google Tag Manager — loaded as early as possible. */}
        <Script id="gtm-loader" strategy="afterInteractive">{`
          (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
          new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
          j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
          'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
          })(window,document,'script','dataLayer','${GTM_ID}');
        `}</Script>
      </head>
      <body className="font-sans antialiased" suppressHydrationWarning>
        {/* Google Tag Manager (noscript) — must be the first child of <body>. */}
        <noscript>
          <iframe
            src={`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`}
            height="0"
            width="0"
            style={{ display: 'none', visibility: 'hidden' }}
          />
        </noscript>

        {gtagId && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${gtagId}`}
              strategy="afterInteractive"
            />
            <Script id="gtag-init" strategy="afterInteractive">{`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', '${gtagId}');
            `}</Script>
          </>
        )}
        <NextIntlClientProvider messages={messages}>
          <AuthProvider>
            <VisitTracker />
            <Header />
            <main>{children}</main>
            <Footer />
          </AuthProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
