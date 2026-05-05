import { Venue, FilterState } from '@/types';

/**
 * Venue conflict map — when a booking exists for ANY id in the list,
 * none of the listed venues are bookable for the same time slot.
 *
 * Sheung Wan is one physical floor: A and B are halves, A+B is the full
 * floor. Booking A blocks A+B, booking A+B blocks both A and B, etc.
 *
 * Each id should appear in its own conflict group (so the lookup catches
 * the venue itself when filtering blocks for it).
 */
export const VENUE_CONFLICTS: Record<string, string[]> = {
  // Sheung Wan group — A / B / Full Floor (A+B) share the same physical space
  'sw-a':  ['sw-a',  'sw-ab'],
  'sw-b':  ['sw-b',  'sw-ab'],
  'sw-ab': ['sw-a',  'sw-b', 'sw-ab'],
};

/** All venue ids that share a physical space with the given venueId
 *  (including the venueId itself). Falls back to just `[venueId]`. */
export function venuesSharingSpace(venueId: string): string[] {
  return VENUE_CONFLICTS[venueId] || [venueId];
}

export const venues: Venue[] = [
  {
    id: 'cwb',
    slug: 'causeway-bay',
    name: { zh: '銅鑼灣店', en: 'Causeway Bay' },
    subtitle: { zh: '', en: '' },
    description: {
      zh: '位於銅鑼灣核心地段的旗艦空間，配備頂級音響及設計師家具，適合各類型聚會。',
      en: 'Our flagship venue in the heart of Causeway Bay, featuring premium sound systems and designer furniture for all occasions.',
    },
    branch: 'CWB',
    capacity: { min: 15, max: 70 },
    size: '2,800 sq ft',
    vibes: ['family', 'chill', 'poker'],
    amenities: ['bbq', 'hotpot', 'mahjong'],
    images: ['/images/cwb-1.jpg', '/images/cwb-2.jpg', '/images/cwb-3.jpg'],
    pricing: {
      weekday: { perHead: 50 },
      weekend: { perHead: 58 },
    },
    minHours: { weekday: 5, weekend: 5 },
    minGuests: { weekday: 15, weekend: 20 },
  },
  {
    id: 'wanchai',
    slug: 'wan-chai',
    name: { zh: '灣仔店', en: 'Wan Chai' },
    subtitle: { zh: '', en: '' },
    description: {
      zh: '灣仔專業商務空間，適合公司活動、工作坊及小型會議，配備專業投影設備。',
      en: 'A professional business space in Wan Chai, ideal for corporate events, workshops and meetings with professional AV equipment.',
    },
    branch: 'WC',
    capacity: { min: 6, max: 35 },
    size: '1,200 sq ft',
    vibes: ['corporate', 'chill', 'poker'],
    amenities: ['mahjong'],
    images: ['/images/wc-1.jpg', '/images/wc-2.jpg'],
    pricing: {
      weekday: { perHead: 50 },
      weekend: { perHead: 58 },
    },
    minHours: { weekday: 4, weekend: 4 },
    minGuests: { weekday: 6, weekend: 8 },
  },
  {
    id: 'sw-a',
    slug: 'sheung-wan-a',
    name: { zh: '上環海景旗艦店 - Room A', en: 'Sheung Wan - Room A' },
    subtitle: { zh: '', en: '' },
    description: {
      zh: '上環寧靜空間 Room A，適合親子活動、小型聚會，設有戶外 BBQ 區域。',
      en: 'A tranquil space in Sheung Wan Room A, perfect for family events and intimate gatherings with outdoor BBQ area.',
    },
    branch: 'SW',
    capacity: { min: 6, max: 35 },
    size: '1,000 sq ft',
    vibes: ['family', 'chill', 'poker'],
    amenities: ['bbq', 'mahjong'],
    images: ['/images/sw-a-1.jpg', '/images/sw-a-2.jpg'],
    pricing: {
      weekday: { perHead: 50 },
      weekend: { perHead: 58 },
    },
    minHours: { weekday: 5, weekend: 5 },
    minGuests: { weekday: 6, weekend: 8 },
  },
  {
    id: 'sw-b',
    slug: 'sheung-wan-b',
    name: { zh: '上環海景旗艦店 - Room B', en: 'Sheung Wan - Room B' },
    subtitle: { zh: '', en: '' },
    description: {
      zh: '上環 Room B 設有獨立專業廚房、桌球枱及打邊爐設備，適合高品味聚會。',
      en: 'Sheung Wan Room B features a private professional kitchen, pool table and hotpot facilities for premium gatherings.',
    },
    branch: 'SW',
    capacity: { min: 20, max: 70 },
    size: '2,200 sq ft',
    vibes: ['chill'],
    amenities: ['bbq', 'pool-table', 'hotpot', 'mahjong', 'private-kitchen'],
    images: ['/images/sw-b-1.jpg', '/images/sw-b-2.jpg'],
    pricing: {
      weekday: { perHead: 50 },
      weekend: { perHead: 58 },
    },
    minHours: { weekday: 5, weekend: 5 },
    minGuests: { weekday: 20, weekend: 25 },
  },
  {
    id: 'tst',
    slug: 'tsim-sha-tsui',
    name: { zh: '尖沙咀店', en: 'Tsim Sha Tsui' },
    subtitle: { zh: '', en: '' },
    description: {
      zh: '尖沙咀獨特海景空間，設有戶外 BBQ 及桌球設備，已包無酒精飲品任飲。',
      en: 'A unique harbour view space in TST with outdoor BBQ, pool table and complimentary non-alcoholic drinks.',
    },
    branch: 'TST',
    capacity: { min: 12, max: 70 },
    size: '2,500 sq ft',
    vibes: ['chill', 'poker'],
    amenities: ['bbq', 'pool-table', 'mahjong'],
    images: ['/images/tst-1.jpg', '/images/tst-2.jpg', '/images/tst-3.jpg'],
    pricing: {
      weekday: { perHead: 50 },
      weekend: { perHead: 58 },
    },
    minHours: { weekday: 5, weekend: 5 },
    minGuests: { weekday: 12, weekend: 15 },
  },
  {
    id: 'sw-ab',
    slug: 'sheung-wan-ab',
    name: { zh: '上環海景旗艦店 - 全層 A+B', en: 'Sheung Wan - Full Floor (A+B)' },
    subtitle: { zh: '', en: '' },
    description: {
      zh: '上環全層包場，合併 Room A 及 B，可容納最多 100 人的大型活動。',
      en: 'Full floor venue combining Room A & B in Sheung Wan, accommodating up to 100 guests for large events.',
    },
    branch: 'SW',
    capacity: { min: 25, max: 100 },
    size: '3,200 sq ft',
    vibes: ['chill'],
    amenities: ['bbq', 'pool-table', 'hotpot', 'mahjong', 'private-kitchen'],
    images: ['/images/sw-ab-1.jpg', '/images/sw-ab-2.jpg'],
    pricing: {
      weekday: { perHead: 50 },
      weekend: { perHead: 58 },
    },
    minHours: { weekday: 5, weekend: 5 },
    minGuests: { weekday: 25, weekend: 35 },
  },
];

// Capacity range to venues mapping
const capacityMap: Record<string, string[]> = {
  '6-10': ['wanchai', 'sw-a'],
  '10-35': ['cwb', 'wanchai', 'sw-a', 'sw-b', 'tst', 'sw-ab'],
  '36-70': ['cwb', 'tst', 'sw-b', 'sw-ab'],
  '71-100': ['sw-ab'],
};

// Vibe to venues mapping
const vibeMap: Record<string, string[]> = {
  family: ['cwb', 'sw-a'],
  corporate: ['wanchai'],
  chill: ['cwb', 'wanchai', 'sw-a', 'sw-b', 'tst', 'sw-ab'],
  poker: ['wanchai', 'tst', 'cwb', 'sw-a'],
};

// Amenity to venues mapping
// `mahjong` defaults to all branches — adjust if a branch doesn't carry tables.
const amenityMap: Record<string, string[]> = {
  bbq: ['cwb', 'tst', 'sw-a', 'sw-b', 'sw-ab'],
  'pool-table': ['tst', 'sw-b', 'sw-ab'],
  hotpot: ['cwb', 'sw-b', 'sw-ab'],
  mahjong: ['cwb', 'wanchai', 'sw-a', 'sw-b', 'sw-ab', 'tst'],
  'private-kitchen': ['sw-b', 'sw-ab'],
};

export function filterVenues(filters: FilterState): Venue[] {
  let matchingIds: string[] | null = null;

  // Capacity filter
  if (filters.capacity) {
    matchingIds = capacityMap[filters.capacity] || [];
  }

  // Vibe filter
  if (filters.vibe) {
    const ids = vibeMap[filters.vibe] || [];
    if (matchingIds) {
      matchingIds = matchingIds.filter((id) => ids.includes(id));
    } else {
      matchingIds = ids;
    }
  }

  // Amenity filter (AND logic: venue must have ALL selected amenities)
  if (filters.amenities.length > 0) {
    for (const amenity of filters.amenities) {
      const ids = amenityMap[amenity] || [];
      if (matchingIds) {
        matchingIds = matchingIds.filter((id) => ids.includes(id));
      } else {
        matchingIds = [...ids];
      }
    }
  }

  if (matchingIds === null) return venues;
  return venues.filter((v) => matchingIds!.includes(v.id));
}

export function getVenueBySlug(slug: string): Venue | undefined {
  return venues.find((v) => v.slug === slug);
}

/** Look up a venue by its `id` (e.g. 'wanchai', 'tst'). Used by server-side
 *  flows (lock-passcode, cron) that key off venueId rather than URL slug. */
export function getVenueById(id: string): Venue | undefined {
  return venues.find((v) => v.id === id);
}

export function generateFallbackSuggestions(
  filters: FilterState
): { type: 'upsell' | 'alternative'; message: { zh: string; en: string }; venueIds: string[] }[] {
  const suggestions: { type: 'upsell' | 'alternative'; message: { zh: string; en: string }; venueIds: string[] }[] = [];

  // Check if private kitchen was selected with small group
  if (
    filters.amenities.includes('private-kitchen') &&
    filters.capacity === '6-10'
  ) {
    suggestions.push({
      type: 'upsell',
      message: {
        zh: '獨立廚房只限上環 Room B 提供。此場地設有 20 人最低消費，您仍可選擇包場獨享極致空間。',
        en: 'Private kitchen is exclusive to Sheung Wan Room B with a 20-person minimum. You can still book the entire venue for an exclusive experience.',
      },
      venueIds: ['sw-b'],
    });
    suggestions.push({
      type: 'alternative',
      message: {
        zh: '若需符合 6-10 人預算，推薦灣仔或上環 Room A，歡迎自攜外賣到會或加購戶外 BBQ。',
        en: 'For a 6-10 person budget, we recommend Wan Chai or Sheung Wan Room A. Catering delivery or outdoor BBQ add-on available.',
      },
      venueIds: ['wanchai', 'sw-a'],
    });
  }

  // Generic fallback if no specific suggestions
  if (suggestions.length === 0) {
    suggestions.push({
      type: 'alternative',
      message: {
        zh: '未能完全匹配您的篩選條件。以下為最接近的推薦空間，歡迎查看詳情或聯絡我們訂製方案。',
        en: 'No exact match for your filters. Here are our closest recommendations — feel free to explore or contact us for a custom arrangement.',
      },
      venueIds: ['cwb', 'sw-a', 'tst'],
    });
  }

  return suggestions;
}

export const amenityLabels: Record<string, { zh: string; en: string }> = {
  bbq: { zh: '戶外 BBQ', en: 'Outdoor BBQ' },
  'pool-table': { zh: '桌球', en: 'Pool Table' },
  hotpot: { zh: '火鍋', en: 'Hotpot' },
  mahjong: { zh: '麻將', en: 'Mahjong' },
  'private-kitchen': { zh: '獨立廚房', en: 'Private Kitchen' },
};

export const vibeLabels: Record<string, { zh: string; en: string }> = {
  family: { zh: '親子放電', en: 'Family Fun' },
  corporate: { zh: '商業活動', en: 'Corporate' },
  chill: { zh: 'Chill 聚會', en: 'Chill Gathering' },
  poker: { zh: 'Poker 局', en: 'Poker Night' },
};

export const capacityLabels: Record<string, { zh: string; en: string }> = {
  '6-10': { zh: '6-10 人', en: '6-10 guests' },
  '10-35': { zh: '10-35 人', en: '10-35 guests' },
  '36-70': { zh: '36-70 人', en: '36-70 guests' },
  '71-100': { zh: '71-100 人', en: '71-100 guests' },
};
