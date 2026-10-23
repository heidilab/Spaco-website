/**
 * Google Calendar id as the API wants it (`…@group.calendar.google.com`
 * or a Gmail address). 分店管理 →「連接設定」 asks for the id, but the
 * natural thing to paste from Google Calendar's settings page is the
 * embed URL or the "public URL" — HART's three rooms were saved as
 * `https://calendar.google.com/calendar/embed?src=…%40group.calendar.google.com&ctz=…`
 * and the sync logged "Not Found" (2026-10-24). Accept all of those and
 * reduce them to the bare id; anything unrecognised is returned trimmed.
 */
export function normalizeGcalCalendarId(input: string | null | undefined): string | null {
  const raw = (input || '').trim();
  if (!raw) return null;
  let value = raw;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      // embed?src=… / cid=… (the "Add to calendar" link) / ical path
      value = url.searchParams.get('src')
        || url.searchParams.get('cid')
        || decodeURIComponent(url.pathname).match(/\/ical\/([^/]+)\//)?.[1]
        || raw;
    } catch { value = raw; }
  }
  try { value = decodeURIComponent(value); } catch { /* keep as is */ }
  return value.trim() || null;
}
