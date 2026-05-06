import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Don't fail production builds on ESLint findings. Lint runs in dev/CI
  // for awareness; the build gate is Next.js's TypeScript check (still on).
  // Deploys aren't held hostage to unused-imports or apostrophe-escaping.
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Reverse-proxy Firebase Auth's helper iframe + redirect handler so the
  // OAuth consent screen says "Continue to spacohk.com" instead of
  // "spaco-website.firebaseapp.com". Set NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
  // to spacohk.com in Vercel for this to take effect.
  async rewrites() {
    return [
      {
        source: '/__/auth/:path*',
        destination: 'https://spaco-website.firebaseapp.com/__/auth/:path*',
      },
    ];
  },
};

export default withNextIntl(nextConfig);
