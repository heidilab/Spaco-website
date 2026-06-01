'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { useParams } from 'next/navigation';
import { Link, useRouter } from '@/i18n/routing';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '@/lib/firebase';
import {
  getArticleById, createArticle, updateArticle, isSlugTaken, makeSlug,
} from '@/lib/articles';
import { useAuth } from '@/contexts/AuthContext';
import { Article } from '@/types';
import {
  ChevronLeft, Save, Sparkles, Languages, Upload, Eye, EyeOff,
  Image as ImageIcon, Loader2, AlertCircle, CheckCircle2,
} from 'lucide-react';
import { marked } from 'marked';

// id === '_new' or 'new' triggers create mode.
function isCreateMode(id: string) { return id === '_new' || id === 'new'; }

export default function AdminArticleEditPage() {
  const locale = useLocale() as 'zh' | 'en';
  const router = useRouter();
  const params = useParams();
  const { user } = useAuth();
  const id = params.id as string;
  const isCreate = isCreateMode(id);

  const [loading, setLoading] = useState(!isCreate);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Form state — zh required, en optional (LLM auto-translate populates it)
  const [titleZh, setTitleZh] = useState('');
  const [titleEn, setTitleEn] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [excerptZh, setExcerptZh] = useState('');
  const [excerptEn, setExcerptEn] = useState('');
  const [heroImage, setHeroImage] = useState('');
  const [contentZh, setContentZh] = useState('');
  const [contentEn, setContentEn] = useState('');
  const [status, setStatus] = useState<'draft' | 'published'>('draft');
  const [tagsRaw, setTagsRaw] = useState('');

  // UX flags for the LLM actions
  const [formatting, setFormatting] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [previewLocale, setPreviewLocale] = useState<'zh' | 'en'>('zh');

  // Load existing article (edit mode)
  useEffect(() => {
    if (isCreate) return;
    (async () => {
      const a = await getArticleById(id);
      if (!a) {
        setError(locale === 'zh' ? '找不到此文章' : 'Article not found');
        setLoading(false);
        return;
      }
      setTitleZh(a.title.zh || '');
      setTitleEn(a.title.en || '');
      setSlug(a.slug);
      setSlugTouched(true);
      setExcerptZh(a.excerpt?.zh || '');
      setExcerptEn(a.excerpt?.en || '');
      setHeroImage(a.heroImage || '');
      setContentZh(a.content.zh || '');
      setContentEn(a.content.en || '');
      setStatus(a.status);
      setTagsRaw((a.tags || []).join(', '));
      setLoading(false);
    })();
  }, [id, isCreate, locale]);

  // Auto-suggest slug from zh title (only until admin manually edits it)
  useEffect(() => {
    if (!slugTouched && titleZh) setSlug(makeSlug(titleZh));
  }, [titleZh, slugTouched]);

  async function handleHeroUpload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const path = `articles/hero/${Date.now()}-${file.name.replace(/[^\w.-]/g, '_')}`;
      const ref = storageRef(storage, path);
      await uploadBytes(ref, file);
      const url = await getDownloadURL(ref);
      setHeroImage(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleSmartFormat() {
    if (!contentZh.trim()) {
      setError(locale === 'zh' ? '請先輸入內容' : 'Please enter content first');
      return;
    }
    setFormatting(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/article-smart-format', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: contentZh, title: titleZh }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Smart format failed');
      setContentZh(data.formatted);
      setSavedMsg(locale === 'zh' ? '✨ 智能排版完成' : '✨ Smart formatting done');
      setTimeout(() => setSavedMsg(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown');
    } finally {
      setFormatting(false);
    }
  }

  async function handleTranslate() {
    if (!titleZh.trim() && !contentZh.trim()) {
      setError(locale === 'zh' ? '請先輸入中文內容' : 'Enter Chinese content first');
      return;
    }
    setTranslating(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/article-translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: titleZh,
          excerpt: excerptZh,
          content: contentZh,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Translate failed');
      setTitleEn(data.title || '');
      setExcerptEn(data.excerpt || '');
      setContentEn(data.content || '');
      setSavedMsg(locale === 'zh' ? '🌐 自動翻譯完成' : '🌐 Auto-translate done');
      setTimeout(() => setSavedMsg(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown');
    } finally {
      setTranslating(false);
    }
  }

  async function handleSave(nextStatus?: 'draft' | 'published') {
    setError(null);
    if (!titleZh.trim()) { setError(locale === 'zh' ? '請填寫中文標題' : 'Chinese title required'); return; }
    if (!slug.trim()) { setError(locale === 'zh' ? '請填寫網址 slug' : 'Slug required'); return; }
    if (!contentZh.trim()) { setError(locale === 'zh' ? '請填寫中文內容' : 'Chinese content required'); return; }

    setSaving(true);
    try {
      const finalStatus = nextStatus ?? status;
      const taken = await isSlugTaken(slug, isCreate ? undefined : id);
      if (taken) {
        setError(locale === 'zh' ? '此 slug 已被使用,請改另一個' : 'Slug already in use');
        setSaving(false);
        return;
      }
      const payload: Omit<Article, 'id' | 'createdAt' | 'updatedAt'> = {
        slug: slug.trim(),
        title: { zh: titleZh.trim(), ...(titleEn.trim() ? { en: titleEn.trim() } : {}) },
        excerpt: {
          ...(excerptZh.trim() ? { zh: excerptZh.trim() } : {}),
          ...(excerptEn.trim() ? { en: excerptEn.trim() } : {}),
        },
        heroImage: heroImage || undefined,
        content: { zh: contentZh, ...(contentEn.trim() ? { en: contentEn } : {}) },
        tags: tagsRaw.split(',').map((t) => t.trim()).filter(Boolean),
        status: finalStatus,
        authorUid: user?.uid,
        authorName: user?.displayName || user?.email || undefined,
      };
      if (isCreate) {
        const newId = await createArticle(payload);
        router.replace(`/admin/articles/${newId}`);
      } else {
        await updateArticle(id, payload);
        setStatus(finalStatus);
        setSavedMsg(locale === 'zh' ? '✓ 已儲存' : '✓ Saved');
        setTimeout(() => setSavedMsg(null), 3000);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="max-content mx-auto px-6 py-12 text-center text-ink-soft">{locale === 'zh' ? '載入中…' : 'Loading…'}</div>;
  }

  const previewContent = previewLocale === 'zh' ? contentZh : (contentEn || contentZh);
  const previewTitle = previewLocale === 'zh' ? titleZh : (titleEn || titleZh);
  const previewHtml = previewContent ? marked.parse(previewContent) as string : '';

  return (
    <div className="max-content mx-auto px-6 md:px-12 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <Link href="/admin/articles" className="text-ink-soft hover:text-ink text-sm flex items-center gap-1">
          <ChevronLeft size={16} /> {locale === 'zh' ? '返回列表' : 'Back to list'}
        </Link>
        <div className="flex items-center gap-3">
          {savedMsg && <span className="text-sm text-emerald-700 flex items-center gap-1"><CheckCircle2 size={14} />{savedMsg}</span>}
          <button
            onClick={() => handleSave('draft')}
            disabled={saving}
            className="px-4 py-2 rounded-pill bg-white/70 border border-charcoal/10 text-sm font-medium hover:bg-white disabled:opacity-40"
          >
            {saving ? <Loader2 size={14} className="animate-spin inline" /> : <Save size={14} className="inline mr-1" />}
            {locale === 'zh' ? '儲存草稿' : 'Save Draft'}
          </button>
          <button
            onClick={() => handleSave('published')}
            disabled={saving}
            className="btn-primary disabled:opacity-40"
          >
            {status === 'published'
              ? (locale === 'zh' ? '更新已發佈' : 'Update Published')
              : (locale === 'zh' ? '發佈' : 'Publish')}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm flex items-center gap-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT — form (2 cols) */}
        <div className="lg:col-span-2 space-y-5">
          <div className="glass-card p-6 space-y-4">
            <h2 className="font-bold text-lg flex items-center gap-2">
              {locale === 'zh' ? '中文內容' : 'Chinese Content'}
              <span className="text-[10px] px-2 py-0.5 bg-pink/10 text-pink rounded-pill">必填</span>
            </h2>
            <div>
              <label className="text-sm font-medium text-ink-soft mb-1 block">{locale === 'zh' ? '標題' : 'Title'} *</label>
              <input
                value={titleZh}
                onChange={(e) => setTitleZh(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-white border border-charcoal/15 focus:outline-none focus:border-pink/50"
                placeholder={locale === 'zh' ? '例:銅鑼灣店全新派對方案' : 'e.g. Brand new party setup at Causeway Bay'}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-ink-soft mb-1 block">URL Slug *</label>
              <input
                value={slug}
                onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); }}
                className="w-full px-4 py-2.5 rounded-xl bg-white border border-charcoal/15 focus:outline-none focus:border-pink/50 font-mono text-sm"
                placeholder="my-article-slug"
              />
              <p className="text-xs text-ink-soft mt-1">URL: /articles/{slug || '...'}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-ink-soft mb-1 block">{locale === 'zh' ? '摘要(可選,顯示於列表)' : 'Excerpt (optional, shown on list)'}</label>
              <textarea
                value={excerptZh}
                onChange={(e) => setExcerptZh(e.target.value)}
                rows={2}
                className="w-full px-4 py-2.5 rounded-xl bg-white border border-charcoal/15 focus:outline-none focus:border-pink/50 text-sm"
                placeholder={locale === 'zh' ? '一兩句總結文章重點' : 'One-line summary'}
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium text-ink-soft">{locale === 'zh' ? '內容(支援 Markdown)' : 'Content (Markdown supported)'} *</label>
                <button
                  type="button"
                  onClick={handleSmartFormat}
                  disabled={formatting || !contentZh.trim()}
                  className="text-xs px-3 py-1 rounded-pill bg-pink/10 text-pink hover:bg-pink/20 disabled:opacity-40 flex items-center gap-1"
                  title={locale === 'zh' ? 'AI 自動加段落、標題、引用、圖片建議' : 'AI restructures headings/lists/quotes + image hints'}
                >
                  {formatting ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  {locale === 'zh' ? '智能排版' : 'Smart Format'}
                </button>
              </div>
              <textarea
                value={contentZh}
                onChange={(e) => setContentZh(e.target.value)}
                rows={18}
                className="w-full px-4 py-3 rounded-xl bg-white border border-charcoal/15 focus:outline-none focus:border-pink/50 font-mono text-sm leading-relaxed"
                placeholder={locale === 'zh' ? '直接寫文字。撳「智能排版」會幫你自動加標題、分段、引用、圖片建議。\n\n圖片格式:\n![描述](https://image-url)' : 'Write freely. Click "Smart Format" to auto-add headings, lists, quotes, and image hints.\n\nImage syntax: ![alt](url)'}
              />
              <p className="text-xs text-ink-soft mt-1">
                {locale === 'zh' ? '提示:`# 大標題` `## 小標題` `- 項目` `> 引用` `**粗體**` `![圖片描述](URL)`' : 'Markdown: # H1, ## H2, - list, > quote, **bold**, ![alt](url)'}
              </p>
            </div>
          </div>

          {/* English section — collapsible-ish; populated by translate button */}
          <div className="glass-card p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-lg flex items-center gap-2">
                {locale === 'zh' ? '英文內容' : 'English Content'}
                <span className="text-[10px] px-2 py-0.5 bg-ink-soft/10 text-ink-soft rounded-pill">可選</span>
              </h2>
              <button
                type="button"
                onClick={handleTranslate}
                disabled={translating || !contentZh.trim()}
                className="text-xs px-3 py-1 rounded-pill bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 disabled:opacity-40 flex items-center gap-1"
              >
                {translating ? <Loader2 size={12} className="animate-spin" /> : <Languages size={12} />}
                {locale === 'zh' ? '自動翻譯(中→英)' : 'Auto-translate (zh→en)'}
              </button>
            </div>
            <input
              value={titleEn}
              onChange={(e) => setTitleEn(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-white border border-charcoal/15 focus:outline-none focus:border-pink/50 text-sm"
              placeholder="English title"
            />
            <textarea
              value={excerptEn}
              onChange={(e) => setExcerptEn(e.target.value)}
              rows={2}
              className="w-full px-4 py-2.5 rounded-xl bg-white border border-charcoal/15 focus:outline-none focus:border-pink/50 text-sm"
              placeholder="English excerpt"
            />
            <textarea
              value={contentEn}
              onChange={(e) => setContentEn(e.target.value)}
              rows={12}
              className="w-full px-4 py-3 rounded-xl bg-white border border-charcoal/15 focus:outline-none focus:border-pink/50 font-mono text-sm"
              placeholder="English content (Markdown). Click Auto-translate above to populate from Chinese."
            />
          </div>
        </div>

        {/* RIGHT — meta + preview (1 col) */}
        <div className="space-y-5">
          <div className="glass-card p-5 space-y-3">
            <h3 className="font-bold text-sm uppercase tracking-wider text-ink-soft">{locale === 'zh' ? '封面圖' : 'Hero Image'}</h3>
            <p className="text-[11px] text-ink-soft leading-relaxed -mt-1">
              {locale === 'zh'
                ? '建議 1600 × 900 px(16:9),JPG / PNG,< 500 KB 最佳。'
                : 'Recommended 1600 × 900 px (16:9), JPG/PNG, under 500 KB.'}
            </p>
            {heroImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={heroImage} alt="" className="w-full rounded-xl aspect-video object-cover" />
            ) : (
              <div className="w-full rounded-xl aspect-video bg-cream/60 flex items-center justify-center text-ink-soft/50">
                <ImageIcon size={32} />
              </div>
            )}
            <label className="block">
              <input
                type="file"
                accept="image/*"
                onChange={(e) => e.target.files?.[0] && handleHeroUpload(e.target.files[0])}
                className="hidden"
              />
              <span className="block text-center py-2 rounded-pill bg-white/60 border border-charcoal/10 text-sm font-medium hover:bg-white cursor-pointer">
                {uploading ? <Loader2 size={14} className="animate-spin inline mr-1" /> : <Upload size={14} className="inline mr-1" />}
                {locale === 'zh' ? '上載 / 替換封面' : 'Upload / Replace'}
              </span>
            </label>
            {heroImage && (
              <button
                onClick={() => setHeroImage('')}
                className="w-full text-xs text-rose-600 hover:underline"
              >
                {locale === 'zh' ? '移除封面' : 'Remove hero'}
              </button>
            )}
          </div>

          <div className="glass-card p-5 space-y-3">
            <h3 className="font-bold text-sm uppercase tracking-wider text-ink-soft">{locale === 'zh' ? '標籤' : 'Tags'}</h3>
            <input
              value={tagsRaw}
              onChange={(e) => setTagsRaw(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-white border border-charcoal/15 focus:outline-none focus:border-pink/50 text-sm"
              placeholder={locale === 'zh' ? '生日, BBQ, 親子(逗號分隔)' : 'tips, party, bbq (comma-separated)'}
            />
          </div>

          {/* Live preview */}
          <div className="glass-card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm uppercase tracking-wider text-ink-soft">{locale === 'zh' ? '預覽' : 'Preview'}</h3>
              <div className="flex gap-1 bg-cream/60 p-0.5 rounded-pill text-xs">
                <button
                  onClick={() => setPreviewLocale('zh')}
                  className={`px-2 py-1 rounded-pill ${previewLocale === 'zh' ? 'bg-white shadow' : 'text-ink-soft'}`}
                >中</button>
                <button
                  onClick={() => setPreviewLocale('en')}
                  className={`px-2 py-1 rounded-pill ${previewLocale === 'en' ? 'bg-white shadow' : 'text-ink-soft'}`}
                >EN</button>
              </div>
            </div>
            {heroImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={heroImage} alt="" className="w-full rounded-xl aspect-video object-cover" />
            )}
            <h4 className="font-bold text-lg">{previewTitle || (locale === 'zh' ? '(無標題)' : '(no title)')}</h4>
            <div
              className="prose prose-sm max-w-none text-ink-soft prose-headings:text-ink prose-headings:font-bold prose-h1:text-xl prose-h2:text-lg prose-strong:text-ink prose-a:text-pink prose-blockquote:border-pink prose-img:rounded-xl"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
            {!previewContent && (
              <p className="text-ink-soft/60 text-sm italic">{locale === 'zh' ? '(內容為空)' : '(empty content)'}</p>
            )}
          </div>

          <div className="glass-card p-5 space-y-3">
            <h3 className="font-bold text-sm uppercase tracking-wider text-ink-soft">{locale === 'zh' ? '狀態' : 'Status'}</h3>
            <div className="flex items-center gap-2">
              {status === 'published' ? (
                <span className="flex items-center gap-1 text-sm text-emerald-700"><Eye size={14}/>{locale === 'zh' ? '已發佈' : 'Published'}</span>
              ) : (
                <span className="flex items-center gap-1 text-sm text-amber-700"><EyeOff size={14}/>{locale === 'zh' ? '草稿' : 'Draft'}</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
