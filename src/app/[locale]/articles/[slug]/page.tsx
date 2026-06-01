'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { useParams } from 'next/navigation';
import { Link } from '@/i18n/routing';
import { getArticleBySlug } from '@/lib/articles';
import { Article } from '@/types';
import { ChevronLeft, Newspaper } from 'lucide-react';
import ArticleView from '@/components/article/ArticleView';

export default function ArticleDetailPage() {
  const locale = useLocale() as 'zh' | 'en';
  const params = useParams();
  const slug = params.slug as string;
  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getArticleBySlug(slug).then((a) => { setArticle(a); setLoading(false); });
  }, [slug]);

  if (loading) {
    return <div className="pt-32 min-h-screen text-center text-ink-soft">{locale === 'zh' ? '載入中…' : 'Loading…'}</div>;
  }

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

  const title = article.title[locale] || article.title.zh;

  return (
    <>
      <ArticleView article={article} locale={locale} />

      {/* Article JSON-LD for SEO */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Article',
            headline: title,
            image: article.heroImage ? [article.heroImage] : undefined,
            datePublished: ((): string | undefined => {
              const v = article.publishedAt as { toDate?: () => Date; seconds?: number } | undefined;
              const d = v?.toDate?.() ?? (v?.seconds ? new Date(v.seconds * 1000) : undefined);
              return d?.toISOString();
            })(),
            dateModified: ((): string | undefined => {
              const v = article.updatedAt as { toDate?: () => Date; seconds?: number } | undefined;
              const d = v?.toDate?.() ?? (v?.seconds ? new Date(v.seconds * 1000) : undefined);
              return d?.toISOString();
            })(),
            author: article.authorName ? { '@type': 'Person', name: article.authorName } : undefined,
            publisher: {
              '@type': 'Organization',
              name: 'SPACO',
              logo: { '@type': 'ImageObject', url: 'https://spacohk.com/spaco-logo.png' },
            },
            description: article.excerpt?.[locale] || article.excerpt?.zh,
            mainEntityOfPage: `https://spacohk.com/${locale}/articles/${article.slug}`,
          }),
        }}
      />
    </>
  );
}
