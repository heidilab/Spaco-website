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
