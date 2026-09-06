// Marketing-channel options — admin-configurable (Heidi 2026-09).
//
// The options customers pick from at 確認預訂 used to be hardcoded in
// MARKETING_CHANNEL_LABELS. They now live in the CMS so Heidi can retune
// tracking without a deploy: 內容管理 → 系統設定 → 「來源渠道選項」, one
// option per line in the format
//
//     id | 中文名 | English name
//
// e.g.   threads | Threads | Threads
//        kol-amy | KOL Amy | KOL Amy
//
// Rules:
//   • `id` is the stable value stored on bookings — NEVER rename an id
//     that has already been used, or finance grouping splits. Rename the
//     display labels freely.
//   • 「其他」(other) is always appended automatically — it has special
//     behaviour (requires a free-text note) so it can't be removed.
//   • Blank config → the built-in defaults below.
//   • 'loyalty_member' is internal (auto-tagged repeat customers), never
//     offered as a choice.

import { MARKETING_CHANNEL_LABELS } from '@/types';

export interface MarketingChannelOption {
  id: string;
  zh: string;
  en: string;
}

/** Built-in defaults — used when the CMS field is empty/unreadable. */
export const DEFAULT_CHANNEL_OPTIONS: MarketingChannelOption[] = [
  { id: 'google',      zh: 'Google',    en: 'Google' },
  { id: 'instagram',   zh: 'Instagram', en: 'Instagram' },
  { id: 'facebook',    zh: 'Facebook',  en: 'Facebook' },
  { id: 'xiaohongshu', zh: '小紅書',    en: '小紅書 (RED)' },
  { id: 'referral',    zh: '朋友介紹',  en: 'Friend referral' },
];

export const OTHER_OPTION: MarketingChannelOption = { id: 'other', zh: '其他', en: 'Other' };

/** Parse the CMS text (one option per line, `id | zh | en`). Pure —
 *  covered by marketingChannels.test.ts. Lines without a usable id are
 *  skipped; missing labels fall back along en → zh → id. */
export function parseChannelConfig(text: string): MarketingChannelOption[] {
  const out: MarketingChannelOption[] = [];
  const seen = new Set<string>();
  for (const rawLine of (text || '').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('|').map((p) => p.trim());
    const id = (parts[0] || '').toLowerCase().replace(/\s+/g, '-');
    if (!id || id === 'other' || id === 'loyalty_member' || seen.has(id)) continue;
    seen.add(id);
    const zh = parts[1] || parts[0];
    const en = parts[2] || zh;
    out.push({ id, zh, en });
  }
  return out;
}

/** Options to offer at checkout: CMS-configured (or defaults) + 其他. */
export async function getMarketingChannelOptions(): Promise<MarketingChannelOption[]> {
  let configured: MarketingChannelOption[] = [];
  try {
    // Lazy import — keeps this module side-effect-free (importing
    // ./content initialises the Firebase client, which breaks vitest and
    // any non-browser consumer of the pure helpers above).
    const { getSiteContent } = await import('./content');
    const cms = await getSiteContent('settings');
    const field = (cms as Record<string, { zh?: string; en?: string }> | null)?.marketing_channels;
    configured = parseChannelConfig(field?.zh || field?.en || '');
  } catch {
    // Firestore unreachable — defaults below.
  }
  const base = configured.length > 0 ? configured : DEFAULT_CHANNEL_OPTIONS;
  return [...base, OTHER_OPTION];
}

/**
 * Display label for a booking's channel, robust to admin-configured ids:
 * built-in label → the label snapshotted on the booking at checkout
 * (marketingChannelLabel) → the raw id. NEVER index
 * MARKETING_CHANNEL_LABELS[ch][locale] directly — an unknown custom id
 * would crash the page.
 */
export function channelDisplayLabel(
  booking: { marketingChannel?: string | null; marketingChannelLabel?: string | null },
  locale: 'zh' | 'en',
): string {
  const ch = booking.marketingChannel;
  if (!ch) return '';
  const builtIn = (MARKETING_CHANNEL_LABELS as Record<string, { zh: string; en: string }>)[ch];
  return builtIn?.[locale] || booking.marketingChannelLabel || ch;
}
