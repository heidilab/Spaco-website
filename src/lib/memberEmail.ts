/**
 * Normalise an email address typed by staff when correcting a member's
 * profile (會員管理 → 電郵). Trims, lower-cases and applies a deliberately
 * simple shape check — one `@`, a non-empty local part, and a domain with
 * at least one dot and a 2+ letter TLD. Returns null when the input is not
 * a usable address so the caller can show a validation message instead of
 * writing junk into `users/{uid}.email` (which every customer email is
 * addressed to at send time).
 */
export function normalizeMemberEmail(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const value = input.trim().toLowerCase();
  if (!value || value.length > 254) return null;
  const at = value.indexOf('@');
  if (at <= 0 || at !== value.lastIndexOf('@')) return null;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (/\s/.test(value)) return null;
  if (local.length > 64) return null;
  const labels = domain.split('.');
  if (labels.length < 2) return null;
  if (labels.some((l) => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(l))) return null;
  if (!/^[a-z]{2,}$/.test(labels[labels.length - 1])) return null;
  return value;
}
