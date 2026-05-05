import type { MetadataRoute } from 'next';
import { SEO_PAGES } from '@/lib/seo';

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://spacohk.com';
const LOCALES = ['zh', 'en'] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const entries: MetadataRoute.Sitemap = [];

  for (const page of SEO_PAGES) {
    const path = page.path === '/' ? '' : page.path;
    entries.push({
      url: `${SITE_URL}/zh${path}`,
      lastModified: now,
      changeFrequency: page.id === 'home' ? 'weekly' : 'monthly',
      priority: page.id === 'home' ? 1.0 : 0.8,
      alternates: {
        languages: {
          'zh-HK': `${SITE_URL}/zh${path}`,
          'en':    `${SITE_URL}/en${path}`,
        },
      },
    });
    entries.push({
      url: `${SITE_URL}/en${path}`,
      lastModified: now,
      changeFrequency: page.id === 'home' ? 'weekly' : 'monthly',
      priority: page.id === 'home' ? 1.0 : 0.8,
    });
  }

  return entries;
}
