// Server loader for 預訂規則 (lib/bookingRules): routes that price a
// booking (deposit tiers, instalment) or credit points await this first.

import { adminDb } from './firebaseAdmin';
import { sanitizeBookingRules, setBookingRules, type BookingRules } from './bookingRules';

const TTL_MS = 30_000;
let cached: { at: number; rules: BookingRules } | null = null;

export async function loadBookingRulesServer(force = false): Promise<BookingRules> {
  if (!force && cached && Date.now() - cached.at < TTL_MS) {
    setBookingRules(cached.rules);
    return cached.rules;
  }
  try {
    const snap = await adminDb.collection('site_content').doc('booking_rules').get();
    const rules = sanitizeBookingRules(snap.exists ? snap.data() : null);
    cached = { at: Date.now(), rules };
    setBookingRules(rules);
    return rules;
  } catch (err) {
    console.warn('[bookingRules] server load failed:', err);
    return cached?.rules ?? sanitizeBookingRules(null);
  }
}
