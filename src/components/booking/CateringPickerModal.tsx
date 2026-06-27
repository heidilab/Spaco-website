'use client';

/**
 * CateringPickerModal — shared component used by the customer venue
 * page, admin/bookings/new, and admin/bookings/[id]. Renders the full
 * 美食到會 self-pick experience: tier choice → dish multi-select →
 * delivery zone → cutlery options, with a live running total.
 *
 * Opens as a modal. On Save it returns a fully-resolved options
 * object the caller should attach to the catering add-on entry.
 */

import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X as XIcon, Plus, Minus, Sparkles, Leaf, Flame, Baby } from 'lucide-react';
import {
  CATERING_CATEGORIES,
  CATERING_ITEMS,
  CATERING_TIERS,
  CATERING_DELIVERY_ZONES,
  CATERING_EXTRA_DISH_FEE,
  CATERING_DOORSTEP_DELIVERY_FEE,
  CATERING_NO_CUTLERY_DISCOUNT,
  CATERING_EXTRA_CUTLERY_SET_FEE,
  CATERING_EXTRA_FOOD_TONG_FEE,
  CATERING_MIN_LEAD_DAYS,
  type CateringTag,
} from '@/lib/cateringMenu';
import { calcCateringTotal } from '@/lib/pricing';

export interface CateringSelection {
  tierId: string;
  dishCodes: string[];
  deliveryZoneId: string;
  doorstepDelivery: boolean;
  noCutlery: boolean;
  extraCutlerySets: number;
  extraFoodTongs: number;
}

interface Props {
  open: boolean;
  initial?: Partial<CateringSelection>;
  locale: 'zh' | 'en';
  /** Booking date YYYY-MM-DD — used to enforce the ≥2-day lead time. */
  bookingDate?: string;
  onClose: () => void;
  onSave: (selection: CateringSelection) => void;
  onRemove?: () => void;
}

const TAG_META: Record<CateringTag, { zh: string; en: string; cls: string; Icon: typeof Sparkles }> = {
  'chef-pick':     { zh: '廚師推介', en: 'Chef',     cls: 'bg-pink/10 text-pink',           Icon: Sparkles },
  'mild-spicy':    { zh: '微辣',     en: 'Mild',     cls: 'bg-rose-100 text-rose-700',      Icon: Flame },
  'vegetarian':    { zh: '素食',     en: 'Veggie',   cls: 'bg-emerald-50 text-emerald-700', Icon: Leaf },
  'kids-favorite': { zh: '小朋友最愛', en: 'Kids',     cls: 'bg-amber-50 text-amber-700',     Icon: Baby },
};

export default function CateringPickerModal({
  open, initial, locale, bookingDate, onClose, onSave, onRemove,
}: Props) {
  const [tierId, setTierId] = useState(initial?.tierId || CATERING_TIERS[0].id);
  const [dishCodes, setDishCodes] = useState<string[]>(initial?.dishCodes || []);
  const [deliveryZoneId, setDeliveryZoneId] = useState(initial?.deliveryZoneId || CATERING_DELIVERY_ZONES[0].id);
  const [doorstepDelivery, setDoorstepDelivery] = useState(!!initial?.doorstepDelivery);
  const [noCutlery, setNoCutlery] = useState(!!initial?.noCutlery);
  const [extraCutlerySets, setExtraCutlerySets] = useState(initial?.extraCutlerySets || 0);
  const [extraFoodTongs, setExtraFoodTongs] = useState(initial?.extraFoodTongs || 0);
  const [activeCategory, setActiveCategory] = useState<string>('main');
  const [activeTagFilter, setActiveTagFilter] = useState<CateringTag | null>(null);

  // Re-hydrate when the modal reopens with a different initial set.
  useEffect(() => {
    if (open) {
      setTierId(initial?.tierId || CATERING_TIERS[0].id);
      setDishCodes(initial?.dishCodes || []);
      setDeliveryZoneId(initial?.deliveryZoneId || CATERING_DELIVERY_ZONES[0].id);
      setDoorstepDelivery(!!initial?.doorstepDelivery);
      setNoCutlery(!!initial?.noCutlery);
      setExtraCutlerySets(initial?.extraCutlerySets || 0);
      setExtraFoodTongs(initial?.extraFoodTongs || 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const tier = CATERING_TIERS.find((t) => t.id === tierId)!;
  const selectedItems = CATERING_ITEMS.filter((d) => dishCodes.includes(d.code));
  const nonAddonSelectedCount = selectedItems.filter((d) => d.category !== 'addon').length;
  const overTierCount = Math.max(0, nonAddonSelectedCount - tier.pickCount);

  const total = useMemo(() => calcCateringTotal({
    tierId, dishCodes, deliveryZoneId, doorstepDelivery, noCutlery, extraCutlerySets, extraFoodTongs,
  }), [tierId, dishCodes, deliveryZoneId, doorstepDelivery, noCutlery, extraCutlerySets, extraFoodTongs]);

  // Lead-time check (≥2 days from today).
  const leadDaysOK = (() => {
    if (!bookingDate) return true;
    const bookingMs = new Date(`${bookingDate}T00:00:00+08:00`).getTime();
    return bookingMs >= Date.now() + CATERING_MIN_LEAD_DAYS * 24 * 60 * 60 * 1000;
  })();

  const visibleItems = CATERING_ITEMS
    .filter((d) => d.category === activeCategory)
    .filter((d) => !activeTagFilter || (d.tags || []).includes(activeTagFilter));

  const toggleDish = (code: string) => {
    setDishCodes((prev) => prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]);
  };

  const handleSave = () => {
    onSave({
      tierId, dishCodes, deliveryZoneId, doorstepDelivery, noCutlery, extraCutlerySets, extraFoodTongs,
    });
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-charcoal/40 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-6"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
          className="w-full max-w-5xl bg-white rounded-t-3xl md:rounded-3xl shadow-2xl max-h-[95vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-charcoal/10">
            <div>
              <h2 className="text-xl font-bold font-display text-ink">
                {locale === 'zh' ? '美食到會餐單' : 'Catering Menu'}
              </h2>
              <p className="text-xs text-ink-soft mt-0.5">
                {locale === 'zh'
                  ? `揀好 tier → 揀心儀菜式 → 揀送貨方式（最少 ${CATERING_MIN_LEAD_DAYS} 日預訂）`
                  : `Pick tier → pick dishes → pick delivery (≥${CATERING_MIN_LEAD_DAYS}-day notice)`}
              </p>
            </div>
            <button onClick={onClose} className="w-9 h-9 rounded-full bg-charcoal/5 hover:bg-charcoal/10 flex items-center justify-center">
              <XIcon size={18} className="text-ink" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
            {!leadDaysOK && (
              <div className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-xs text-rose-700">
                {locale === 'zh'
                  ? `⚠️ 你嘅預訂日期距今唔夠 ${CATERING_MIN_LEAD_DAYS} 日，請改較遲嘅日子或 WhatsApp 聯絡 CS。`
                  : `⚠️ Booking date is < ${CATERING_MIN_LEAD_DAYS} days away. Pick a later date or contact CS.`}
              </div>
            )}

            {/* Tier picker */}
            <div>
              <h3 className="text-sm font-bold mb-2 text-ink">
                {locale === 'zh' ? '人數套餐' : 'Group-size tier'}
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                {CATERING_TIERS.map((t) => {
                  const active = tierId === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTierId(t.id)}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        active ? 'border-pink bg-pink/5 ring-1 ring-pink' : 'border-charcoal/10 hover:border-charcoal/30'
                      }`}
                    >
                      <p className="text-xs text-ink-soft">{locale === 'zh' ? `${t.paxRange.min}-${t.paxRange.max} 人` : `${t.paxRange.min}-${t.paxRange.max} pax`}</p>
                      <p className="font-bold text-ink text-sm">{locale === 'zh' ? `任選 ${t.pickCount} 盤` : `${t.pickCount} dishes`}</p>
                      <p className="text-xs font-bold font-display text-gradient-pink mt-1">HK${t.price.toLocaleString()}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Category tabs + tag filter */}
            <div>
              <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                <div className="flex gap-1.5 overflow-x-auto pb-1 flex-1 min-w-0">
                  {CATERING_CATEGORIES.map((c) => {
                    const active = activeCategory === c.id;
                    const cnt = CATERING_ITEMS.filter((d) => d.category === c.id && dishCodes.includes(d.code)).length;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setActiveCategory(c.id)}
                        className={`shrink-0 px-3 py-1.5 rounded-pill text-xs font-semibold transition-colors ${
                          active ? 'bg-charcoal text-white' : 'bg-charcoal/5 text-ink hover:bg-charcoal/10'
                        }`}
                      >
                        {c.label[locale]}{cnt > 0 ? ` · ${cnt}` : ''}
                      </button>
                    );
                  })}
                </div>
                <div className="flex gap-1 shrink-0">
                  {(['chef-pick', 'mild-spicy', 'vegetarian', 'kids-favorite'] as CateringTag[]).map((tag) => {
                    const M = TAG_META[tag];
                    const active = activeTagFilter === tag;
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => setActiveTagFilter(active ? null : tag)}
                        className={`px-2 py-1 rounded-pill text-[10px] font-semibold inline-flex items-center gap-1 transition-all ${
                          active ? `${M.cls} ring-1 ring-current` : 'bg-charcoal/5 text-ink-soft hover:bg-charcoal/10'
                        }`}
                        title={M[locale]}
                      >
                        <M.Icon size={10} />
                        {M[locale]}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Dish grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {visibleItems.map((d) => {
                  const selected = dishCodes.includes(d.code);
                  return (
                    <button
                      key={d.code}
                      type="button"
                      onClick={() => toggleDish(d.code)}
                      className={`text-left p-3 rounded-xl border transition-all ${
                        selected ? 'border-pink bg-pink/5 ring-1 ring-pink' : 'border-charcoal/10 hover:border-charcoal/30 bg-white'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-ink-soft font-mono">{d.code}</p>
                          <p className="text-sm font-semibold text-ink leading-snug">{d.name[locale]}</p>
                          {d.tags && d.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {d.tags.map((t) => {
                                const M = TAG_META[t];
                                return (
                                  <span key={t} className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-pill inline-flex items-center gap-0.5 ${M.cls}`}>
                                    <M.Icon size={8} /> {M[locale]}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>
                        {d.price && (
                          <span className="text-xs font-bold font-display text-pink whitespace-nowrap">+${d.price}</span>
                        )}
                        <div className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center ${selected ? 'border-pink bg-pink text-white' : 'border-charcoal/20'}`}>
                          {selected && <span className="text-[10px] font-bold">✓</span>}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Delivery + cutlery */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-charcoal/5">
                <h4 className="text-sm font-bold mb-2 text-ink">{locale === 'zh' ? '送貨方式' : 'Delivery'}</h4>
                <select
                  value={deliveryZoneId}
                  onChange={(e) => setDeliveryZoneId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-charcoal/15 text-sm bg-white mb-2"
                >
                  {CATERING_DELIVERY_ZONES.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.label[locale]}{z.fee > 0 ? ` (+$${z.fee})` : ''}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-xs text-ink cursor-pointer">
                  <input type="checkbox" checked={doorstepDelivery} onChange={(e) => setDoorstepDelivery(e.target.checked)} className="w-4 h-4" />
                  <span>{locale === 'zh' ? `上門交收 (+HK$${CATERING_DOORSTEP_DELIVERY_FEE})` : `Door-to-door (+HK$${CATERING_DOORSTEP_DELIVERY_FEE})`}</span>
                </label>
              </div>
              <div className="p-4 rounded-xl bg-charcoal/5">
                <h4 className="text-sm font-bold mb-2 text-ink">{locale === 'zh' ? '餐具選項' : 'Cutlery'}</h4>
                <label className="flex items-center gap-2 text-xs text-ink cursor-pointer mb-2">
                  <input type="checkbox" checked={noCutlery} onChange={(e) => setNoCutlery(e.target.checked)} className="w-4 h-4" />
                  <span>{locale === 'zh' ? `走餐具 (−HK$${CATERING_NO_CUTLERY_DISCOUNT})` : `No cutlery (−HK$${CATERING_NO_CUTLERY_DISCOUNT})`}</span>
                </label>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <Stepper label={locale === 'zh' ? '額外餐具' : 'Extra sets'} unitFee={CATERING_EXTRA_CUTLERY_SET_FEE} value={extraCutlerySets} onChange={setExtraCutlerySets} />
                  <Stepper label={locale === 'zh' ? '額外食物夾' : 'Extra tongs'}  unitFee={CATERING_EXTRA_FOOD_TONG_FEE}  value={extraFoodTongs}   onChange={setExtraFoodTongs} />
                </div>
              </div>
            </div>
          </div>

          {/* Footer summary */}
          <div className="border-t border-charcoal/10 px-6 py-4 space-y-2">
            <div className="flex items-center justify-between gap-3 text-sm">
              <div className="text-ink-soft">
                <span className="font-semibold text-ink">
                  {locale === 'zh' ? `已揀 ${nonAddonSelectedCount} / ${tier.pickCount} 盤` : `${nonAddonSelectedCount} / ${tier.pickCount} dishes`}
                </span>
                {overTierCount > 0 && (
                  <span className="ml-2 text-amber-700">
                    {locale === 'zh' ? `(額外 ${overTierCount} × HK$${CATERING_EXTRA_DISH_FEE})` : `(+${overTierCount} × HK$${CATERING_EXTRA_DISH_FEE})`}
                  </span>
                )}
              </div>
              <p className="text-2xl font-bold font-display text-gradient-pink">HK${total.toLocaleString()}</p>
            </div>
            <div className="flex gap-2">
              {onRemove && (
                <button type="button" onClick={onRemove} className="px-4 py-2 rounded-pill bg-rose-50 text-rose-700 text-sm font-semibold hover:bg-rose-100">
                  {locale === 'zh' ? '移除美食到會' : 'Remove catering'}
                </button>
              )}
              <button type="button" onClick={onClose} className="ml-auto px-4 py-2 rounded-pill bg-charcoal/5 text-ink text-sm font-semibold hover:bg-charcoal/10">
                {locale === 'zh' ? '取消' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!leadDaysOK || nonAddonSelectedCount === 0}
                className="px-5 py-2 rounded-pill bg-gradient-pink text-white text-sm font-bold shadow-glow disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {locale === 'zh' ? '儲存' : 'Save'}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function Stepper({ label, unitFee, value, onChange }: { label: string; unitFee: number; value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center justify-between bg-white rounded-lg border border-charcoal/10 px-2 py-1">
      <span className="text-[10px] text-ink-soft flex-1 truncate">{label} (+${unitFee})</span>
      <div className="flex items-center gap-1 shrink-0">
        <button type="button" onClick={() => onChange(Math.max(0, value - 1))} disabled={value <= 0} className="w-6 h-6 rounded bg-charcoal/5 disabled:opacity-30 flex items-center justify-center"><Minus size={10} /></button>
        <span className="w-5 text-center font-bold text-xs">{value}</span>
        <button type="button" onClick={() => onChange(value + 1)} className="w-6 h-6 rounded bg-charcoal/5 flex items-center justify-center"><Plus size={10} /></button>
      </div>
    </div>
  );
}
