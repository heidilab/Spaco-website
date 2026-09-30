import { describe, it, expect } from 'vitest';
import { looksLikeMarkdown, markdownToHtml, plainTextToHtml, textToHtml } from './pasteContent';

describe('pasteContent', () => {
  it('detects markdown incl. GFM tables and numbered lists', () => {
    expect(looksLikeMarkdown('## 標題\n內容')).toBe(true);
    expect(looksLikeMarkdown('| a | b |\n|---|---|\n| 1 | 2 |')).toBe(true);
    expect(looksLikeMarkdown('1. 第一\n2. 第二')).toBe(true);
    expect(looksLikeMarkdown('純文字一段。')).toBe(false);
    expect(looksLikeMarkdown('<p>已經係 HTML</p>')).toBe(false);
  });

  it('converts a markdown table into a real <table>', () => {
    const html = markdownToHtml('| 比較項目 | 傳統麻雀館 |\n|---|---|\n| 私隱度 | 低 |');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>比較項目</th>');
    expect(html).toContain('<td>低</td>');
  });

  it('turns • bullets into <ul>', () => {
    const html = markdownToHtml('• 打完麻雀轉場BBQ\n• 打波子桌球');
    expect(html).toContain('<ul>');
    expect((html.match(/<li>/g) || []).length).toBe(2);
  });

  it('plain text → one <p> per line, escaped', () => {
    expect(plainTextToHtml('a\n\nb <c>')).toBe('<p>a</p><p>b &lt;c&gt;</p>');
  });

  it('textToHtml routes html / markdown / plain', () => {
    expect(textToHtml('<h2>x</h2>')).toBe('<h2>x</h2>');
    expect(textToHtml('## x')).toContain('<h2');
    expect(textToHtml('x')).toBe('<p>x</p>');
  });
});
