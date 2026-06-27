// Self-pick catering menu (自選到會餐單). Single source of truth for
// the catering add-on — used by booking UI, admin tools, customer
// receipts, and (eventually) the admin CMS edit page.
//
// Pricing model:
//   - Customer picks a tier by group size; price is fixed per tier
//     regardless of which items they choose.
//   - Each item has a fixed-price 追加 surcharge (HK$155) EXCEPT items
//     in `additionalDishes` which carry their own price.
//   - Delivery zone adds a flat fee on top.

export type CateringTag = 'chef-pick' | 'mild-spicy' | 'vegetarian' | 'kids-favorite';

export interface CateringItem {
  /** Numeric code as printed on the menu image (e.g. 101, A1). */
  code: string;
  /** Category id — see CATERING_CATEGORIES below. */
  category: string;
  name: { zh: string; en: string };
  /** Optional explicit price — only for items in 追加款式 (A1-A10). */
  price?: number;
  tags?: CateringTag[];
}

export interface CateringCategory {
  id: string;
  label: { zh: string; en: string };
}

export const CATERING_CATEGORIES: CateringCategory[] = [
  { id: 'main',     label: { zh: '營養主食',          en: 'Main Course' } },
  { id: 'side',     label: { zh: '派對熱盤',          en: 'Side Dish' } },
  { id: 'green',    label: { zh: '走肉之選',          en: 'Green Choice' } },
  { id: 'japan',    label: { zh: '料理長發板',        en: 'Japan Food' } },
  { id: 'sushi',    label: { zh: '厚切壽司 & 卷物',    en: 'Sushi & Roll' } },
  { id: 'salad',    label: { zh: '沙律 & 前菜',       en: 'Salad & Appetizer' } },
  { id: 'dessert',  label: { zh: '甜品 / 包點',       en: 'Dessert & Bread' } },
  { id: 'world',    label: { zh: '多國風味（需 2 日前落單）', en: 'World Flavours (2-day notice)' } },
  { id: 'addon',    label: { zh: '追加款式',          en: 'Add-on Dishes' } },
];

export const CATERING_ITEMS: CateringItem[] = [
  // ── 營養主食 Main Course ──
  { code: '101', category: 'main', name: { zh: '中華冷烏冬配胡麻汁（約 2 磅）',         en: 'Chinese cold udon with sesame sauce (~2 lb)' } },
  { code: '102', category: 'main', name: { zh: '日式牛肉炒烏冬（約 2 磅）',           en: 'Japanese stir-fried beef udon (~2 lb)' }, tags: ['chef-pick'] },
  { code: '103', category: 'main', name: { zh: '和風雞肉炒飯（約 2 磅）',             en: 'Japanese-style chicken fried rice (~2 lb)' } },
  { code: '104', category: 'main', name: { zh: '三文魚蟹籽炒飯（約 2 磅）',           en: 'Salmon roe fried rice (~2 lb)' } },
  { code: '105', category: 'main', name: { zh: '蒲燒鰻魚炒飯（約 2 磅）',             en: 'Unagi fried rice (~2 lb)' }, tags: ['chef-pick'] },
  { code: '106', category: 'main', name: { zh: '照燒雞扒飯配日式咖喱（約 2 磅）',       en: 'Teriyaki chicken rice with Japanese curry (~2 lb)' } },
  { code: '107', category: 'main', name: { zh: '雜菇野菜炒烏冬（約 2 磅）',           en: 'Mixed mushroom & vegetable udon (~2 lb)' }, tags: ['vegetarian'] },
  { code: '108', category: 'main', name: { zh: '韓式牛肉炒粉絲（約 2 磅）',           en: 'Korean beef japchae (~2 lb)' } },
  { code: '109', category: 'main', name: { zh: '雙重芝士卡邦尼煙肉燴意大利麵（約 2 磅）', en: 'Double cheese carbonara with bacon (~2 lb)' } },
  { code: '110', category: 'main', name: { zh: '蕃茄肉醬海鮮繪長通粉（約 2 磅）',      en: 'Tomato seafood bolognese penne (~2 lb)' } },

  // ── 派對熱盤 Side Dish ──
  { code: '121', category: 'side', name: { zh: '日式炸餃子 20 件',                    en: 'Japanese fried gyoza × 20' } },
  { code: '122', category: 'side', name: { zh: '和風小丸子 20 件',                    en: 'Takoyaki × 20' }, tags: ['kids-favorite'] },
  { code: '123', category: 'side', name: { zh: '紫心香芋波波 20 件',                  en: 'Purple sweet potato balls × 20' }, tags: ['vegetarian'] },
  { code: '124', category: 'side', name: { zh: '燒日本蕃薯仔 30 件',                  en: 'Roasted Japanese mini sweet potatoes × 30' } },
  { code: '125', category: 'side', name: { zh: '炙燒八爪魚棒 15 支',                  en: 'Torched octopus skewers × 15' } },
  { code: '126', category: 'side', name: { zh: '墨魚天婦羅配甜辣雞醬 25 件',          en: 'Squid tempura with sweet chili sauce × 25' }, tags: ['chef-pick'] },
  { code: '127', category: 'side', name: { zh: '醬燒雞中翼 15 件',                    en: 'Soy-glazed chicken mid-wings × 15' }, tags: ['kids-favorite'] },
  { code: '128', category: 'side', name: { zh: '酥炸魷魚圈配凱薩汁 12 件',            en: 'Crispy squid rings with Caesar dressing × 12' } },
  { code: '129', category: 'side', name: { zh: '鰻魚芝士蟹棒玉子燒 9 件',            en: 'Eel, cheese & crab stick tamagoyaki × 9' } },
  { code: '130', category: 'side', name: { zh: '香酥脆炸魚手指配沙律醬 15 條',        en: 'Crispy fish fingers with salad mayo × 15' } },
  { code: '131', category: 'side', name: { zh: '派對咖喱角・春卷 各 10 件',            en: 'Curry puffs & spring rolls × 10 each' } },

  // ── 走肉之選 Green Choice ──
  { code: '132', category: 'green', name: { zh: '芝士焗北海道忌廉西蘭花（約 2 磅）',     en: 'Hokkaido cream cheese-baked broccoli (~2 lb)' } },
  { code: '133', category: 'green', name: { zh: '日式炒雜菜（約 2 磅）',               en: 'Japanese stir-fried mixed vegetables (~2 lb)' } },
  { code: '134', category: 'green', name: { zh: '日式南瓜及紫薯甘粟薯餅（6 件切 12 塊）', en: 'Japanese pumpkin & purple sweet potato corn cakes (12 pcs)' } },
  { code: '135', category: 'green', name: { zh: '雙色素菜丸（咖喱汁 & 北海道忌廉汁）',   en: 'Twin vegetable balls (curry & Hokkaido cream)' } },
  { code: '136', category: 'green', name: { zh: '日式和風汁炒野菌、蘆筍（約 2 磅）',     en: 'Wafu stir-fried mushrooms & asparagus (~2 lb)' } },
  { code: '137', category: 'green', name: { zh: '日式燒汁茄子拼蘆筍（約 2 磅）',         en: 'Grilled eggplant & asparagus with teriyaki (~2 lb)' } },
  { code: '138', category: 'green', name: { zh: '素・冷烏冬配胡麻汁（約 2 磅）',         en: 'Vegetarian cold udon with sesame sauce (~2 lb)' }, tags: ['vegetarian'] },
  { code: '139', category: 'green', name: { zh: '香烤焗南瓜片（約 20 塊）',             en: 'Roasted pumpkin slices × 20' } },
  { code: '140', category: 'green', name: { zh: '韓風泡菜炒飯（約 2 磅）',             en: 'Korean kimchi fried rice (~2 lb)' }, tags: ['mild-spicy'] },
  { code: '141', category: 'green', name: { zh: '天使與魔鬼一口西多士（約 2 磅）',       en: 'Angel & devil bite-sized French toast (~2 lb)' } },
  { code: '182', category: 'green', name: { zh: '日式素之卷（16 件）',                  en: 'Japanese vegetarian rolls × 16' } },

  // ── 料理長發板 Japan Food ──
  { code: '111', category: 'japan', name: { zh: '鹿兒島風豬軟骨（約 2 磅）',           en: 'Kagoshima-style pork cartilage (~2 lb)' } },
  { code: '112', category: 'japan', name: { zh: '和風生薑豚肉配野菜（約 2 磅）',        en: 'Wafu ginger pork with vegetables (~2 lb)' } },
  { code: '113', category: 'japan', name: { zh: '秘製炭燒豬頸肉 36 片',                en: 'Secret-recipe charcoal-grilled pork collar × 36' } },
  { code: '114', category: 'japan', name: { zh: '博多炭燒雞肉串 15 串',                en: 'Hakata charcoal chicken skewers × 15' }, tags: ['kids-favorite'] },
  { code: '115', category: 'japan', name: { zh: '日式唐揚炸雞配沙律醬 20 件',          en: 'Japanese karaage with salad mayo × 20' } },
  { code: '116', category: 'japan', name: { zh: '香酥芝麻雞全翼 8 隻',                  en: 'Crispy sesame whole chicken wings × 8' } },
  { code: '117', category: 'japan', name: { zh: '香烤日式骨付香腸 10 件',              en: 'Grilled bone-in Japanese sausages × 10' }, tags: ['chef-pick'] },
  { code: '118', category: 'japan', name: { zh: '和風吉列豬扒（15-20 片）',            en: 'Wafu tonkatsu pork chops (15-20 slices)' } },
  { code: '119', category: 'japan', name: { zh: '秘製香辣炸雞槌 12 件',                en: 'Secret-recipe spicy fried chicken drumsticks × 12' }, tags: ['mild-spicy'] },
  { code: '120', category: 'japan', name: { zh: '和風金針菇牛肉卷 12 件',              en: 'Wafu enoki beef rolls × 12' } },

  // ── 厚切壽司 & 卷物 Sushi & Roll ──
  { code: '150', category: 'sushi', name: { zh: '熟・卷物壽司拼盤 25 件（加州卷 8、火龍卷 8、玉子壽司 3、燒蟹柳壽司 3、大蝦壽司 3）', en: 'Cooked sushi & roll platter × 25 (California, Dragon, tamago, grilled crab stick, prawn)' } },
  { code: '151', category: 'sushi', name: { zh: '精選壽司 14 件（炙燒蟹棒 4、玉子 4、吞拿魚沙律 3、蟹籽 3）',                 en: 'Premium sushi × 14 (torched crab stick, tamago, tuna salad, crab roe)' } },
  { code: '152', category: 'sushi', name: { zh: '小卷拼盤 64 件（玉子蟹柳青瓜千本漬）',  en: 'Mini roll platter × 64 (tamago / crab / cucumber / pickled radish)' }, tags: ['kids-favorite'] },
  { code: '153', category: 'sushi', name: { zh: '三文魚壽司盛 24 件（三文魚 4、三文魚腩 2、辣味三文魚 2、三文魚小卷 16）', en: 'Salmon sushi platter × 24 (salmon, salmon belly, spicy salmon, mini salmon rolls)' }, tags: ['chef-pick'] },
  { code: '154', category: 'sushi', name: { zh: '韓式辣炒豚肉紫菜卷 24 件',            en: 'Korean spicy pork seaweed rolls × 24' } },
  { code: '155', category: 'sushi', name: { zh: '招牌三文魚飯糰 8 件',                  en: 'Signature salmon rice balls × 8' }, tags: ['kids-favorite'] },

  // ── 沙律 & 前菜 Salad & Appetizer ──
  { code: '142', category: 'salad', name: { zh: '三色珍味拼盤（螺肉 / 中華沙律 / 帶子裙邊）每款 100g', en: 'Tri-colour delicacy platter (whelk / Chinese salad / scallop fringe) 100g each' }, tags: ['chef-pick'] },
  { code: '143', category: 'salad', name: { zh: '牛油果田園沙律配胡麻汁（1 份）',        en: 'Avocado garden salad with sesame dressing (1 portion)' }, tags: ['vegetarian'] },
  { code: '144', category: 'salad', name: { zh: '和風薯仔沙律（1 份）',                 en: 'Wafu potato salad (1 portion)' } },
  { code: '145', category: 'salad', name: { zh: '健康雞胸沙律配柚子汁（1 份）',         en: 'Healthy chicken breast salad with yuzu dressing (1 portion)' } },
  { code: '146', category: 'salad', name: { zh: '三文魚牛油果沙律配凱撒汁（1 份）',     en: 'Salmon avocado salad with Caesar dressing (1 portion)' } },
  { code: '147', category: 'salad', name: { zh: '香芒大蝦沙律（1 份）',                 en: 'Mango prawn salad (1 portion)' } },
  { code: '148', category: 'salad', name: { zh: '芫荽涼拌芝麻手撕雞（1 份）',           en: 'Cilantro sesame hand-shredded chicken (1 portion)' } },
  { code: '149', category: 'salad', name: { zh: '蟹籽沙律（1 份, 可轉蟹籽沙律杯）',     en: 'Crab roe salad (1 portion, or as salad cups)' } },
  { code: '181', category: 'salad', name: { zh: '法式煙鴨胸肉菠蘿沙律杯 12 杯',         en: 'French smoked duck breast & pineapple salad cups × 12' } },

  // ── 甜品 / 包點 Dessert & Bread ──
  { code: '170', category: 'dessert', name: { zh: '芝士吞拿魚三文治（12 件）',          en: 'Cheese tuna sandwiches × 12' } },
  { code: '171', category: 'dessert', name: { zh: '蘋果牛奶流沙包（9 件）',            en: 'Apple milk lava buns × 9' } },
  { code: '172', category: 'dessert', name: { zh: 'Tiramisu 意式芝士蛋糕杯（12 件）',   en: 'Tiramisu Italian cheesecake cups × 12' }, tags: ['chef-pick'] },
  { code: '173', category: 'dessert', name: { zh: '一口藍莓芝士蛋糕（12 件）',          en: 'Mini blueberry cheesecakes × 12' } },
  { code: '174', category: 'dessert', name: { zh: '比利時朱古力布朗尼（16 件）',        en: 'Belgian chocolate brownies × 16' } },
  { code: '175', category: 'dessert', name: { zh: '法式繽紛低卡馬卡龍（12 件）',        en: 'French low-cal colourful macarons × 12' } },
  { code: '176', category: 'dessert', name: { zh: '日式忌廉泡芙（16 粒）',              en: 'Japanese cream puffs × 16' }, tags: ['kids-favorite'] },
  { code: '177', category: 'dessert', name: { zh: '蛋黃醬蜜桃吞拿魚酥（9 件）',         en: 'Egg mayo peach tuna puff pastry × 9' } },
  { code: '178', category: 'dessert', name: { zh: '荔枝蟹肉撻配飛魚籽（9 件）',         en: 'Lychee crab tarts with flying fish roe × 9' } },
  { code: '179', category: 'dessert', name: { zh: '他他蛋沙律鮮蕃茄迷你牛角包（10 個）', en: 'Tartare egg salad & tomato mini croissants × 10' } },
  { code: '180', category: 'dessert', name: { zh: '繽紛甜甜圈冬甩三重奏 12 件',        en: 'Colourful doughnut trio × 12' } },

  // ── 多國風味 World Flavours (2-day notice) ──
  { code: '156', category: 'world', name: { zh: '美式蜜汁即燒豬肋骨（約 12 支骨）',     en: 'American honey BBQ pork ribs (~12 ribs)' } },
  { code: '157', category: 'world', name: { zh: '芝士肉鬆培根蔥油手抓餅 9 件',          en: 'Cheese, pork floss, bacon & scallion pancake × 9' } },
  { code: '158', category: 'world', name: { zh: '越式鮮蝦長春卷配噲汁 12 條',          en: 'Vietnamese prawn spring rolls with hoisin × 12' } },
  { code: '159', category: 'world', name: { zh: '泰式酸辣無骨鳳爪配蜜糖芥末醬 12 隻',  en: 'Thai sour-spicy boneless chicken feet with honey mustard × 12' } },
  { code: '160', category: 'world', name: { zh: '地中海風味素菜薄餅 9 件',              en: 'Mediterranean vegetable flatbread × 9' } },
  { code: '161', category: 'world', name: { zh: '墨西哥蔬菜雞肉卷配胡麻醬 12 件',      en: 'Mexican veggie & chicken wraps with sesame sauce × 12' } },
  { code: '162', category: 'world', name: { zh: '香脆爆汁一口生煎包（18 件）',          en: 'Crispy bite-sized pan-fried buns × 18' } },
  { code: '163', category: 'world', name: { zh: '古早風味鹽酥雞（20-24 件）',          en: 'Taiwanese-style salt & pepper chicken (20-24 pcs)' } },
  { code: '164', category: 'world', name: { zh: '寶島甜不辣拼台灣腸（各 12 件）',       en: 'Taiwanese tempura & sausage platter × 12 each' } },
  { code: '165', category: 'world', name: { zh: '黑松露熔岩芝士炸薯角 1 份',            en: 'Black truffle molten cheese potato wedges (1 portion)' } },

  // ── 追加款式 Add-on Dishes (with own prices) ──
  { code: 'A1',  category: 'addon', name: { zh: '派對手打檸檬茶（5 升）',              en: 'Party-style handcrafted lemon tea (5 L)' }, price: 298, tags: ['chef-pick'] },
  { code: 'A2',  category: 'addon', name: { zh: '港式檸檬柚子蜜（5 升）',              en: 'HK-style lemon yuzu honey (5 L)' }, price: 298 },
  { code: 'A3',  category: 'addon', name: { zh: '桶裝珍珠奶茶（5 升）',                en: 'Bucket pearl milk tea (5 L)' }, price: 298, tags: ['kids-favorite'] },
  { code: 'A4',  category: 'addon', name: { zh: '桶裝夏日水果茶（5 升）',              en: 'Bucket summer fruit tea (5 L)' }, price: 298 },
  { code: 'A5',  category: 'addon', name: { zh: '椰子花膠雞湯（2.4 升）',              en: 'Coconut fish maw chicken soup (2.4 L)' }, price: 358 },
  { code: 'A6',  category: 'addon', name: { zh: '蟲草花螺片姬茸花膠雞湯（2.4 升）',    en: 'Cordyceps, whelk & maitake fish maw chicken soup (2.4 L)' }, price: 358 },
  { code: 'A7',  category: 'addon', name: { zh: '傳統蠔豉冬菇花膠雞湯（2.4 升）',      en: 'Traditional oyster, mushroom & fish maw chicken soup (2.4 L)' }, price: 358 },
  { code: 'A8',  category: 'addon', name: { zh: '招牌燒羊架（8 件）',                  en: 'Signature roasted lamb rack × 8' }, price: 468 },
  { code: 'A9',  category: 'addon', name: { zh: '極上壽司盛 40 件',                    en: 'Premium sushi platter × 40' }, price: 728, tags: ['chef-pick'] },
  { code: 'A10', category: 'addon', name: { zh: '精選刺身組合 A 64 件（三文魚刺身 36 片 / 甘蝦刺身 18 隻 / 油甘魚刺身 10 片）', en: 'Premium sashimi combo A × 64 (salmon 36 / amaebi 18 / yellowtail 10)' }, price: 968 },
];

/** Tier pricing by group size — customer picks one tier, gets to choose
 *  N dishes from the menu (excluding 追加款式). Add-on dishes are a la
 *  carte on top of the tier price. */
export interface CateringTier {
  id: string;
  paxRange: { min: number; max: number };
  pickCount: number;
  price: number;
}

export const CATERING_TIERS: CateringTier[] = [
  { id: 'tier-10', paxRange: { min: 10, max: 12 }, pickCount: 12, price: 1808 },
  { id: 'tier-13', paxRange: { min: 13, max: 16 }, pickCount: 16, price: 2390 },
  { id: 'tier-17', paxRange: { min: 17, max: 20 }, pickCount: 20, price: 2988 },
  { id: 'tier-28', paxRange: { min: 28, max: 30 }, pickCount: 30, price: 4468 },
  { id: 'tier-38', paxRange: { min: 38, max: 40 }, pickCount: 40, price: 5920 },
];

/** Flat fee per extra dish beyond the tier's included count (excluding
 *  追加款式 — those carry their own per-item price). */
export const CATERING_EXTRA_DISH_FEE = 155;

/** Delivery zone surcharges. Each booking picks one zone. */
export interface CateringDeliveryZone {
  id: string;
  label: { zh: string; en: string };
  fee: number;
}

export const CATERING_DELIVERY_ZONES: CateringDeliveryZone[] = [
  { id: 'kowloon-hkisland', label: { zh: '全九龍 / 港島區', en: 'All Kowloon / HK Island' },                          fee: 0 },
  { id: 'nt-southern',      label: { zh: '新界區 / 南區',     en: 'New Territories / Southern District' },              fee: 0 },
  { id: 'remote',           label: { zh: '偏遠地區及沙頭角（禁區前）/ 離島區', en: 'Remote areas, Sha Tau Kok (before restricted), outlying islands' }, fee: 80 },
  { id: 'restricted',       label: { zh: '禁區及馬灣',         en: 'Restricted area & Ma Wan' },                          fee: 300 },
];

/** Pickup vs door-to-door delivery surcharge. */
export const CATERING_DOORSTEP_DELIVERY_FEE = 150;

/** Disposable cutlery options. */
export const CATERING_NO_CUTLERY_DISCOUNT = 10;     // 走餐具每單 −$10
export const CATERING_EXTRA_CUTLERY_SET_FEE = 3;    // 額外每 Set $3
export const CATERING_EXTRA_FOOD_TONG_FEE = 9;      // 額外每個食物夾 $9

/** Booking lead time — orders must be placed ≥ 2 days before event. */
export const CATERING_MIN_LEAD_DAYS = 2;

/** Categories with their own lead time — currently 多國風味 (world)
 *  needs 2 days same as everything else; surfacing the constraint as
 *  data in case admin wants to change per-category later. */
export const CATERING_CATEGORY_LEAD_DAYS: Record<string, number> = {
  world: 2,
};
