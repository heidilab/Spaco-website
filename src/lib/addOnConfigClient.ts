'use client';

// Browser loader for the 附加服務管理 settings (see lib/addOnConfig).
// Pages that price or list add-ons call useAddOnConfig(); it loads
// `site_content/addons` once per page view and activates it, so
// lib/pricing's accessors (addOnUnitPrice / addOnAvailableAt / addOnMenu,
// and calculatePricing itself) reflect what staff set.

import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import { sanitizeAddOnConfig, setAddOnConfig, addOnConfigVersion, type AddOnConfig } from './addOnConfig';

export const ADDON_CONFIG_DOC = { collection: 'site_content', id: 'addons' } as const;

let inFlight: Promise<AddOnConfig> | null = null;

/** Load and activate the settings. A failed read keeps the built-in
 *  catalog (never a half-applied config). */
export function loadAddOnConfig(force = false): Promise<AddOnConfig> {
  if (inFlight && !force) return inFlight;
  inFlight = getDoc(doc(db, ADDON_CONFIG_DOC.collection, ADDON_CONFIG_DOC.id))
    .then((snap) => {
      const config = sanitizeAddOnConfig(snap.exists() ? snap.data()?.items : null);
      setAddOnConfig(config);
      return config;
    })
    .catch((err) => {
      console.warn('[addOnConfig] load failed — using built-in add-on settings:', err);
      inFlight = null;
      return {} as AddOnConfig;
    });
  return inFlight;
}

/**
 * Activate the staff add-on settings for this page. Returns a number that
 * changes once they are loaded — put it in the dependency list of any
 * useMemo that prices or filters add-ons so it recomputes.
 */
export function useAddOnConfig(): number {
  const [version, setVersion] = useState(addOnConfigVersion());
  useEffect(() => {
    let alive = true;
    loadAddOnConfig().then(() => { if (alive) setVersion(addOnConfigVersion()); });
    return () => { alive = false; };
  }, []);
  return version;
}
