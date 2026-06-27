import { Venue, AddOn, AddOnOptions } from '@/types';

// Add-on definitions for the booking UI
export const addOns: AddOn[] = [
  {
    id: 'bbq-standard',
    name: { zh: 'BBQ 標準套餐（只有肉類及丸）', en: 'BBQ Standard Package (Meat & Balls)' },
    pricePerUnit: 158,
    unit: 'person',
    description: {
      zh: '銅鑼灣及上環每位 $158 / 尖沙咀每位 $138',
      en: 'CWB & SW: $158/pax / TST: $138/pax',
    },
  },
  {
    id: 'bbq-premium',
    name: { zh: 'BBQ 豪華套餐（有海鮮、肉類、丸及蔬菜）', en: 'BBQ Premium Package (Seafood, Meat & Veggies)' },
    pricePerUnit: 328,
    unit: 'person',
    description: {
      zh: '統一每位 $328，包含大扇貝、活鮑魚、海蝦等',
      en: '$328/pax, includes scallops, live abalone, prawns & more',
    },
  },
  {
    id: 'bbq-grill',
    name: { zh: 'BBQ 爐租用', en: 'BBQ Grill Rental' },
    pricePerUnit: 500,
    unit: 'item',
    maxQuantity: 2,
    description: {
      zh: '自攜食物必須租用 BBQ 爐（最多 2 個）',
      en: 'BBQ grill rental required for BYO food (max 2 units)',
    },
  },
  {
    // Helper chef — staff sent to operate the BBQ. Custom pricing:
    // $300/hour × num_chefs × booking_hours. Min booking 5 hours
    // (enforced in venue page UI) and 7 days advance notice.
    // Hidden at venues in noBBQVenues (灣仔店 / wanchai).
    id: 'bbq-helper',
    name: { zh: '代燒員', en: 'BBQ Helper Chef' },
    pricePerUnit: 300,
    unit: 'person',
    maxQuantity: 6,
    description: {
      zh: '每位代燒員每小時 $300；最少訂 5 小時；需提前最少 7 日預訂（灣仔店不適用）',
      en: '$300/hr per chef; min 5-hour booking; reserve ≥ 7 days ahead (not available at Wan Chai)',
    },
  },
  {
    id: 'hotpot-standard',
    name: { zh: '火鍋標準套餐', en: 'Hotpot Standard Package' },
    pricePerUnit: 168,
    unit: 'person',
    description: {
      zh: '每位 $168，包含肉類、丸類及蔬菜（須最少三日前預訂）',
      en: '$168/pax, includes meat, balls & vegetables (min. 3 days advance booking)',
    },
  },
  {
    id: 'hotpot-seafood',
    name: { zh: '海鮮火鍋套餐', en: 'Seafood Hotpot Package' },
    pricePerUnit: 348,
    unit: 'person',
    description: {
      zh: '每位 $348，包含海鮮、肉類、丸類及蔬菜（須最少三日前預訂）',
      en: '$348/pax, includes seafood, meat, balls & vegetables (min. 3 days advance booking)',
    },
  },
  {
    id: 'hotpot-extra-soup',
    name: { zh: '加購額外湯底', en: 'Extra Soup Base' },
    pricePerUnit: 108,
    unit: 'item',
    maxQuantity: 1,
    description: {
      zh: '15人以下如需第二個湯底，每個 +$108',
      en: 'Extra soup base for groups under 15 pax, $108 each',
    },
  },
  {
    id: 'drinks',
    name: { zh: '無酒精飲品任飲', en: 'Unlimited Non-Alcoholic Drinks' },
    pricePerUnit: 25,
    unit: 'person',
    description: {
      zh: '飲品由供應商隨機供應，不能指定飲品，一般均為罐裝汽水及紙包飲品',
      en: 'Drinks are randomly supplied by our vendor (no specific selection) — typically canned soft drinks and packaged beverages',
    },
  },
  {
    // Shisha is a tiered package — pricePerUnit here is the base for the
    // first head; the actual price uses calcShishaPrice() below to handle
    // the 1-head / 2-head / extra-head tiers + optional staff setup.
    id: 'shisha',
    name: { zh: 'Shisha 水煙套餐', en: 'Shisha Package' },
    pricePerUnit: 390,
    unit: 'item',
    maxQuantity: 10,
    description: {
      zh: '1 支水煙 + 1 個煙頭 $390 / 2 支 + 2 頭 $750 / 額外每個煙頭 +$250；自助形式（食完一個頭可以換新嘅）；最多 2 支水煙；需活動 2 日前預訂',
      en: '1 pipe + 1 head $390 / 2 pipes + 2 heads $750 / +$250 each extra head (DIY swap); max 2 pipes per venue; order ≥ 2 days ahead',
    },
    variants: [
      { id: 'A', category: 'fruity-minty', name: { zh: 'A · 芒果菠蘿檸檬綠茶',     en: 'A · Mango Pineapple Lemon Green Tea' } },
      { id: 'B', category: 'fruity-minty', name: { zh: 'B · 蜜桃伯爵茶',           en: 'B · Peach Earl Grey' } },
      { id: 'C', category: 'fruity-minty', name: { zh: 'C · 提子茉莉青瓜',         en: 'C · Grape Jasmine Cucumber' } },
      { id: 'D', category: 'creamy',       name: { zh: 'D · 士多啤梨窩夫',         en: 'D · Strawberry Waffle' } },
      { id: 'E', category: 'creamy',       name: { zh: 'E · 蜜瓜牛奶',             en: 'E · Melon Milk' } },
      { id: 'F', category: 'floral',       name: { zh: 'F · 茉莉雞蛋花青檸',       en: 'F · Jasmine Frangipani Lemon Lime' } },
      { id: 'G', category: 'woody',        name: { zh: 'G · 檀香伯爵蜜桃針葉',     en: 'G · Sandalwood Earl Grey Peach Needle' } },
      { id: 'H', category: 'woody',        name: { zh: 'H · 檀香綠茶蘋果',         en: 'H · Sandalwood Green Tea Apple' } },
    ],
  },
];

/** Shisha pricing.
 *  - 1 pipe + 1 head = $390 (single base)
 *  - 2 pipes + 2 heads = $750 (double base)
 *  - Each extra head beyond `pipes` = +$250 (for mid-session swap)
 *  - Optional staff setup = +$180 flat */
export function calcShishaPrice(
  pipes: number,
  heads: number,
  staffSetup = false,
): number {
  if (pipes <= 0 || heads <= 0) return 0;
  const validPipes = Math.min(2, Math.max(1, Math.floor(pipes)));
  const validHeads = Math.max(validPipes, Math.floor(heads));
  const base = validPipes === 1 ? 390 : 750;
  const extra = (validHeads - validPipes) * 250;
  return base + extra + (staffSetup ? 180 : 0);
}

/** Max simultaneous pipes per venue. Currently uniform across venues. */
export const SHISHA_MAX_PIPES = 2;

export const SHISHA_STAFF_SETUP_FEE = 180;

// Concise staff-facing add-on labels, used for supplier ordering, the master
// calendar popup, admin booking lists, and Google Calendar event descriptions.
// These strip the consumer-facing parenthetical detail from name.en so staff
// can scan and order quickly. Falls back to the id if not mapped.
const STAFF_ADDON_LABELS: Record<string, { zh: string; en: string }> = {
  'bbq-standard':     { zh: 'BBQ 標準套餐',   en: 'BBQ Standard Package' },
  'bbq-premium':      { zh: 'BBQ 豪華套餐',   en: 'BBQ Premium Package' },
  'bbq-grill':        { zh: 'BBQ 爐租用',      en: 'BBQ Grill Rental' },
  'hotpot-standard':  { zh: '火鍋標準套餐',   en: 'Standard Hotpot Package' },
  'hotpot-seafood':   { zh: '海鮮火鍋套餐',   en: 'Seafood Hotpot Package' },
  'hotpot-extra-soup':{ zh: '額外湯底',        en: 'Extra Soup Base' },
  'drinks':           { zh: '無酒精飲品任飲', en: 'Drinks Package' },
  'shisha':           { zh: 'Shisha 水煙',     en: 'Shisha Package' },
};

export function getAddOnLabel(id: string, locale: 'zh' | 'en' = 'en'): string {
  return STAFF_ADDON_LABELS[id]?.[locale] || id;
}

/** Resolve a Shisha flavor variant id → its display label. */
export function getShishaFlavorLabel(variantId: string, locale: 'zh' | 'en' = 'en'): string {
  const shisha = addOns.find((a) => a.id === 'shisha');
  const v = shisha?.variants?.find((x) => x.id === variantId);
  return v?.name[locale] || variantId;
}

/** Format a booking's addOns as a comma-separated staff-facing string,
 *  e.g. "BBQ Standard Package ×4, Drinks Package ×4". For Shisha, also
 *  surface pipe count + flavor breakdown + setup option:
 *  "Shisha 水煙 (2支/3頭: A·芒果菠蘿×2, C·提子×1, +人手setup)". */
export function formatAddOnsForStaff(
  bookingAddOns: { id: string; quantity: number; options?: AddOnOptions }[] | undefined,
  locale: 'zh' | 'en' = 'en',
): string {
  if (!bookingAddOns || bookingAddOns.length === 0) return '';
  return bookingAddOns.map((a) => {
    // Admin-defined custom add-on. Use the stored customName directly
    // — there's no catalog entry to look up. Suffix the price so staff
    // / gcal description tells the reader what was charged for.
    if (a.id.startsWith('custom-')) {
      const name = a.options?.customName?.trim() || (locale === 'zh' ? '自訂項目' : 'Custom item');
      const price = a.options?.customPrice ?? 0;
      if (price > 0) return `${name} ($${price.toLocaleString()})`;
      return locale === 'zh' ? `${name}（免費）` : `${name} (FREE)`;
    }
    if (a.id !== 'shisha') {
      // Per-head packages (BBQ / hotpot / drinks) charge against the
      // booking's full guest count — the stored quantity is just a
      // presence flag, so rendering "×1" was misleading. Look up the
      // catalog entry (module-level `addOns`, shadowed by the
      // parameter — hence the alias) to know which unit type this is.
      const cfg = addOns.find((x) => x.id === a.id);
      if (cfg?.unit === 'person') return getAddOnLabel(a.id, locale);
      return `${getAddOnLabel(a.id, locale)} ×${a.quantity}`;
    }
    // Shisha: pipes/heads + flavor breakdown + setup flag.
    const heads = a.quantity;
    const pipes = a.options?.pipes ?? Math.min(2, heads);
    const headerZh = `${pipes}支/${heads}頭`;
    const headerEn = `${pipes} pipe${pipes > 1 ? 's' : ''} / ${heads} head${heads > 1 ? 's' : ''}`;
    const counts: Record<string, number> = {};
    for (const f of a.options?.flavors || []) counts[f] = (counts[f] || 0) + 1;
    const flavorParts = Object.entries(counts)
      .map(([id, n]) => `${getShishaFlavorLabel(id, locale)}${n > 1 ? `×${n}` : ''}`);
    const setupTag = a.options?.staffSetup
      ? (locale === 'zh' ? '+人手setup' : '+staff setup')
      : '';
    const detail = [locale === 'zh' ? headerZh : headerEn, ...flavorParts, setupTag]
      .filter(Boolean)
      .join(', ');
    return `${getAddOnLabel(a.id, locale)} (${detail})`;
  }).join(', ');
}

// BBQ Standard package prices differ by venue
export const bbqStandardPriceByVenue: Record<string, number> = {
  cwb: 158,
  'sw-a': 158,
  'sw-b': 158,
  'sw-ab': 158,
  tst: 138,
  // wanchai: no BBQ available
};

// BBQ Standard menu items
export const bbqStandardMenu = {
  zh: [
    '香茅豬扒', '五花肉叉燒', '香草蜜糖金沙骨', '黑椒西冷牛扒',
    '韓式牛柳條', 'BBQ 雞中翼', '奧爾良雞中翼', 'BBQ 雞扒',
    '蜜汁雞扒', '咖喱魷焦', '雜丸', '香腸', '土匪雞中翼',
  ],
  en: [
    'Lemongrass Pork Chop', 'Char Siu Pork Belly', 'Honey Herb Ribs', 'Black Pepper Sirloin',
    'Korean Beef Strips', 'BBQ Chicken Wings', 'Orleans Chicken Wings', 'BBQ Chicken Steak',
    'Honey Chicken Steak', 'Curry Squid', 'Assorted Balls', 'Sausages', 'Bandit Chicken Wings',
  ],
  notes: {
    zh: [
      '食物有機會因應供應商貨源而有所調整及更改',
      '餐單不包括提供蔬菜、菇類、番薯、麵包、棉花糖',
      '食物份量按預訂人數提供',
      '食物均由合作供應商提供，本公司幫客人代訂',
      '選購 BBQ 套餐免收租爐費',
    ],
    en: [
      'Menu items may be adjusted based on supplier availability',
      'Menu does not include vegetables, mushrooms, sweet potatoes, bread or marshmallows',
      'Food portions are based on the number of guests booked',
      'All food is provided by our partner suppliers and ordered on your behalf',
      'BBQ grill rental fee is waived when ordering a BBQ package',
    ],
  },
};

// BBQ Premium menu items
export const bbqPremiumMenu = {
  zh: [
    '香茅豬扒', '五花肉叉燒', '香草蜜糖金沙骨', '黑椒西冷牛扒',
    '韓式牛柳條', 'BBQ 雞中翼', '土匪雞中翼', '奧爾良雞中翼',
    'BBQ 雞扒', '蜜汁雞扒', '咖喱魷魚', '雜丸', '香腸',
    '大扇貝（每人1隻）', '活鮑魚（每人2隻）', '新鮮海蝦',
    '青口', '蟶子（每人1隻）', '金菇蔬菜包',
  ],
  en: [
    'Lemongrass Pork Chop', 'Char Siu Pork Belly', 'Honey Herb Ribs', 'Black Pepper Sirloin',
    'Korean Beef Strips', 'BBQ Chicken Wings', 'Bandit Chicken Wings', 'Orleans Chicken Wings',
    'BBQ Chicken Steak', 'Honey Chicken Steak', 'Curry Squid', 'Assorted Balls', 'Sausages',
    'Scallop (1 per person)', 'Live Abalone (2 per person)', 'Fresh Prawns',
    'Mussels', 'Razor Clam (1 per person)', 'Enoki Mushroom & Veggie Wrap',
  ],
  notes: {
    zh: [
      '食物有機會因應供應商貨源而有所調整及更改',
      '餐單不包括提供蔬菜、菇類、番薯、麵包、棉花糖',
      '食物份量按預訂人數提供',
      '食物均由合作供應商提供，本公司幫客人代訂',
      '選購 BBQ 套餐免收租爐費',
    ],
    en: [
      'Menu items may be adjusted based on supplier availability',
      'Menu does not include vegetables, mushrooms, sweet potatoes, bread or marshmallows',
      'Food portions are based on the number of guests booked',
      'All food is provided by our partner suppliers and ordered on your behalf',
      'BBQ grill rental fee is waived when ordering a BBQ package',
    ],
  },
};

// Venues that do NOT offer BBQ
export const noBBQVenues = ['wanchai'];

// Venues that include free non-alcoholic drinks
export const freeDrinksVenues = ['tst'];

// Venues that offer hotpot
export const hotpotVenues = ['cwb', 'sw-b', 'sw-ab'];

// Hotpot soup base options
export const hotpotSoupBases = {
  zh: ['蕃茄湯', '豬骨湯', '麻辣湯'],
  en: ['Tomato Soup', 'Pork Bone Soup', 'Spicy Mala Soup'],
};

// Hotpot Standard menu
export const hotpotStandardMenu = {
  zh: [
    '牛肩胛火鍋片', '牛頸脊火鍋片', '去皮豬腩火鍋片',
    '全殼藍青口', '蟹棒', '芝士腸',
    '花枝丸/牛筋丸/豬肉丸/炸魚旦/香菇丸',
    '娃娃菜', '油麥菜', '粟米', '金菇',
    '白蘿蔔', '素生根', '響鈴', '稻庭烏冬',
  ],
  en: [
    'Beef Chuck Slices', 'Beef Neck Slices', 'Skinless Pork Belly Slices',
    'Blue Mussels (Whole Shell)', 'Crab Sticks', 'Cheese Sausage',
    'Assorted Balls (Cuttlefish/Beef Tendon/Pork/Fish/Mushroom)',
    'Baby Cabbage', 'Romaine Lettuce', 'Corn', 'Enoki Mushroom',
    'White Radish', 'Bean Curd Sticks', 'Fried Tofu Skin', 'Inaniwa Udon',
  ],
  notes: {
    zh: [
      '所有食物由合作之食物供應商提供，本公司只負責代訂',
      '食物份量由供應商按人數安排及提供',
      '部分食材為當日新鮮選購，或會因應市場供應問題更換食材，但其價值不會低於原先食材',
      '須最少三日前預訂',
    ],
    en: [
      'All food is provided by our partner suppliers and ordered on your behalf',
      'Food portions are arranged by the supplier based on guest count',
      'Some ingredients are freshly sourced daily and may be substituted due to availability, but value will not be lower',
      'Must be ordered at least 3 days in advance',
    ],
  },
};

// Hotpot Seafood menu (includes everything in standard + seafood)
export const hotpotSeafoodMenu = {
  zh: [
    '牛肩胛火鍋片', '牛頸脊火鍋片', '去皮豬腩火鍋片',
    '全殼藍青口', '蟹棒', '芝士腸',
    '花枝丸/牛筋丸/豬肉丸/炸魚旦/香菇丸',
    '娃娃菜', '油麥菜', '粟米', '金菇',
    '白蘿蔔', '素生根', '響鈴', '稻庭烏冬',
    '扇貝（每人1隻）', '九節蝦', '蟶子皇（每人1隻）',
    '大花甲', '鮑魚（每人1隻）', '脆肉鯇',
  ],
  en: [
    'Beef Chuck Slices', 'Beef Neck Slices', 'Skinless Pork Belly Slices',
    'Blue Mussels (Whole Shell)', 'Crab Sticks', 'Cheese Sausage',
    'Assorted Balls (Cuttlefish/Beef Tendon/Pork/Fish/Mushroom)',
    'Baby Cabbage', 'Romaine Lettuce', 'Corn', 'Enoki Mushroom',
    'White Radish', 'Bean Curd Sticks', 'Fried Tofu Skin', 'Inaniwa Udon',
    'Scallop (1 per person)', 'Tiger Prawns', 'Razor Clam (1 per person)',
    'Clams', 'Abalone (1 per person)', 'Crispy Grass Carp',
  ],
  notes: {
    zh: [
      '所有食物由合作之食物供應商提供，本公司只負責代訂',
      '食物份量由供應商按人數安排及提供',
      '部分食材為當日新鮮選購，或會因應市場供應問題更換食材，但其價值不會低於原先食材',
      '須最少三日前預訂',
    ],
    en: [
      'All food is provided by our partner suppliers and ordered on your behalf',
      'Food portions are arranged by the supplier based on guest count',
      'Some ingredients are freshly sourced daily and may be substituted due to availability, but value will not be lower',
      'Must be ordered at least 3 days in advance',
    ],
  },
};

export interface PricingCalculation {
  baseCharge: number;
  addOnTotal: number;
  /** rental + add-ons (excluding security deposit). */
  subtotal: number;
  /** Refundable security deposit (按金) — returned ≤24h after event,
   *  tiered: ≤$4k → $1000, ≤$10k → $2000, >$10k → $4000. */
  securityDeposit: number;
  /** subtotal + securityDeposit — the total amount the customer owes. */
  grandTotal: number;
  /** Amount payable upfront to confirm:
   *   - grandTotal ≤ HK$10,000 → grandTotal (full payment)
   *   - grandTotal >  HK$10,000 → grandTotal × 0.5 (deposit only,
   *     remaining 50 % due 2 days before the event) */
  deposit: number;
  /** True when grandTotal exceeds the installment threshold. */
  canInstallment: boolean;
  breakdown: { label: { zh: string; en: string }; amount: number }[];
}

/** Compute the adult-equivalent guest count: each child counts as 0.5.
 *  Used for both minimum-charge enforcement and per-head pricing
 *  (venue rental, BBQ, hotpot, drinks). Children pay half on these. */
export function adultEquivalent(adults: number, children: number): number {
  return adults + 0.5 * Math.max(0, children);
}

export function calculatePricing(
  venue: Venue,
  isWeekend: boolean,
  hours: number,
  guests: number,
  selectedAddOns: { id: string; quantity: number; options?: AddOnOptions }[],
  /** Optional adult/child split. If omitted, the entire `guests` count
   *  is treated as adults (legacy bookings) and full price applies. */
  childCount: number = 0,
): PricingCalculation {
  const tier = isWeekend ? venue.pricing.weekend : venue.pricing.weekday;
  const adults = Math.max(0, guests - childCount);
  const equiv = adultEquivalent(adults, childCount);
  const baseCharge = Math.round(tier.perHead * equiv * hours);
  const guestLabel = childCount > 0
    ? `${adults}成人 + ${childCount}小童`
    : `${guests}人`;
  const guestLabelEn = childCount > 0
    ? `${adults} adults + ${childCount} kids`
    : `${guests} pax`;
  const breakdown: { label: { zh: string; en: string }; amount: number }[] = [
    {
      label: {
        zh: `場地費 (${guestLabel} x ${hours}小時 x $${tier.perHead})`,
        en: `Venue (${guestLabelEn} x ${hours}hrs x $${tier.perHead})`,
      },
      amount: baseCharge,
    },
  ];

  let addOnTotal = 0;
  const hasBBQPackage = selectedAddOns.some(
    (a) => a.id === 'bbq-standard' || a.id === 'bbq-premium'
  );

  for (const selected of selectedAddOns) {
    if (selected.id === 'bbq-standard') {
      // Use venue-specific BBQ standard price; children at half rate.
      const price = bbqStandardPriceByVenue[venue.id] || 158;
      const cost = Math.round(price * equiv);
      addOnTotal += cost;
      breakdown.push({
        label: {
          zh: `BBQ 標準套餐 (${guestLabel} x $${price})`,
          en: `BBQ Standard (${guestLabelEn} x $${price})`,
        },
        amount: cost,
      });
      continue;
    }

    if (selected.id === 'bbq-premium') {
      const cost = Math.round(328 * equiv);
      addOnTotal += cost;
      breakdown.push({
        label: {
          zh: `BBQ 豪華套餐 (${guestLabel} x $328)`,
          en: `BBQ Premium (${guestLabelEn} x $328)`,
        },
        amount: cost,
      });
      continue;
    }

    if (selected.id === 'bbq-grill') {
      // Skip BBQ grill fee if a BBQ package is selected
      if (hasBBQPackage) continue;
      const cost = 500 * selected.quantity;
      addOnTotal += cost;
      breakdown.push({
        label: {
          zh: `BBQ 爐租用 (${selected.quantity}個 x $500)`,
          en: `BBQ Grill Rental (${selected.quantity} x $500)`,
        },
        amount: cost,
      });
      continue;
    }

    if (selected.id === 'bbq-helper') {
      // Helper chef = \$300/hr × num_chefs × booked_hours.
      // Min-5-hour + 7-day-advance constraints are enforced at the
      // venue-page UI layer (block submit + tell customer); pricing
      // just multiplies what came in, so an admin-issued booking
      // with shorter hours still prices correctly.
      const numChefs = selected.quantity;
      const cost = 300 * numChefs * hours;
      addOnTotal += cost;
      breakdown.push({
        label: {
          zh: `代燒員 (${numChefs} 位 × ${hours} 小時 × $300)`,
          en: `BBQ Helper Chef (${numChefs} × ${hours} hr × $300)`,
        },
        amount: cost,
      });
      continue;
    }

    if (selected.id === 'hotpot-standard') {
      const cost = Math.round(168 * equiv);
      addOnTotal += cost;
      breakdown.push({
        label: {
          zh: `火鍋標準套餐 (${guestLabel} x $168)`,
          en: `Hotpot Standard (${guestLabelEn} x $168)`,
        },
        amount: cost,
      });
      continue;
    }

    if (selected.id === 'hotpot-seafood') {
      const cost = Math.round(348 * equiv);
      addOnTotal += cost;
      breakdown.push({
        label: {
          zh: `海鮮火鍋套餐 (${guestLabel} x $348)`,
          en: `Seafood Hotpot (${guestLabelEn} x $348)`,
        },
        amount: cost,
      });
      continue;
    }

    if (selected.id === 'hotpot-extra-soup') {
      const cost = 108 * selected.quantity;
      addOnTotal += cost;
      breakdown.push({
        label: {
          zh: `加購額外湯底 (${selected.quantity}個 x $108)`,
          en: `Extra Soup Base (${selected.quantity} x $108)`,
        },
        amount: cost,
      });
      continue;
    }

    if (selected.id === 'drinks') {
      // Skip if venue includes free drinks (TST)
      if (freeDrinksVenues.includes(venue.id)) continue;
      const cost = Math.round(25 * equiv);
      addOnTotal += cost;
      breakdown.push({
        label: {
          zh: `無酒精飲品任飲 (${guestLabel} x $25)`,
          en: `Unlimited Drinks (${guestLabelEn} x $25)`,
        },
        amount: cost,
      });
      continue;
    }

    // Admin-only "custom" add-on. Id prefix `custom-` lets the booking
    // hold multiple custom items in parallel; each carries its own
    // name + flat price in `options.customName` / `options.customPrice`.
    // Customer-facing pages never render these (the catalog has no
    // `custom-…` entries), so this branch is exclusively driven by
    // admin's manual additions in the booking-link / booking-manage
    // flows.
    if (selected.id.startsWith('custom-')) {
      const customName = selected.options?.customName?.trim() || '自訂項目';
      const customPrice = Math.max(0, Math.floor(selected.options?.customPrice ?? 0));
      addOnTotal += customPrice;
      // Render the breakdown line even for free items so admin/customer
      // see CS-promised freebies on the receipt + emails. Label gets a
      // 「(免費)」 / 「(FREE)」 suffix so it reads correctly when the
      // amount is 0.
      breakdown.push({
        label: customPrice > 0
          ? { zh: customName, en: customName }
          : { zh: `${customName}（免費）`, en: `${customName} (FREE)` },
        amount: customPrice,
      });
      continue;
    }

    if (selected.id === 'shisha') {
      const heads = selected.quantity;
      // Default pipes to min(2, heads) for any legacy entry without it,
      // so old test data keeps producing a sensible total.
      const pipes = Math.min(SHISHA_MAX_PIPES, Math.max(1, selected.options?.pipes ?? Math.min(2, heads)));
      const staffSetup = !!selected.options?.staffSetup;
      const cost = calcShishaPrice(pipes, heads, staffSetup);
      addOnTotal += cost;
      breakdown.push({
        label: {
          zh: `Shisha 水煙 (${pipes} 支水煙 / ${heads} 個煙頭${staffSetup ? ' + 人手 setup' : ''})`,
          en: `Shisha (${pipes} pipe${pipes > 1 ? 's' : ''} / ${heads} head${heads > 1 ? 's' : ''}${staffSetup ? ' + staff setup' : ''})`,
        },
        amount: cost,
      });
      continue;
    }
  }

  // BBQ grill fee waiver note
  if (hasBBQPackage) {
    breakdown.push({
      label: { zh: 'BBQ 爐租用費（已豁免）', en: 'BBQ Grill Fee (Waived)' },
      amount: 0,
    });
  }

  // Free drinks note for TST
  if (freeDrinksVenues.includes(venue.id)) {
    breakdown.push({
      label: { zh: '無酒精飲品任飲（已包含）', en: 'Non-Alcoholic Drinks (Included)' },
      amount: 0,
    });
  }

  const subtotal = baseCharge + addOnTotal;
  const securityDeposit = calculateSecurityDeposit(subtotal);
  const grandTotal = subtotal + securityDeposit;
  const deposit = calculateDeposit(grandTotal);

  return {
    baseCharge,
    addOnTotal,
    subtotal,
    securityDeposit,
    grandTotal,
    deposit,
    canInstallment: grandTotal > 10000,
    breakdown,
  };
}

/**
 * Refundable security deposit (按金), returned to the customer within 24h
 * after the event (less any deductions). Tiered against the rental subtotal
 * (rental + add-ons, excluding the security deposit itself):
 *   ≤ HK$4,000  → HK$1,000
 *   ≤ HK$10,000 → HK$2,000
 *   >  HK$10,000 → HK$4,000
 */
export function calculateSecurityDeposit(rentalSubtotal: number): number {
  if (rentalSubtotal > 10000) return 4000;
  if (rentalSubtotal > 4000) return 2000;
  return 1000;
}

/**
 * Amount the customer must pay UPFRONT to confirm a booking. Computed
 * against the GRAND TOTAL (subtotal + security deposit):
 *   grandTotal ≤ HK$10,000 → full payment (deposit = grandTotal, no balance)
 *   grandTotal >  HK$10,000 → 50% deposit; remaining 50% due 2 days before event.
 */
export function calculateDeposit(grandTotal: number): number {
  if (grandTotal <= 10000) return grandTotal;
  return Math.round(grandTotal * 0.5);
}
