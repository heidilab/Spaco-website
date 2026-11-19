/** Minimal member shape shared by /admin/members and the booking-page
 *  "連結會員帳號" tool. */
export type MemberHit = {
  uid: string;
  displayName?: string;
  email?: string;
  phone?: string;
  whatsappPhone?: string;
};

/**
 * Same matcher as /admin/members: name / email substring, phone by
 * consecutive digits (so the middle 4 digits still hit a stored
 * "+852 9xxx xxxx"). Empty search → no hits, never the whole list.
 */
export function matchMembers<T extends MemberHit>(list: T[], search: string, limit = 8): T[] {
  const s = search.trim().toLowerCase();
  if (!s) return [];
  const sDigits = s.replace(/\D/g, '');
  const out: T[] = [];
  for (const m of list) {
    let hit = false;
    if ((m.displayName || '').toLowerCase().includes(s)) hit = true;
    else if ((m.email || '').toLowerCase().includes(s)) hit = true;
    else if (sDigits.length >= 3) {
      const phones = [m.phone, m.whatsappPhone].filter(Boolean).map((p) => String(p).replace(/\D/g, ''));
      if (phones.some((p) => p.includes(sDigits))) hit = true;
    }
    if (hit) {
      out.push(m);
      if (out.length >= limit) break;
    }
  }
  return out;
}
