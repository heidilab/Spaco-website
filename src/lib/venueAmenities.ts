/**
 * Amenity list shown on branch pages.
 *
 * 分店管理 offers two inputs per space: the default checkbox set
 * (`amenities` ids → amenityLabels) and a free-text 設施文字列表
 * (`amenitiesText`, one per line / 、 / comma). The pages used to show the
 * text list INSTEAD of the ticked boxes whenever it was non-empty, so a
 * space with 麻將 + 火鍋 ticked and "Poker / 音響" typed lost 麻將 and 火鍋
 * (Heidi 2026-10-24). Both now show, ticked first, duplicates removed.
 */
import type { Venue } from '@/types';
import { amenityLabels } from './venues';

type AmenitySource = Pick<Venue, 'amenities'> & { amenitiesText?: Venue['amenitiesText'] };

export function splitAmenityText(raw?: string): string[] {
  return (raw || '').split(/[、,，\n]/).map((s) => s.trim()).filter(Boolean);
}

export function venueAmenityItems(v: AmenitySource, locale: 'zh' | 'en'): string[] {
  const ticked = (v.amenities || []).map((a) => amenityLabels[a]?.[locale] || a);
  // Free text falls back to the zh list so an en page still shows what
  // the admin typed when only the zh box was filled.
  const typed = splitAmenityText(v.amenitiesText?.[locale] || v.amenitiesText?.zh);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of [...ticked, ...typed]) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
