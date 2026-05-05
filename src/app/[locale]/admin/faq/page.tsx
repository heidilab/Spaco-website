'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import { loadFaqContent, saveFaqContent } from '@/lib/faqStorage';
import { DEFAULT_FAQ, FaqContent, FaqEntry } from '@/lib/faqDefaults';
import { translateZhToEn } from '@/lib/translate';
import {
  HelpCircle, ShieldAlert, Plus, Trash2, ArrowUp, ArrowDown,
  Save, RotateCcw, Languages, Loader2, Check, ChevronDown,
} from 'lucide-react';
import { motion } from 'framer-motion';

type Section = 'guestRules' | 'faqItems';

const SECTION_META: Record<Section, { icon: typeof HelpCircle; gradient: string; label: { zh: string; en: string } }> = {
  guestRules: {
    icon: ShieldAlert,
    gradient: 'bg-gradient-warm',
    label: { zh: '客人須知', en: 'Guest Rules' },
  },
  faqItems: {
    icon: HelpCircle,
    gradient: 'bg-gradient-cool',
    label: { zh: '常見問題', en: 'FAQ' },
  },
};

function newEntry(): FaqEntry {
  return {
    id: `entry-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    zh: { q: '', a: '' },
    en: { q: '', a: '' },
  };
}

export default function AdminFaqPage() {
  const locale = useLocale() as 'zh' | 'en';
  const { user, hasPermission } = useAuth();
  const canAccess = hasPermission('content');

  const [content, setContent] = useState<FaqContent>(DEFAULT_FAQ);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [translating, setTranslating] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!canAccess) return;
    loadFaqContent().then((c) => {
      setContent(c);
      setLoading(false);
    });
  }, [canAccess]);

  const updateEntry = (section: Section, id: string, patch: Partial<FaqEntry>) => {
    setContent((prev) => ({
      ...prev,
      [section]: prev[section].map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }));
  };

  const updateField = (section: Section, id: string, lang: 'zh' | 'en', field: 'q' | 'a', value: string) => {
    setContent((prev) => ({
      ...prev,
      [section]: prev[section].map((e) =>
        e.id === id ? { ...e, [lang]: { ...e[lang], [field]: value } } : e
      ),
    }));
  };

  const addEntry = (section: Section) => {
    const e = newEntry();
    setContent((prev) => ({ ...prev, [section]: [...prev[section], e] }));
    setExpandedId(e.id);
  };

  const removeEntry = (section: Section, id: string) => {
    if (!confirm(locale === 'zh' ? '確認刪除呢個問答？' : 'Delete this entry?')) return;
    setContent((prev) => ({ ...prev, [section]: prev[section].filter((e) => e.id !== id) }));
  };

  const moveEntry = (section: Section, id: string, dir: -1 | 1) => {
    setContent((prev) => {
      const arr = [...prev[section]];
      const idx = arr.findIndex((e) => e.id === id);
      if (idx === -1) return prev;
      const ni = idx + dir;
      if (ni < 0 || ni >= arr.length) return prev;
      [arr[idx], arr[ni]] = [arr[ni], arr[idx]];
      return { ...prev, [section]: arr };
    });
  };

  const autoTranslate = async (section: Section, id: string) => {
    const entry = content[section].find((e) => e.id === id);
    if (!entry) return;
    setTranslating(id);
    try {
      const [enQ, enA] = await Promise.all([
        entry.zh.q ? translateZhToEn(entry.zh.q) : Promise.resolve(entry.en.q),
        entry.zh.a ? translateZhToEn(entry.zh.a) : Promise.resolve(entry.en.a),
      ]);
      updateEntry(section, id, { en: { q: enQ, a: enA } });
    } finally {
      setTranslating(null);
    }
  };

  const resetSection = (section: Section) => {
    if (!confirm(locale === 'zh' ? '重設為預設內容？所有未儲存嘅修改會失去。' : 'Reset to defaults? Unsaved changes will be lost.')) return;
    setContent((prev) => ({ ...prev, [section]: DEFAULT_FAQ[section].map((e) => ({ ...e, zh: { ...e.zh }, en: { ...e.en } })) }));
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      await saveFaqContent(content, user.uid);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  if (!canAccess) {
    return <div className="text-center py-20 text-ink-soft">{locale === 'zh' ? '無權限存取' : 'No permission'}</div>;
  }

  if (loading) {
    return <div className="text-center py-20 text-ink-soft">Loading...</div>;
  }

  return (
    <div>
      <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <span className="chip mb-3">
            <HelpCircle size={12} className="text-pink" />
            FAQ
          </span>
          <h1 className="text-heading font-display">
            <span className="text-ink">{locale === 'zh' ? '常見問題' : 'FAQ'}</span>
            <span>{' '}</span>
            <span className="text-gradient-pink">{locale === 'zh' ? '管理' : 'Editor'}</span>
          </h1>
          <p className="text-ink-soft mt-2 text-sm">
            {locale === 'zh' ? '增加、修改或刪除客人須知同常見問題（中／英對照）。' : 'Add, edit, reorder, or remove FAQ entries (bilingual).'}
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary disabled:opacity-50"
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : savedFlash ? <Check size={16} /> : <Save size={16} />}
          {saving ? (locale === 'zh' ? '儲存中…' : 'Saving…') : savedFlash ? (locale === 'zh' ? '已儲存' : 'Saved') : (locale === 'zh' ? '儲存修改' : 'Save changes')}
        </button>
      </div>

      <div className="space-y-6">
        {(['guestRules', 'faqItems'] as Section[]).map((section) => {
          const meta = SECTION_META[section];
          const Icon = meta.icon;
          const list = content[section];
          return (
            <div key={section} className="glass-card p-6">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-2xl ${meta.gradient} flex items-center justify-center text-white shadow-glow`}>
                    <Icon size={18} />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold font-display text-ink">{meta.label[locale]}</h2>
                    <p className="text-xs text-ink-soft">{list.length} {locale === 'zh' ? '個項目' : 'entries'}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => resetSection(section)}
                    className="px-3 py-1.5 rounded-pill text-xs font-medium bg-white/60 text-ink-soft border border-white/80 hover:bg-white/90 inline-flex items-center gap-1"
                  >
                    <RotateCcw size={11} /> {locale === 'zh' ? '重設預設' : 'Reset defaults'}
                  </button>
                  <button
                    onClick={() => addEntry(section)}
                    className="px-3 py-1.5 rounded-pill text-xs font-semibold bg-gradient-pink text-white shadow-glow inline-flex items-center gap-1"
                  >
                    <Plus size={11} /> {locale === 'zh' ? '加入問答' : 'Add entry'}
                  </button>
                </div>
              </div>

              {/* Entries */}
              <div className="space-y-2.5">
                {list.length === 0 && (
                  <div className="text-center py-8 text-sm text-ink-soft">
                    {locale === 'zh' ? '尚未有問答' : 'No entries yet'}
                  </div>
                )}
                {list.map((entry, idx) => {
                  const isOpen = expandedId === entry.id;
                  const preview = entry[locale]?.q || entry.zh.q || entry.en.q || (locale === 'zh' ? '（未填問題）' : '(empty)');
                  return (
                    <motion.div key={entry.id} layout className="bg-white/40 backdrop-blur-md border border-white/60 rounded-2xl overflow-hidden">
                      {/* Header — collapsed view */}
                      <div className="flex items-center gap-2 p-3">
                        <span className="text-xs font-mono text-ink-soft w-6 text-center">{idx + 1}</span>
                        <button
                          onClick={() => setExpandedId(isOpen ? null : entry.id)}
                          className="flex-1 text-left text-sm font-medium text-ink truncate"
                        >
                          {preview}
                        </button>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => moveEntry(section, entry.id, -1)}
                            disabled={idx === 0}
                            className="w-7 h-7 rounded-lg bg-white/70 text-ink-soft hover:bg-white disabled:opacity-30 flex items-center justify-center"
                            title="Move up"
                          >
                            <ArrowUp size={12} />
                          </button>
                          <button
                            onClick={() => moveEntry(section, entry.id, 1)}
                            disabled={idx === list.length - 1}
                            className="w-7 h-7 rounded-lg bg-white/70 text-ink-soft hover:bg-white disabled:opacity-30 flex items-center justify-center"
                            title="Move down"
                          >
                            <ArrowDown size={12} />
                          </button>
                          <button
                            onClick={() => removeEntry(section, entry.id)}
                            className="w-7 h-7 rounded-lg bg-rose-100/80 text-rose-700 hover:bg-rose-200 flex items-center justify-center"
                            title="Delete"
                          >
                            <Trash2 size={12} />
                          </button>
                          <button
                            onClick={() => setExpandedId(isOpen ? null : entry.id)}
                            className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${isOpen ? 'bg-gradient-pink text-white' : 'bg-white/70 text-ink-soft'}`}
                          >
                            <ChevronDown size={12} className={isOpen ? 'rotate-180' : ''} />
                          </button>
                        </div>
                      </div>

                      {/* Expanded — editable fields */}
                      {isOpen && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          className="px-4 pb-4 pt-2 space-y-3 border-t border-white/50"
                        >
                          {/* Auto-translate button */}
                          <div className="flex justify-end">
                            <button
                              onClick={() => autoTranslate(section, entry.id)}
                              disabled={translating === entry.id || !entry.zh.q}
                              className="text-xs font-semibold text-pink hover:underline inline-flex items-center gap-1 disabled:opacity-50"
                              title={locale === 'zh' ? '把中文 Q&A 自動翻譯成英文' : 'Auto-translate ZH → EN'}
                            >
                              {translating === entry.id ? <Loader2 size={11} className="animate-spin" /> : <Languages size={11} />}
                              {locale === 'zh' ? '中→英自動翻譯' : 'Auto-translate ZH → EN'}
                            </button>
                          </div>

                          {/* ZH fields */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                              <label className="text-[10px] text-ink-soft uppercase tracking-wider font-semibold flex items-center gap-1.5 mb-1">
                                <span className="px-1.5 py-0.5 rounded bg-pink/10 text-pink">中文</span>
                                {locale === 'zh' ? '問題' : 'Question'}
                              </label>
                              <input
                                type="text"
                                value={entry.zh.q}
                                onChange={(e) => updateField(section, entry.id, 'zh', 'q', e.target.value)}
                                className="w-full px-3 py-2 rounded-xl bg-white/80 border border-white/80 text-ink text-sm"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-ink-soft uppercase tracking-wider font-semibold flex items-center gap-1.5 mb-1">
                                <span className="px-1.5 py-0.5 rounded bg-lavender/10 text-lavender-deep">EN</span>
                                {locale === 'zh' ? '問題' : 'Question'}
                              </label>
                              <input
                                type="text"
                                value={entry.en.q}
                                onChange={(e) => updateField(section, entry.id, 'en', 'q', e.target.value)}
                                className="w-full px-3 py-2 rounded-xl bg-white/80 border border-white/80 text-ink text-sm"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-ink-soft uppercase tracking-wider font-semibold flex items-center gap-1.5 mb-1">
                                <span className="px-1.5 py-0.5 rounded bg-pink/10 text-pink">中文</span>
                                {locale === 'zh' ? '答案' : 'Answer'}
                              </label>
                              <textarea
                                value={entry.zh.a}
                                onChange={(e) => updateField(section, entry.id, 'zh', 'a', e.target.value)}
                                rows={4}
                                className="w-full px-3 py-2 rounded-xl bg-white/80 border border-white/80 text-ink text-sm leading-relaxed"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-ink-soft uppercase tracking-wider font-semibold flex items-center gap-1.5 mb-1">
                                <span className="px-1.5 py-0.5 rounded bg-lavender/10 text-lavender-deep">EN</span>
                                {locale === 'zh' ? '答案' : 'Answer'}
                              </label>
                              <textarea
                                value={entry.en.a}
                                onChange={(e) => updateField(section, entry.id, 'en', 'a', e.target.value)}
                                rows={4}
                                className="w-full px-3 py-2 rounded-xl bg-white/80 border border-white/80 text-ink text-sm leading-relaxed"
                              />
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Sticky footer save reminder */}
      <div className="mt-6 text-xs text-ink-soft text-center">
        {locale === 'zh' ? '⚠️ 修改完記得點右上角「儲存修改」' : '⚠️ Click "Save changes" above to publish edits'}
      </div>
    </div>
  );
}
