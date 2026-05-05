import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'SPACO — Multifunctional Space',
    template: '%s · SPACO',
  },
  description: 'Premium self-service event spaces in Hong Kong',
  icons: {
    icon: [
      { url: '/spaco-logo.png', type: 'image/png' },
    ],
    shortcut: '/spaco-logo.png',
    apple: '/spaco-logo.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
