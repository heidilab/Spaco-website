/**
 * Minimal Anthropic Claude client. Uses raw fetch (no SDK dep) so this
 * stays a tiny zero-install helper. Reads ANTHROPIC_API_KEY from env;
 * throws if missing so calling endpoints can surface a clear error.
 */

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929';

export interface ClaudeMessageInput {
  system?: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
}

export async function callClaude(input: ClaudeMessageInput): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: input.maxTokens ?? 4096,
      temperature: input.temperature ?? 0.3,
      ...(input.system ? { system: input.system } : {}),
      messages: [{ role: 'user', content: input.prompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Claude API ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text = data.content
    ?.filter((b) => b.type === 'text')
    .map((b) => b.text || '')
    .join('\n')
    .trim();
  if (!text) throw new Error('Claude returned empty response');
  return text;
}

// ── Vision / document input (單據自動入帳) ───────────────────────────
//
// Same raw-fetch style as callClaude, with one image or PDF attached.
// Default model is the current Opus (receipt photos are often handwritten
// or crumpled — the cheaper tiers misread totals); RECEIPT_MODEL overrides.
// `fallbacks: "default"` lets the API re-run on another model if a safety
// classifier declines the request, so one odd photo never stalls the sync.

export interface ClaudeAttachment {
  kind: 'image' | 'pdf';
  /** image/jpeg, image/png, image/webp, image/gif or application/pdf */
  mediaType: string;
  base64: string;
}

export interface ClaudeAttachmentInput {
  system?: string;
  prompt: string;
  attachment: ClaudeAttachment;
  maxTokens?: number;
  model?: string;
}

export const RECEIPT_MODEL = process.env.RECEIPT_MODEL || 'claude-opus-5-5';

export async function callClaudeWithAttachment(input: ClaudeAttachmentInput): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const source = { type: 'base64', media_type: input.attachment.mediaType, data: input.attachment.base64 };
  const block = input.attachment.kind === 'pdf'
    ? { type: 'document', source }
    : { type: 'image', source };

  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: input.model || RECEIPT_MODEL,
      max_tokens: input.maxTokens ?? 2048,
      fallbacks: 'default',
      ...(input.system ? { system: input.system } : {}),
      messages: [{ role: 'user', content: [block, { type: 'text', text: input.prompt }] }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Claude API ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    stop_reason?: string;
    stop_details?: { category?: string | null; explanation?: string };
    content?: Array<{ type: string; text?: string }>;
  };
  if (data.stop_reason === 'refusal') {
    throw new Error(`Claude declined to read the file (${data.stop_details?.category || 'refusal'})`);
  }
  const text = data.content
    ?.filter((b) => b.type === 'text')
    .map((b) => b.text || '')
    .join('\n')
    .trim();
  if (!text) throw new Error('Claude returned empty response');
  return text;
}
