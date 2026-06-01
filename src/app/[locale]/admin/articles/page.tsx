'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import { listAllArticles, deleteArticle } from '@/lib/articles';
import { Article } from '@/types';
import { Newspaper, Plus, Pencil, Trash2, Eye, EyeOff, ExternalLink } from 'lucide-react';

function fmtTime(v: unknown): string {
  if (!v) return '—';
  const obj = v as { toDate?: () => Date; seconds?: number };
  if (typeof obj.toDate === 'function') return obj.toDate().toLocaleString();
  if (typeof obj.seconds === 'number') return new Date(obj.seconds * 1000).toLocaleString();
  return '—';
}

export default function AdminArticlesPage() {
  const locale = useLocale() as 'zh' | 'en';
  const [items, setItems] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'draft' | 'published'>('all');

  async function load() {
    setLoading(true);
    setItems(await listAllArticles());
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const filtered = items.filter((a) => filter === 'all' || a.status === filter);

  async function handleDelete(id: string, title: string) {
    if (!confirm(locale === 'zh' ? `確定刪除「${title}」?此操作不可復原。` : `Delete "${title}"? This cannot be undone.`)) return;
    await deleteArticle(id);
    load();
  }

  return (
    <div className="max-content mx-auto px-6 md:px-12 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-display font-bold flex items-center gap-3">
            <Newspaper size={28} className="text-pink" />
            {locale === 'zh' ? '文章分享管理' : 'Articles'}
          </h1>
          <p className="text-sm text-ink-soft mt-1">
            {locale === 'zh' ? '新增、編輯及發佈分店活動文章、Tips、客人 story 等。' : 'Create, edit and publish articles, tips and customer stories.'}
          </p>
        </div>
        <Link href="/admin/articles/new" className="btn-primary flex items-center gap-2">
          <Plus size={18} />
          {locale === 'zh' ? '新增文章' : 'New Article'}
        </Link>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-2 mb-5">
        {(['all', 'published', 'draft'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-pill text-sm font-medium transition ${
              filter === f
                ? 'bg-gradient-pink text-white shadow-glow'
                : 'bg-white/60 text-ink-soft hover:bg-white/90'
            }`}
          >
            {locale === 'zh'
              ? f === 'all' ? '全部' : f === 'published' ? '已發佈' : '草稿'
              : f === 'all' ? 'All' : f === 'published' ? 'Published' : 'Draft'}
            <span className="ml-2 text-xs opacity-70">
              ({items.filter((a) => f === 'all' || a.status === f).length})
            </span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-ink-soft">{locale === 'zh' ? '載入中…' : 'Loading…'}</div>
      ) : filtered.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Newspaper size={40} className="text-ink-soft/40 mx-auto mb-4" />
          <p className="text-ink-soft mb-4">
            {locale === 'zh' ? '仲未有文章。' : 'No articles yet.'}
          </p>
          <Link href="/admin/articles/new" className="btn-primary inline-flex items-center gap-2">
            <Plus size={16} />
            {locale === 'zh' ? '寫第一篇' : 'Write the first one'}
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((a) => (
            <div key={a.id} className="glass-card p-5 flex items-center gap-4">
              {a.heroImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.heroImage} alt="" className="w-20 h-20 rounded-xl object-cover flex-shrink-0" />
              ) : (
                <div className="w-20 h-20 rounded-xl bg-cream/60 flex items-center justify-center flex-shrink-0">
                  <Newspaper size={24} className="text-ink-soft/40" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-bold truncate">{a.title.zh || a.title.en || '(untitled)'}</h3>
                  <span className={`text-[10px] px-2 py-0.5 rounded-pill font-semibold flex items-center gap-1 ${
                    a.status === 'published'
                      ? 'bg-emerald-500/15 text-emerald-700'
                      : 'bg-amber-500/15 text-amber-700'
                  }`}>
                    {a.status === 'published' ? <Eye size={10} /> : <EyeOff size={10} />}
                    {locale === 'zh'
                      ? a.status === 'published' ? '已發佈' : '草稿'
                      : a.status === 'published' ? 'Published' : 'Draft'}
                  </span>
                  {!a.title.en && (
                    <span className="text-[10px] px-2 py-0.5 rounded-pill bg-rose-500/10 text-rose-700">
                      {locale === 'zh' ? '缺英文' : 'No EN'}
                    </span>
                  )}
                </div>
                <p className="text-xs text-ink-soft truncate">
                  /{a.slug} · {locale === 'zh' ? '更新' : 'Updated'} {fmtTime(a.updatedAt)}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {a.status === 'published' && (
                  <Link
                    href={`/articles/${a.slug}`}
                    target="_blank"
                    className="p-2 rounded-lg bg-white/60 hover:bg-white text-ink-soft hover:text-ink"
                    title={locale === 'zh' ? '前台預覽' : 'View on site'}
                  >
                    <ExternalLink size={16} />
                  </Link>
                )}
                <Link
                  href={`/admin/articles/${a.id}`}
                  className="p-2 rounded-lg bg-white/60 hover:bg-pink/10 text-ink-soft hover:text-pink"
                  title={locale === 'zh' ? '編輯' : 'Edit'}
                >
                  <Pencil size={16} />
                </Link>
                <button
                  onClick={() => handleDelete(a.id, a.title.zh || a.title.en || a.id)}
                  className="p-2 rounded-lg bg-white/60 hover:bg-rose-500/10 text-ink-soft hover:text-rose-600"
                  title={locale === 'zh' ? '刪除' : 'Delete'}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
