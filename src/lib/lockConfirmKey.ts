// Per-venue lock keypad confirm key — PURE, safe for client and server.
//
// Every TTLock keypad confirms a passcode with "#", EXCEPT the Wan Chai
// lock, whose keypad has a 🔔 bell key instead (Heidi 2026-09-07). Any
// surface that shows a passcode must append the right key via these
// helpers, never a hard-coded "#".

export function lockConfirmKey(venueId: string | undefined): string {
  return venueId === 'wanchai' ? '🔔' : '#';
}

/** `123456` + venue → `123456#` (or `123456🔔` at Wan Chai). */
export function formatPasscode(passcode: string, venueId: string | undefined): string {
  return `${passcode}${lockConfirmKey(venueId)}`;
}
