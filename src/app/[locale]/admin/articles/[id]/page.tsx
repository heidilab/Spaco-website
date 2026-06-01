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
  Image as ImageIcon, Loader2, AlertCircle, CheckCircle2, ExternalLink, Wand2,
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
  // Pending-image placeholder generation state — keyed by the literal
  // placeholder text so we can show per-row spinners + collisions.
  const [genBusy, setGenBusy] = useState<Record<string, boolean>>({});
  // Per-row URL input (Cloudinary / own image hosting link) — admin can
  // skip DALL-E and paste a URL they already have. Keyed same as genBusy.
  const [urlInput, setUrlInput] = useState<Record<string, string>>({});

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

  // Parse contentZh for image-suggestion placeholders inserted by
  // smart-format. Pattern: ![圖片建議: <description>](TODO_UPLOAD)
  // Returns the unique list with the literal markdown for replacement.
  const pendingImages: Array<{ literal: string; description: string }> = (() => {
    const re = /!\[圖片建議:\s*([^\]]+?)\]\(TODO_UPLOAD\)/g;
    const seen = new Map<string, { literal: string; description: string }>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(contentZh)) !== null) {
      if (!seen.has(m[0])) seen.set(m[0], { literal: m[0], description: m[1].trim() });
    }
    return Array.from(seen.values());
  })();

  async function handleGenerateImage(literal: string, description: string) {
    setGenBusy((b) => ({ ...b, [literal]: true }));
    setError(null);
    try {
      const res = await fetch('/api/admin/article-generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: description, size: '1792x1024' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Generate failed');
      // Replace ALL occurrences of this literal placeholder with the
      // real image markdown. Alt = original description (without "圖片建議:").
      const replacement = `![${description}](${data.url})`;
      setContentZh((c) => c.split(literal).join(replacement));
      setSavedMsg(locale === 'zh' ? '🎨 AI 圖已生成並插入' : '🎨 AI image generated + inserted');
      setTimeout(() => setSavedMsg(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown');
    } finally {
      setGenBusy((b) => { const n = { ...b }; delete n[literal]; return n; });
    }
  }

  /** Insert an admin-supplied image URL (Cloudinary, S3, etc.) into the
   *  placeholder slot. No upload, no API cost — just swaps the markdown. */
  function handleInsertUrl(literal: string, description: string) {
    const raw = (urlInput[literal] || '').trim();
    if (!raw) {
      setError(locale === 'zh' ? '請貼上圖片連結' : 'Paste an image URL first');
      return;
    }
    // Light validation — accept http(s) URLs of common image hosts.
    if (!/^https?:\/\//i.test(raw)) {
      setError(locale === 'zh' ? '連結需要 http:// 或 https:// 開頭' : 'URL must start with http(s)://');
      return;
    }
    setError(null);
    const replacement = `![${description}](${raw})`;
    setContentZh((c) => c.split(literal).join(replacement));
    setUrlInput((m) => { const n = { ...m }; delete n[literal]; return n; });
    setSavedMsg(locale === 'zh' ? '🖼️ 圖片連結已插入' : '🖼️ Image URL inserted');
    setTimeout(() => setSavedMsg(null), 3000);
  }

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
      // Firestore rejects `undefined` field values. Spread-include only
      // the fields that actually have a value so optional ones stay absent.
      const authorName = user?.displayName || user?.email || '';
      const payload = {
        slug: slug.trim(),
        title: { zh: titleZh.trim(), ...(titleEn.trim() ? { en: titleEn.trim() } : {}) },
        excerpt: {
          ...(excerptZh.trim() ? { zh: excerptZh.trim() } : {}),
          ...(excerptEn.trim() ? { en: excerptEn.trim() } : {}),
        },
        ...(heroImage ? { heroImage } : {}),
        content: { zh: contentZh, ...(contentEn.trim() ? { en: contentEn } : {}) },
        tags: tagsRaw.split(',').map((t) => t.trim()).filter(Boolean),
        status: finalStatus,
        ...(user?.uid ? { authorUid: user.uid } : {}),
        ...(authorName ? { authorName } : {}),
      } as Omit<Article, 'id' | 'createdAt' | 'updatedAt'>;
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
          {!isCreate && (
            <a
              href={`/${locale}/admin/articles/${id}/preview`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 rounded-pill bg-white/70 border border-charcoal/10 text-sm font-medium hover:bg-white flex items-center gap-1.5"
              title={locale === 'zh' ? '新分頁開預覽(同客人見到嘅一模一樣)' : 'Open preview in new tab'}
            >
              <Eye size={14} />
              {locale === 'zh' ? '預覽' : 'Preview'}
              <ExternalLink size={12} className="opacity-60" />
            </a>
          )}
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

          {/* AI image generation panel — surfaces ![圖片建議: ...](TODO_UPLOAD)
              placeholders smart-format inserted. Each row has a Generate
              button that calls DALL-E + inserts the real image inline. */}
          {pendingImages.length > 0 && (
            <div className="glass-card p-5 space-y-3">
              <h3 className="font-bold text-sm uppercase tracking-wider text-ink-soft flex items-center gap-1.5">
                <Wand2 size={14} className="text-pink" />
                {locale === 'zh' ? `待生成圖 (${pendingImages.length})` : `Pending Images (${pendingImages.length})`}
              </h3>
              <p className="text-[11px] text-ink-soft leading-relaxed">
                {locale === 'zh'
                  ? 'AI 排版插入嘅圖片建議。撳「生成」叫 DALL-E 即場生圖 + 自動插入文章相應位置(每張 ~HK$0.30)。'
                  : "AI-suggested image slots. Click Generate to call DALL-E and auto-insert into the article (~HK$0.30 each)."}
              </p>
              <div className="space-y-3">
                {pendingImages.map((img) => (
                  <div key={img.literal} className="rounded-xl bg-white/60 border border-charcoal/10 p-3 space-y-2.5">
                    <p className="text-xs text-ink leading-relaxed">{img.description}</p>

                    {/* Option A — AI generate (costs ~HK$0.30-0.62) */}
                    <button
                      onClick={() => handleGenerateImage(img.literal, img.description)}
                      disabled={!!genBusy[img.literal]}
                      className="w-full text-xs px-3 py-1.5 rounded-pill bg-pink/10 text-pink hover:bg-pink/20 disabled:opacity-40 flex items-center justify-center gap-1.5 font-semibold"
                    >
                      {genBusy[img.literal] ? (
                        <>
                          <Loader2 size={12} className="animate-spin" />
                          {locale === 'zh' ? '生成中(約 20 秒)…' : 'Generating (~20s)…'}
                        </>
                      ) : (
                        <>
                          <Wand2 size={12} />
                          {locale === 'zh' ? '生成 AI 圖' : 'Generate AI Image'}
                        </>
                      )}
                    </button>

                    {/* Divider */}
                    <div className="flex items-center gap-2 text-[10px] text-ink-soft/60 uppercase tracking-wider">
                      <span className="flex-1 h-px bg-charcoal/10" />
                      {locale === 'zh' ? '或' : 'or'}
                      <span className="flex-1 h-px bg-charcoal/10" />
                    </div>

                    {/* Option B — Paste own URL (Cloudinary / Imgur / any host) */}
                    <div className="space-y-1.5">
                      <input
                        type="url"
                        value={urlInput[img.literal] || ''}
                        onChange={(e) => setUrlInput((m) => ({ ...m, [img.literal]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleInsertUrl(img.literal, img.description); } }}
                        placeholder={locale === 'zh' ? '貼 Cloudinary / 其他圖片 URL' : 'Paste Cloudinary / image URL'}
                        className="w-full text-xs px-3 py-1.5 rounded-pill bg-white border border-charcoal/15 focus:outline-none focus:border-pink/50 font-mono"
                      />
                      <button
                        onClick={() => handleInsertUrl(img.literal, img.description)}
                        disabled={!urlInput[img.literal]?.trim()}
                        className="w-full text-xs px-3 py-1.5 rounded-pill bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 disabled:opacity-40 flex items-center justify-center gap-1.5 font-semibold"
                      >
                        <ImageIcon size={12} />
                        {locale === 'zh' ? '插入自選圖' : 'Insert Custom Image'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="glass-card p-5 space-y-3">
            <h3 className="font-bold text-sm uppercase tracking-wider text-ink-soft">{locale === 'zh' ? '狀態' : 'Status'}</h3>
            <div className="flex items-center gap-2">
              {status === 'published' ? (
                <span className="flex items-center gap-1 text-sm text-emerald-700"><Eye size={14}/>{locale === 'zh' ? '已發佈' : 'Published'}</span>
              ) : (
                <span className="flex items-center gap-1 text-sm text-amber-700"><EyeOff size={14}/>{locale === 'zh' ? '草稿' : 'Draft'}</span>
              )}
            </div>
            {!isCreate && (
              <p className="text-xs text-ink-soft leading-relaxed">
                {locale === 'zh'
                  ? '撳右上「預覽」掣,新分頁開大畫面睇實際發佈版排版 + 圖文佈局,中英文都可以切換。'
                  : 'Click "Preview" top-right to open the full published-style view in a new tab. Switch between zh/en there.'}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Full-width quick preview at bottom of page — gives admin a fast
          scan-glance without leaving the edit form. Use the 預覽 button
          at top for the proper full-experience customer view. */}
      {previewContent && (
        <div className="mt-8 glass-card p-6 md:p-8">
          <div className="flex items-center justify-between mb-5 pb-4 border-b border-charcoal/10">
            <h3 className="font-bold text-sm uppercase tracking-wider text-ink-soft">
              {locale === 'zh' ? '即時排版預覽(精簡版)' : 'Live Layout Preview (compact)'}
            </h3>
            <div className="flex gap-1 bg-cream/60 p-0.5 rounded-pill text-xs">
              <button
                onClick={() => setPreviewLocale('zh')}
                className={`px-3 py-1 rounded-pill ${previewLocale === 'zh' ? 'bg-white shadow font-bold' : 'text-ink-soft'}`}
              >中文</button>
              <button
                onClick={() => setPreviewLocale('en')}
                className={`px-3 py-1 rounded-pill ${previewLocale === 'en' ? 'bg-white shadow font-bold' : 'text-ink-soft'}`}
              >English</button>
            </div>
          </div>
          {heroImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={heroImage} alt="" className="w-full aspect-video object-cover rounded-2xl mb-6" />
          )}
          <h1 className="text-2xl md:text-3xl font-display font-bold mb-2 leading-tight">
            <span className="text-gradient-pink">{previewTitle || (locale === 'zh' ? '(未填標題)' : '(no title)')}</span>
          </h1>
          {tagsRaw && (
            <div className="flex flex-wrap gap-1.5 mb-5">
              {tagsRaw.split(',').map((t) => t.trim()).filter(Boolean).map((t) => (
                <span key={t} className="text-xs px-2.5 py-1 rounded-pill bg-pink/10 text-pink font-medium">#{t}</span>
              ))}
            </div>
          )}
          <article
            className="prose prose-base max-w-none
              prose-headings:font-display prose-headings:text-ink prose-headings:font-bold
              prose-h2:text-2xl prose-h2:mt-10 prose-h2:mb-4 prose-h3:text-xl prose-h3:mt-7
              prose-p:text-ink-soft prose-p:leading-relaxed
              prose-strong:text-ink prose-a:text-pink
              prose-blockquote:border-l-4 prose-blockquote:border-pink prose-blockquote:bg-pink/5 prose-blockquote:rounded-r-2xl prose-blockquote:py-3 prose-blockquote:px-6 prose-blockquote:not-italic prose-blockquote:text-ink prose-blockquote:font-medium prose-blockquote:my-6
              prose-img:rounded-2xl prose-img:shadow-glass-lg prose-img:my-8 prose-img:w-full
              prose-ul:text-ink-soft prose-ol:text-ink-soft
              prose-li:my-1
            "
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
          {!isCreate && (
            <div className="mt-6 pt-4 border-t border-charcoal/10 text-center">
              <a
                href={`/${locale}/admin/articles/${id}/preview`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-pink font-semibold hover:underline"
              >
                <Eye size={14} />
                {locale === 'zh' ? '新分頁開完整版預覽(同客人見到一樣)' : 'Open full-size preview in new tab'}
                <ExternalLink size={12} />
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
