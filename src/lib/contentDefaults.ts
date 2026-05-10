/**
 * Default text content for the public site, sourced from i18n message files.
 * Used by the admin /content text editor to pre-fill the form so admins
 * can see exactly what's currently rendered on the live site.
 *
 * Each entry maps a (pageId, fieldKey) combo to the bilingual default text,
 * pulled from src/i18n/messages/{zh,en}.json paths.
 */
import zhMessages from '@/i18n/messages/zh.json';
import enMessages from '@/i18n/messages/en.json';
import { GUIDELINES_DEFAULTS } from './guidelinesDefaults';

type Bilingual = { zh: string; en: string };

/** Look up a dot-notation path in a JSON object (e.g. 'hero.title'). */
function pick(messages: Record<string, unknown>, path: string): string {
  const parts = path.split('.');
  let cur: unknown = messages;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return '';
    }
  }
  return typeof cur === 'string' ? cur : '';
}

function bothLocales(path: string): Bilingual {
  return {
    zh: pick(zhMessages as Record<string, unknown>, path),
    en: pick(enMessages as Record<string, unknown>, path),
  };
}

/**
 * Map of pageId → fieldKey → default bilingual text.
 * Keys MUST match the textPages config in
 * src/app/[locale]/admin/content/page.tsx.
 */
export const CONTENT_DEFAULTS: Record<string, Record<string, Bilingual>> = {
  homepage: {
    hero_title:           bothLocales('hero.title'),
    hero_subtitle:        bothLocales('hero.subtitle'),
    hero_cta:             bothLocales('hero.cta'),
    marquee_text:         bothLocales('marquee.text'),
    collection_title:     bothLocales('collection.title'),
    collection_subtitle:  bothLocales('collection.subtitle'),
    amenities_title:      bothLocales('amenities.title'),
    amenities_subtitle:   bothLocales('amenities.subtitle'),
    branches_title:       bothLocales('branches.title'),
    branches_subtitle:    bothLocales('branches.subtitle'),
  },
  corporate: {
    title:     bothLocales('corporate.title'),
    subtitle:  bothLocales('corporate.subtitle'),
    hero_text: bothLocales('corporate.hero'),
    cta:       bothLocales('corporate.cta'),
  },
  family: {
    title:     bothLocales('family.title'),
    subtitle:  bothLocales('family.subtitle'),
    hero_text: bothLocales('family.hero'),
    cta:       bothLocales('family.cta'),
  },
  guidelines: GUIDELINES_DEFAULTS,
  branches: {
    // ─── 銅鑼灣店 ───
    cwb_name:        { zh: '銅鑼灣店', en: 'Causeway Bay' },
    cwb_size:        { zh: '2,800 sq ft', en: '2,800 sq ft' },
    cwb_description: { zh: '位於銅鑼灣核心地段的旗艦空間，配備頂級音響及設計師家具。', en: 'Flagship venue in the heart of Causeway Bay with premium sound and designer furniture.' },
    cwb_amenities:   { zh: '戶外 BBQ、火鍋、麻將', en: 'Outdoor BBQ, Hotpot, Mahjong' },
    // ─── 灣仔店 ───
    wc_name:         { zh: '灣仔店', en: 'Wan Chai' },
    wc_size:         { zh: '1,200 sq ft', en: '1,200 sq ft' },
    wc_description:  { zh: '灣仔專業商務空間，配備專業投影設備。', en: 'Professional business space in Wan Chai with AV equipment.' },
    wc_amenities:    { zh: '麻將', en: 'Mahjong' },
    // ─── 上環海景旗艦店 - Room A ───
    swa_name:        { zh: '上環海景旗艦店 - Room A', en: 'Sheung Wan - Room A' },
    swa_size:        { zh: '1,000 sq ft', en: '1,000 sq ft' },
    swa_description: { zh: '上環海景旗艦店 Room A，設有戶外 BBQ 區域。', en: 'Tranquil Room A with outdoor BBQ.' },
    swa_amenities:   { zh: '戶外 BBQ、麻將', en: 'Outdoor BBQ, Mahjong' },
    // ─── 上環海景旗艦店 - Room B ───
    swb_name:        { zh: '上環海景旗艦店 - Room B', en: 'Sheung Wan - Room B' },
    swb_size:        { zh: '2,200 sq ft', en: '2,200 sq ft' },
    swb_description: { zh: '上環海景旗艦店 Room B 設有獨立專業廚房、桌球枱及打邊爐設備。', en: 'Room B with private kitchen, pool table and hotpot facilities.' },
    swb_amenities:   { zh: '戶外 BBQ、桌球、火鍋、麻將、獨立廚房', en: 'Outdoor BBQ, Pool Table, Hotpot, Mahjong, Private Kitchen' },
    // ─── 尖沙咀店 ───
    tst_name:        { zh: '尖沙咀店', en: 'Tsim Sha Tsui' },
    tst_size:        { zh: '2,500 sq ft', en: '2,500 sq ft' },
    tst_description: { zh: '尖沙咀獨特空間，已包無酒精飲品任飲。', en: 'Unique TST space with complimentary non-alcoholic drinks.' },
    tst_amenities:   { zh: '戶外 BBQ、桌球、麻將', en: 'Outdoor BBQ, Pool Table, Mahjong' },
    // ─── 上環海景旗艦店 - 全層 A+B ───
    swab_name:       { zh: '上環海景旗艦店 - 全層 A+B', en: 'Sheung Wan - Full Floor (A+B)' },
    swab_size:       { zh: '3,200 sq ft', en: '3,200 sq ft' },
    swab_description:{ zh: '上環全層包場，合併 Room A 及 B，最多容納 100 人。', en: 'Full floor combining Room A & B, up to 100 guests.' },
    swab_amenities:  { zh: '戶外 BBQ、桌球、火鍋、麻將、獨立廚房', en: 'Outdoor BBQ, Pool Table, Hotpot, Mahjong, Private Kitchen' },
  },
};

/** Fetch the default bilingual text for a (pageId, fieldKey) pair. */
export function getDefault(pageId: string, fieldKey: string): Bilingual | null {
  return CONTENT_DEFAULTS[pageId]?.[fieldKey] ?? null;
}
