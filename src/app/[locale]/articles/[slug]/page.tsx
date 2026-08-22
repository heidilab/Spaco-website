import type { Metadata } from 'next';
import { Link } from '@/i18n/routing';
import { Newspaper, ChevronLeft } from 'lucide-react';
import { adminDb } from '@/lib/firebaseAdmin';
import { Article } from '@/types';
import ArticleView from '@/components/article/ArticleView';

const COLLECTION = 'articles';
const SITE_URL = 'https://spacohk.com';

/** Server-side fetch — used by both generateMetadata and the page
 *  itself. Uses Firebase Admin SDK so it works in the RSC context
 *  without needing client-side auth. */
async function getArticleBySlugServer(slug: string): Promise<Article | null> {
  const snap = await adminDb
    .collection(COLLECTION)
    .where('slug', '==', slug)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...(d.data() as Omit<Article, 'id'>) };
}

export async function generateMetadata({ params }: { params: Promise<{ locale: 'zh' | 'en'; slug: string }> }): Promise<Metadata> {
  const { locale, slug } = await params;
  const article = await getArticleBySlugServer(slug);
  if (!article || article.status !== 'published') {
    return { title: locale === 'zh' ? '找唔到呢篇文章 — SPACO' : 'Article not found — SPACO' };
  }
  // SEO override → falls back to article title / excerpt / hero.
  const title = article.seoTitle?.[locale] || article.title[locale] || article.title.zh;
  const description = article.seoDescription?.[locale]
    || article.excerpt?.[locale]
    || article.excerpt?.zh
    || '';
  const keywords = article.seoKeywords?.[locale] || article.seoKeywords?.zh || '';
  const ogImg = article.ogImage || article.heroImage;
  const canonical = `${SITE_URL}/${locale}/articles/${article.slug}`;

  return {
    title,
    description,
    keywords: keywords || undefined,
    robots: article.noindex ? { index: false, follow: false } : undefined,
    alternates: {
      canonical,
      languages: {
        'zh-HK': `${SITE_URL}/zh/articles/${article.slug}`,
        'en':    `${SITE_URL}/en/articles/${article.slug}`,
      },
    },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: 'SPACO',
      type: 'article',
      images: ogImg ? [{ url: ogImg }] : undefined,
      locale: locale === 'zh' ? 'zh_HK' : 'en_US',
    },
    twitter: {
      card: ogImg ? 'summary_large_image' : 'summary',
      title,
      description,
      images: ogImg ? [ogImg] : undefined,
    },
  };
}

export default async function ArticleDetailPage({ params }: { params: Promise<{ locale: 'zh' | 'en'; slug: string }> }) {
  const { locale, slug } = await params;
  const article = await getArticleBySlugServer(slug);

  if (!article || article.status !== 'published') {
    return (
      <div className="pt-32 min-h-screen flex items-center justify-center px-6">
        <div className="text-center space-y-4 max-w-md">
          <Newspaper size={40} className="text-ink-soft/30 mx-auto" />
          <h1 className="text-2xl font-bold">{locale === 'zh' ? '找唔到呢篇文章' : 'Article not found'}</h1>
          <p className="text-ink-soft">{locale === 'zh' ? '佢可能未發佈或者已被移除。' : 'It may not be published yet or has been removed.'}</p>
          <Link href="/articles" className="btn-primary inline-flex items-center gap-2">
            <ChevronLeft size={16} />
            {locale === 'zh' ? '返回文章列表' : 'Back to articles'}
          </Link>
        </div>
      </div>
    );
  }

  // Firestore Timestamps don't serialize across the RSC boundary —
  // strip them to ISO strings before handing to the client view.
  const safeArticle: Article = {
    ...article,
    createdAt: serializeTs(article.createdAt),
    updatedAt: serializeTs(article.updatedAt),
    publishedAt: serializeTs(article.publishedAt),
  };

  const title = article.title[locale] || article.title.zh;

  return (
    <>
      <ArticleView article={safeArticle} locale={locale} />

      {/* Breadcrumb JSON-LD — helps engines place the article in the
       *  site structure (AI-friendliness audit 2026-08). */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: locale === 'zh' ? '首頁' : 'Home', item: `${SITE_URL}/${locale}` },
              { '@type': 'ListItem', position: 2, name: locale === 'zh' ? '文章分享' : 'Articles', item: `${SITE_URL}/${locale}/articles` },
              { '@type': 'ListItem', position: 3, name: title, item: `${SITE_URL}/${locale}/articles/${article.slug}` },
            ],
          }),
        }}
      />
      {/* Article JSON-LD for SEO */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Article',
            headline: title,
            image: article.heroImage ? [article.heroImage] : undefined,
            datePublished: serializeTs(article.publishedAt),
            dateModified: serializeTs(article.updatedAt),
            author: article.authorName ? { '@type': 'Person', name: article.authorName } : undefined,
            publisher: {
              '@type': 'Organization',
              name: 'SPACO',
              logo: { '@type': 'ImageObject', url: `${SITE_URL}/spaco-logo.png` },
            },
            description: article.seoDescription?.[locale] || article.excerpt?.[locale] || article.excerpt?.zh,
            mainEntityOfPage: `${SITE_URL}/${locale}/articles/${article.slug}`,
          }),
        }}
      />
    </>
  );
}

function serializeTs(v: unknown): string | undefined {
  if (!v) return undefined;
  const t = v as { toDate?: () => Date; seconds?: number };
  const d = t.toDate?.() ?? (typeof t.seconds === 'number' ? new Date(t.seconds * 1000) : undefined);
  return d?.toISOString();
}
