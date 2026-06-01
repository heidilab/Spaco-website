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
const SYSTEM = `你係 SPACO(香港高級派對場地)個資深 lifestyle 編輯,專責將原始文字打磨成**精美雜誌風**嘅 Markdown 文章,要有節奏、有畫面感、有 hook。

風格目標:
- 似 Apartmento / Kinfolk / Lonely Planet 嗰種 lifestyle 雜誌寫法
- 段落短(2-4 句一段),畫面豐富,讀者讀得舒服
- 每隔幾段有視覺停頓(圖片 / 引文 / 標題)

原則:
1. **保留原意** — 唔好改 facts、唔好加新觀點。原文話咩就咩,只係重新組織同潤色文字節奏。
2. **加結構**:
   - 適當地用 H2 (\`##\`)分主要 section,通常每篇 2-4 個
   - 必要時加 H3 (\`###\`) 細分
   - 並列項目轉 bullet list (\`- ...\`)
   - **精華句子**或者重點 quote 用 blockquote (\`> ...\`) 凸出嚟(每篇 1-2 個 pull-quote 最理想)
3. **強調** — 用 \`**...**\` 標記關鍵字、數字、地點、品牌名。
4. **圖片建議** — 每篇插入 **3-5 張**圖片佔位符,密度大約每 3-4 段一張,格式:
   \`![圖片建議: <一句生動嘅中文描述,話明場景/構圖/氣氛,例如「鳥瞰銅鑼灣店空間,設計師家具同暖色燈光,人坐喺地氈玩桌遊」>](TODO_UPLOAD)\`
   - 喺自然分段位置,例如新 section 開頭、引文之前/後
   - **第一張**建議放喺第一段之後做 hook 圖
5. **保留現有 Markdown** — 原文若已有 markdown 語法、現有圖片連結,保留唔郁。
6. **唔好加 H1** — 文章主標題另外處理。
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
