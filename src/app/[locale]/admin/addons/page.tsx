'use client';

// 附加服務管理 (Heidi 2026-11-13) — staff manage the add-ons themselves
// instead of asking for a code change:
//
//   開放／關閉   whether customers can pick the add-on at all
//   適用分店     the built-in rule, or only the branches ticked here
//   價錢         one price for every branch and/or a price per branch
//   菜單         the BBQ / hotpot package menus customers see
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
import { addOns as ADDON_CATALOG, builtInAddOnMenu, builtInAddOnPrice } from '@/lib/pricing';
import type { Venue } from '@/types';
import { Package, Loader2, Check, RotateCcw } from 'lucide-react';

interface Draft {
  enabled: boolean;
  limitVenues: boolean;
  venueIds: string[];
  price: string;
  venuePrices: Record<string, string>;
  menuZh: string;
  menuEn: string;
  notesZh: string;
  notesEn: string;
}

const lines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean);
const isPriceEditable = (id: string) => (PRICE_EDITABLE_ADDON_IDS as readonly string[]).includes(id);
const isMenuEditable = (id: string) => (MENU_EDITABLE_ADDON_IDS as readonly string[]).includes(id);

function draftFrom(id: string, setting: AddOnSetting | undefined): Draft {
  const builtIn = builtInAddOnMenu(id);
  const menu = setting?.menu;
  return {
    enabled: setting?.enabled !== false,
    limitVenues: Array.isArray(setting?.venueIds),
    venueIds: setting?.venueIds || [],
    price: typeof setting?.price === 'number' ? String(setting.price) : '',
    venuePrices: Object.fromEntries(Object.entries(setting?.venuePrices || {}).map(([k, v]) => [k, String(v)])),
    menuZh: (menu?.zh || builtIn?.zh || []).join('\n'),
    menuEn: (menu?.en?.length ? menu.en : builtIn?.en || []).join('\n'),
    notesZh: (menu ? menu.notesZh : builtIn?.notes.zh || []).join('\n'),
    notesEn: (menu ? (menu.notesEn.length ? menu.notesEn : menu.notesZh) : builtIn?.notes.en || []).join('\n'),
  };
}

function settingFrom(id: string, d: Draft): AddOnSetting {
  const s: AddOnSetting = {};
  if (!d.enabled) s.enabled = false;
  if (d.limitVenues) s.venueIds = d.venueIds;
  if (isPriceEditable(id)) {
    if (d.price.trim() !== '' && Number.isFinite(Number(d.price))) s.price = Number(d.price);
    const vp: Record<string, number> = {};
    for (const [venueId, v] of Object.entries(d.venuePrices)) {
      if (v.trim() !== '' && Number.isFinite(Number(v))) vp[venueId] = Number(v);
    }
    if (Object.keys(vp).length > 0) s.venuePrices = vp;
  }
  if (isMenuEditable(id)) {
    const builtIn = builtInAddOnMenu(id);
    const menu = { zh: lines(d.menuZh), en: lines(d.menuEn), notesZh: lines(d.notesZh), notesEn: lines(d.notesEn) };
    const same = !!builtIn
      && menu.zh.join('\n') === builtIn.zh.join('\n') && menu.en.join('\n') === builtIn.en.join('\n')
      && menu.notesZh.join('\n') === builtIn.notes.zh.join('\n') && menu.notesEn.join('\n') === builtIn.notes.en.join('\n');
    // Only a menu staff actually changed is stored; an untouched one keeps
    // following the built-in menu.
    if (!same && menu.zh.length > 0) s.menu = menu;
  }
  return s;
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

  function hydrate(config: AddOnConfig) {
    setDrafts(Object.fromEntries(ADDON_CATALOG.map((a) => [a.id, draftFrom(a.id, config[a.id])])));
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

  async function save() {
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

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Package className="w-6 h-6 text-primary-600" />
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
            const summary = [
              d.enabled ? (zh ? '開放中' : 'On') : (zh ? '已關閉' : 'Off'),
              d.limitVenues
                ? (zh ? `${d.venueIds.length} 間分店` : `${d.venueIds.length} branches`)
                : (zh ? '預設分店' : 'default branches'),
              priced && d.price.trim() !== '' ? `$${d.price}` : null,
              items[a.id]?.menu ? (zh ? '自訂菜單' : 'custom menu') : null,
            ].filter(Boolean).join(' · ');
            return (
              <div key={a.id} className={`bg-white rounded-xl border ${d.enabled ? '' : 'opacity-70'}`}>
                <div className="flex items-center gap-3 p-4">
                  <button type="button" onClick={() => setOpenId(open ? null : a.id)} className="flex-1 text-left">
                    <div className="font-semibold">{a.name[locale]}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{summary}</div>
                  </button>
                  <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                    <input
                      type="checkbox" checked={d.enabled}
                      onChange={(e) => patch(a.id, { enabled: e.target.checked })}
                      className="w-4 h-4"
                    />
                    {zh ? '開放俾客人訂' : 'Offered to customers'}
                  </label>
                  <button type="button" onClick={() => setOpenId(open ? null : a.id)} className="text-sm text-primary-600 hover:underline">
                    {open ? (zh ? '收起' : 'Close') : (zh ? '設定' : 'Edit')}
                  </button>
                </div>

                {open && (
                  <div className="border-t p-4 space-y-5 text-sm">
                    {/* ── branches ── */}
                    <div>
                      <div className="font-medium mb-2">{zh ? '適用分店' : 'Branches'}</div>
                      <label className="flex items-center gap-2 mb-1 cursor-pointer">
                        <input type="radio" checked={!d.limitVenues} onChange={() => patch(a.id, { limitVenues: false })} />
                        {zh ? '跟系統預設（例如冇 BBQ 場嘅分店自動唔顯示 BBQ；已包飲品嘅分店唔顯示飲品）' : 'Built-in rule (e.g. no BBQ where there is no BBQ area)'}
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio" checked={d.limitVenues}
                          onChange={() => patch(a.id, { limitVenues: true, venueIds: d.venueIds.length ? d.venueIds : venues.map((v) => v.id) })}
                        />
                        {zh ? '只限以下剔咗嘅分店' : 'Only the branches ticked below'}
                      </label>
                      {d.limitVenues && (
                        <div className="mt-2 ml-6 grid grid-cols-2 md:grid-cols-3 gap-1.5">
                          {venues.map((v) => (
                            <label key={v.id} className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox" checked={d.venueIds.includes(v.id)}
                                onChange={(e) => patch(a.id, {
                                  venueIds: e.target.checked ? [...d.venueIds, v.id] : d.venueIds.filter((x) => x !== v.id),
                                })}
                              />
                              {v.name[locale]}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* ── price ── */}
                    {priced ? (
                      <div>
                        <div className="font-medium mb-2">{zh ? `價錢（${unit(a.id)}，HK$）` : `Price (${unit(a.id)}, HK$)`}</div>
                        <div className="flex items-center gap-2">
                          <span className="text-gray-500 w-32">{zh ? '全部分店' : 'All branches'}</span>
                          <input
                            type="number" min={0} value={d.price}
                            onChange={(e) => patch(a.id, { price: e.target.value })}
                            placeholder={zh ? '留空＝用原本價錢' : 'blank = built-in'}
                            className="border rounded-lg px-3 py-1.5 w-40"
                          />
                        </div>
                        <details className="mt-2">
                          <summary className="cursor-pointer text-primary-600">
                            {zh ? '個別分店用唔同價錢' : 'Different price at a branch'}
                          </summary>
                          <div className="mt-2 space-y-1.5">
                            {venues.map((v) => (
                              <div key={v.id} className="flex items-center gap-2">
                                <span className="text-gray-500 w-32 truncate">{v.name[locale]}</span>
                                <input
                                  type="number" min={0} value={d.venuePrices[v.id] || ''}
                                  onChange={(e) => patch(a.id, { venuePrices: { ...d.venuePrices, [v.id]: e.target.value } })}
                                  placeholder={`${d.price.trim() !== '' ? d.price : builtInAddOnPrice(a.id, v)}`}
                                  className="border rounded-lg px-3 py-1.5 w-40"
                                />
                              </div>
                            ))}
                            <p className="text-xs text-gray-400">
                              {zh ? '灰色數字係呢間分店而家用緊嘅價錢；留空即係照用。' : 'Grey = the price in use at that branch; leave blank to keep it.'}
                            </p>
                          </div>
                        </details>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-500">
                        {a.id === 'shisha'
                          ? (zh ? '水煙嘅價錢按支數同人頭自動計，暫時未可以喺呢度改；可以開關同揀分店。' : 'Shisha is priced by pipes and heads automatically — on/off and branches only here.')
                          : (zh ? '到會嘅價錢同菜式由到會餐單決定，暫時未可以喺呢度改；可以開關同揀分店。' : 'Catering is priced from its own menu — on/off and branches only here.')}
                      </p>
                    )}

                    {/* ── menu ── */}
                    {isMenuEditable(a.id) && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <div className="font-medium">{zh ? '菜單（每行一項）' : 'Menu (one item per line)'}</div>
                          <button
                            type="button"
                            onClick={() => patch(a.id, draftMenuFromBuiltIn(a.id))}
                            className="text-xs text-gray-500 hover:underline flex items-center gap-1"
                          >
                            <RotateCcw className="w-3 h-3" />{zh ? '還原原本菜單' : 'Restore built-in menu'}
                          </button>
                        </div>
                        <div className="grid md:grid-cols-2 gap-3">
                          <label className="block">
                            <span className="text-xs text-gray-500">{zh ? '菜式（中文）' : 'Items (Chinese)'}</span>
                            <textarea value={d.menuZh} onChange={(e) => patch(a.id, { menuZh: e.target.value })} rows={10} className="w-full border rounded-lg px-3 py-2 mt-1" />
                          </label>
                          <label className="block">
                            <span className="text-xs text-gray-500">{zh ? '菜式（英文）' : 'Items (English)'}</span>
                            <textarea value={d.menuEn} onChange={(e) => patch(a.id, { menuEn: e.target.value })} rows={10} className="w-full border rounded-lg px-3 py-2 mt-1" />
                          </label>
                          <label className="block">
                            <span className="text-xs text-gray-500">{zh ? '備註（中文）' : 'Notes (Chinese)'}</span>
                            <textarea value={d.notesZh} onChange={(e) => patch(a.id, { notesZh: e.target.value })} rows={4} className="w-full border rounded-lg px-3 py-2 mt-1" />
                          </label>
                          <label className="block">
                            <span className="text-xs text-gray-500">{zh ? '備註（英文）' : 'Notes (English)'}</span>
                            <textarea value={d.notesEn} onChange={(e) => patch(a.id, { notesEn: e.target.value })} rows={4} className="w-full border rounded-lg px-3 py-2 mt-1" />
                          </label>
                        </div>
                      </div>
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
          </div>
        </>
      )}
    </div>
  );
}

/** The four menu fields reset to the built-in menu. */
function draftMenuFromBuiltIn(id: string): Partial<Draft> {
  const b = builtInAddOnMenu(id);
  return {
    menuZh: (b?.zh || []).join('\n'), menuEn: (b?.en || []).join('\n'),
    notesZh: (b?.notes.zh || []).join('\n'), notesEn: (b?.notes.en || []).join('\n'),
  };
}
