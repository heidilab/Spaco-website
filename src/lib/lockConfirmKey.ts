// Per-venue lock keypad confirm key — PURE, safe for client and server.
//
// Every TTLock keypad confirms a passcode with "#", EXCEPT the Wan Chai
// lock, whose keypad has a 🔔 bell key instead (Heidi 2026-09-07). Any
// surface that shows a passcode must append the right key via these
// helpers, never a hard-coded "#".

export function lockConfirmKey(venueId: string | undefined, venue?: { lockConfirmKey?: string } | null): string {
  // 分店管理 can name the key per door (2026-11-13); the Wan Chai rule
  // stays as the default for venues that have not set it.
  const set = (venue?.lockConfirmKey || '').trim();
  if (set) return set;
  return venueId === 'wanchai' ? '🔔' : '#';
}

/** `123456` + venue → `123456#` (or `123456🔔` at Wan Chai). */
export function formatPasscode(passcode: string, venueId: string | undefined, venue?: { lockConfirmKey?: string } | null): string {
  return `${passcode}${lockConfirmKey(venueId, venue)}`;
}
