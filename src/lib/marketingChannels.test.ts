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
