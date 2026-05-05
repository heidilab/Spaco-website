/**
 * TTLock Open Platform API client — server-side ONLY.
 *
 * Reference: https://euopen.ttlock.com/document
 *
 * SPACO uses TTLock for door access at every branch. The booking system
 * generates a time-limited keyboard passcode 2 days before each event
 * (or immediately, if the booking falls within that window). The passcode
 * is valid from booking-start − 1 hour through booking-end, then auto-expires.
 *
 * NEVER import this from a client component — the OAuth secrets must
 * stay on the server. The client lib auto-throws if it's not on Node.
 *
 * ── Environment variables ──
 *   TTLOCK_CLIENT_ID        — Open Platform Client ID
 *   TTLOCK_CLIENT_SECRET    — Open Platform Client Secret
 *   TTLOCK_USERNAME         — TTLock account email (the one that owns the locks)
 *   TTLOCK_PASSWORD_MD5     — MD5 hash of the TTLock account password (lowercase hex)
 *
 * `TTLOCK_PASSWORD_MD5` is the lowercase MD5 of the cleartext password.
 * Generate it once with: `echo -n "your_password" | md5sum`
 * (We store the hash, not the password — TTLock's auth flow expects MD5.)
 */

import { createHash } from 'crypto';

// API base — EU region (auto-redirects to correct region for HK accounts).
// Use api.ttlock.com (CN region) if your TTLock account was registered in CN.
const TTLOCK_API_BASE = process.env.TTLOCK_API_BASE || 'https://euapi.ttlock.com';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface TTLockTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;     // seconds
  uid: number;
  openid: number;
  scope: string;
  token_type: string;
  errcode?: number;
  errmsg?: string;
}

interface TTLockKeyboardPwdResponse {
  keyboardPwdId: number;
  keyboardPwd: string;
  errcode?: number;
  errmsg?: string;
  description?: string;
}

interface TTLockOkResponse {
  errcode?: number;
  errmsg?: string;
  description?: string;
}

interface TTLockListLocksResponse {
  list: Array<{
    lockId: number;
    lockAlias: string;
    lockName: string;
    lockMac: string;
    electricQuantity: number;
    [key: string]: unknown;
  }>;
  pageNo: number;
  pageSize: number;
  pages: number;
  total: number;
  errcode?: number;
  errmsg?: string;
}

// ─────────────────────────────────────────────────────────────
// Token cache (module-scoped)
// ─────────────────────────────────────────────────────────────
//
// Tokens are valid 30 days; we keep one in memory per server process and
// refresh proactively when expires_at is within 1 day. On serverless cold
// starts the cache resets — that's fine, we just re-auth on next call.

interface CachedToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;

// ─────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────

/** MD5 hash a string and return lowercase hex (TTLock requirement). */
function md5(s: string): string {
  return createHash('md5').update(s, 'utf8').digest('hex');
}

function readEnvOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `[ttlock] Missing required env var: ${name}. ` +
      'Set it in .env.local (dev) or Vercel project env (prod).'
    );
  }
  return v;
}

async function fetchAccessToken(): Promise<CachedToken> {
  const clientId     = readEnvOrThrow('TTLOCK_CLIENT_ID');
  const clientSecret = readEnvOrThrow('TTLOCK_CLIENT_SECRET');
  const username     = readEnvOrThrow('TTLOCK_USERNAME');
  // Allow either the raw password (we hash it) or a pre-hashed MD5 — admins
  // who don't want their cleartext pwd in env can supply TTLOCK_PASSWORD_MD5
  // directly.
  const passwordMd5  = process.env.TTLOCK_PASSWORD_MD5
    || (process.env.TTLOCK_PASSWORD ? md5(process.env.TTLOCK_PASSWORD) : '');
  if (!passwordMd5) {
    throw new Error(
      '[ttlock] Missing TTLOCK_PASSWORD_MD5 (or TTLOCK_PASSWORD). ' +
      'Set the lowercase MD5 hash of your TTLock account password.'
    );
  }

  const body = new URLSearchParams({
    clientId,
    clientSecret,
    username,
    password: passwordMd5,
  });

  const res = await fetch(`${TTLOCK_API_BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = (await res.json()) as TTLockTokenResponse;

  if (data.errcode || !data.access_token) {
    throw new Error(
      `[ttlock] Auth failed: ${data.errcode} ${data.errmsg || 'unknown'}`,
    );
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    // Refresh 1 day early to avoid using a token that expires mid-request
    expiresAt: Date.now() + (data.expires_in - 86400) * 1000,
  };
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.accessToken;
  }
  cachedToken = await fetchAccessToken();
  return cachedToken.accessToken;
}

// ─────────────────────────────────────────────────────────────
// API methods
// ─────────────────────────────────────────────────────────────

/**
 * List the locks visible to this TTLock account. Use this once at setup time
 * to figure out the lockId for each venue's door — record those IDs into
 * `site_content` (admin → 設定 → TTLock) so the cron can map venueId → lockId.
 */
export async function listLocks(pageSize = 100): Promise<Array<{
  lockId: number;
  lockAlias: string;
  lockName: string;
  lockMac: string;
}>> {
  const accessToken = await getAccessToken();
  const clientId    = readEnvOrThrow('TTLOCK_CLIENT_ID');

  const params = new URLSearchParams({
    clientId,
    accessToken,
    pageNo: '1',
    pageSize: String(pageSize),
    date: String(Date.now()),
  });

  const res = await fetch(`${TTLOCK_API_BASE}/v3/lock/list?${params}`);
  const data = (await res.json()) as TTLockListLocksResponse;
  if (data.errcode) {
    throw new Error(`[ttlock] listLocks failed: ${data.errcode} ${data.errmsg}`);
  }
  return (data.list || []).map((l) => ({
    lockId:    l.lockId,
    lockAlias: l.lockAlias,
    lockName:  l.lockName,
    lockMac:   l.lockMac,
  }));
}

/**
 * Generate a time-limited keyboard passcode on the given lock.
 *
 * @param lockId      The TTLock lockId for the venue's door
 * @param startMs     Unix ms — passcode becomes valid (booking start − 1 hour)
 * @param endMs       Unix ms — passcode expires (booking end)
 * @param name        Display name for the passcode (shown in TTLock app)
 * @returns           { passcode, keyboardPwdId } — passcode is the digits the
 *                    customer types; keyboardPwdId is needed for later delete.
 *
 * `addType=2` means the passcode is created via TTLock cloud (vs gateway).
 * `keyboardPwdType=3` means custom period (start + end).
 */
export async function addKeyboardPasscode(params: {
  lockId: number;
  startMs: number;
  endMs: number;
  name: string;
  /** Optional explicit passcode (4-9 digits). If omitted, TTLock generates one. */
  passcode?: string;
}): Promise<{ passcode: string; keyboardPwdId: number }> {
  const { lockId, startMs, endMs, name, passcode } = params;
  if (endMs <= startMs) {
    throw new Error('[ttlock] addKeyboardPasscode: endMs must be > startMs');
  }
  const accessToken = await getAccessToken();
  const clientId    = readEnvOrThrow('TTLOCK_CLIENT_ID');

  const body = new URLSearchParams({
    clientId,
    accessToken,
    lockId:           String(lockId),
    keyboardPwdName:  name,
    startDate:        String(startMs),
    endDate:          String(endMs),
    addType:          '2', // 2 = via cloud
    date:             String(Date.now()),
    ...(passcode ? { keyboardPwd: passcode } : {}),
  });

  const res = await fetch(`${TTLOCK_API_BASE}/v3/keyboardPwd/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = (await res.json()) as TTLockKeyboardPwdResponse;

  if (data.errcode || !data.keyboardPwdId) {
    throw new Error(
      `[ttlock] addKeyboardPasscode failed: ${data.errcode} ${data.errmsg || data.description || 'unknown'}`,
    );
  }
  return {
    passcode:      data.keyboardPwd,
    keyboardPwdId: data.keyboardPwdId,
  };
}

/**
 * Delete a previously-generated keyboard passcode. Call this when a booking
 * is cancelled to revoke door access immediately.
 *
 * `deleteType=2` = delete via cloud (no gateway / Bluetooth required).
 */
export async function deleteKeyboardPasscode(params: {
  lockId: number;
  keyboardPwdId: number;
}): Promise<void> {
  const { lockId, keyboardPwdId } = params;
  const accessToken = await getAccessToken();
  const clientId    = readEnvOrThrow('TTLOCK_CLIENT_ID');

  const body = new URLSearchParams({
    clientId,
    accessToken,
    lockId:        String(lockId),
    keyboardPwdId: String(keyboardPwdId),
    deleteType:    '2',
    date:          String(Date.now()),
  });

  const res = await fetch(`${TTLOCK_API_BASE}/v3/keyboardPwd/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = (await res.json()) as TTLockOkResponse;
  if (data.errcode && data.errcode !== 0) {
    // errcode 5006 = passcode already deleted — not an error from our POV
    if (data.errcode === 5006) return;
    throw new Error(
      `[ttlock] deleteKeyboardPasscode failed: ${data.errcode} ${data.errmsg || data.description}`,
    );
  }
}

/** True iff TTLock credentials are configured. Use to gracefully skip work
 *  during local dev when nobody has set up TTLock yet. */
export function isTTLockConfigured(): boolean {
  return Boolean(
    process.env.TTLOCK_CLIENT_ID &&
    process.env.TTLOCK_CLIENT_SECRET &&
    process.env.TTLOCK_USERNAME &&
    (process.env.TTLOCK_PASSWORD_MD5 || process.env.TTLOCK_PASSWORD),
  );
}
