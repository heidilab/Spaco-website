'use client';

// 附加服務管理 (Heidi 2026-11-13) — staff manage the add-ons themselves
// instead of asking for a code change:
//
//   開放／關閉   whether customers can pick the add-on at all
//   適用分店     the built-in rule, or only the branches ticked here
//   價錢         unit prices; 到會 tier prices and fees; 水煙 prices
//   菜單         BBQ / hotpot menus, the 到會 dish list, 水煙 flavours
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
  type AddOnConfig, type AddOnSetting,
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
}

const NO_SETTINGS: AddOnConfig = {};
const isPriceEditable = (id: string) => (PRICE_EDITABLE_ADDON_IDS as readonly string[]).includes(id);
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
  };
}

/** What to store for one add-on — only what differs from the built-in
 *  catalog, so untouched parts keep following it. */
function settingFrom(id: string, d: Draft): AddOnSetting {
  const s: AddOnSetting = {};
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

  function hydrate(config: AddOnConfig) {
    setDrafts(Object.fromEntries(ADDON_CATALOG.map((a) => [a.id, draftFrom(a.id, config)])));
  }

  useEffect(() => {
    if (!canAccess) return;
    Promise.all([loadAllVenues(), loadAddOnConfig(true)])
      .then(([v, config]) => { setVenues(v.filter((x) => x.active !== false)); hydrate(config); })
      .finally(() => setLoading(false));
  }, [canAccess]);

  const patch = (id: string, p: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...p } }));

  const items = useMemo(() => {
    const out: AddOnConfig = {};
    for (const a of ADDON_CATALOG) {
      const d = drafts[a.id];
      if (!d) continue;
      const s = settingFrom(a.id, d);
      if (Object.keys(s).length > 0) out[a.id] = s;
    }
    return sanitizeAddOnConfig(out);
  }, [drafts]);
  const problems = useMemo(
    () => ADDON_CATALOG.flatMap((a) => (drafts[a.id] ? problemsOf(a.id, drafts[a.id], zh) : [])),
    [drafts, zh],
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
    const u = ADDON_CATALOG.find((a) => a.id === id)?.unit;
    if (id === 'early-setup' || id === 'bbq-helper') return zh ? '每小時' : 'per hour';
    return u === 'person' ? (zh ? '每位' : 'per person') : (zh ? '每個' : 'each');
  };
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
          {ADDON_CATALOG.map((a) => {
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
              <div key={a.id} className={`bg-white rounded-xl border ${d.enabled ? '' : 'opacity-70'}`}>
                <div className="flex items-center gap-3 p-4">
                  <button type="button" onClick={() => setOpenId(open ? null : a.id)} className="flex-1 text-left">
                    <div className="font-semibold">{a.name[locale]}</div>
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
