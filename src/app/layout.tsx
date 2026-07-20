import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'SPACO — Multifunctional Space',
    template: '%s · SPACO',
  },
  description: 'Premium self-service event spaces in Hong Kong',
  manifest: '/manifest.webmanifest',
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
