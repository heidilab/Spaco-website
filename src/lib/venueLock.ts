// 不使用電子門鎖 — PURE, safe for client and server.
//
// Some branches have no TTLock / keypad door at all (staff open up, or the
// building has its own access). 分店管理 marks them with `noElectronicLock`
// (2026-11-26). Everything that would issue, promise or chase a door
// passcode asks here first, so such a space never reaches TTLock and is
// never reported as "passcode could not be issued".

export function venueHasNoElectronicLock(
  venue: { noElectronicLock?: boolean } | null | undefined,
): boolean {
  return venue?.noElectronicLock === true;
}
