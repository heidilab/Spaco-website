import type { MetadataRoute } from 'next';
import { SEO_PAGES } from '@/lib/seo';
import { groupBranches } from '@/lib/branchGrouping';
import type { Venue } from '@/types';

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

/** Live venues from 分店管理 (the `venues` collection is public-read),
 *  via REST so this stays a pure server function. */
async function fetchVenues(): Promise<Venue[]> {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/venues?pageSize=100`;
    const res = await fetch(url, { next: { revalidate: 600 } });
    if (!res.ok) return [];
    const data = (await res.json()) as { documents?: Array<{ name: string; fields?: Record<string, unknown> }> };
    const unwrap = (v: unknown): unknown => {
      const f = v as Record<string, unknown>;
      if ('stringValue' in f) return f.stringValue;
      if ('integerValue' in f) return Number(f.integerValue);
      if ('doubleValue' in f) return f.doubleValue;
      if ('booleanValue' in f) return f.booleanValue;
      if ('mapValue' in f) {
        const out: Record<string, unknown> = {};
        for (const [k, x] of Object.entries((f.mapValue as { fields?: Record<string, unknown> }).fields || {})) out[k] = unwrap(x);
        return out;
      }
      if ('arrayValue' in f) return ((f.arrayValue as { values?: unknown[] }).values || []).map(unwrap);
      return undefined;
    };
    return (data.documents || []).map((d) => {
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(d.fields || {})) o[k] = unwrap(v);
      return { ...(o as unknown as Venue), id: d.name.split('/').pop() as string };
    });
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

  // Branch pages from 分店管理 that SEO_PAGES does not list (e.g. HART).
  const listed = new Set(SEO_PAGES.map((p) => p.path));
  for (const b of groupBranches(await fetchVenues())) {
    const path = `/branches/${b.slug}`;
    if (listed.has(path)) continue;
    entries.push({
      url: `${SITE_URL}/zh${path}`, lastModified: now, changeFrequency: 'monthly', priority: 0.8,
      alternates: { languages: { 'zh-HK': `${SITE_URL}/zh${path}`, 'en': `${SITE_URL}/en${path}` } },
    });
    entries.push({ url: `${SITE_URL}/en${path}`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 });
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
