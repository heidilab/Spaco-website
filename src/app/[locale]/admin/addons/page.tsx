'use client';

// 附加服務管理 (Heidi 2026-11-13) — staff manage the add-ons themselves
// instead of asking for a code change:
//
//   開放／關閉   whether customers can pick the add-on at all
//   適用分店     the built-in rule, or only the branches ticked here
//   價錢         unit prices; 到會 tier prices and fees; 水煙 prices
//   菜單         BBQ / hotpot menus, the 到會 dish list, 水煙 flavours
//   新增附加服務  a custom add-on (name, per person / item / flat, price,
//                month-close column, supplier order) — id `x-…`, appears
//                in every booking form through pricing.allAddOns()
//
// Every list is edited ONE ROW PER ITEM, Chinese and English side by side
// (the first version used two free-text boxes, which were hard to keep
// lined up — Heidi 2026-11-13).
//
// The settings are layered over the catalog in lib/pricing (lib/addOnConfig)
// and are read by the customer booking pages and by the server when it
// prices a booking. A price change applies to NEW bookings only: saving
// locks the old price onto existing bookings (POST /api/admin/addon-config).

import { useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import { adminApiFetch } from '@/lib/adminApiFetch';
import { loadAllVenues } from '@/lib/venueRegistry';
import { loadAddOnConfig } from '@/lib/addOnConfigClient';
import {
  MENU_EDITABLE_ADDON_IDS, PRICE_EDITABLE_ADDON_IDS, setAddOnConfig, sanitizeAddOnConfig,
  isCustomAddOnId, customAddOnSettings, CUSTOM_ADDON_PREFIX,
  type AddOnConfig, type AddOnSetting, type CustomAddOnSetting, type CustomAddOnUnit, type CustomAddOnCategory,
} from '@/lib/addOnConfig';
import { addOns as ADDON_CATALOG, builtInAddOnMenu, builtInAddOnPrice, shishaPrices } from '@/lib/pricing';
import { CATERING_CATEGORIES } from '@/lib/cateringMenu';
import { cateringItemsAll, cateringTiers, cateringExtraDishFee, cateringDoorstepFee } from '@/lib/cateringCatalog';
import type { Venue } from '@/types';
import { Package, Loader2, Check, RotateCcw, Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';

interface Pair { zh: string; en: string }
interface DishRow { code: string; category: string; zh: string; en: string; price: string; hidden: boolean; tags?: string[] }
interface FlavorRow { id: string; zh: string; en: string; hidden: boolean }
type ShishaPriceKey = 'onePipe' | 'twoPipes' | 'extraHead' | 'staffSetup';

/** A custom add-on's own fields (lib/addOnConfig CustomAddOnSetting). */
interface CustomDraft {
  nameZh: string; nameEn: string; descZh: string; descEn: string;
  unit: CustomAddOnUnit; maxQuantity: string; category: CustomAddOnCategory; supplierOrder: boolean;
}

interface Draft {
  enabled: boolean;
  limitVenues: boolean;
  venueIds: string[];
  price: string;
  venuePrices: Record<string, string>;
  menu: Pair[];
  notes: Pair[];
  // 到會
  dishes: DishRow[];
  tierPrices: Record<string, string>;
  extraDishFee: string;
  doorstepFee: string;
  // 水煙
  flavors: FlavorRow[];
  shisha: Record<ShishaPriceKey, string>;
  // 自訂附加服務 (id `x-…`) only
  custom?: CustomDraft;
}

const NO_SETTINGS: AddOnConfig = {};
const isPriceEditable = (id: string) => (PRICE_EDITABLE_ADDON_IDS as readonly string[]).includes(id) || isCustomAddOnId(id);
const customDraftOf = (c?: CustomAddOnSetting): CustomDraft => ({
  nameZh: c?.name.zh || '', nameEn: c?.name.en || '', descZh: c?.description?.zh || '', descEn: c?.description?.en || '',
  unit: c?.unit || 'item', maxQuantity: c?.maxQuantity ? String(c.maxQuantity) : '',
  category: c?.category || 'other', supplierOrder: !!c?.supplierOrder,
});
const isMenuEditable = (id: string) => (MENU_EDITABLE_ADDON_IDS as readonly string[]).includes(id);
const num = (v: string): number | null => (v.trim() !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null);

const pairsOf = (zh: string[], en: string[]): Pair[] => zh.map((z, i) => ({ zh: z, en: en[i] ?? '' }));
const samePairs = (a: Pair[], b: Pair[]) =>
  JSON.stringify(a.map((p) => [p.zh.trim(), (p.en.trim() || p.zh.trim())])) === JSON.stringify(b.map((p) => [p.zh.trim(), (p.en.trim() || p.zh.trim())]));

function builtInMenuPairs(id: string): { menu: Pair[]; notes: Pair[] } {
  const b = builtInAddOnMenu(id);
  return { menu: b ? pairsOf(b.zh, b.en) : [], notes: b ? pairsOf(b.notes.zh, b.notes.en) : [] };
}
const dishRows = (config: AddOnConfig): DishRow[] => cateringItemsAll(config).map((d) => ({
  code: d.code, category: d.category, zh: d.name.zh, en: d.name.en,
  price: typeof d.price === 'number' ? String(d.price) : '', hidden: !!d.hidden,
  ...(d.tags ? { tags: d.tags } : {}),
}));
const builtInFlavors = (): FlavorRow[] =>
  (ADDON_CATALOG.find((a) => a.id === 'shisha')?.variants || []).map((v) => ({ id: v.id, zh: v.name.zh, en: v.name.en, hidden: false }));
const dishKey = (rows: DishRow[]) => JSON.stringify(rows.map((d) => [d.code.trim(), d.category, d.zh.trim(), d.en.trim() || d.zh.trim(), num(d.price) || 0, d.hidden]));
const flavorKey = (rows: FlavorRow[]) => JSON.stringify(rows.map((f) => [f.id.trim(), f.zh.trim(), f.en.trim() || f.zh.trim(), f.hidden]));

function draftFrom(id: string, config: AddOnConfig): Draft {
  const setting = config[id];
  const built = builtInMenuPairs(id);
  const m = setting?.menu;
  const sp = setting?.shishaPrices;
  return {
    enabled: setting?.enabled !== false,
    limitVenues: Array.isArray(setting?.venueIds),
    venueIds: setting?.venueIds || [],
    price: typeof setting?.price === 'number' ? String(setting.price) : '',
    venuePrices: Object.fromEntries(Object.entries(setting?.venuePrices || {}).map(([k, v]) => [k, String(v)])),
    menu: m ? pairsOf(m.zh, m.en) : built.menu,
    notes: m ? pairsOf(m.notesZh, m.notesEn) : built.notes,
    dishes: id === 'catering' ? dishRows(config) : [],
    tierPrices: Object.fromEntries(Object.entries(setting?.tierPrices || {}).map(([k, v]) => [k, String(v)])),
    extraDishFee: typeof setting?.extraDishFee === 'number' ? String(setting.extraDishFee) : '',
    doorstepFee: typeof setting?.doorstepFee === 'number' ? String(setting.doorstepFee) : '',
    flavors: id === 'shisha'
      ? (setting?.flavors?.map((f) => ({ id: f.id, zh: f.zh, en: f.en, hidden: !!f.hidden })) || builtInFlavors())
      : [],
    shisha: {
      onePipe: typeof sp?.onePipe === 'number' ? String(sp.onePipe) : '',
      twoPipes: typeof sp?.twoPipes === 'number' ? String(sp.twoPipes) : '',
      extraHead: typeof sp?.extraHead === 'number' ? String(sp.extraHead) : '',
      staffSetup: typeof sp?.staffSetup === 'number' ? String(sp.staffSetup) : '',
    },
    ...(isCustomAddOnId(id) ? { custom: customDraftOf(setting?.custom) } : {}),
  };
}

/** What to store for one add-on — only what differs from the built-in
 *  catalog, so untouched parts keep following it. */
function settingFrom(id: string, d: Draft): AddOnSetting {
  const s: AddOnSetting = {};
  if (isCustomAddOnId(id) && d.custom) {
    const c = d.custom;
    const nameZh = c.nameZh.trim();
    const maxQ = num(c.maxQuantity);
    s.custom = {
      name: { zh: nameZh, en: c.nameEn.trim() || nameZh },
      ...(c.descZh.trim() ? { description: { zh: c.descZh.trim(), en: c.descEn.trim() || c.descZh.trim() } } : {}),
      unit: c.unit,
      category: c.category,
      ...(c.unit === 'item' && maxQ ? { maxQuantity: Math.round(maxQ) } : {}),
      ...(c.supplierOrder ? { supplierOrder: true } : {}),
    };
  }
  if (!d.enabled) s.enabled = false;
  if (d.limitVenues) s.venueIds = d.venueIds;
  if (isPriceEditable(id)) {
    const p = num(d.price);
    if (p !== null) s.price = p;
    const vp: Record<string, number> = {};
    for (const [venueId, v] of Object.entries(d.venuePrices)) { const n = num(v); if (n !== null) vp[venueId] = n; }
    if (Object.keys(vp).length > 0) s.venuePrices = vp;
  }
  if (isMenuEditable(id)) {
    const built = builtInMenuPairs(id);
    const menu = d.menu.filter((p) => p.zh.trim());
    const notes = d.notes.filter((p) => p.zh.trim());
    if (menu.length > 0 && !(samePairs(menu, built.menu) && samePairs(notes, built.notes))) {
      s.menu = {
        zh: menu.map((p) => p.zh.trim()), en: menu.map((p) => p.en.trim() || p.zh.trim()),
        notesZh: notes.map((p) => p.zh.trim()), notesEn: notes.map((p) => p.en.trim() || p.zh.trim()),
      };
    }
  }
  if (id === 'catering') {
    if (dishKey(d.dishes) !== dishKey(dishRows(NO_SETTINGS))) {
      s.dishes = d.dishes.filter((r) => r.code.trim() && r.zh.trim()).map((r) => ({
        code: r.code.trim(), category: r.category, zh: r.zh.trim(), en: r.en.trim() || r.zh.trim(),
        ...(num(r.price) ? { price: num(r.price) as number } : {}),
        ...(r.hidden ? { hidden: true } : {}),
        ...(r.tags ? { tags: r.tags } : {}),
      }));
    }
    const tp: Record<string, number> = {};
    for (const t of cateringTiers(NO_SETTINGS)) { const n = num(d.tierPrices[t.id] || ''); if (n !== null && n !== t.price) tp[t.id] = n; }
    if (Object.keys(tp).length > 0) s.tierPrices = tp;
    const extra = num(d.extraDishFee);
    if (extra !== null && extra !== cateringExtraDishFee(NO_SETTINGS)) s.extraDishFee = extra;
    const door = num(d.doorstepFee);
    if (door !== null && door !== cateringDoorstepFee(NO_SETTINGS)) s.doorstepFee = door;
  }
  if (id === 'shisha') {
    if (flavorKey(d.flavors) !== flavorKey(builtInFlavors())) {
      s.flavors = d.flavors.filter((f) => f.id.trim() && f.zh.trim()).map((f) => ({
        id: f.id.trim(), zh: f.zh.trim(), en: f.en.trim() || f.zh.trim(), ...(f.hidden ? { hidden: true } : {}),
      }));
    }
    const built = shishaPrices(NO_SETTINGS);
    const sp: Partial<Record<ShishaPriceKey, number>> = {};
    for (const k of ['onePipe', 'twoPipes', 'extraHead', 'staffSetup'] as const) {
      const n = num(d.shisha[k]);
      if (n !== null && n !== built[k]) sp[k] = n;
    }
    if (Object.keys(sp).length > 0) s.shishaPrices = sp;
  }
  return s;
}

/** Row problems that must be fixed before saving. */
function problemsOf(id: string, d: Draft, zh: boolean): string[] {
  const out: string[] = [];
  const dupes = (values: string[]) => values.filter((v, i) => v && values.indexOf(v) !== i);
  if (isCustomAddOnId(id)) {
    const name = d.custom?.nameZh.trim();
    if (!name) out.push(zh ? '新增附加服務：未填中文名稱' : 'New add-on: Chinese name missing');
    if (num(d.price) === null) out.push(zh ? `${name || '新增附加服務'}：未填價錢（免費請填 0）` : `${name || 'New add-on'}: price missing (enter 0 if free)`);
  }
  if (id === 'catering') {
    const codes = d.dishes.map((r) => r.code.trim());
    if (d.dishes.some((r) => !r.code.trim() || !r.zh.trim())) out.push(zh ? '到會：有菜式未填編號或者中文名' : 'Catering: a dish has no code or Chinese name');
    const dup = Array.from(new Set(dupes(codes)));
    if (dup.length) out.push(zh ? `到會：編號重複（${dup.join('、')}）` : `Catering: duplicate codes (${dup.join(', ')})`);
  }
  if (id === 'shisha') {
    const ids = d.flavors.map((f) => f.id.trim());
    if (d.flavors.some((f) => !f.id.trim() || !f.zh.trim())) out.push(zh ? '水煙：有口味未填編號或者中文名' : 'Shisha: a flavour has no id or Chinese name');
    const dup = Array.from(new Set(dupes(ids)));
    if (dup.length) out.push(zh ? `水煙：口味編號重複（${dup.join('、')}）` : `Shisha: duplicate ids (${dup.join(', ')})`);
  }
  return out;
}

const INPUT = 'w-full border rounded-lg px-2.5 py-1.5 text-sm bg-white';

/** A numbered list edited one row per item, Chinese | English. */
function PairList({ rows, onChange, zh, addLabel }: { rows: Pair[]; onChange: (rows: Pair[]) => void; zh: boolean; addLabel: string }) {
  const set = (i: number, p: Partial<Pair>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div>
      <div className="hidden md:grid grid-cols-[2rem,1fr,1fr,5.5rem] gap-2 text-xs text-gray-500 mb-1 px-1">
        <span>#</span><span>{zh ? '中文' : 'Chinese'}</span><span>English</span><span />
      </div>
      <div className="space-y-1.5">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[2rem,1fr] md:grid-cols-[2rem,1fr,1fr,5.5rem] gap-2 items-center rounded-lg bg-gray-50 p-1.5">
            <span className="text-xs font-semibold text-gray-400 text-center">{i + 1}</span>
            <input value={r.zh} onChange={(e) => set(i, { zh: e.target.value })} placeholder={zh ? '中文' : 'Chinese'} className={INPUT} />
            <input value={r.en} onChange={(e) => set(i, { en: e.target.value })} placeholder={zh ? 'English（留空＝用中文）' : 'English (blank = Chinese)'} className={`${INPUT} col-start-2 md:col-start-auto`} />
            <div className="flex items-center justify-end gap-1 col-start-2 md:col-start-auto">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="p-1.5 rounded hover:bg-gray-200 disabled:opacity-25" title={zh ? '上移' : 'Up'}><ArrowUp className="w-3.5 h-3.5" /></button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} className="p-1.5 rounded hover:bg-gray-200 disabled:opacity-25" title={zh ? '下移' : 'Down'}><ArrowDown className="w-3.5 h-3.5" /></button>
              <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50" title={zh ? '刪除' : 'Remove'}><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => onChange([...rows, { zh: '', en: '' }])} className="mt-2 text-sm text-pink hover:underline inline-flex items-center gap-1">
        <Plus className="w-4 h-4" />{addLabel}
      </button>
    </div>
  );
}

function SectionTitle({ children, onReset, resetLabel }: { children: React.ReactNode; onReset?: () => void; resetLabel?: string }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <div className="font-medium">{children}</div>
      {onReset && (
        <button type="button" onClick={onReset} className="text-xs text-gray-500 hover:underline flex items-center gap-1">
          <RotateCcw className="w-3 h-3" />{resetLabel}
        </button>
      )}
    </div>
  );
}

export default function AddOnsAdminPage() {
  const locale = useLocale() as 'zh' | 'en';
  const zh = locale === 'zh';
  const { hasPermission } = useAuth();
  const canAccess = hasPermission('staff');

  const [venues, setVenues] = useState<Venue[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dishCategory, setDishCategory] = useState(CATERING_CATEGORIES[0].id);
  /** Custom add-on ids in display order (the catalog ones come first). */
  const [customIds, setCustomIds] = useState<string[]>([]);

  function hydrate(config: AddOnConfig) {
    const customs = customAddOnSettings(config).map((c) => c.id);
    setCustomIds(customs);
    setDrafts(Object.fromEntries([...ADDON_CATALOG.map((a) => a.id), ...customs].map((id) => [id, draftFrom(id, config)])));
  }

  useEffect(() => {
    if (!canAccess) return;
    Promise.all([loadAllVenues(), loadAddOnConfig(true)])
      .then(([v, config]) => { setVenues(v.filter((x) => x.active !== false)); hydrate(config); })
      .finally(() => setLoading(false));
  }, [canAccess]);

  const patch = (id: string, p: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...p } }));
  const patchCustom = (id: string, p: Partial<CustomDraft>) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], custom: { ...customDraftOf(), ...(prev[id].custom || {}), ...p } } }));

  /** Add a custom add-on — a new id; the name and price are filled in below. */
  function addCustom() {
    const id = `${CUSTOM_ADDON_PREFIX}${Date.now().toString(36)}`;
    setDrafts((prev) => ({ ...prev, [id]: { ...draftFrom(id, NO_SETTINGS), custom: customDraftOf() } }));
    setCustomIds((prev) => [...prev, id]);
    setOpenId(id);
  }
  /** Remove a custom add-on from the settings (saved on 儲存). Bookings
   *  that already have it keep the name and price stamped on them. */
  function removeCustom(id: string) {
    if (!window.confirm(zh ? '刪除呢個附加服務？已落咗嘅訂單會保留原本項目同價錢。' : 'Delete this add-on? Existing bookings keep it at the price they paid.')) return;
    setCustomIds((prev) => prev.filter((x) => x !== id));
    setDrafts((prev) => { const next = { ...prev }; delete next[id]; return next; });
    if (openId === id) setOpenId(null);
  }

  const allIds = useMemo(() => [...ADDON_CATALOG.map((a) => a.id), ...customIds], [customIds]);
  const items = useMemo(() => {
    const out: AddOnConfig = {};
    for (const id of allIds) {
      const d = drafts[id];
      if (!d) continue;
      const s = settingFrom(id, d);
      if (s.custom) s.custom.sortOrder = customIds.indexOf(id);
      if (Object.keys(s).length > 0) out[id] = s;
    }
    return sanitizeAddOnConfig(out);
  }, [drafts, allIds, customIds]);
  const problems = useMemo(
    () => allIds.flatMap((id) => (drafts[id] ? problemsOf(id, drafts[id], zh) : [])),
    [drafts, allIds, zh],
  );

  async function save() {
    if (problems.length > 0) { setMessage({ ok: false, text: problems.join('；') }); return; }
    setSaving(true); setMessage(null);
    try {
      const res = await adminApiFetch('/api/admin/addon-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'save failed');
      const saved = sanitizeAddOnConfig(data.items);
      setAddOnConfig(saved);
      hydrate(saved);
      setMessage({
        ok: true,
        text: zh
          ? `已儲存，客人頁面即時生效。${data.lockedBookings > 0 ? `有 ${data.lockedBookings} 張現有訂單已鎖定原本價錢，唔會受今次改價影響。` : ''}`
          : `Saved — live on the customer pages.${data.lockedBookings > 0 ? ` ${data.lockedBookings} existing bookings keep their original price.` : ''}`,
      });
    } catch {
      setMessage({ ok: false, text: zh ? '儲存失敗，請再試。' : 'Could not save — please try again.' });
    } finally {
      setSaving(false);
    }
  }

  if (!canAccess) return <div className="p-8 text-gray-500">{zh ? '冇權限' : 'No access'}</div>;

  const unit = (id: string) => {
    const u = isCustomAddOnId(id) ? drafts[id]?.custom?.unit : ADDON_CATALOG.find((a) => a.id === id)?.unit;
    if (id === 'early-setup' || id === 'bbq-helper') return zh ? '每小時' : 'per hour';
    if (u === 'flat') return zh ? '每張訂單' : 'per booking';
    return u === 'person' ? (zh ? '每位' : 'per person') : (zh ? '每個' : 'each');
  };
  /** The rows on the page: the coded catalog, then the custom add-ons. */
  const rows: Array<{ id: string; name: { zh: string; en: string }; custom: boolean }> = [
    ...ADDON_CATALOG.map((a) => ({ id: a.id, name: a.name, custom: false })),
    ...customIds.map((id) => {
      const c = drafts[id]?.custom;
      const zhName = c?.nameZh.trim() || (zh ? '（未命名的新附加服務）' : '(unnamed new add-on)');
      return { id, name: { zh: zhName, en: c?.nameEn.trim() || zhName }, custom: true };
    }),
  ];
  const priceField = (label: string, value: string, placeholder: string | number, onChange: (v: string) => void) => (
    <label className="block">
      <span className="text-xs text-gray-500">{label}</span>
      <input type="number" min={0} value={value} onChange={(e) => onChange(e.target.value)} placeholder={String(placeholder)} className={`${INPUT} mt-1`} />
    </label>
  );

  return (
    <div className="p-4 md:p-8 pb-28 space-y-5 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Package className="w-6 h-6 text-pink" />
          {zh ? '附加服務管理' : 'Add-on Management'}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {zh
            ? '喺呢度開關每個附加服務、揀適用分店、改價錢同菜單。儲存之後客人訂場頁面即時跟住變。改價只影響之後嘅新訂單；已經落咗嘅訂單會保留原本價錢。'
            : 'Switch each add-on on or off, choose its branches, and edit its price and menu. Saving updates the customer booking pages at once. A price change applies to new bookings only; existing bookings keep their price.'}
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>
      ) : (
        <>
          {rows.map((a) => {
            const d = drafts[a.id];
            if (!d) return null;
            const open = openId === a.id;
            const priced = isPriceEditable(a.id);
            const setting = items[a.id];
            const summary = [
              d.enabled ? (zh ? '開放中' : 'On') : (zh ? '已關閉' : 'Off'),
              d.limitVenues ? (zh ? `${d.venueIds.length} 間分店` : `${d.venueIds.length} branches`) : (zh ? '預設分店' : 'default branches'),
              priced && d.price.trim() !== '' ? `$${d.price}` : null,
              setting?.menu ? (zh ? '自訂菜單' : 'custom menu') : null,
              a.id === 'catering' ? (zh ? `${d.dishes.filter((r) => !r.hidden).length} 款菜式` : `${d.dishes.filter((r) => !r.hidden).length} dishes`) : null,
              a.id === 'shisha' ? (zh ? `${d.flavors.filter((f) => !f.hidden).length} 款口味` : `${d.flavors.filter((f) => !f.hidden).length} flavours`) : null,
            ].filter(Boolean).join(' · ');
            return (
              <div key={a.id} className={`bg-white rounded-xl border ${d.enabled ? '' : 'opacity-70'} ${a.custom ? 'border-pink/40' : ''}`}>
                <div className="flex items-center gap-3 p-4">
                  <button type="button" onClick={() => setOpenId(open ? null : a.id)} className="flex-1 text-left">
                    <div className="font-semibold">
                      {a.name[locale]}
                      {a.custom && <span className="ml-2 text-[11px] font-medium text-pink bg-pink/10 rounded-pill px-2 py-0.5 align-middle">{zh ? '自訂' : 'custom'}</span>}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">{summary}</div>
                  </button>
                  <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                    <input type="checkbox" checked={d.enabled} onChange={(e) => patch(a.id, { enabled: e.target.checked })} className="w-4 h-4" />
                    {zh ? '開放俾客人訂' : 'Offered to customers'}
                  </label>
                  <button type="button" onClick={() => setOpenId(open ? null : a.id)} className="text-sm text-pink hover:underline">
                    {open ? (zh ? '收起' : 'Close') : (zh ? '設定' : 'Edit')}
                  </button>
                </div>

                {open && (
                  <div className="border-t p-4 space-y-6 text-sm">
                    {/* ── custom add-on: what it is ── */}
                    {a.custom && d.custom && (
                      <div>
                        <SectionTitle>{zh ? '基本資料' : 'Details'}</SectionTitle>
                        <div className="grid md:grid-cols-2 gap-3">
                          <label className="block">
                            <span className="text-xs text-gray-500">{zh ? '名稱（中文）' : 'Name (Chinese)'} *</span>
                            <input value={d.custom.nameZh} onChange={(e) => patchCustom(a.id, { nameZh: e.target.value })} placeholder={zh ? '例：生日蛋糕 / 氣球佈置' : 'e.g. Birthday cake'} className={`${INPUT} mt-1`} />
                          </label>
                          <label className="block">
                            <span className="text-xs text-gray-500">{zh ? '名稱（英文，留空＝用中文）' : 'Name (English, blank = Chinese)'}</span>
                            <input value={d.custom.nameEn} onChange={(e) => patchCustom(a.id, { nameEn: e.target.value })} className={`${INPUT} mt-1`} />
                          </label>
                          <label className="block">
                            <span className="text-xs text-gray-500">{zh ? '簡介（中文）' : 'Description (Chinese)'}</span>
                            <input value={d.custom.descZh} onChange={(e) => patchCustom(a.id, { descZh: e.target.value })} placeholder={zh ? '客人會喺訂場頁見到' : 'Shown to customers'} className={`${INPUT} mt-1`} />
                          </label>
                          <label className="block">
                            <span className="text-xs text-gray-500">{zh ? '簡介（英文）' : 'Description (English)'}</span>
                            <input value={d.custom.descEn} onChange={(e) => patchCustom(a.id, { descEn: e.target.value })} className={`${INPUT} mt-1`} />
                          </label>
                          <label className="block">
                            <span className="text-xs text-gray-500">{zh ? '收費方式' : 'Charged'}</span>
                            <select value={d.custom.unit} onChange={(e) => patchCustom(a.id, { unit: e.target.value as CustomAddOnUnit })} className={`${INPUT} mt-1`}>
                              <option value="person">{zh ? '每位（按計價人數，小童計半）' : 'Per person (charged guests, children half)'}</option>
                              <option value="item">{zh ? '每個（客人揀數量）' : 'Per item (customer picks a quantity)'}</option>
                              <option value="flat">{zh ? '每張訂單一個價' : 'Flat, once per booking'}</option>
                            </select>
                          </label>
                          {d.custom.unit === 'item' && (
                            <label className="block">
                              <span className="text-xs text-gray-500">{zh ? '最多可訂數量' : 'Maximum quantity'}</span>
                              <input type="number" min={1} value={d.custom.maxQuantity} onChange={(e) => patchCustom(a.id, { maxQuantity: e.target.value })} placeholder="20" className={`${INPUT} mt-1`} />
                            </label>
                          )}
                          <label className="block">
                            <span className="text-xs text-gray-500">{zh ? '月結入邊一欄' : 'Month-close column'}</span>
                            <select value={d.custom.category} onChange={(e) => patchCustom(a.id, { category: e.target.value as CustomAddOnCategory })} className={`${INPUT} mt-1`}>
                              <option value="other">{zh ? '其他（計入「加時/罰款」欄）' : 'Other (加時/罰款 column)'}</option>
                              <option value="bbqHotpot">BBQ / Hotpot</option>
                              <option value="shisha">Shisha</option>
                              <option value="cater">{zh ? '到會' : 'Catering'}</option>
                              <option value="drinks">{zh ? '飲品' : 'Drinks'}</option>
                            </select>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer md:mt-6">
                            <input type="checkbox" checked={d.custom.supplierOrder} onChange={(e) => patchCustom(a.id, { supplierOrder: e.target.checked })} className="w-4 h-4" />
                            <span>{zh ? '要向供應商落單（訂單確認後，供應商落單電郵會列出）' : 'Needs a supplier order (listed in the supplier email on confirmation)'}</span>
                          </label>
                        </div>
                        <button type="button" onClick={() => removeCustom(a.id)} className="mt-3 text-xs text-red-600 hover:underline inline-flex items-center gap-1">
                          <Trash2 className="w-3.5 h-3.5" />{zh ? '刪除呢個附加服務' : 'Delete this add-on'}
                        </button>
                      </div>
                    )}

                    {/* ── branches ── */}
                    <div>
                      <SectionTitle>{zh ? '適用分店' : 'Branches'}</SectionTitle>
                      <label className="flex items-center gap-2 mb-1 cursor-pointer">
                        <input type="radio" checked={!d.limitVenues} onChange={() => patch(a.id, { limitVenues: false })} />
                        {zh ? '跟系統預設（例如冇 BBQ 場嘅分店自動唔顯示 BBQ；已包飲品嘅分店唔顯示飲品）' : 'Built-in rule (e.g. no BBQ where there is no BBQ area)'}
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" checked={d.limitVenues} onChange={() => patch(a.id, { limitVenues: true, venueIds: d.venueIds.length ? d.venueIds : venues.map((v) => v.id) })} />
                        {zh ? '只限以下剔咗嘅分店' : 'Only the branches ticked below'}
                      </label>
                      {d.limitVenues && (
                        <div className="mt-2 ml-6 grid grid-cols-2 md:grid-cols-3 gap-1.5">
                          {venues.map((v) => (
                            <label key={v.id} className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox" checked={d.venueIds.includes(v.id)}
                                onChange={(e) => patch(a.id, { venueIds: e.target.checked ? [...d.venueIds, v.id] : d.venueIds.filter((x) => x !== v.id) })}
                              />
                              {v.name[locale]}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* ── unit price ── */}
                    {priced && (
                      <div>
                        <SectionTitle>{zh ? `價錢（${unit(a.id)}，HK$）` : `Price (${unit(a.id)}, HK$)`}</SectionTitle>
                        <div className="flex items-center gap-2">
                          <span className="text-gray-500 w-32">{zh ? '全部分店' : 'All branches'}</span>
                          <input type="number" min={0} value={d.price} onChange={(e) => patch(a.id, { price: e.target.value })} placeholder={zh ? '留空＝用原本價錢' : 'blank = built-in'} className="border rounded-lg px-3 py-1.5 w-44" />
                        </div>
                        <details className="mt-2">
                          <summary className="cursor-pointer text-pink">{zh ? '個別分店用唔同價錢' : 'Different price at a branch'}</summary>
                          <div className="mt-2 space-y-1.5">
                            {venues.map((v) => (
                              <div key={v.id} className="flex items-center gap-2">
                                <span className="text-gray-500 w-32 truncate">{v.name[locale]}</span>
                                <input
                                  type="number" min={0} value={d.venuePrices[v.id] || ''}
                                  onChange={(e) => patch(a.id, { venuePrices: { ...d.venuePrices, [v.id]: e.target.value } })}
                                  placeholder={`${d.price.trim() !== '' ? d.price : builtInAddOnPrice(a.id, v)}`}
                                  className="border rounded-lg px-3 py-1.5 w-44"
                                />
                              </div>
                            ))}
                            <p className="text-xs text-gray-400">{zh ? '灰色數字係呢間分店而家用緊嘅價錢；留空即係照用。' : 'Grey = the price in use at that branch; leave blank to keep it.'}</p>
                          </div>
                        </details>
                      </div>
                    )}

                    {/* ── BBQ / hotpot menu ── */}
                    {isMenuEditable(a.id) && (
                      <>
                        <div>
                          <SectionTitle onReset={() => patch(a.id, builtInMenuPairs(a.id))} resetLabel={zh ? '還原原本菜單' : 'Restore built-in menu'}>
                            {zh ? `菜單（${d.menu.length} 項）` : `Menu (${d.menu.length} items)`}
                          </SectionTitle>
                          <PairList rows={d.menu} onChange={(menu) => patch(a.id, { menu })} zh={zh} addLabel={zh ? '新增菜式' : 'Add item'} />
                        </div>
                        <div>
                          <SectionTitle>{zh ? `備註（${d.notes.length} 項）` : `Notes (${d.notes.length})`}</SectionTitle>
                          <PairList rows={d.notes} onChange={(notes) => patch(a.id, { notes })} zh={zh} addLabel={zh ? '新增備註' : 'Add note'} />
                        </div>
                      </>
                    )}

                    {/* ── 到會 ── */}
                    {a.id === 'catering' && (
                      <>
                        <div>
                          <SectionTitle>{zh ? '套餐價錢（HK$）' : 'Tier prices (HK$)'}</SectionTitle>
                          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                            {cateringTiers(NO_SETTINGS).map((t) => priceField(
                              zh ? `${t.paxRange.min}–${t.paxRange.max} 人 · 任選 ${t.pickCount} 盤` : `${t.paxRange.min}–${t.paxRange.max} pax · ${t.pickCount} dishes`,
                              d.tierPrices[t.id] || '', t.price,
                              (v) => patch(a.id, { tierPrices: { ...d.tierPrices, [t.id]: v } }),
                            )).map((el, i) => <div key={i}>{el}</div>)}
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-2">
                            {priceField(zh ? '額外每盤' : 'Each extra dish', d.extraDishFee, cateringExtraDishFee(NO_SETTINGS), (v) => patch(a.id, { extraDishFee: v }))}
                            {priceField(zh ? '上門交收' : 'Door-to-door', d.doorstepFee, cateringDoorstepFee(NO_SETTINGS), (v) => patch(a.id, { doorstepFee: v }))}
                          </div>
                          <p className="text-xs text-gray-400 mt-1">{zh ? '灰色數字係原本價錢；留空即係照用。' : 'Grey = the built-in price; leave blank to keep it.'}</p>
                        </div>

                        <div>
                          <SectionTitle onReset={() => patch(a.id, { dishes: dishRows(NO_SETTINGS) })} resetLabel={zh ? '還原原本餐單' : 'Restore built-in menu'}>
                            {zh ? '到會餐單' : 'Catering menu'}
                          </SectionTitle>
                          <div className="flex flex-wrap gap-1.5 mb-3">
                            {CATERING_CATEGORIES.map((c) => {
                              const count = d.dishes.filter((r) => r.category === c.id).length;
                              return (
                                <button
                                  key={c.id} type="button" onClick={() => setDishCategory(c.id)}
                                  className={`px-3 py-1 rounded-full text-xs border ${dishCategory === c.id ? 'bg-pink text-white border-pink' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                                >
                                  {c.label[locale]} <span className="opacity-70">({count})</span>
                                </button>
                              );
                            })}
                          </div>
                          <div className="hidden md:grid grid-cols-[5rem,1fr,1fr,6rem,5.5rem,2rem] gap-2 text-xs text-gray-500 mb-1 px-1">
                            <span>{zh ? '編號' : 'Code'}</span><span>{zh ? '中文名' : 'Chinese'}</span><span>English</span>
                            <span>{dishCategory === 'addon' ? (zh ? '價錢 HK$' : 'Price HK$') : ''}</span>
                            <span>{zh ? '供應中' : 'Offered'}</span><span />
                          </div>
                          <div className="space-y-1.5">
                            {d.dishes.map((r, i) => r.category !== dishCategory ? null : (
                              <div key={i} className={`grid grid-cols-[5rem,1fr] md:grid-cols-[5rem,1fr,1fr,6rem,5.5rem,2rem] gap-2 items-center rounded-lg p-1.5 ${r.hidden ? 'bg-gray-100 opacity-60' : 'bg-gray-50'}`}>
                                <input value={r.code} onChange={(e) => patch(a.id, { dishes: d.dishes.map((x, j) => j === i ? { ...x, code: e.target.value } : x) })} placeholder="101" className={`${INPUT} font-mono`} />
                                <input value={r.zh} onChange={(e) => patch(a.id, { dishes: d.dishes.map((x, j) => j === i ? { ...x, zh: e.target.value } : x) })} placeholder={zh ? '中文名' : 'Chinese'} className={INPUT} />
                                <input value={r.en} onChange={(e) => patch(a.id, { dishes: d.dishes.map((x, j) => j === i ? { ...x, en: e.target.value } : x) })} placeholder="English" className={`${INPUT} col-start-2 md:col-start-auto`} />
                                {r.category === 'addon'
                                  ? <input type="number" min={0} value={r.price} onChange={(e) => patch(a.id, { dishes: d.dishes.map((x, j) => j === i ? { ...x, price: e.target.value } : x) })} placeholder="0" className={`${INPUT} col-start-2 md:col-start-auto`} />
                                  : <span className="hidden md:block text-xs text-gray-400">{zh ? '計入套餐' : 'in tier'}</span>}
                                <label className="flex items-center gap-1.5 text-xs cursor-pointer col-start-2 md:col-start-auto">
                                  <input type="checkbox" checked={!r.hidden} onChange={(e) => patch(a.id, { dishes: d.dishes.map((x, j) => j === i ? { ...x, hidden: !e.target.checked } : x) })} />
                                  {r.hidden ? (zh ? '暫停' : 'Paused') : (zh ? '供應中' : 'On')}
                                </label>
                                <button type="button" onClick={() => patch(a.id, { dishes: d.dishes.filter((_, j) => j !== i) })} className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 justify-self-end" title={zh ? '刪除' : 'Remove'}><Trash2 className="w-3.5 h-3.5" /></button>
                              </div>
                            ))}
                          </div>
                          <button
                            type="button"
                            onClick={() => patch(a.id, { dishes: [...d.dishes, { code: '', category: dishCategory, zh: '', en: '', price: '', hidden: false }] })}
                            className="mt-2 text-sm text-pink hover:underline inline-flex items-center gap-1"
                          >
                            <Plus className="w-4 h-4" />{zh ? '喺呢個分類新增菜式' : 'Add a dish to this category'}
                          </button>
                          <p className="text-xs text-gray-400 mt-2">
                            {zh
                              ? '唔再供應嘅菜式建議取消剔「供應中」而唔係刪除，舊訂單先會繼續顯示返個名。編號唔可以重複。'
                              : 'Prefer un-ticking “Offered” over deleting, so old bookings still show the dish name. Codes must be unique.'}
                          </p>
                        </div>
                      </>
                    )}

                    {/* ── 水煙 ── */}
                    {a.id === 'shisha' && (
                      <>
                        <div>
                          <SectionTitle>{zh ? '價錢（HK$）' : 'Prices (HK$)'}</SectionTitle>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                            {priceField(zh ? '1 支水煙 + 1 個煙頭' : '1 pipe + 1 head', d.shisha.onePipe, shishaPrices(NO_SETTINGS).onePipe, (v) => patch(a.id, { shisha: { ...d.shisha, onePipe: v } }))}
                            {priceField(zh ? '2 支 + 2 個煙頭' : '2 pipes + 2 heads', d.shisha.twoPipes, shishaPrices(NO_SETTINGS).twoPipes, (v) => patch(a.id, { shisha: { ...d.shisha, twoPipes: v } }))}
                            {priceField(zh ? '額外每個煙頭' : 'Each extra head', d.shisha.extraHead, shishaPrices(NO_SETTINGS).extraHead, (v) => patch(a.id, { shisha: { ...d.shisha, extraHead: v } }))}
                            {priceField(zh ? '人手 setup' : 'Staff set-up', d.shisha.staffSetup, shishaPrices(NO_SETTINGS).staffSetup, (v) => patch(a.id, { shisha: { ...d.shisha, staffSetup: v } }))}
                          </div>
                          <p className="text-xs text-gray-400 mt-1">{zh ? '灰色數字係原本價錢；留空即係照用。' : 'Grey = the built-in price; leave blank to keep it.'}</p>
                        </div>
                        <div>
                          <SectionTitle onReset={() => patch(a.id, { flavors: builtInFlavors() })} resetLabel={zh ? '還原原本口味' : 'Restore built-in flavours'}>
                            {zh ? `口味（${d.flavors.length} 款）` : `Flavours (${d.flavors.length})`}
                          </SectionTitle>
                          <div className="hidden md:grid grid-cols-[5rem,1fr,1fr,5.5rem,2rem] gap-2 text-xs text-gray-500 mb-1 px-1">
                            <span>{zh ? '編號' : 'Id'}</span><span>{zh ? '中文名' : 'Chinese'}</span><span>English</span><span>{zh ? '供應中' : 'Offered'}</span><span />
                          </div>
                          <div className="space-y-1.5">
                            {d.flavors.map((f, i) => (
                              <div key={i} className={`grid grid-cols-[5rem,1fr] md:grid-cols-[5rem,1fr,1fr,5.5rem,2rem] gap-2 items-center rounded-lg p-1.5 ${f.hidden ? 'bg-gray-100 opacity-60' : 'bg-gray-50'}`}>
                                <input value={f.id} onChange={(e) => patch(a.id, { flavors: d.flavors.map((x, j) => j === i ? { ...x, id: e.target.value } : x) })} placeholder="A" className={`${INPUT} font-mono`} />
                                <input value={f.zh} onChange={(e) => patch(a.id, { flavors: d.flavors.map((x, j) => j === i ? { ...x, zh: e.target.value } : x) })} placeholder={zh ? '中文名' : 'Chinese'} className={INPUT} />
                                <input value={f.en} onChange={(e) => patch(a.id, { flavors: d.flavors.map((x, j) => j === i ? { ...x, en: e.target.value } : x) })} placeholder="English" className={`${INPUT} col-start-2 md:col-start-auto`} />
                                <label className="flex items-center gap-1.5 text-xs cursor-pointer col-start-2 md:col-start-auto">
                                  <input type="checkbox" checked={!f.hidden} onChange={(e) => patch(a.id, { flavors: d.flavors.map((x, j) => j === i ? { ...x, hidden: !e.target.checked } : x) })} />
                                  {f.hidden ? (zh ? '暫停' : 'Paused') : (zh ? '供應中' : 'On')}
                                </label>
                                <button type="button" onClick={() => patch(a.id, { flavors: d.flavors.filter((_, j) => j !== i) })} className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 justify-self-end" title={zh ? '刪除' : 'Remove'}><Trash2 className="w-3.5 h-3.5" /></button>
                              </div>
                            ))}
                          </div>
                          <button
                            type="button"
                            onClick={() => patch(a.id, { flavors: [...d.flavors, { id: '', zh: '', en: '', hidden: false }] })}
                            className="mt-2 text-sm text-pink hover:underline inline-flex items-center gap-1"
                          >
                            <Plus className="w-4 h-4" />{zh ? '新增口味' : 'Add flavour'}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <button type="button" onClick={addCustom} className="w-full rounded-xl border-2 border-dashed border-pink/40 text-pink hover:bg-pink/5 p-4 text-sm font-semibold inline-flex items-center justify-center gap-2">
            <Plus className="w-4 h-4" />{zh ? '新增附加服務（例如生日蛋糕、氣球佈置、投影機）' : 'Add an add-on (e.g. birthday cake, balloons, projector)'}
          </button>
          <p className="text-xs text-gray-500 -mt-2">
            {zh
              ? '新增後填好名稱、收費方式同價錢，撳「儲存全部設定」—— 客人訂場頁、員工開單、改單、收據、月結同供應商電郵都會自動有埋呢個項目。'
              : 'Fill in the name, how it is charged and the price, then save — it appears in the customer booking page, staff forms, receipts, month close and the supplier email automatically.'}
          </p>

          <div className="sticky bottom-3 bg-white/95 backdrop-blur rounded-xl border p-4 flex flex-wrap items-center gap-3 shadow">
            <button onClick={save} disabled={saving} className="btn-primary text-sm flex items-center gap-2 disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {zh ? '儲存全部設定' : 'Save all settings'}
            </button>
            {message && <span className={`text-sm ${message.ok ? 'text-green-700' : 'text-red-600'}`}>{message.text}</span>}
            {!message && problems.length > 0 && <span className="text-sm text-red-600">{problems.join('；')}</span>}
          </div>
        </>
      )}
    </div>
  );
}
