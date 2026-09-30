// Pure helpers for turning pasted / imported article text into HTML the
// TipTap editor can load. No DOM, no firebase — unit-tested in vitest
// (node env). The browser-only HTML cleaner lives in RichEditor.tsx.

import { marked } from 'marked';

/** Content is markdown when there's no HTML tag but classic markers exist
 *  (headings, bullets, numbered lists, quotes, bold, images, GFM tables). */
export function looksLikeMarkdown(s: string): boolean {
  if (!s) return false;
  if (/<\w+[^>]*>/.test(s)) return false;           // any HTML tag → already HTML
  return /(^|\n)#{1,6}\s|^\s*[-*•]\s|^\s*\d+[.)]\s|^>\s|\*\*[^*]+\*\*|!\[[^\]]*\]\(|^\s*\|.+\|\s*$/m.test(s);
}

/** Markdown → HTML (GFM on, so `| a | b |` tables become <table>). */
export function markdownToHtml(md: string): string {
  if (!md.trim()) return '';
  // AI tools often emit "•" bullets instead of "-" — normalise so they
  // become real <ul> items rather than literal dots.
  const normalised = md.replace(/^(\s*)•\s+/gm, '$1- ');
  return marked.parse(normalised, { gfm: true, breaks: false, async: false }) as string;
}

/** Plain prose (no markdown markers): blank line = new paragraph, single
 *  newline = new paragraph too (Chinese copy rarely relies on soft wraps). */
export function plainTextToHtml(text: string): string {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => `<p>${esc(l)}</p>`)
    .join('');
}

/** Best-effort conversion of whatever text was pasted into a textarea. */
export function textToHtml(text: string): string {
  if (!text.trim()) return '';
  if (/<\w+[^>]*>/.test(text)) return text;           // raw HTML pasted as text
  if (looksLikeMarkdown(text)) return markdownToHtml(text);
  return plainTextToHtml(text);
}
