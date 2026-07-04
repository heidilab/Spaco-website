import { NextRequest, NextResponse } from 'next/server';
import { callClaude } from '@/lib/llm';

export const runtime = 'nodejs';

/**
 * POST /api/admin/article-translate
 *   { title: string; excerpt?: string; content: string }   // all Chinese
 *
 * Translates a zh article (title + excerpt + Markdown body) into English.
 * Preserves Markdown structure exactly (headings, lists, image tags,
 * blockquotes). Returns { title, excerpt, content } in English.
 */
const SYSTEM = `You are SPACO's bilingual content translator. SPACO is a premium self-service multifunctional event-space brand in Hong Kong (4 branches: Causeway Bay, Wan Chai, Sheung Wan, Tsim Sha Tsui).

Translation rules:
1. **Preserve Markdown structure 1:1** — heading levels, bullets, blockquotes, image tags \`![alt](url)\`, bold/italic markers all stay in the same places.
2. **Tone** — warm, professional, modern lifestyle brand voice. Casual but not slangy.
3. **Place names** — use the standard English forms: Causeway Bay, Wan Chai, Sheung Wan, Tsim Sha Tsui. Use SPACO brand names verbatim.
4. **Numbers / pricing** — keep numerals and HK$ formatting.
5. **Image hint placeholders** — if you see \`![圖片建議: ...](TODO_UPLOAD)\`, translate the hint into English: \`![Image suggestion: ...](TODO_UPLOAD)\`.
6. **Output format** — return a single JSON object with keys "title", "excerpt", "content". No prose, no code fences, just the JSON.`;

interface TranslateResult {
  title: string;
  excerpt: string;
  content: string;
}

export async function POST(req: NextRequest) {
  try {
    const { title, excerpt, content } = (await req.json()) as {
      title?: string; excerpt?: string; content?: string;
    };
    if (!title?.trim() && !content?.trim()) {
      return NextResponse.json({ error: 'title or content required' }, { status: 400 });
    }

    const payload = {
      title: title || '',
      excerpt: excerpt || '',
      content: content || '',
    };

    const prompt = [
      'Translate the following Chinese article fields to English.',
      'Input (JSON):',
      JSON.stringify(payload, null, 2),
      '',
      'Output (JSON only, no prose, no code fence):',
    ].join('\n');

    const raw = await callClaude({
      system: SYSTEM,
      prompt,
      maxTokens: 4096,
      temperature: 0.3,
    });

    // Tolerant JSON parsing — strip code fence if present.
    const jsonText = raw
      .replace(/^```(?:json)?\n?/i, '')
      .replace(/\n?```\s*$/, '')
      .trim();
    let parsed: TranslateResult;
    try {
      parsed = JSON.parse(jsonText) as TranslateResult;
    } catch {
      return NextResponse.json({
        error: 'LLM did not return valid JSON',
        raw: jsonText.slice(0, 500),
      }, { status: 500 });
    }

    return NextResponse.json({
      title: parsed.title || '',
      excerpt: parsed.excerpt || '',
      content: parsed.content || '',
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'translate failed' },
      { status: 500 },
    );
  }
}
