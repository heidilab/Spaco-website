// Calls /api/translate. Throws on failure so callers can show an error
// instead of silently writing the original Chinese (or a `[...]` prefix)
// into the EN field.

export async function translateZhToEn(text: string): Promise<string> {
  return translate(text, 'zh', 'en');
}

export async function translate(
  text: string, from: string, to: string,
): Promise<string> {
  const res = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, from, to }),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data?.error) msg = data.error;
    } catch {}
    throw new Error(msg);
  }
  const data = await res.json();
  if (!data?.translated || typeof data.translated !== 'string') {
    throw new Error('Empty translation');
  }
  return data.translated;
}
