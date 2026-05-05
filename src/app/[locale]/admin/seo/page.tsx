'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import {
  saveSeoEntry, getSeoEntryClient, SEO_PAGES, type SeoPageDef,
} from '@/lib/seo';
import { uploadSiteImage } from '@/lib/content';
import { translateZhToEn } from '@/lib/translate';
import { SeoEntry, SeoDefaults } from '@/types';
import {
  Search, Save, Check, Languages, Loader2, Image as ImageIcon, Globe, Upload, AlertCircle,
} from 'lucide-react';

type Tab = 'global' | 'pages';

const DEFAULT_PAGE_ID = '_default';

export default function AdminSeoPage() {
  const locale = useLocale() as 'zh' | 'en';
  const { user, hasPermission } = useAuth();
  const [tab, setTab] = useState<Tab>('global');
  const [activePage, setActivePage] = useState<string>('home');
  const [globalConfig, setGlobalConfig] = useState<SeoDefaults>({});
  const [pageConfigs, setPageConfigs] = useState<Record<string, SeoEntry>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [translating, setTranslating] = useState<string | null>(null);

  useEffect(() => {
    if (!hasPermission('seo')) return;
    (async () => {
      const [def, ...entries] = await Promise.all([
        getSeoEntryClient(DEFAULT_PAGE_ID),
        ...SEO_PAGES.map((p) => getSeoEntryClient(p.id)),
      ]);
      setGlobalConfig((def as SeoDefaults) || {});
      const map: Record<string, SeoEntry> = {};
      SEO_PAGES.forEach((p, i) => { map[p.id] = entries[i] || {}; });
      setPageConfigs(map);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!hasPermission('seo')) {
    return (
      <div className="text-center py-20 text-ink-soft">
        {locale === 'zh' ? '無權限存取' : 'Access Denied'}
      </div>
    );
  }

  const updatePage = (pageId: string, patch: Partial<SeoEntry>) => {
    setPageConfigs((prev) => ({
      ...prev,
      [pageId]: { ...(prev[pageId] || {}), ...patch },
    }));
  };

  const updateBilingual = (
    pageId: string,
    field: 'title' | 'description' | 'keywords',
    lang: 'zh' | 'en',
    value: string,
  ) => {
    const current = pageConfigs[pageId]?.[field] || { zh: '', en: '' };
    updatePage(pageId, { [field]: { ...current, [lang]: value } });
  };

  const updateGlobalBilingual = (
    field: 'title' | 'description' | 'keywords' | 'siteName',
    lang: 'zh' | 'en',
    value: string,
  ) => {
    setGlobalConfig((prev) => ({
      ...prev,
      [field]: { ...(prev[field] || { zh: '', en: '' }), [lang]: value },
    }));
  };

  const handleSavePage = async (pageId: string) => {
    if (!user) return;
    setSavingId(pageId);
    try {
      await saveSeoEntry(pageId, pageConfigs[pageId] || {}, user.uid);
      setSavedId(pageId);
      setTimeout(() => setSavedId(null), 2200);
    } catch (err) {
      alert((locale === 'zh' ? '儲存失敗：' : 'Save failed: ') + String(err));
    } finally {
      setSavingId(null);
    }
  };

  const handleSaveGlobal = async () => {
    if (!user) return;
    setSavingId(DEFAULT_PAGE_ID);
    try {
      await saveSeoEntry(DEFAULT_PAGE_ID, globalConfig, user.uid);
      setSavedId(DEFAULT_PAGE_ID);
      setTimeout(() => setSavedId(null), 2200);
    } catch (err) {
      alert((locale === 'zh' ? '儲存失敗：' : 'Save failed: ') + String(err));
    } finally {
      setSavingId(null);
    }
  };

  const handleTranslate = async (
    pageId: string,
    field: 'title' | 'description' | 'keywords',
    isGlobal = false,
  ) => {
    const source = isGlobal
      ? globalConfig[field]?.zh
      : pageConfigs[pageId]?.[field]?.zh;
    if (!source) return;
    const tag = `${pageId}-${field}`;
    setTranslating(tag);
    try {
      const en = await translateZhToEn(source);
      if (isGlobal) updateGlobalBilingual(field, 'en', en);
      else updateBilingual(pageId, field, 'en', en);
    } catch (err) {
      alert(
        (locale === 'zh' ? '翻譯失敗：' : 'Translation failed: ') +
        (err instanceof Error ? err.message : String(err)),
      );
    } finally {
      setTranslating(null);
    }
  };

  const currentPage = SEO_PAGES.find((p) => p.id === activePage);
  const currentPageCfg = pageConfigs[activePage] || {};

  return (
    <div>
      <div className="mb-8">
        <span className="chip mb-3"><Search size={12} className="text-pink" /> SEO</span>
        <h1 className="text-heading font-display">
          <span className="text-ink">{locale === 'zh' ? 'SEO ' : 'SEO '}</span>
          <span className="text-gradient-pink">{locale === 'zh' ? '管理' : 'Management'}</span>
        </h1>
      </div>

      {/* Top tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setTab('global')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-pill text-sm font-medium transition-all border ${
            tab === 'global' ? 'bg-gradient-pink text-white border-transparent shadow-glow' : 'bg-white/50 text-ink-soft border-white/70 hover:bg-white/80 backdrop-blur-md'
          }`}
        >
          <Globe size={16} /> {locale === 'zh' ? '全站設定' : 'Site-wide'}
        </button>
        <button
          onClick={() => setTab('pages')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-pill text-sm font-medium transition-all border ${
            tab === 'pages' ? 'bg-gradient-pink text-white border-transparent shadow-glow' : 'bg-white/50 text-ink-soft border-white/70 hover:bg-white/80 backdrop-blur-md'
          }`}
        >
          <Search size={16} /> {locale === 'zh' ? '逐頁設定' : 'Per-page'}
        </button>
      </div>

      {loading ? (
        <div className="animate-pulse text-ink-soft">Loading…</div>
      ) : tab === 'global' ? (
        <GlobalForm
          locale={locale}
          config={globalConfig}
          setConfig={setGlobalConfig}
          updateBilingual={updateGlobalBilingual}
          onSave={handleSaveGlobal}
          saving={savingId === DEFAULT_PAGE_ID}
          saved={savedId === DEFAULT_PAGE_ID}
          onTranslate={(f) => handleTranslate(DEFAULT_PAGE_ID, f, true)}
          translating={translating}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Page list */}
          <aside className="lg:col-span-3 glass-card p-3 h-fit">
            <p className="text-[11px] uppercase tracking-wider font-semibold text-ink-soft px-3 py-2">
              {locale === 'zh' ? '頁面' : 'Pages'}
            </p>
            <div className="space-y-0.5">
              {SEO_PAGES.map((p) => {
                const isActive = activePage === p.id;
                const has = !!pageConfigs[p.id]?.title?.zh;
                return (
                  <button
                    key={p.id}
                    onClick={() => setActivePage(p.id)}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-sm transition-colors ${
                      isActive ? 'bg-gradient-pink text-white shadow-glow font-semibold' : 'text-ink-soft hover:bg-white/60'
                    }`}
                  >
                    <span>{p.label[locale]}</span>
                    {!has && (
                      <span title={locale === 'zh' ? '未設定' : 'Not set'}>
                        <AlertCircle size={12} className={isActive ? 'text-white/80' : 'text-amber-500'} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </aside>

          {/* Page form */}
          <div className="lg:col-span-9">
            {currentPage && (
              <PageForm
                key={currentPage.id}
                page={currentPage}
                locale={locale}
                cfg={currentPageCfg}
                updateBilingual={(field, lang, value) => updateBilingual(currentPage.id, field, lang, value)}
                updatePage={(patch) => updatePage(currentPage.id, patch)}
                onSave={() => handleSavePage(currentPage.id)}
                saving={savingId === currentPage.id}
                saved={savedId === currentPage.id}
                onTranslate={(f) => handleTranslate(currentPage.id, f)}
                translating={translating}
                userUid={user?.uid}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Global form
// ────────────────────────────────────────────────────────────

interface GlobalFormProps {
  locale: 'zh' | 'en';
  config: SeoDefaults;
  setConfig: React.Dispatch<React.SetStateAction<SeoDefaults>>;
  updateBilingual: (
    field: 'title' | 'description' | 'keywords' | 'siteName',
    lang: 'zh' | 'en',
    value: string,
  ) => void;
  onSave: () => Promise<void> | void;
  saving: boolean;
  saved: boolean;
  onTranslate: (f: 'title' | 'description' | 'keywords') => void;
  translating: string | null;
}

function GlobalForm({
  locale, config, setConfig, updateBilingual, onSave, saving, saved, onTranslate, translating,
}: GlobalFormProps) {
  return (
    <div className="glass-card p-6 md:p-7 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold font-display text-ink">
            {locale === 'zh' ? '全站預設' : 'Site-wide defaults'}
          </h3>
          <p className="text-xs text-ink-soft mt-1">
            {locale === 'zh'
              ? '逐頁未填嘅 SEO 欄位會自動 fallback 用呢度。'
              : 'Per-page SEO fields fall back to these defaults when blank.'}
          </p>
        </div>
        <SaveButton onSave={onSave} saving={saving} saved={saved} locale={locale} />
      </div>

      <BilingualInput
        label={{ zh: '網站名稱', en: 'Site name' }}
        value={config.siteName || { zh: '', en: '' }}
        onChange={(lang, v) => updateBilingual('siteName', lang, v)}
        locale={locale}
      />

      <BilingualInput
        label={{ zh: '預設標題', en: 'Default page title' }}
        value={config.title || { zh: '', en: '' }}
        onChange={(lang, v) => updateBilingual('title', lang, v)}
        onTranslate={() => onTranslate('title')}
        translating={translating === '_default-title'}
        locale={locale}
      />

      <BilingualInput
        label={{ zh: '預設描述', en: 'Default description' }}
        value={config.description || { zh: '', en: '' }}
        onChange={(lang, v) => updateBilingual('description', lang, v)}
        onTranslate={() => onTranslate('description')}
        translating={translating === '_default-description'}
        locale={locale}
        multiline
      />

      <BilingualInput
        label={{ zh: '預設關鍵字（逗號分隔）', en: 'Default keywords (comma-sep)' }}
        value={config.keywords || { zh: '', en: '' }}
        onChange={(lang, v) => updateBilingual('keywords', lang, v)}
        onTranslate={() => onTranslate('keywords')}
        translating={translating === '_default-keywords'}
        locale={locale}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SimpleInput
          label={{ zh: '預設 OG 圖片 URL', en: 'Default OG image URL' }}
          value={config.ogImage || ''}
          onChange={(v) => setConfig((p) => ({ ...p, ogImage: v }))}
          placeholder="https://…/og.jpg"
          locale={locale}
        />
        <SimpleInput
          label={{ zh: 'Twitter handle', en: 'Twitter handle' }}
          value={config.twitterHandle || ''}
          onChange={(v) => setConfig((p) => ({ ...p, twitterHandle: v }))}
          placeholder="@spaco"
          locale={locale}
        />
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Page form
// ────────────────────────────────────────────────────────────

interface PageFormProps {
  page: SeoPageDef;
  locale: 'zh' | 'en';
  cfg: SeoEntry;
  updateBilingual: (
    field: 'title' | 'description' | 'keywords',
    lang: 'zh' | 'en',
    value: string,
  ) => void;
  updatePage: (patch: Partial<SeoEntry>) => void;
  onSave: () => Promise<void> | void;
  saving: boolean;
  saved: boolean;
  onTranslate: (f: 'title' | 'description' | 'keywords') => void;
  translating: string | null;
  userUid?: string;
}

function PageForm({
  page, locale, cfg, updateBilingual, updatePage, onSave, saving, saved, onTranslate, translating,
}: PageFormProps) {
  const ogInputRef = useRef<HTMLInputElement>(null);
  const [uploadingOg, setUploadingOg] = useState(false);

  const handleOgUpload = async (file: File) => {
    setUploadingOg(true);
    try {
      const img = await uploadSiteImage(file, `og-${page.id}`, 'seo-og', `og-${page.id}`);
      updatePage({ ogImage: img.url });
    } catch (err) {
      alert((locale === 'zh' ? '上傳失敗：' : 'Upload failed: ') + String(err));
    } finally {
      setUploadingOg(false);
      if (ogInputRef.current) ogInputRef.current.value = '';
    }
  };

  return (
    <div className="glass-card p-6 md:p-7 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-lg font-bold font-display text-ink">{page.label[locale]}</h3>
          <p className="text-xs text-ink-soft mt-1 font-mono">{page.path}</p>
        </div>
        <SaveButton onSave={onSave} saving={saving} saved={saved} locale={locale} />
      </div>

      <BilingualInput
        label={{ zh: '頁面標題（<title>）', en: 'Page title (<title>)' }}
        value={cfg.title || { zh: '', en: '' }}
        onChange={(lang, v) => updateBilingual('title', lang, v)}
        onTranslate={() => onTranslate('title')}
        translating={translating === `${page.id}-title`}
        placeholder={page.defaultTitle}
        locale={locale}
        hint={{ zh: '建議 50-60 字元；過長會被截斷。', en: 'Aim for 50-60 chars; longer titles get truncated.' }}
      />

      <BilingualInput
        label={{ zh: '描述（meta description）', en: 'Meta description' }}
        value={cfg.description || { zh: '', en: '' }}
        onChange={(lang, v) => updateBilingual('description', lang, v)}
        onTranslate={() => onTranslate('description')}
        translating={translating === `${page.id}-description`}
        placeholder={page.defaultDescription}
        locale={locale}
        multiline
        hint={{ zh: '建議 120-160 字元。', en: 'Aim for 120-160 chars.' }}
      />

      <BilingualInput
        label={{ zh: '關鍵字（逗號分隔）', en: 'Keywords (comma-sep)' }}
        value={cfg.keywords || { zh: '', en: '' }}
        onChange={(lang, v) => updateBilingual('keywords', lang, v)}
        onTranslate={() => onTranslate('keywords')}
        translating={translating === `${page.id}-keywords`}
        locale={locale}
      />

      {/* OG image */}
      <div>
        <label className="text-sm font-semibold text-ink-soft mb-2 block">
          {locale === 'zh' ? 'Open Graph 圖片' : 'Open Graph image'}
        </label>
        <div className="flex items-start gap-4">
          <div className="aspect-[1.91/1] w-48 rounded-xl bg-cream border-2 border-dashed border-charcoal/10 overflow-hidden flex-shrink-0">
            {cfg.ogImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cfg.ogImage} alt="OG preview" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-charcoal/30">
                <ImageIcon size={20} />
              </div>
            )}
          </div>
          <div className="flex-1 space-y-2">
            <input
              ref={ogInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleOgUpload(f);
              }}
            />
            <input
              type="url"
              value={cfg.ogImage || ''}
              onChange={(e) => updatePage({ ogImage: e.target.value })}
              placeholder="https://…/og.jpg"
              className="w-full px-3 py-2 rounded-xl border border-charcoal/10 text-sm focus:outline-none focus:border-accent"
            />
            <button
              onClick={() => ogInputRef.current?.click()}
              disabled={uploadingOg}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-pill bg-accent/10 text-accent text-xs font-medium hover:bg-accent/20 disabled:opacity-50"
            >
              {uploadingOg ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
              {locale === 'zh' ? '上傳新圖片' : 'Upload new image'}
            </button>
            <p className="text-[11px] text-ink-soft">
              {locale === 'zh' ? '建議 1200 × 630 px。留空時會 fallback 用全站預設 OG 圖片。' : 'Recommended 1200×630 px. Falls back to site default if empty.'}
            </p>
          </div>
        </div>
      </div>

      {/* noindex toggle */}
      <label className="flex items-center gap-3 cursor-pointer p-3 rounded-xl bg-white/40 border border-white/60">
        <input
          type="checkbox"
          checked={!!cfg.noindex}
          onChange={(e) => updatePage({ noindex: e.target.checked })}
          className="w-4 h-4"
        />
        <div>
          <p className="text-sm font-semibold text-ink">noindex</p>
          <p className="text-xs text-ink-soft">
            {locale === 'zh' ? '勾選後搜尋引擎唔會索引此頁。' : 'When checked, search engines will not index this page.'}
          </p>
        </div>
      </label>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Shared inputs
// ────────────────────────────────────────────────────────────

interface BilingualInputProps {
  label: { zh: string; en: string };
  value: { zh: string; en: string };
  onChange: (lang: 'zh' | 'en', v: string) => void;
  onTranslate?: () => void;
  translating?: boolean;
  placeholder?: { zh: string; en: string };
  locale: 'zh' | 'en';
  multiline?: boolean;
  hint?: { zh: string; en: string };
}

function BilingualInput({
  label, value, onChange, onTranslate, translating, placeholder, locale, multiline, hint,
}: BilingualInputProps) {
  const Field = multiline ? 'textarea' : 'input';
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-semibold text-ink-soft">{label[locale]}</label>
        {hint && <span className="text-[11px] text-ink-soft/70">{hint[locale]}</span>}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <span className="text-[10px] uppercase tracking-wider text-ink-soft font-medium">中文</span>
          <Field
            value={value.zh || ''}
            onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange('zh', e.target.value)}
            placeholder={placeholder?.zh}
            rows={multiline ? 4 : undefined}
            className="w-full mt-1 px-3 py-2 rounded-xl border border-charcoal/10 text-sm focus:outline-none focus:border-accent resize-none"
          />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-ink-soft font-medium">EN</span>
            {onTranslate && (
              <button
                onClick={onTranslate}
                disabled={translating}
                className="text-[10px] text-blue-500 hover:text-blue-700 inline-flex items-center gap-1 disabled:opacity-50"
              >
                {translating ? <Loader2 size={10} className="animate-spin" /> : <Languages size={10} />}
                {locale === 'zh' ? '自動翻譯' : 'Translate'}
              </button>
            )}
          </div>
          <Field
            value={value.en || ''}
            onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange('en', e.target.value)}
            placeholder={placeholder?.en}
            rows={multiline ? 4 : undefined}
            className="w-full mt-1 px-3 py-2 rounded-xl border border-charcoal/10 text-sm focus:outline-none focus:border-accent resize-none"
          />
        </div>
      </div>
    </div>
  );
}

interface SimpleInputProps {
  label: { zh: string; en: string };
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  locale: 'zh' | 'en';
}

function SimpleInput({ label, value, onChange, placeholder, locale }: SimpleInputProps) {
  return (
    <div>
      <label className="text-sm font-semibold text-ink-soft mb-2 block">{label[locale]}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-xl border border-charcoal/10 text-sm focus:outline-none focus:border-accent"
      />
    </div>
  );
}

interface SaveButtonProps {
  onSave: () => Promise<void> | void;
  saving: boolean;
  saved: boolean;
  locale: 'zh' | 'en';
}

function SaveButton({ onSave, saving, saved, locale }: SaveButtonProps) {
  return (
    <button
      onClick={onSave}
      disabled={saving}
      className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
        saved ? 'bg-green-100 text-green-700' : 'bg-accent text-white hover:bg-accent/90'
      } disabled:opacity-50`}
    >
      {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : <Save size={14} />}
      {saving
        ? (locale === 'zh' ? '儲存中…' : 'Saving…')
        : saved
          ? (locale === 'zh' ? '已儲存' : 'Saved')
          : (locale === 'zh' ? '儲存' : 'Save')}
    </button>
  );
}
