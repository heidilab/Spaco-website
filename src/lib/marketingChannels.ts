// Marketing channels — ONE list for the whole site (site review
// 2026-11-13, phase 4b).
//
// Every channel a booking can carry is a row of the channel registry:
//
//   id        the stable value stored on bookings — never renamed once used
//   zh / en   display labels (rename freely)
//   customer  offered to customers at 確認預訂「喺邊度得知我哋」
//   platform  a broker / platform (行家, Reubird, Common Room …): staff pick
//             it in 後台直接落單 / the booking's source editor, commission
//             applies, and a booking with it but no rule is flagged
//   excel     gets its own Sales / % column pair in the month-close Excel
//             overview (her Financial Master's first table)
//
// Commission rules stay in system/finance_config (keyed by channel id);
// 財務 → 來源渠道／佣金 (/admin/channels) edits both together.
//
// Storage: `site_content/channels` { items: ChannelDef[] } (public read,
// admin write). Before that doc exists the registry is DERIVED from the
// legacy settings — the customer options text in site_content/settings
// → marketing_channels (`id | 中文 | English`, one per line) plus the
// three built-in platform channels — so nothing changes until staff save
// the new screen once. Saving also rewrites the legacy text, so a
// deployment still on the old reader lists the same customer options.
//
//   • 「其他」(other) is always appended to the customer options — it has
//     special behaviour (requires a free-text note) so it is not a row.
//   • 'loyalty_member' is internal (auto-tagged repeat customers), never
//     offered as a choice and never a row.
//
// The parsing / derivation helpers are pure (marketingChannels.test.ts);
// Firestore is imported lazily so vitest and non-browser callers can use
// them.

import { MARKETING_CHANNEL_LABELS } from '@/types';

export interface MarketingChannelOption {
  id: string;
  zh: string;
  en: string;
}

/** One row of the channel registry. */
export interface ChannelDef extends MarketingChannelOption {
  customer: boolean;
  platform: boolean;
  excel: boolean;
}

/** Built-in customer options — used when nothing is configured. */
export const DEFAULT_CHANNEL_OPTIONS: MarketingChannelOption[] = [
  { id: 'google',      zh: 'Google',    en: 'Google' },
  { id: 'instagram',   zh: 'Instagram', en: 'Instagram' },
  { id: 'facebook',    zh: 'Facebook',  en: 'Facebook' },
  { id: 'xiaohongshu', zh: '小紅書',    en: '小紅書 (RED)' },
  { id: 'referral',    zh: '朋友介紹',  en: 'Friend referral' },
];

/** Built-in broker / platform channels (the ids the commission rules in
 *  DEFAULT_FINANCE_CONFIG key on). */
export const DEFAULT_PLATFORM_CHANNELS: ChannelDef[] = [
  { id: 'agent',      zh: '行家',        en: 'Agent (行家)', customer: false, platform: true, excel: true },
  { id: 'reubird',    zh: 'Reubird',     en: 'Reubird',      customer: false, platform: true, excel: true },
  { id: 'commonroom', zh: 'Common Room', en: 'Common Room',  customer: false, platform: true, excel: true },
];

export const OTHER_OPTION: MarketingChannelOption = { id: 'other', zh: '其他', en: 'Other' };

export const RESERVED_CHANNEL_IDS = ['other', 'loyalty_member'] as const;
const CHANNEL_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const MAX_CHANNELS = 60;

/** Parse the legacy CMS text (one option per line, `id | zh | en`).
 *  Lines without a usable id are skipped; missing labels fall back along
 *  en → zh → id. */
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

/** The registry as it stands before anyone saved the new screen: the
 *  legacy customer options (or the built-in ones) + the built-in platform
 *  channels. */
export function legacyChannelRegistry(customerText: string): ChannelDef[] {
  const parsed = parseChannelConfig(customerText);
  const customers = (parsed.length > 0 ? parsed : DEFAULT_CHANNEL_OPTIONS)
    .map((o) => ({ ...o, customer: true, platform: false, excel: false }));
  return [...customers, ...DEFAULT_PLATFORM_CHANNELS.filter((p) => !customers.some((c) => c.id === p.id))];
}

/** The built-in registry. */
export function defaultChannelRegistry(): ChannelDef[] {
  return legacyChannelRegistry('');
}

/** Keep only well-formed rows; null when there is no usable list at all
 *  (so the caller derives the legacy registry instead). */
export function sanitizeChannelRegistry(raw: unknown): ChannelDef[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ChannelDef[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object' || out.length >= MAX_CHANNELS) continue;
    const r = item as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id.trim().toLowerCase() : '';
    if (!CHANNEL_ID.test(id) || (RESERVED_CHANNEL_IDS as readonly string[]).includes(id) || seen.has(id)) continue;
    const zh = typeof r.zh === 'string' ? r.zh.trim().slice(0, 80) : '';
    const en = typeof r.en === 'string' ? r.en.trim().slice(0, 80) : '';
    if (!zh && !en) continue;
    seen.add(id);
    out.push({ id, zh: zh || en, en: en || zh, customer: r.customer === true, platform: r.platform === true, excel: r.excel === true });
  }
  return out.length > 0 ? out : null;
}

/** What customers may pick at checkout: the customer rows + 其他. */
export function customerChannelOptions(registry: ChannelDef[]): MarketingChannelOption[] {
  const base = registry.filter((c) => c.customer).map(({ id, zh, en }) => ({ id, zh, en }));
  return [...(base.length > 0 ? base : DEFAULT_CHANNEL_OPTIONS), OTHER_OPTION];
}

/** Broker / platform channel ids. */
export function platformChannelIds(registry: ChannelDef[]): string[] {
  return registry.filter((c) => c.platform).map((c) => c.id);
}

/** Channels with their own column pair in the month-close Excel overview. */
export function excelChannelColumns(registry: ChannelDef[]): ChannelDef[] {
  return registry.filter((c) => c.excel);
}

/** Staff pick-list order: platform channels first, then the rest. */
export function staffChannelOptions(registry: ChannelDef[]): MarketingChannelOption[] {
  const platform = registry.filter((c) => c.platform);
  const rest = registry.filter((c) => !c.platform);
  return [...platform, ...rest].map(({ id, zh, en }) => ({ id, zh, en }));
}

/** The legacy customer-options text for a registry (`id | zh | en`). */
export function registryToLegacyText(registry: ChannelDef[]): string {
  return registry.filter((c) => c.customer).map((c) => `${c.id} | ${c.zh} | ${c.en}`).join('\n');
}

// ── active registry (module state; set by the loader) ──

let active: ChannelDef[] | null = null;
let inFlight: Promise<ChannelDef[]> | null = null;

/** Make a registry the one channelDisplayLabel reads (tests, loader). */
export function setChannelRegistry(registry: ChannelDef[] | null): void {
  active = registry;
}

/** The registry loaded on this page, if any. */
export function activeChannelRegistry(): ChannelDef[] | null {
  return active;
}

/** Load the channel registry (site_content/channels, else derived from
 *  the legacy settings, else the built-in list) and make it active. */
export async function getChannelRegistry(force = false): Promise<ChannelDef[]> {
  if (active && !force) return active;
  if (inFlight && !force) return inFlight;
  inFlight = (async () => {
    try {
      // Lazy import — keeps this module side-effect-free for vitest and
      // any non-browser consumer of the pure helpers above.
      const [{ doc, getDoc }, { db }] = await Promise.all([import('firebase/firestore'), import('./firebase')]);
      const snap = await getDoc(doc(db, 'site_content', 'channels'));
      const saved = snap.exists() ? sanitizeChannelRegistry(snap.data()?.items) : null;
      if (saved) { active = saved; return saved; }
      const { getSiteContent } = await import('./content');
      const cms = await getSiteContent('settings');
      const field = (cms as Record<string, { zh?: string; en?: string }> | null)?.marketing_channels;
      active = legacyChannelRegistry(field?.zh || field?.en || '');
      return active;
    } catch {
      // Firestore unreachable — the built-in list, not remembered as loaded.
      return defaultChannelRegistry();
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Save the registry (and the legacy customer-options text beside it). */
export async function saveChannelRegistry(registry: ChannelDef[], updatedBy: string): Promise<ChannelDef[]> {
  const clean = sanitizeChannelRegistry(registry) ?? defaultChannelRegistry();
  const [{ doc, setDoc, serverTimestamp }, { db }, { updateSiteContent }] = await Promise.all([
    import('firebase/firestore'), import('./firebase'), import('./content'),
  ]);
  await setDoc(doc(db, 'site_content', 'channels'), { items: clean, updatedAt: serverTimestamp(), updatedBy });
  const text = registryToLegacyText(clean);
  await updateSiteContent('settings', { marketing_channels: { zh: text, en: text } }, updatedBy);
  active = clean;
  return clean;
}

/** Options to offer at checkout: the registry's customer rows + 其他. */
export async function getMarketingChannelOptions(): Promise<MarketingChannelOption[]> {
  return customerChannelOptions(await getChannelRegistry());
}

/**
 * Display label for a booking's channel, robust to any id: the registry
 * (when loaded on this page) → built-in label → the label snapshotted on
 * the booking at checkout (marketingChannelLabel) → the raw id. NEVER
 * index MARKETING_CHANNEL_LABELS[ch][locale] directly — an unknown id
 * would crash the page.
 */
export function channelDisplayLabel(
  booking: { marketingChannel?: string | null; marketingChannelLabel?: string | null },
  locale: 'zh' | 'en',
): string {
  const ch = booking.marketingChannel;
  if (!ch) return '';
  const fromRegistry = active?.find((c) => c.id === ch)?.[locale];
  if (fromRegistry) return fromRegistry;
  const builtIn = (MARKETING_CHANNEL_LABELS as Record<string, { zh: string; en: string }>)[ch];
  return builtIn?.[locale] || booking.marketingChannelLabel || ch;
}

/** Label of a channel id (registry → built-in → id); for aggregates that
 *  have no booking to read a snapshot from. */
export function channelIdLabel(id: string, locale: 'zh' | 'en', registry: ChannelDef[] | null = active): string {
  if (id === 'loyalty_member') return locale === 'zh' ? '🌟 老會員' : '🌟 Loyalty Member';
  if (id === 'other') return OTHER_OPTION[locale];
  const fromRegistry = registry?.find((c) => c.id === id)?.[locale];
  if (fromRegistry) return fromRegistry;
  const builtIn = (MARKETING_CHANNEL_LABELS as Record<string, { zh: string; en: string }>)[id];
  return builtIn?.[locale] || id;
}
