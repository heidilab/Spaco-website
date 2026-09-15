/**
 * WhatsApp phone helpers — HK-first but INTERNATIONAL-friendly
 * (Heidi 2026-09-15: many customers are overseas; the old HK-only
 * validation blocked them at the confirm step).
 *
 * Accepted input:
 *  - HK local: 8 digits ("92823060") → +852XXXXXXXX
 *  - HK with country code: "852…", "+852…", "00852…"
 *  - INTERNATIONAL: must start with "+" (or "00") followed by country
 *    code + number, 8–15 digits total (E.164 length rule)
 *
 * Stored canonical form: E.164 ("+<digits>").
 */

/** Canonicalise to E.164. Returns '' when invalid. */
export function normalizeHkPhone(input: string): string {
  if (!input) return '';
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, '');
  const explicitIntl = trimmed.startsWith('+') || digits.startsWith('00');
  // HK conveniences first (no + needed for local numbers)
  if (!explicitIntl && digits.length === 8) return `+852${digits}`;
  if (digits.length === 11 && digits.startsWith('852')) return `+${digits}`;
  if (digits.length === 13 && digits.startsWith('00852')) return `+${digits.slice(2)}`;
  // International: needs an explicit "+" or "00" prefix so we never
  // misread a foreign local number as some other country's.
  if (explicitIntl) {
    const intl = digits.startsWith('00') ? digits.slice(2) : digits;
    // E.164: max 15 digits; require ≥8 so bare junk doesn't pass.
    if (intl.length >= 8 && intl.length <= 15 && !intl.startsWith('0')) return `+${intl}`;
  }
  return ''; // invalid
}

/** True if the input parses to a valid HK or international number. */
export function isValidHkPhone(input: string): boolean {
  return normalizeHkPhone(input) !== '';
}

/** Pretty-format for display. HK: "+852 9282 3060"; others: E.164 as-is. */
export function formatHkPhone(input: string): string {
  const e164 = normalizeHkPhone(input);
  if (!e164) return input;
  if (e164.startsWith('+852') && e164.length === 12) {
    const local = e164.replace('+852', '');
    return `+852 ${local.slice(0, 4)} ${local.slice(4)}`;
  }
  return e164;
}

/** Build a wa.me deep-link with optional pre-filled message. */
export function buildWhatsAppLink(phone: string, message = ''): string {
  const e164 = normalizeHkPhone(phone) || phone;
  // wa.me wants digits only, no +
  const digits = e164.replace(/\D/g, '');
  const base = `https://wa.me/${digits}`;
  if (!message) return base;
  return `${base}?text=${encodeURIComponent(message)}`;
}
