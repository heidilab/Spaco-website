/**
 * Display order for the spaces of a multi-space branch (上環模式):
 * individual rooms first (Room A, Room B…), the combined / full-floor
 * option last (Heidi 2026-10-24: 「Room A 之後 Room B 之後 Room A 加 B」).
 *
 * A space is "combined" when it blocks two or more sibling spaces
 * (`conflictsWith`, set in 分店管理) or its label says so (A+B / 全場 / 全層
 * / full floor). Within each group the admin `sortOrder` wins, then the
 * label, so 「Hart Room A」 precedes 「Hart Room B」 even with equal sortOrder.
 */
import type { Venue } from '@/types';

const COMBINED_LABEL = /\+|全場|全層|full\s*floor|combined|whole/i;

export function roomLabel(v: Venue, locale: 'zh' | 'en' = 'zh'): string {
  return (v.roomLabel?.[locale] || v.roomLabel?.zh || v.name[locale] || v.name.zh || '').trim();
}

export function isCombinedRoom(v: Venue): boolean {
  if ((v.conflictsWith?.length ?? 0) >= 2) return true;
  return COMBINED_LABEL.test(roomLabel(v)) || COMBINED_LABEL.test(v.name.zh || '') || COMBINED_LABEL.test(v.name.en || '');
}

export function orderRooms(rooms: Venue[]): Venue[] {
  const byLabel = (a: Venue, b: Venue) =>
    (a.sortOrder ?? 99) - (b.sortOrder ?? 99)
    || roomLabel(a).localeCompare(roomLabel(b), undefined, { numeric: true, sensitivity: 'base' })
    || a.id.localeCompare(b.id);
  const singles = rooms.filter((r) => !isCombinedRoom(r)).sort(byLabel);
  const combined = rooms.filter(isCombinedRoom).sort((a, b) => a.capacity.max - b.capacity.max || byLabel(a, b));
  return [...singles, ...combined];
}

/** "A", "B", … for individual rooms; "A+B" style for the combined option. */
export function optionLetter(rooms: Venue[], idx: number): string {
  const singles = rooms.filter((r) => !isCombinedRoom(r));
  if (!isCombinedRoom(rooms[idx])) return String.fromCharCode(65 + idx);
  return singles.map((_, i) => String.fromCharCode(65 + i)).join('+') || String.fromCharCode(65 + idx);
}
