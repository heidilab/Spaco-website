import { NextRequest, NextResponse } from 'next/server';

// Translation API. Tries providers in order:
//   1. Claude Haiku (highest quality, needs ANTHROPIC_API_KEY)
//   2. MyMemory free API (no key needed, ~5000 chars/day/IP)
// On failure: returns 503 — caller surfaces an error to the user instead
// of silently writing garbage / Chinese text into the EN field.

export async function POST(request: NextRequest) {
  try {
    const { text, from, to } = await request.json();
    if (!text || !from || !to) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    const claude = await translateWithClaude(text, from, to);
    if (claude) return NextResponse.json({ translated: claude, source: 'claude' });

    const mm = await translateWithMyMemory(text, from, to);
    if (mm) return NextResponse.json({ translated: mm, source: 'mymemory' });

    return NextResponse.json(
      { error: 'All translation providers failed' },
      { status: 503 },
    );
  } catch (err) {
    console.error('[translate] error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Translation failed' },
      { status: 500 },
    );
  }
}

const LANG_NAMES: Record<string, string> = {
  zh: 'Traditional Chinese (Hong Kong colloquial usage where appropriate)',
  en: 'English',
};

async function translateWithClaude(
  text: string, from: string, to: string,
): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const fromLang = LANG_NAMES[from] || from;
  const toLang = LANG_NAMES[to] || to;
  const prompt =
    `Translate the following ${fromLang} text to ${toLang}. ` +
    `Output ONLY the translated text — no commentary, no quotes, no prefix, no labels. ` +
    `Preserve numbers, units (sq ft, 呎, 人, hours, $), punctuation, and line breaks.\n\n` +
    text;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) {
      console.warn('[translate:claude] HTTP', res.status, await res.text());
      return null;
    }
    const data = await res.json();
    const out = data?.content?.[0]?.text;
    return typeof out === 'string' && out.trim() ? out.trim() : null;
  } catch (err) {
    console.warn('[translate:claude] failed:', err);
    return null;
  }
}

async function translateWithMyMemory(
  text: string, from: string, to: string,
): Promise<string | null> {
  // MyMemory expects locale codes; HK Chinese maps best to zh-TW.
  const code = (lang: string) => (lang === 'zh' ? 'zh-TW' : lang);
  const url =
    `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}` +
    `&langpair=${code(from)}|${code(to)}&de=admin@spacohk.com`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const translated = data?.responseData?.translatedText;
    if (typeof translated !== 'string' || !translated.trim()) return null;
    // MyMemory occasionally echoes the source on quota / unsupported pair —
    // detect that case and treat as failure so we don't write zh into the EN field.
    if (translated.trim() === text.trim()) return null;
    return translated;
  } catch (err) {
    console.warn('[translate:mymemory] failed:', err);
    return null;
  }
}
