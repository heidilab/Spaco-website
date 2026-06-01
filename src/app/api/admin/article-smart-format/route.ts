import { NextRequest, NextResponse } from 'next/server';
import { callClaude } from '@/lib/llm';

export const runtime = 'nodejs';

/**
 * POST /api/admin/article-smart-format
 *   { content: string; title?: string }
 *
 * Takes admin's raw Markdown/plain text and returns a cleaner, well-
 * structured Markdown version: adds H2/H3 section breaks, converts
 * obvious lists, surfaces key sentences as blockquotes, and inserts
 * inline image hints `![圖片建議: 描述](TODO_UPLOAD)` at natural break
 * points so admin can upload images for those slots.
 */
const SYSTEM = `你係 SPACO(香港派對場地)個資深編輯,專責將原始文字整理成有清晰結構嘅 Markdown 文章。

原則:
1. **保留原意** — 唔好改寫意思,唔好加新觀點。只係重新組織同潤色語氣。
2. **加結構** — 適當地加 H2 (\`##\`) 同 H3 (\`###\`) 標題分段;將並列項目轉成 bullet list (\`- ...\`);將精華句子變成 blockquote (\`> ...\`)。
3. **粗體重點** — 用 \`**...**\` 標記關鍵字、數字、地點。
4. **圖片建議** — 喺自然分段處插入圖片佔位符,格式:\`![圖片建議: <一句中文描述應該放咩圖>](TODO_UPLOAD)\`。每篇大概 1-3 張,唔好太密。
5. **保留現有 Markdown** — 如果原文已經有 markdown 語法、現有圖片連結等,保留唔郁。
6. **唔好加 H1** — 文章標題另外處理。
7. **直接出 Markdown 結果**,唔好包 code block,唔好寫前言/說明/解釋。`;

export async function POST(req: NextRequest) {
  try {
    const { content, title } = (await req.json()) as { content?: string; title?: string };
    if (!content?.trim()) {
      return NextResponse.json({ error: 'content required' }, { status: 400 });
    }

    const prompt = [
      title ? `文章標題:${title}` : '',
      '原始內容:',
      '"""',
      content,
      '"""',
      '',
      '請輸出整理後嘅 Markdown(直接內容,唔好包 code fence):',
    ].filter(Boolean).join('\n');

    const formatted = await callClaude({
      system: SYSTEM,
      prompt,
      maxTokens: 4096,
      temperature: 0.4,
    });

    // Strip accidental code-fence wrapping if Claude includes it.
    const cleaned = formatted
      .replace(/^```(?:markdown|md)?\n?/i, '')
      .replace(/\n?```\s*$/, '')
      .trim();

    return NextResponse.json({ formatted: cleaned });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'smart-format failed' },
      { status: 500 },
    );
  }
}
