import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  // No `template`: the client-side metadata pass re-applied it on top of
  // page titles that already end in SPACO, producing 「SPACO · SPACO」 after
  // hydration. buildMetadata (and the article page) append the brand
  // suffix themselves, so server and client titles stay identical.
  title: 'SPACO — Multifunctional Space',
  description: 'Premium self-service event spaces in Hong Kong',
  manifest: '/manifest.webmanifest',
  // Meta Business Suite domain verification for spacohk.com (added 2026-11-18).
  // Renders <meta name="facebook-domain-verification"> in <head> on every page.
  verification: {
    other: {
      'facebook-domain-verification': '2x2lwuxrzhaqsdo4ekpausfzowl4g6',
    },
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'SPACO',
  },
  icons: {
    icon: [
      { url: '/spaco-logo.png', type: 'image/png' },
    ],
    shortcut: '/spaco-logo.png',
    apple: '/icon-192.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#ffffff',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
