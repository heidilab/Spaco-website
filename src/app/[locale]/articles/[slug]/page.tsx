'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { useParams } from 'next/navigation';
import { Link } from '@/i18n/routing';
import { getArticleBySlug } from '@/lib/articles';
import { Article } from '@/types';
import { ChevronLeft, Calendar, Newspaper, MessageCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { marked } from 'marked';

function fmtDate(v: unknown, locale: 'zh' | 'en'): string {
  if (!v) return '';
  const obj = v as { toDate?: () => Date; seconds?: number };
  const d = typeof obj.toDate === 'function' ? obj.toDate()
    : typeof obj.seconds === 'number' ? new Date(obj.seconds * 1000) : null;
  if (!d) return '';
  return locale === 'zh'
    ? `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
    : d.toLocaleDateString('en', { year: 'numeric', month: 'long', day: 'numeric' });
}

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
  const content = article.content[locale] || article.content.zh;
  const html = content ? marked.parse(content) as string : '';

  return (
    <div className="pt-28 pb-20 relative overflow-hidden min-h-screen">
      <div className="orb orb-pink animate-float-slow" style={{ width: 280, height: 280, top: '-80px', right: '-60px', opacity: 0.35 }} />
      <div className="orb orb-lavender animate-float-medium" style={{ width: 200, height: 200, bottom: '10%', left: '-40px', opacity: 0.4 }} />

      <div className="max-content mx-auto px-6 md:px-12 lg:px-20 relative z-10">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="max-w-3xl mx-auto">
          <Link href="/articles" className="text-ink-soft hover:text-pink text-sm flex items-center gap-1 mb-6">
            <ChevronLeft size={16} />
            {locale === 'zh' ? '所有文章' : 'All articles'}
          </Link>

          {/* Hero */}
          {article.heroImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={article.heroImage}
              alt={article.heroAlt?.[locale] || title}
              className="w-full aspect-video object-cover rounded-3xl mb-8 shadow-glass-lg"
            />
          )}

          {/* Title + meta */}
          <div className="mb-8 space-y-3">
            {article.tags && article.tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {article.tags.map((t) => (
                  <span key={t} className="text-xs px-3 py-1 rounded-pill bg-pink/10 text-pink font-medium">#{t}</span>
                ))}
              </div>
            )}
            <h1 className="text-3xl md:text-5xl font-bold font-display leading-tight">
              <span className="text-gradient-pink">{title}</span>
            </h1>
            <div className="flex items-center gap-4 text-sm text-ink-soft">
              <span className="flex items-center gap-1.5"><Calendar size={14} />{fmtDate(article.publishedAt, locale)}</span>
              {article.authorName && (
                <span>· {locale === 'zh' ? '作者' : 'By'} {article.authorName}</span>
              )}
            </div>
          </div>

          {/* Body — rendered Markdown */}
          <article
            className="prose prose-lg max-w-none
              prose-headings:font-display prose-headings:text-ink prose-headings:font-bold
              prose-h1:text-3xl prose-h2:text-2xl prose-h3:text-xl
              prose-p:text-ink-soft prose-p:leading-relaxed
              prose-strong:text-ink prose-em:text-ink-soft
              prose-a:text-pink prose-a:no-underline hover:prose-a:underline
              prose-blockquote:border-pink prose-blockquote:bg-pink/5 prose-blockquote:rounded-r-xl prose-blockquote:py-2 prose-blockquote:px-4 prose-blockquote:not-italic prose-blockquote:text-ink
              prose-img:rounded-2xl prose-img:shadow-glass-lg prose-img:my-8
              prose-ul:text-ink-soft prose-ol:text-ink-soft
              prose-li:my-1
              prose-code:bg-cream/60 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-pink prose-code:font-normal
            "
            dangerouslySetInnerHTML={{ __html: html }}
          />

          {/* CTA — back to articles + WhatsApp */}
          <div className="mt-12 pt-8 border-t border-charcoal/10 flex flex-wrap items-center justify-between gap-4">
            <Link href="/articles" className="text-ink-soft hover:text-pink text-sm flex items-center gap-1">
              <ChevronLeft size={16} />
              {locale === 'zh' ? '返回文章列表' : 'Back to all articles'}
            </Link>
            <a
              href="https://wa.me/85292823060"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-5 py-3 bg-[#25D366] text-white rounded-pill font-semibold hover:-translate-y-0.5 transition-transform"
            >
              <MessageCircle size={16} />
              {locale === 'zh' ? '即刻 WhatsApp 查詢場地' : 'Chat on WhatsApp'}
            </a>
          </div>
        </motion.div>
      </div>

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
    </div>
  );
}
