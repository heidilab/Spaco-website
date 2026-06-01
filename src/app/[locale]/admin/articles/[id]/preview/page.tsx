'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { useParams } from 'next/navigation';
import { Link } from '@/i18n/routing';
import { getArticleById } from '@/lib/articles';
import { Article } from '@/types';
import { ChevronLeft, Newspaper } from 'lucide-react';
import ArticleView from '@/components/article/ArticleView';

/**
 * Admin-only preview of an article by id — works for drafts.
 * Renders identically to /articles/[slug] via the shared ArticleView
 * component so admin sees exactly what the published version will look
 * like (with a yellow "PREVIEW MODE" banner).
 *
 * Locale picker at the top lets admin flip between zh / en preview.
 */
export default function AdminArticlePreviewPage() {
  const locale = useLocale() as 'zh' | 'en';
  const params = useParams();
  const id = params.id as string;
  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewLocale, setViewLocale] = useState<'zh' | 'en'>(locale);

  useEffect(() => {
    getArticleById(id).then((a) => { setArticle(a); setLoading(false); });
  }, [id]);

  if (loading) {
    return <div className="pt-32 min-h-screen text-center text-ink-soft">{locale === 'zh' ? '載入中…' : 'Loading…'}</div>;
  }

  if (!article) {
    return (
      <div className="pt-32 min-h-screen flex items-center justify-center px-6">
        <div className="text-center space-y-4 max-w-md">
          <Newspaper size={40} className="text-ink-soft/30 mx-auto" />
          <h1 className="text-2xl font-bold">{locale === 'zh' ? '找唔到呢篇文章' : 'Article not found'}</h1>
          <Link href={`/admin/articles`} className="btn-primary inline-flex items-center gap-2">
            <ChevronLeft size={16} />
            {locale === 'zh' ? '返回文章列表' : 'Back to articles'}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Floating admin controls — language switcher + back to edit */}
      <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-white/95 backdrop-blur-md rounded-pill px-3 py-2 shadow-lg border border-charcoal/10">
        <span className="text-xs text-ink-soft pl-1">{locale === 'zh' ? '檢視:' : 'View:'}</span>
        <div className="flex gap-1 bg-cream/60 p-0.5 rounded-pill text-xs">
          <button
            onClick={() => setViewLocale('zh')}
            className={`px-3 py-1 rounded-pill ${viewLocale === 'zh' ? 'bg-white shadow font-bold' : 'text-ink-soft'}`}
          >中文</button>
          <button
            onClick={() => setViewLocale('en')}
            className={`px-3 py-1 rounded-pill ${viewLocale === 'en' ? 'bg-white shadow font-bold' : 'text-ink-soft'}`}
          >English</button>
        </div>
        <Link
          href={`/admin/articles/${id}`}
          className="text-xs px-3 py-1.5 rounded-pill bg-pink/10 text-pink font-semibold hover:bg-pink/20 flex items-center gap-1"
        >
          <ChevronLeft size={12} /> {locale === 'zh' ? '返回編輯' : 'Edit'}
        </Link>
      </div>

      <ArticleView article={article} locale={viewLocale} isPreview />
    </>
  );
}
