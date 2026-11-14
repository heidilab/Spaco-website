/**
 * Marketing-channel config + display tests (Heidi 2026-09).
 *
 * Guards two rules:
 *   1. The CMS line format `id | 中文 | English` parses predictably —
 *      including the messy inputs a non-developer will actually type.
 *   2. channelDisplayLabel never crashes on an unknown/custom id — the
 *      old MARKETING_CHANNEL_LABELS[ch][locale] lookup threw on any id
 *      outside the built-in six and took the whole bookings list down.
 */

import { describe, it, expect } from 'vitest';
import { parseChannelConfig, channelDisplayLabel, OTHER_OPTION } from './marketingChannels';

describe('parseChannelConfig', () => {
  it('parses id | zh | en lines', () => {
    expect(parseChannelConfig('threads | Threads仔 | Threads')).toEqual([
      { id: 'threads', zh: 'Threads仔', en: 'Threads' },
    ]);
  });

  it('falls back en → zh → id when labels are omitted', () => {
    expect(parseChannelConfig('tiktok | 抖音')).toEqual([
      { id: 'tiktok', zh: '抖音', en: '抖音' },
    ]);
    expect(parseChannelConfig('tiktok')).toEqual([
      { id: 'tiktok', zh: 'tiktok', en: 'tiktok' },
    ]);
  });

  it('skips blanks, comments, duplicates, and reserved ids', () => {
    const text = [
      '',
      '# comment line',
      'kol-amy | KOL Amy',
      'kol-amy | duplicate ignored',
      'other | 其他',            // reserved — auto-appended, not configurable
      'loyalty_member | nope',   // internal tag, never offerable
    ].join('\n');
    expect(parseChannelConfig(text)).toEqual([
      { id: 'kol-amy', zh: 'KOL Amy', en: 'KOL Amy' },
    ]);
  });

  it('normalises ids: lower-case, spaces → dashes', () => {
    expect(parseChannelConfig('KOL Amy | KOL Amy 推廣')[0].id).toBe('kol-amy');
  });

  it('empty config parses to [] (caller falls back to defaults)', () => {
    expect(parseChannelConfig('')).toEqual([]);
    expect(OTHER_OPTION.id).toBe('other');
  });
});

describe('channelDisplayLabel', () => {
  it('resolves built-in ids from the static labels', () => {
    expect(channelDisplayLabel({ marketingChannel: 'instagram' }, 'zh')).toBe('Instagram');
    expect(channelDisplayLabel({ marketingChannel: 'xiaohongshu' }, 'zh')).toBe('小紅書');
  });

  it('uses the snapshotted label for custom ids instead of crashing', () => {
    expect(channelDisplayLabel(
      { marketingChannel: 'kol-amy', marketingChannelLabel: 'KOL Amy' }, 'zh',
    )).toBe('KOL Amy');
  });

  it('falls back to the raw id when no label was snapshotted', () => {
    expect(channelDisplayLabel({ marketingChannel: 'mystery-channel' }, 'en')).toBe('mystery-channel');
  });

  it('returns empty for missing channel', () => {
    expect(channelDisplayLabel({}, 'zh')).toBe('');
  });
});

// ── the channel registry (site review 2026-11-13, phase 4b) ──
import { afterEach } from 'vitest';
import {
  legacyChannelRegistry, defaultChannelRegistry, sanitizeChannelRegistry, customerChannelOptions,
  platformChannelIds, excelChannelColumns, staffChannelOptions, registryToLegacyText, setChannelRegistry, channelIdLabel,
} from './marketingChannels';

afterEach(() => setChannelRegistry(null));

describe('channel registry', () => {
  it('is derived from the legacy settings until saved: customer options + the three platform channels', () => {
    const reg = legacyChannelRegistry('threads | Threads | Threads\nkol-amy | KOL Amy');
    expect(reg.map((c) => c.id)).toEqual(['threads', 'kol-amy', 'agent', 'reubird', 'commonroom']);
    expect(reg[0]).toMatchObject({ customer: true, platform: false, excel: false });
    expect(reg[2]).toMatchObject({ id: 'agent', customer: false, platform: true, excel: true });
    expect(defaultChannelRegistry().map((c) => c.id)).toEqual(['google', 'instagram', 'facebook', 'xiaohongshu', 'referral', 'agent', 'reubird', 'commonroom']);
  });

  it('sanitises a saved list and returns null for nothing usable', () => {
    expect(sanitizeChannelRegistry(null)).toBeNull();
    expect(sanitizeChannelRegistry([])).toBeNull();
    expect(sanitizeChannelRegistry([{ id: 'other', zh: 'x' }, { id: 'Bad Id', zh: 'x' }, { id: 'ok', zh: '' }])).toBeNull();
    expect(sanitizeChannelRegistry([
      { id: 'Klook', zh: 'Klook', customer: 'yes', platform: true, excel: 1 },
      { id: 'klook', zh: 'dupe' },
      { id: 'ig', en: 'Instagram', customer: true },
    ])).toEqual([
      { id: 'klook', zh: 'Klook', en: 'Klook', customer: false, platform: true, excel: false },
      { id: 'ig', zh: 'Instagram', en: 'Instagram', customer: true, platform: false, excel: false },
    ]);
  });

  it('splits into customer options (+ 其他), staff pick-list, platform ids and Excel columns', () => {
    const reg = sanitizeChannelRegistry([
      { id: 'google', zh: 'Google', en: 'Google', customer: true },
      { id: 'klook', zh: 'Klook', en: 'Klook', customer: false, platform: true, excel: true },
      { id: 'agent', zh: '行家', en: 'Agent', customer: false, platform: true, excel: false },
    ])!;
    expect(customerChannelOptions(reg).map((o) => o.id)).toEqual(['google', 'other']);
    expect(staffChannelOptions(reg).map((o) => o.id)).toEqual(['klook', 'agent', 'google']);
    expect(platformChannelIds(reg)).toEqual(['klook', 'agent']);
    expect(excelChannelColumns(reg).map((c) => c.id)).toEqual(['klook']);
    expect(registryToLegacyText(reg)).toBe('google | Google | Google');
    // No customer rows at all → the built-in options, so checkout never shows only 其他.
    expect(customerChannelOptions(reg.filter((c) => c.platform)).map((o) => o.id)).toEqual(['google', 'instagram', 'facebook', 'xiaohongshu', 'referral', 'other']);
  });

  it('labels follow the loaded registry, then the built-in names, then the booking snapshot', () => {
    expect(channelIdLabel('agent', 'zh', null)).toBe('agent');
    setChannelRegistry(defaultChannelRegistry());
    expect(channelIdLabel('agent', 'zh')).toBe('行家');
    expect(channelDisplayLabel({ marketingChannel: 'commonroom' }, 'en')).toBe('Common Room');
    setChannelRegistry(sanitizeChannelRegistry([{ id: 'xiaohongshu', zh: 'RED 小紅書', en: 'RED', customer: true }]));
    expect(channelDisplayLabel({ marketingChannel: 'xiaohongshu' }, 'zh')).toBe('RED 小紅書');
    expect(channelDisplayLabel({ marketingChannel: 'instagram' }, 'zh')).toBe('Instagram');
    expect(channelDisplayLabel({ marketingChannel: 'gone', marketingChannelLabel: 'Gone Ltd' }, 'zh')).toBe('Gone Ltd');
    expect(channelIdLabel('loyalty_member', 'en')).toBe('🌟 Loyalty Member');
  });
});
