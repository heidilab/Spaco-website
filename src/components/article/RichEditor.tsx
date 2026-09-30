'use client';

// WYSIWYG rich-text editor for article authoring. Outputs HTML; admin
// gets a toolbar with font size + colour + headings + lists + alignment
// + image + link + tables — the controls Heidi asked for ("揀埋字型大小顏色").
//
// 2026-09-30: pasting from AI writing tools / web pages / Google Docs now
// keeps headings, lists and TABLES (smart paste cleans the clipboard HTML
// before it enters the editor; plain-text Markdown is converted too), and
// a 「匯入文章」 modal gives a deterministic bulk-import path.

import { useEditor, EditorContent, Editor, Extension } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import TextAlign from '@tiptap/extension-text-align';
import Underline from '@tiptap/extension-underline';
import { TableKit } from '@tiptap/extension-table';
import { DOMParser as PMDOMParser } from '@tiptap/pm/model';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, Heading1, Heading2, Heading3,
  List, ListOrdered, Quote, Link2, Image as ImageIcon, Code,
  AlignLeft, AlignCenter, AlignRight, Undo, Redo, Palette, Eraser, Type,
  Table2, ClipboardPaste, Trash2, X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { textToHtml, looksLikeMarkdown, markdownToHtml } from '@/lib/pasteContent';

// Custom font-size mark on top of TextStyle (no official extension for this).
const FontSize = Extension.create({
  name: 'fontSize',
  addOptions() { return { types: ['textStyle'] as string[] }; },
  addGlobalAttributes() {
    return [{
      types: this.options.types as string[],
      attributes: {
        fontSize: {
          default: null,
          parseHTML: (el: HTMLElement) => el.style.fontSize || null,
          renderHTML: (attrs: Record<string, unknown>) =>
            attrs.fontSize ? { style: `font-size: ${attrs.fontSize}` } : {},
        },
      },
    }];
  },
});

const FONT_SIZES = [
  { label: '細', value: '14px' },
  { label: '正常', value: '' },          // unset → inherit
  { label: '大', value: '20px' },
  { label: '特大', value: '28px' },
  { label: '標題', value: '40px' },
];

const COLOURS = [
  { name: '黑', value: '#1a1a1a' },
  { name: '灰', value: '#6b7280' },
  { name: '粉紅', value: '#ec4899' },
  { name: '紫', value: '#a855f7' },
  { name: '藍', value: '#3b82f6' },
  { name: '綠', value: '#10b981' },
  { name: '黃', value: '#f59e0b' },
  { name: '紅', value: '#ef4444' },
];

// ── Smart paste: clean clipboard HTML from web pages / AI tools / Docs ──
// Strips presentational junk (inline styles, spans, divs, classes) that
// wrecks spacing, and normalises tags so the TipTap schema keeps the
// structure: headings, lists, blockquotes, links, images, TABLES.
const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'TABLE', 'BLOCKQUOTE', 'PRE', 'HR', 'SECTION', 'ARTICLE', 'FIGURE', 'HEADER', 'FOOTER', 'ASIDE', 'MAIN', 'NAV', 'TR', 'TD', 'TH', 'THEAD', 'TBODY']);
const KEEP_ATTRS: Record<string, string[]> = {
  A: ['href', 'target', 'rel'],
  IMG: ['src', 'alt'],
  TD: ['colspan', 'rowspan'],
  TH: ['colspan', 'rowspan'],
  OL: ['start'],
};

export function cleanPastedHtml(html: string): string {
  if (typeof window === 'undefined') return html;
  const doc = new window.DOMParser().parseFromString(html, 'text/html');
  const body = doc.body;

  // 1. Drop non-content nodes entirely.
  body.querySelectorAll('script, style, meta, link, title, noscript, iframe, svg, button, input, textarea, select, form, nav, video, audio, canvas, template').forEach((n) => n.remove());
  // Comments
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_COMMENT);
  const comments: Node[] = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  comments.forEach((c) => c.parentNode?.removeChild(c));

  const unwrap = (el: Element) => { el.replaceWith(...Array.from(el.childNodes)); };
  const rename = (el: Element, tag: string) => {
    const n = doc.createElement(tag);
    while (el.firstChild) n.appendChild(el.firstChild);
    el.replaceWith(n);
    return n;
  };
  const hasBlockChild = (el: Element) => Array.from(el.children).some((c) => BLOCK_TAGS.has(c.tagName));

  // 2. Google Docs wraps everything in <b style="font-weight:normal">.
  body.querySelectorAll('b').forEach((b) => {
    if (/font-weight\s*:\s*(normal|400)/i.test(b.getAttribute('style') || '') || /^docs-internal-guid/.test(b.id)) unwrap(b);
  });

  // 3. Inline wrappers that only carry styling → unwrap. Bold/italic via
  //    inline style get promoted to real marks first.
  body.querySelectorAll('span, font').forEach((el) => {
    const st = (el.getAttribute('style') || '').toLowerCase();
    if (/font-weight\s*:\s*(bold|[6-9]00)/.test(st) && el.textContent?.trim()) rename(el, 'strong');
    else if (/font-style\s*:\s*italic/.test(st) && el.textContent?.trim()) rename(el, 'em');
    else unwrap(el);
  });

  // 4. Structural wrappers → unwrap; leaf <div> → <p>. Loop until stable
  //    because unwrapping exposes nested wrappers.
  for (let i = 0; i < 20; i++) {
    const wrappers = body.querySelectorAll('div, section, article, main, header, footer, aside, figure, figcaption, center');
    if (!wrappers.length) break;
    wrappers.forEach((el) => {
      if (el.tagName === 'DIV' && !hasBlockChild(el)) rename(el, 'p');
      else unwrap(el);
    });
  }

  // 5. Tag normalisation. Body h1 → h2 (page title is the only h1);
  //    h4–h6 → h3 (editor supports 1–3). b/i → strong/em.
  body.querySelectorAll('h1').forEach((el) => rename(el, 'h2'));
  body.querySelectorAll('h4, h5, h6').forEach((el) => rename(el, 'h3'));
  body.querySelectorAll('b').forEach((el) => rename(el, 'strong'));
  body.querySelectorAll('i').forEach((el) => rename(el, 'em'));
  body.querySelectorAll('a:not([href])').forEach((el) => unwrap(el));
  body.querySelectorAll('caption, colgroup, col').forEach((el) => el.remove());

  // 6. Strip every attribute except the semantic whitelist.
  body.querySelectorAll('*').forEach((el) => {
    const keep = KEEP_ATTRS[el.tagName] || [];
    Array.from(el.attributes).forEach((a) => { if (!keep.includes(a.name.toLowerCase())) el.removeAttribute(a.name); });
    if (el.tagName === 'A') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener'); }
  });

  // 7. Empty blocks (only whitespace / <br> / nbsp) → remove. Lone <br>
  //    runs are what produce the "行距極度難睇" look.
  body.querySelectorAll('p, li, h2, h3, blockquote').forEach((el) => {
    const txt = (el.textContent || '').replace(/ /g, ' ').trim();
    if (!txt && !el.querySelector('img, table')) el.remove();
  });
  body.querySelectorAll('br + br').forEach((br) => br.remove());
  body.querySelectorAll('p > br:only-child').forEach((br) => br.parentElement?.remove());

  return body.innerHTML.replace(/ /g, ' ').trim();
}

/** Count what the cleaned HTML contains — shown as feedback in the import modal. */
function summarise(html: string): string {
  const c = (re: RegExp) => (html.match(re) || []).length;
  const parts: string[] = [];
  const h = c(/<h[1-3]\b/g); if (h) parts.push(`${h} 個標題`);
  const l = c(/<li\b/g); if (l) parts.push(`${l} 個清單項`);
  const t = c(/<table\b/g); if (t) parts.push(`${t} 個表格`);
  const i = c(/<img\b/g); if (i) parts.push(`${i} 張圖片`);
  const p = c(/<p\b/g); if (p) parts.push(`${p} 段`);
  return parts.join(' · ');
}

interface Props {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}

export default function RichEditor({ value, onChange, placeholder, minHeight = 420 }: Props) {
  const lastEmittedRef = useRef(value);
  const [colourOpen, setColourOpen] = useState(false);
  const [sizeOpen, setSizeOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imageOpen, setImageOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  // When the user pastes into the import box we capture the clipboard's
  // HTML too (richer than the text). Valid only while textarea text is
  // still exactly what was pasted.
  const [captured, setCaptured] = useState<{ text: string; html: string } | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Image.configure({ inline: false, allowBase64: false }),
      Link.configure({ openOnClick: false, autolink: true }),
      TextStyle,
      Color,
      FontSize,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Underline,
      TableKit.configure({ table: { resizable: false } }),
    ],
    content: value || '',
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      lastEmittedRef.current = html;
      onChange(html);
    },
    editorProps: {
      attributes: {
        // Tailwind prose classes give SPACO-consistent typography; admin
        // sees roughly what customers will see.
        class: 'prose prose-base max-w-none focus:outline-none px-5 py-4 prose-headings:font-display prose-headings:font-bold prose-h1:text-3xl prose-h2:text-2xl prose-h3:text-xl prose-p:text-ink prose-blockquote:border-pink prose-blockquote:bg-pink/5 prose-blockquote:rounded-r-xl prose-img:rounded-2xl prose-a:text-pink',
      },
      // Smart paste — see cleanPastedHtml. Returning false falls back to
      // ProseMirror's default paste for anything we don't recognise.
      handlePaste: (view, event) => {
        const cd = event.clipboardData;
        if (!cd) return false;
        const html = cd.getData('text/html');
        const text = cd.getData('text/plain');
        let cleaned = '';
        if (html && /<(h[1-6]|ul|ol|table|p|div|li|blockquote|img)\b/i.test(html)) {
          cleaned = cleanPastedHtml(html);
        } else if (!html && text && looksLikeMarkdown(text)) {
          cleaned = markdownToHtml(text);
        }
        if (!cleaned) return false;
        const dom = new window.DOMParser().parseFromString(cleaned, 'text/html').body;
        const slice = PMDOMParser.fromSchema(view.state.schema).parseSlice(dom, { preserveWhitespace: false });
        view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
        return true;
      },
    },
    immediatelyRender: false,
  });

  // Sync external value changes (e.g. LLM smart-format returns new content)
  // back into the editor — but skip when value === what we last emitted to
  // avoid an infinite loop.
  useEffect(() => {
    if (!editor) return;
    if (value === lastEmittedRef.current) return;
    editor.commands.setContent(value || '', { emitUpdate: false });
    lastEmittedRef.current = value;
  }, [value, editor]);

  if (!editor) {
    return (
      <div className="w-full rounded-xl border border-charcoal/15 bg-white" style={{ minHeight }} />
    );
  }

  function applyLink() {
    if (!linkUrl.trim()) {
      editor!.chain().focus().unsetLink().run();
    } else {
      const url = /^https?:\/\//i.test(linkUrl.trim()) ? linkUrl.trim() : `https://${linkUrl.trim()}`;
      editor!.chain().focus().extendMarkRange('link').setLink({ href: url, target: '_blank' }).run();
    }
    setLinkOpen(false);
    setLinkUrl('');
  }

  function applyImage() {
    if (imageUrl.trim()) {
      editor!.chain().focus().setImage({ src: imageUrl.trim() }).run();
    }
    setImageOpen(false);
    setImageUrl('');
  }

  function importHtml(): string {
    if (captured && captured.text === importText) return captured.html;
    return textToHtml(importText);
  }

  function runImport(mode: 'replace' | 'append') {
    const html = importHtml();
    if (!html) return;
    if (mode === 'replace') {
      editor!.commands.setContent(html, { emitUpdate: true });
    } else {
      editor!.chain().focus('end').insertContent(html).run();
    }
    setImportOpen(false);
    setImportText('');
    setCaptured(null);
  }

  const inTable = editor.isActive('table');
  const previewHtml = importOpen && importText.trim() ? importHtml() : '';

  return (
    <div className="rounded-xl border border-charcoal/15 bg-white overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1 px-2 py-2 border-b border-charcoal/10 bg-cream/30 text-ink">
        {/* Undo / Redo */}
        <Btn onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="復原 (Cmd+Z)">
          <Undo size={15} />
        </Btn>
        <Btn onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="重做">
          <Redo size={15} />
        </Btn>
        <Sep />

        {/* Headings */}
        <Btn active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="大標題 H1"><Heading1 size={15} /></Btn>
        <Btn active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="標題 H2"><Heading2 size={15} /></Btn>
        <Btn active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="細標題 H3"><Heading3 size={15} /></Btn>
        <Sep />

        {/* Font size picker */}
        <div className="relative">
          <Btn active={sizeOpen} onClick={() => { setSizeOpen((v) => !v); setColourOpen(false); }} title="字型大小">
            <Type size={15} />
          </Btn>
          {sizeOpen && (
            <div className="absolute top-full left-0 mt-1 z-30 bg-white border border-charcoal/15 rounded-xl shadow-lg p-1 min-w-[110px]">
              {FONT_SIZES.map((s) => (
                <button
                  key={s.label}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    if (s.value) {
                      editor.chain().focus().setMark('textStyle', { fontSize: s.value }).run();
                    } else {
                      editor.chain().focus().setMark('textStyle', { fontSize: null }).run();
                    }
                    setSizeOpen(false);
                  }}
                  className="block w-full text-left px-3 py-1.5 rounded-lg hover:bg-pink/10 text-sm"
                  style={s.value ? { fontSize: s.value, lineHeight: 1.2 } : undefined}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Colour picker */}
        <div className="relative">
          <Btn active={colourOpen} onClick={() => { setColourOpen((v) => !v); setSizeOpen(false); }} title="文字顏色">
            <Palette size={15} />
          </Btn>
          {colourOpen && (
            <div className="absolute top-full left-0 mt-1 z-30 bg-white border border-charcoal/15 rounded-xl shadow-lg p-2 grid grid-cols-4 gap-1.5">
              {COLOURS.map((c) => (
                <button
                  key={c.value}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    editor.chain().focus().setColor(c.value).run();
                    setColourOpen(false);
                  }}
                  className="w-8 h-8 rounded-lg border border-charcoal/15 hover:scale-110 transition"
                  style={{ backgroundColor: c.value }}
                  title={c.name}
                />
              ))}
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { editor.chain().focus().unsetColor().run(); setColourOpen(false); }}
                className="col-span-4 mt-1 px-2 py-1 text-xs rounded-lg bg-charcoal/5 hover:bg-charcoal/10"
              >
                清除顏色
              </button>
            </div>
          )}
        </div>
        <Sep />

        {/* Inline marks */}
        <Btn active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title="粗體 (Cmd+B)"><Bold size={15} /></Btn>
        <Btn active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title="斜體 (Cmd+I)"><Italic size={15} /></Btn>
        <Btn active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} title="底線 (Cmd+U)"><UnderlineIcon size={15} /></Btn>
        <Btn active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} title="刪除線"><Strikethrough size={15} /></Btn>
        <Sep />

        {/* Lists + blockquote */}
        <Btn active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title="無序清單"><List size={15} /></Btn>
        <Btn active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="有序清單"><ListOrdered size={15} /></Btn>
        <Btn active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="引用"><Quote size={15} /></Btn>
        <Btn active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()} title="代碼"><Code size={15} /></Btn>
        <Sep />

        {/* Alignment */}
        <Btn active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()} title="向左對齊"><AlignLeft size={15} /></Btn>
        <Btn active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()} title="置中"><AlignCenter size={15} /></Btn>
        <Btn active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()} title="向右對齊"><AlignRight size={15} /></Btn>
        <Sep />

        {/* Link */}
        <div className="relative">
          <Btn active={editor.isActive('link') || linkOpen} onClick={() => { setLinkOpen((v) => !v); setLinkUrl(editor.getAttributes('link').href || ''); }} title="插入連結">
            <Link2 size={15} />
          </Btn>
          {linkOpen && (
            <div className="absolute top-full left-0 mt-1 z-30 bg-white border border-charcoal/15 rounded-xl shadow-lg p-2 flex gap-1 min-w-[260px]">
              <input
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyLink(); } if (e.key === 'Escape') setLinkOpen(false); }}
                placeholder="https://…"
                autoFocus
                className="flex-1 px-2 py-1 text-sm rounded-lg border border-charcoal/15 focus:outline-none focus:border-pink/50"
              />
              <button onClick={applyLink} className="px-3 py-1 rounded-lg bg-pink text-white text-sm font-semibold">確定</button>
            </div>
          )}
        </div>

        {/* Image (paste URL) */}
        <div className="relative">
          <Btn active={imageOpen} onClick={() => { setImageOpen((v) => !v); setImageUrl(''); }} title="插入圖片(URL)">
            <ImageIcon size={15} />
          </Btn>
          {imageOpen && (
            <div className="absolute top-full left-0 mt-1 z-30 bg-white border border-charcoal/15 rounded-xl shadow-lg p-2 flex gap-1 min-w-[300px]">
              <input
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyImage(); } if (e.key === 'Escape') setImageOpen(false); }}
                placeholder="貼圖片 URL (Cloudinary 等)"
                autoFocus
                className="flex-1 px-2 py-1 text-sm rounded-lg border border-charcoal/15 focus:outline-none focus:border-pink/50 font-mono"
              />
              <button onClick={applyImage} className="px-3 py-1 rounded-lg bg-pink text-white text-sm font-semibold">插入</button>
            </div>
          )}
        </div>
        <Sep />

        {/* Table */}
        <Btn
          active={inTable}
          onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
          title="插入表格 (3×3,有標題行)"
        >
          <Table2 size={15} />
        </Btn>
        {inTable && (
          <>
            <TxtBtn onClick={() => editor.chain().focus().addRowAfter().run()} title="喺下面加一行">+行</TxtBtn>
            <TxtBtn onClick={() => editor.chain().focus().deleteRow().run()} title="刪除呢一行">−行</TxtBtn>
            <TxtBtn onClick={() => editor.chain().focus().addColumnAfter().run()} title="喺右邊加一欄">+欄</TxtBtn>
            <TxtBtn onClick={() => editor.chain().focus().deleteColumn().run()} title="刪除呢一欄">−欄</TxtBtn>
            <TxtBtn onClick={() => editor.chain().focus().toggleHeaderRow().run()} title="切換第一行做標題行">標題行</TxtBtn>
            <Btn onClick={() => editor.chain().focus().deleteTable().run()} title="刪除整個表格"><Trash2 size={15} /></Btn>
          </>
        )}
        <Sep />

        {/* Clear formatting */}
        <Btn onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} title="清除所有格式">
          <Eraser size={15} />
        </Btn>

        {/* Import — pushed to the right */}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { setImportOpen(true); setImportText(''); setCaptured(null); }}
          className="ml-auto flex items-center gap-1.5 px-3 h-8 rounded-pill bg-pink text-white text-xs font-semibold hover:bg-pink/90 shadow-sm"
          title="一次過貼入整篇文章(網頁 / AI 工具 / Word / Markdown),保留標題、清單、表格"
        >
          <ClipboardPaste size={14} /> 匯入文章
        </button>
      </div>

      {/* Editor area */}
      <EditorContent
        editor={editor}
        style={{ minHeight }}
        // Empty-state placeholder via CSS on the first paragraph
        data-placeholder={placeholder || ''}
      />

      {/* Import modal */}
      {importOpen && (
        <div className="fixed inset-0 z-[60] bg-ink/40 backdrop-blur-sm flex items-center justify-center p-4" onMouseDown={() => setImportOpen(false)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-charcoal/10">
              <div>
                <h3 className="font-bold text-lg flex items-center gap-2"><ClipboardPaste size={18} className="text-pink" /> 匯入文章</h3>
                <p className="text-xs text-ink-soft mt-0.5">由網頁 / AI 寫作工具 / Google Docs / Word 直接 Cmd+V 貼落下面,或者貼 Markdown。標題、清單、表格、連結會自動保留。</p>
              </div>
              <button type="button" onClick={() => setImportOpen(false)} className="w-9 h-9 rounded-full hover:bg-charcoal/5 flex items-center justify-center"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-3 overflow-y-auto">
              <textarea
                value={importText}
                autoFocus
                onChange={(e) => setImportText(e.target.value)}
                onPaste={(e) => {
                  const html = e.clipboardData.getData('text/html');
                  const text = e.clipboardData.getData('text/plain');
                  if (html && /<(h[1-6]|ul|ol|table|p|div|li|blockquote|img)\b/i.test(html)) {
                    e.preventDefault();
                    const cleaned = cleanPastedHtml(html);
                    setImportText(text);
                    setCaptured({ text, html: cleaned });
                  } else {
                    setCaptured(null);
                  }
                }}
                placeholder={'喺度 Cmd+V 貼上整篇文章…\n\n支援:\n• 由網頁 / AI 工具 copy 嘅內容(連表格)\n• Markdown(## 標題、- 清單、| 表格 |)\n• 純文字(每行變一段)'}
                className="w-full h-56 px-4 py-3 rounded-2xl border border-charcoal/15 focus:outline-none focus:border-pink/50 text-sm font-mono resize-y"
              />
              {previewHtml && (
                <>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-ink-soft">
                      {captured && captured.text === importText
                        ? <span className="text-green-600 font-semibold">✓ 已擷取網頁格式</span>
                        : looksLikeMarkdown(importText) ? <span className="text-pink font-semibold">✓ 偵測到 Markdown</span> : <span>純文字,每行一段</span>}
                      {summarise(previewHtml) && <span className="ml-2">— {summarise(previewHtml)}</span>}
                    </span>
                    <span className="text-ink-soft/60">預覽 ↓</span>
                  </div>
                  <div
                    className="article-prose prose prose-sm max-w-none rounded-2xl border border-charcoal/10 bg-cream/30 px-5 py-4 max-h-64 overflow-y-auto prose-headings:font-display prose-a:text-pink"
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                </>
              )}
            </div>
            <div className="px-6 py-4 border-t border-charcoal/10 flex flex-wrap items-center justify-end gap-2 bg-cream/20">
              <button type="button" onClick={() => setImportOpen(false)} className="px-4 py-2 rounded-pill text-sm text-ink-soft hover:bg-charcoal/5">取消</button>
              <button
                type="button"
                disabled={!previewHtml}
                onClick={() => runImport('append')}
                className="px-4 py-2 rounded-pill text-sm font-semibold border border-pink text-pink hover:bg-pink/5 disabled:opacity-40"
              >
                加到文章最尾
              </button>
              <button
                type="button"
                disabled={!previewHtml}
                onClick={() => {
                  if (editor.getText().trim() && !window.confirm('會取代編輯器入面全部現有內容,確定?')) return;
                  runImport('replace');
                }}
                className="px-4 py-2 rounded-pill text-sm font-semibold bg-pink text-white hover:bg-pink/90 disabled:opacity-40"
              >
                取代全部內容
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Btn({
  active, onClick, disabled, title, children,
}: {
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}   // keep editor focus
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`w-8 h-8 rounded-lg flex items-center justify-center transition disabled:opacity-30 disabled:cursor-not-allowed ${
        active ? 'bg-pink/20 text-pink' : 'hover:bg-white text-ink-soft hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

function TxtBtn({ onClick, title, children }: { onClick: () => void; title?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title}
      className="h-8 px-2 rounded-lg text-xs font-semibold text-ink-soft hover:bg-white hover:text-ink transition whitespace-nowrap"
    >
      {children}
    </button>
  );
}

function Sep() {
  return <div className="w-px h-6 bg-charcoal/15 mx-0.5" />;
}

/** Unused — placeholder for unused Editor type warning suppression. */
export type _RichEditorRef = Editor;
