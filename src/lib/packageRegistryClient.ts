'use client';

// Browser loader for the package registry (lib/packages). Pages that list
// or price packages call usePackages(); it loads `site_content/packages`
// once per page view and activates it, so getPackageBySlug /
// getPackagesByVenueId / getPackagesByCategory reflect what staff set in
// 套餐管理. Until the doc exists (or if it is unreadable) the coded
// packages stay in force.

import { useEffect, useState } from 'react';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import {
  sanitizePackages, setPackageRegistry, packageRegistryVersion, packageRegistryLoaded, type EventPackage,
} from './packages';

export const PACKAGES_DOC = { collection: 'site_content', id: 'packages' } as const;

let inFlight: Promise<EventPackage[] | null> | null = null;

/** Load and activate the saved packages (null = none saved, coded list). */
export function loadPackages(force = false): Promise<EventPackage[] | null> {
  if (inFlight && !force) return inFlight;
  inFlight = getDoc(doc(db, PACKAGES_DOC.collection, PACKAGES_DOC.id))
    .then((snap) => {
      const list = snap.exists() ? sanitizePackages(snap.data()?.items) : null;
      setPackageRegistry(list);
      return list;
    })
    .catch((err) => {
      console.warn('[packages] load failed — using the coded packages:', err);
      inFlight = null;
      setPackageRegistry(null);
      return null;
    });
  return inFlight;
}

/** Save the packages staff edited (套餐管理). */
export async function savePackages(list: EventPackage[], updatedBy: string): Promise<EventPackage[]> {
  const clean = sanitizePackages(list) ?? [];
  await setDoc(doc(db, PACKAGES_DOC.collection, PACKAGES_DOC.id), { items: clean, updatedAt: serverTimestamp(), updatedBy });
  setPackageRegistry(clean);
  inFlight = Promise.resolve(clean);
  return clean;
}

/**
 * Activate the saved packages for this page. `version` changes once they
 * are loaded (put it in the dependency list of memos that read packages);
 * `loaded` says the registry has been read at least once, so a slug that
 * is still unknown is really unknown.
 */
export function usePackages(): { version: number; loaded: boolean } {
  const [state, setState] = useState({ version: packageRegistryVersion(), loaded: packageRegistryLoaded() });
  useEffect(() => {
    let alive = true;
    loadPackages().then(() => { if (alive) setState({ version: packageRegistryVersion(), loaded: true }); });
    return () => { alive = false; };
  }, []);
  return state;
}
