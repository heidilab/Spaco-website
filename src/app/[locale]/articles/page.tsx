'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import { listPublishedArticles } from '@/lib/articles';
import { Article } from '@/types';
import { Newspaper, Calendar, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';

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

export default function ArticlesListPage() {
  const locale = useLocale() as 'zh' | 'en';
  const [items, setItems] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listPublishedArticles().then((arr) => { setItems(arr); setLoading(false); });
  }, []);

  return (
    <div className="pt-28 pb-20 relative overflow-hidden min-h-screen">
      <div className="orb orb-pink animate-float-slow" style={{ width: 320, height: 320, top: '-60px', right: '-80px', opacity: 0.4 }} />
      <div className="orb orb-lavender animate-float-medium" style={{ width: 220, height: 220, bottom: '10%', left: '-60px', opacity: 0.45 }} />

      <div className="max-content mx-auto px-6 md:px-12 lg:px-20 relative z-10">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mb-10">
          <div className="flex items-center gap-3 mb-3">
            <Newspaper size={28} className="text-pink" />
            <span className="text-sm uppercase tracking-widest text-ink-soft">{locale === 'zh' ? '文章分享' : 'Articles'}</span>
          </div>
          <h1 className="text-heading font-display">
            <span className="text-gradient-pink">
              {locale === 'zh' ? '靈感、貼士、客人故事' : 'Inspiration, Tips & Stories'}
            </span>
          </h1>
          <p className="text-ink-soft mt-3 max-w-2xl">
            {locale === 'zh'
              ? 'SPACO 嘅最新活動、派對靈感、實用貼士同客人精選故事。'
              : "SPACO's latest events, party inspiration, practical tips and curated customer stories."}
          </p>
        </motion.div>

        {loading ? (
          <div className="text-center py-16 text-ink-soft">{locale === 'zh' ? '載入中…' : 'Loading…'}</div>
        ) : items.length === 0 ? (
          <div className="glass-card p-12 text-center">
            <Newspaper size={40} className="text-ink-soft/30 mx-auto mb-4" />
            <p className="text-ink-soft">{locale === 'zh' ? '暫時未有文章,記住返嚟睇睇!' : 'No articles yet — check back soon!'}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {items.map((a, i) => {
              const title = a.title[locale] || a.title.zh;
              const excerpt = a.excerpt?.[locale] || a.excerpt?.zh || '';
              return (
                <motion.div
                  key={a.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <Link
                    href={`/articles/${a.slug}`}
                    className="block group glass-card overflow-hidden hover:shadow-glass-lg transition-all"
                  >
                    {a.heroImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={a.heroImage}
                        alt={a.heroAlt?.[locale] || title}
                        className="w-full aspect-video object-cover group-hover:scale-[1.03] transition-transform duration-500"
                      />
                    ) : (
                      <div className="w-full aspect-video bg-gradient-to-br from-pink/10 via-lavender/15 to-coral/10 flex items-center justify-center">
                        <Newspaper size={32} className="text-pink/40" />
                      </div>
                    )}
                    <div className="p-5 space-y-2">
                      {a.tags && a.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {a.tags.slice(0, 3).map((t) => (
                            <span key={t} className="text-[10px] px-2 py-0.5 rounded-pill bg-pink/10 text-pink font-medium">#{t}</span>
                          ))}
                        </div>
                      )}
                      <h2 className="font-bold text-lg leading-snug group-hover:text-pink transition-colors">
                        {title}
                      </h2>
                      {excerpt && <p className="text-sm text-ink-soft line-clamp-3">{excerpt}</p>}
                      <div className="flex items-center justify-between text-xs text-ink-soft pt-2">
                        <span className="flex items-center gap-1"><Calendar size={12} />{fmtDate(a.publishedAt, locale)}</span>
                        <ArrowRight size={14} className="text-pink group-hover:translate-x-1 transition-transform" />
                      </div>
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
