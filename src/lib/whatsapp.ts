/**
 * WhatsApp / HK phone number helpers.
 * Validation accepts:
 *  - 8 local digits (e.g. "92823060")
 *  - "+852 9282 3060" with optional spaces or dashes
 *  - "85292823060" (with country code, no plus)
 *  - "+85292823060"
 *
 * Stored canonical form: '+852XXXXXXXX' (E.164).
 */

/** Strip everything except digits, return canonicalised E.164 with +852. */
export function normalizeHkPhone(input: string): string {
  if (!input) return '';
  const digits = input.replace(/\D/g, '');
  if (digits.length === 8) return `+852${digits}`;
  if (digits.length === 11 && digits.startsWith('852')) return `+${digits}`;
  if (digits.length === 12 && digits.startsWith('00852')) return `+${digits.slice(2)}`;
  return ''; // invalid
}

/** True if the input parses to a valid HK 8-digit number. */
export function isValidHkPhone(input: string): boolean {
  return normalizeHkPhone(input) !== '';
}

/** Pretty-format for display: "+852 9282 3060" */
export function formatHkPhone(input: string): string {
  const e164 = normalizeHkPhone(input);
  if (!e164) return input;
  const local = e164.replace('+852', '');
  return `+852 ${local.slice(0, 4)} ${local.slice(4)}`;
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
