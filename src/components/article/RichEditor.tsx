'use client';

// WYSIWYG rich-text editor for article authoring. Outputs HTML; admin
// gets a toolbar with font size + colour + headings + lists + alignment
// + image + link — the controls Heidi asked for ("揀埋字型大小顏色").

import { useEditor, EditorContent, Editor, Extension } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import TextAlign from '@tiptap/extension-text-align';
import Underline from '@tiptap/extension-underline';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, Heading1, Heading2, Heading3,
  List, ListOrdered, Quote, Link2, Image as ImageIcon, Code,
  AlignLeft, AlignCenter, AlignRight, Undo, Redo, Palette, Eraser, Type,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

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

        {/* Clear formatting */}
        <Btn onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} title="清除所有格式">
          <Eraser size={15} />
        </Btn>
      </div>

      {/* Editor area */}
      <EditorContent
        editor={editor}
        style={{ minHeight }}
        // Empty-state placeholder via CSS on the first paragraph
        data-placeholder={placeholder || ''}
      />
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

function Sep() {
  return <div className="w-px h-6 bg-charcoal/15 mx-0.5" />;
}

/** Unused — placeholder for unused Editor type warning suppression. */
export type _RichEditorRef = Editor;
