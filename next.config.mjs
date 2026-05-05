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
};

export default withNextIntl(nextConfig);
