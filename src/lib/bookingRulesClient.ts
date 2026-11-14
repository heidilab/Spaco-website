'use client';

// Browser loader for 預訂規則 (lib/bookingRules). Pages that compute a
// deposit, show the rules, or settle a deposit call useBookingRules(); it
// loads `site_content/booking_rules` once per page view and activates it.

import { useEffect, useState } from 'react';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { sanitizeBookingRules, setBookingRules, bookingRulesVersion, type BookingRules } from './bookingRules';

export const BOOKING_RULES_DOC = { collection: 'site_content', id: 'booking_rules' } as const;

let inFlight: Promise<BookingRules> | null = null;

export function loadBookingRules(force = false): Promise<BookingRules> {
  if (inFlight && !force) return inFlight;
  inFlight = getDoc(doc(db, BOOKING_RULES_DOC.collection, BOOKING_RULES_DOC.id))
    .then((snap) => {
      const rules = sanitizeBookingRules(snap.exists() ? snap.data() : null);
      setBookingRules(rules);
      return rules;
    })
    .catch((err) => {
      console.warn('[bookingRules] load failed — using the coded rules:', err);
      inFlight = null;
      return sanitizeBookingRules(null);
    });
  return inFlight;
}

export async function saveBookingRules(rules: BookingRules, updatedBy: string): Promise<BookingRules> {
  const clean = sanitizeBookingRules(rules);
  await setDoc(doc(db, BOOKING_RULES_DOC.collection, BOOKING_RULES_DOC.id), { ...clean, updatedAt: serverTimestamp(), updatedBy });
  setBookingRules(clean);
  inFlight = Promise.resolve(clean);
  return clean;
}

/** Activate the rules for this page; the number changes once loaded. */
export function useBookingRules(): number {
  const [version, setVersion] = useState(bookingRulesVersion());
  useEffect(() => {
    let alive = true;
    loadBookingRules().then(() => { if (alive) setVersion(bookingRulesVersion()); });
    return () => { alive = false; };
  }, []);
  return version;
}
