import { NextRequest, NextResponse } from 'next/server';
import { adminStorage } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
// DALL-E can take 20+ seconds; bump the function timeout.
export const maxDuration = 60;

/**
 * POST /api/admin/article-generate-image
 *   { prompt: string; size?: '1024x1024' | '1792x1024' | '1024x1792' }
 *
 * Calls OpenAI DALL-E 3 to generate an image from the prompt, downloads
 * the result, uploads to Firebase Storage at articles/inline/<ts>.png,
 * returns the public URL.
 *
 * SPACO brand context is auto-appended to the prompt so generated images
 * stay on-brand (warm, modern lifestyle photography).
 */

const SPACO_STYLE_SUFFIX =
  ' — warm modern lifestyle photography, soft natural lighting, '
  + 'cozy interior aesthetic. Setting: a premium Hong Kong '
  + 'multifunctional event space (SPACO). High-quality, magazine-style.';

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY not configured. Add it to Vercel env vars (Production + Preview).' },
        { status: 500 },
      );
    }

    const { prompt, size = '1792x1024' } = (await req.json()) as {
      prompt?: string;
      size?: '1024x1024' | '1792x1024' | '1024x1792';
    };
    if (!prompt?.trim()) {
      return NextResponse.json({ error: 'prompt required' }, { status: 400 });
    }

    // 1. Call DALL-E 3
    const dalleRes = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: prompt + SPACO_STYLE_SUFFIX,
        n: 1,
        size,
        quality: 'standard',
        response_format: 'url',
      }),
    });

    if (!dalleRes.ok) {
      const errText = await dalleRes.text().catch(() => '');
      return NextResponse.json(
        { error: `DALL-E ${dalleRes.status}: ${errText.slice(0, 300)}` },
        { status: 500 },
      );
    }
    const dalleData = (await dalleRes.json()) as {
      data?: Array<{ url?: string; revised_prompt?: string }>;
    };
    const tempUrl = dalleData.data?.[0]?.url;
    if (!tempUrl) {
      return NextResponse.json({ error: 'DALL-E returned no image URL' }, { status: 500 });
    }

    // 2. Download the image bytes (DALL-E URL expires in ~1hr).
    const imgRes = await fetch(tempUrl);
    if (!imgRes.ok) {
      return NextResponse.json({ error: `Image download failed: ${imgRes.status}` }, { status: 500 });
    }
    const arrayBuffer = await imgRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 3. Upload to Firebase Storage at articles/inline/<ts>.png
    const filename = `articles/inline/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const file = adminStorage.file(filename);
    await file.save(buffer, {
      contentType: 'image/png',
      public: true,
      metadata: {
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });

    // 4. Public URL — bucket files saved with `public: true` are accessible
    //    at https://storage.googleapis.com/<bucket>/<path>
    const publicUrl = `https://storage.googleapis.com/${file.bucket.name}/${encodeURIComponent(filename)}`;

    return NextResponse.json({
      url: publicUrl,
      revisedPrompt: dalleData.data?.[0]?.revised_prompt,
      size,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'image generation failed' },
      { status: 500 },
    );
  }
}
