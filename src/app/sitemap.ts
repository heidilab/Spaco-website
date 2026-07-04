import type { MetadataRoute } from 'next';
import { SEO_PAGES } from '@/lib/seo';

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://spacohk.com';
const PROJECT_ID =
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'spaco-website';

/** Article (published only) for sitemap inclusion. Fetched via Firestore
 *  REST API so this stays a pure server function (no admin SDK init). */
async function fetchPublishedArticles(): Promise<Array<{ slug: string; updatedAt?: Date }>> {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`;
    const body = {
      structuredQuery: {
        from: [{ collectionId: 'articles' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'status' },
            op: 'EQUAL',
            value: { stringValue: 'published' },
          },
        },
      },
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      next: { revalidate: 600 },
    });
    if (!res.ok) return [];
    const rows = (await res.json()) as Array<{ document?: { fields?: Record<string, { stringValue?: string; timestampValue?: string }> } }>;
    return rows
      .filter((r) => r.document?.fields?.slug?.stringValue)
      .map((r) => ({
        slug: r.document!.fields!.slug.stringValue!,
        updatedAt: r.document?.fields?.updatedAt?.timestampValue
          ? new Date(r.document.fields.updatedAt.timestampValue)
          : undefined,
      }));
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
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

  // Articles section landing
  for (const loc of ['zh', 'en'] as const) {
    entries.push({
      url: `${SITE_URL}/${loc}/articles`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.7,
      ...(loc === 'zh' ? {
        alternates: {
          languages: {
            'zh-HK': `${SITE_URL}/zh/articles`,
            'en':    `${SITE_URL}/en/articles`,
          },
        },
      } : {}),
    });
  }

  // Per-article URLs
  const articles = await fetchPublishedArticles();
  for (const a of articles) {
    entries.push({
      url: `${SITE_URL}/zh/articles/${a.slug}`,
      lastModified: a.updatedAt || now,
      changeFrequency: 'monthly',
      priority: 0.6,
      alternates: {
        languages: {
          'zh-HK': `${SITE_URL}/zh/articles/${a.slug}`,
          'en':    `${SITE_URL}/en/articles/${a.slug}`,
        },
      },
    });
    entries.push({
      url: `${SITE_URL}/en/articles/${a.slug}`,
      lastModified: a.updatedAt || now,
      changeFrequency: 'monthly',
      priority: 0.6,
    });
  }

  return entries;
}
