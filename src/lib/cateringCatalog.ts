// 美食到會 as staff have it set up: the dish list, tier prices and fees
// from 附加服務管理 (lib/addOnConfig) over the built-in menu in
// lib/cateringMenu. PURE — no firebase.
//
// Read the catering menu through these, never straight from
// CATERING_ITEMS / CATERING_TIERS, so an edit in the back office reaches
// the picker, the price and the supplier order alike.

import { getAddOnConfig, type AddOnConfig } from './addOnConfig';
import {
  CATERING_ITEMS, CATERING_TIERS, CATERING_EXTRA_DISH_FEE, CATERING_DOORSTEP_DELIVERY_FEE,
  type CateringItem, type CateringTag, type CateringTier,
} from './cateringMenu';

/** Every dish staff keep on the menu, hidden ones included. */
export function cateringItemsAll(config: AddOnConfig = getAddOnConfig()): CateringItem[] {
  const dishes = config.catering?.dishes;
  if (!dishes || dishes.length === 0) return CATERING_ITEMS;
  return dishes.map((d) => ({
    code: d.code,
    category: d.category,
    name: { zh: d.zh, en: d.en },
    ...(typeof d.price === 'number' ? { price: d.price } : {}),
    ...(d.tags ? { tags: d.tags as CateringTag[] } : {}),
    ...(d.hidden ? { hidden: true } : {}),
  }));
}

/** Dishes a customer can pick now. */
export function cateringItemsOffered(config: AddOnConfig = getAddOnConfig()): CateringItem[] {
  return cateringItemsAll(config).filter((d) => !d.hidden);
}

/** A dish by its code — for pricing and for naming what a booking holds.
 *  Falls back to the built-in menu so a dish staff later removed still
 *  reads properly on an old booking. */
export function findCateringItem(code: string, config: AddOnConfig = getAddOnConfig()): CateringItem | undefined {
  return cateringItemsAll(config).find((d) => d.code === code) ?? CATERING_ITEMS.find((d) => d.code === code);
}

/** The tiers with staff-set prices applied. */
export function cateringTiers(config: AddOnConfig = getAddOnConfig()): CateringTier[] {
  const prices = config.catering?.tierPrices;
  if (!prices) return CATERING_TIERS;
  return CATERING_TIERS.map((t) => (typeof prices[t.id] === 'number' ? { ...t, price: prices[t.id] } : t));
}

export function cateringExtraDishFee(config: AddOnConfig = getAddOnConfig()): number {
  return config.catering?.extraDishFee ?? CATERING_EXTRA_DISH_FEE;
}

export function cateringDoorstepFee(config: AddOnConfig = getAddOnConfig()): number {
  return config.catering?.doorstepFee ?? CATERING_DOORSTEP_DELIVERY_FEE;
}
