'use client';

// Shared article-rendering component used by:
//   - /articles/[slug]      (public, published-only)
//   - /admin/articles/[id]/preview  (admin, includes drafts)
// Keeps the typography/layout identical between the two so admin's
// preview matches exactly what customers see post-publish.

import { Link } from '@/i18n/routing';
import { Article } from '@/types';
import { ChevronLeft, Calendar, MessageCircle } from 'lucide-react';
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

// Detect legacy markdown content so we still render those right after
// the TipTap migration. New content from the editor is HTML.
function looksLikeMarkdown(s: string): boolean {
  if (!s) return false;
  if (/<\w+[^>]*>/.test(s)) return false;
  return /(^|\n)#{1,3}\s|^\s*[-*]\s|>\s|\*\*[^*]+\*\*|!\[[^\]]*\]\(/m.test(s);
}

export default function ArticleView({
  article,
  locale,
  isPreview = false,
}: {
  article: Article;
  locale: 'zh' | 'en';
  isPreview?: boolean;
}) {
  const title = article.title[locale] || article.title.zh;
  const content = article.content[locale] || article.content.zh;
  const html = content
    ? (looksLikeMarkdown(content) ? marked.parse(content) as string : content)
    : '';

  return (
    <div className="pt-28 pb-20 relative overflow-hidden min-h-screen">
      <div className="orb orb-pink animate-float-slow" style={{ width: 280, height: 280, top: '-80px', right: '-60px', opacity: 0.35 }} />
      <div className="orb orb-lavender animate-float-medium" style={{ width: 200, height: 200, bottom: '10%', left: '-40px', opacity: 0.4 }} />

      {isPreview && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-amber-400 text-amber-950 px-4 py-1.5 rounded-pill text-xs font-bold shadow-lg">
          {locale === 'zh' ? '🔍 預覽模式 — 客人實際睇到嘅樣' : '🔍 Preview Mode — Customer-facing view'}
        </div>
      )}

      <div className="max-content mx-auto px-6 md:px-12 lg:px-20 relative z-10">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="max-w-3xl mx-auto">
          {!isPreview && (
            <Link href="/articles" className="text-ink-soft hover:text-pink text-sm flex items-center gap-1 mb-6">
              <ChevronLeft size={16} />
              {locale === 'zh' ? '所有文章' : 'All articles'}
            </Link>
          )}

          {article.heroImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={article.heroImage}
              alt={article.heroAlt?.[locale] || title}
              className="w-full aspect-video object-cover rounded-3xl mb-8 shadow-glass-lg"
            />
          )}

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
              <span className="flex items-center gap-1.5"><Calendar size={14} />{fmtDate(article.publishedAt || article.updatedAt, locale)}</span>
              {article.authorName && (
                <span>· {locale === 'zh' ? '作者' : 'By'} {article.authorName}</span>
              )}
            </div>
          </div>

          <article
            className="prose prose-lg max-w-none
              prose-headings:font-display prose-headings:text-ink prose-headings:font-bold
              prose-h1:text-3xl prose-h2:text-2xl prose-h2:mt-12 prose-h2:mb-4 prose-h3:text-xl prose-h3:mt-8 prose-h3:mb-3
              prose-p:text-ink-soft prose-p:leading-relaxed prose-p:my-5
              prose-strong:text-ink prose-em:text-ink-soft
              prose-a:text-pink prose-a:no-underline hover:prose-a:underline
              prose-blockquote:border-l-4 prose-blockquote:border-pink prose-blockquote:bg-pink/5 prose-blockquote:rounded-r-2xl prose-blockquote:py-3 prose-blockquote:px-6 prose-blockquote:not-italic prose-blockquote:text-ink prose-blockquote:font-medium prose-blockquote:my-8
              prose-img:rounded-2xl prose-img:shadow-glass-lg prose-img:my-10 prose-img:w-full
              prose-ul:text-ink-soft prose-ol:text-ink-soft prose-ul:my-5 prose-ol:my-5
              prose-li:my-1.5 prose-li:leading-relaxed
              prose-code:bg-cream/60 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-pink prose-code:font-normal prose-code:before:content-none prose-code:after:content-none
              prose-hr:my-12 prose-hr:border-charcoal/10
            "
            dangerouslySetInnerHTML={{ __html: html }}
          />

          {!isPreview && (
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
          )}
        </motion.div>
      </div>
    </div>
  );
}
