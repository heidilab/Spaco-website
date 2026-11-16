// Microsoft Graph client for Heidi's PERSONAL OneDrive (單據自動入帳).
//
// Auth: OAuth 2.0 authorization-code flow against the `consumers` tenant.
// She signs in once from 後台 → OneDrive 連結; the refresh token lives in
// Firestore at `secrets/onedrive_oauth` (admin-only rules; only server
// code touches it). Personal accounts ROTATE the refresh token on every
// refresh, so the new one is persisted each time — losing it means
// re-connecting.
//
// Everything is raw fetch (no Graph SDK) in the same spirit as llm.ts.

import 'server-only';
import { createHmac, timingSafeEqual } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './firebaseAdmin';
import type { OneDriveReceiptsConfig } from '@/types';
import { detectMonthLayout, parseRangeAddress, type MonthLayout } from './receiptExtract';

const AUTHORITY = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
export const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPES = ['offline_access', 'User.Read', 'Files.ReadWrite'];

export const TOKEN_DOC = 'secrets/onedrive_oauth';
export const CONFIG_DOC = 'system/onedrive_receipts';

function clientCreds(): { clientId: string; clientSecret: string } {
  const clientId = process.env.MS_OAUTH_CLIENT_ID;
  const clientSecret = process.env.MS_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('MS_OAUTH_CLIENT_ID / MS_OAUTH_CLIENT_SECRET not set in env');
  return { clientId, clientSecret };
}

export function isConfigured(): boolean {
  return !!(process.env.MS_OAUTH_CLIENT_ID && process.env.MS_OAUTH_CLIENT_SECRET);
}

// ── CSRF state: HMAC(timestamp) so the callback only accepts a sign-in
//    we started (an attacker must not be able to connect THEIR drive). ──

function stateKey(): string {
  return `${clientCreds().clientSecret}:onedrive-state`;
}
export function signState(ts: number = Date.now()): string {
  const sig = createHmac('sha256', stateKey()).update(String(ts)).digest('hex').slice(0, 32);
  return `${ts}.${sig}`;
}
export function verifyState(state: string | null, maxAgeMs = 15 * 60 * 1000): boolean {
  if (!state) return false;
  const [tsStr, sig] = state.split('.');
  const ts = Number(tsStr);
  if (!Number.isFinite(ts) || !sig || Math.abs(Date.now() - ts) > maxAgeMs) return false;
  const expected = createHmac('sha256', stateKey()).update(String(ts)).digest('hex').slice(0, 32);
  return sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

export function buildAuthUrl(redirectUri: string): string {
  const { clientId } = clientCreds();
  const q = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: SCOPES.join(' '),
    state: signState(),
    prompt: 'select_account',
  });
  return `${AUTHORITY}/authorize?${q.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface StoredToken {
  refresh_token: string;
  scope: string;
  connected_email?: string;
  connected_name?: string;
  connected_at: unknown;
  refreshed_at?: unknown;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const { clientId, clientSecret } = clientCreds();
  const res = await fetch(`${AUTHORITY}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: SCOPES.join(' '), ...body }),
  });
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !data.access_token) {
    throw new Error(`Microsoft token error: ${data.error || res.status} ${data.error_description || ''}`.trim());
  }
  return data;
}

export async function exchangeCodeAndStore(code: string, redirectUri: string): Promise<{ email?: string }> {
  const tokens = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
  if (!tokens.refresh_token) throw new Error('Microsoft did not return a refresh_token (offline_access scope missing?)');
  let email: string | undefined; let name: string | undefined;
  try {
    const me = await fetch(`${GRAPH}/me?$select=displayName,mail,userPrincipalName`, {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    }).then((r) => r.json()) as { displayName?: string; mail?: string; userPrincipalName?: string };
    email = me.mail || me.userPrincipalName || undefined;
    name = me.displayName || undefined;
  } catch { /* non-fatal */ }
  const payload: StoredToken = {
    refresh_token: tokens.refresh_token,
    scope: tokens.scope || SCOPES.join(' '),
    connected_email: email,
    connected_name: name,
    connected_at: FieldValue.serverTimestamp(),
  };
  await adminDb.doc(TOKEN_DOC).set(payload);
  cached = { token: tokens.access_token, exp: Date.now() + (tokens.expires_in - 120) * 1000 };
  return { email };
}

export async function getConnectionStatus(): Promise<{ connected: boolean; email?: string; name?: string; connectedAt?: string }> {
  const snap = await adminDb.doc(TOKEN_DOC).get();
  if (!snap.exists) return { connected: false };
  const d = snap.data() as StoredToken & { connected_at?: { toDate?: () => Date } };
  return {
    connected: true,
    email: d.connected_email,
    name: d.connected_name,
    connectedAt: d.connected_at?.toDate ? d.connected_at.toDate().toISOString() : undefined,
  };
}

export async function disconnect(): Promise<void> {
  cached = null;
  await adminDb.doc(TOKEN_DOC).delete();
}

let cached: { token: string; exp: number } | null = null;

/** Access token, refreshed (and the rotated refresh token persisted) when
 *  the cached one is near expiry. Throws 'not connected' when no token. */
export async function getAccessToken(): Promise<string> {
  if (cached && cached.exp > Date.now()) return cached.token;
  const snap = await adminDb.doc(TOKEN_DOC).get();
  if (!snap.exists) throw new Error('OneDrive not connected');
  const stored = snap.data() as StoredToken;
  const tokens = await tokenRequest({ grant_type: 'refresh_token', refresh_token: stored.refresh_token });
  if (tokens.refresh_token && tokens.refresh_token !== stored.refresh_token) {
    await adminDb.doc(TOKEN_DOC).set({ refresh_token: tokens.refresh_token, refreshed_at: FieldValue.serverTimestamp() }, { merge: true });
  }
  cached = { token: tokens.access_token, exp: Date.now() + (tokens.expires_in - 120) * 1000 };
  return cached.token;
}

// ── Generic Graph call ─────────────────────────────────────────────────

export class GraphError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export async function graphFetch<T = unknown>(path: string, init: RequestInit & { raw?: boolean } = {}): Promise<T> {
  const token = await getAccessToken();
  const url = path.startsWith('http') ? path : `${GRAPH}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body && !(init.body instanceof ArrayBuffer) ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    let code = String(res.status);
    try { code = (JSON.parse(txt) as { error?: { code?: string } }).error?.code || code; } catch { /* text */ }
    throw new GraphError(res.status, code, `Graph ${res.status} ${code}: ${txt.slice(0, 300)}`);
  }
  if (init.raw) return (await res.arrayBuffer()) as unknown as T;
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ── Drive items ────────────────────────────────────────────────────────

export interface DriveItem {
  id: string;
  name: string;
  size?: number;
  webUrl?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  folder?: { childCount?: number };
  file?: { mimeType?: string };
  deleted?: { state?: string };
  parentReference?: { id?: string; path?: string; driveId?: string };
}

const ITEM_SELECT = '$select=id,name,size,webUrl,createdDateTime,lastModifiedDateTime,folder,file,deleted,parentReference';

function itemPath(itemId: string): string {
  return itemId === 'root' ? '/me/drive/root' : `/me/drive/items/${encodeURIComponent(itemId)}`;
}

export async function listChildren(itemId: string): Promise<DriveItem[]> {
  const out: DriveItem[] = [];
  let url: string | undefined = `${itemPath(itemId)}/children?${ITEM_SELECT}&$top=200`;
  while (url) {
    const page: { value: DriveItem[]; '@odata.nextLink'?: string } = await graphFetch(url);
    out.push(...page.value);
    url = page['@odata.nextLink'];
  }
  return out.sort((a, b) => (a.folder ? 0 : 1) - (b.folder ? 0 : 1) || a.name.localeCompare(b.name, 'zh-Hant'));
}

export async function getItem(itemId: string): Promise<DriveItem> {
  return graphFetch<DriveItem>(`${itemPath(itemId)}?${ITEM_SELECT}`);
}

/** 「單據/銅鑼灣」-style display path from a Graph parentReference.path
 *  (`/drive/root:/單據`) plus the item name. */
export function displayPath(item: Pick<DriveItem, 'name' | 'parentReference'>): string {
  const p = item.parentReference?.path || '';
  const idx = p.indexOf('root:');
  const parent = idx >= 0 ? decodeURIComponent(p.slice(idx + 5)).replace(/^\//, '') : '';
  return parent ? `${parent}/${item.name}` : item.name;
}

export interface DeltaResult { items: DriveItem[]; deltaLink: string }

/** Changes under a folder since `deltaLink` (or just the current token
 *  when `deltaLink` is 'latest', so connecting never re-reads old files). */
export async function folderDelta(folderId: string, deltaLink: string | 'latest'): Promise<DeltaResult> {
  const items: DriveItem[] = [];
  let url: string | undefined = deltaLink === 'latest'
    ? `${itemPath(folderId)}/delta?token=latest`
    : deltaLink;
  let next: string | undefined;
  while (url) {
    const page: { value?: DriveItem[]; '@odata.nextLink'?: string; '@odata.deltaLink'?: string } = await graphFetch(url);
    items.push(...(page.value || []));
    if (page['@odata.deltaLink']) { next = page['@odata.deltaLink']; break; }
    url = page['@odata.nextLink'];
  }
  if (!next) throw new Error('delta did not return a deltaLink');
  return { items, deltaLink: next };
}

export async function downloadContent(itemId: string): Promise<ArrayBuffer> {
  return graphFetch<ArrayBuffer>(`${itemPath(itemId)}/content`, { raw: true });
}

/** Server-rendered JPEG (≤ 2000 px) — how HEIC and oversized photos reach Claude. */
export async function downloadThumbnailJpeg(itemId: string): Promise<ArrayBuffer> {
  try {
    return await graphFetch<ArrayBuffer>(`${itemPath(itemId)}/thumbnails/0/c2000x2000/content`, { raw: true });
  } catch {
    return graphFetch<ArrayBuffer>(`${itemPath(itemId)}/thumbnails/0/large/content`, { raw: true });
  }
}

// ── Excel (workbook API) ───────────────────────────────────────────────

export interface WorkbookMeta {
  worksheets: Array<{
    id: string; name: string; headers: string[]; headerAddress?: string; usedAddress?: string;
    /** Set when the sheet has her 「Vendor | Amount」 expenses block. */
    monthLayout?: MonthLayout;
  }>;
  tables: Array<{ id: string; name: string; worksheet: string; address: string; columns: string[] }>;
}

function wb(itemId: string): string {
  return `${itemPath(itemId)}/workbook`;
}
function ws(itemId: string, worksheet: string): string {
  return `${wb(itemId)}/worksheets/${encodeURIComponent(worksheet)}`;
}

/** Sheets with their first-row headers, and any formatted tables — what
 *  the column-mapping UI shows after Heidi picks a workbook. */
export async function getWorkbookMeta(itemId: string): Promise<WorkbookMeta> {
  const sheets: { value: Array<{ id: string; name: string }> } = await graphFetch(`${wb(itemId)}/worksheets?$select=id,name`);
  const worksheets: WorkbookMeta['worksheets'] = [];
  for (const s of sheets.value) {
    try {
      const used: { address: string; values: unknown[][] } = await graphFetch(
        `${ws(itemId, s.name)}/usedRange(valuesOnly=true)?$select=address,values`);
      const first = (used.values && used.values[0]) || [];
      const origin = parseRangeAddress(used.address);
      const monthLayout = detectMonthLayout(used.values || [], origin) || undefined;
      worksheets.push({
        id: s.id, name: s.name, usedAddress: used.address,
        headers: first.map((v) => (v === null || v === undefined ? '' : String(v))),
        headerAddress: used.address,
        ...(monthLayout ? { monthLayout } : {}),
      });
    } catch {
      worksheets.push({ id: s.id, name: s.name, headers: [] });
    }
  }
  const tables: WorkbookMeta['tables'] = [];
  try {
    const t: { value: Array<{ id: string; name: string }> } = await graphFetch(`${wb(itemId)}/tables?$select=id,name`);
    for (const tb of t.value) {
      const range: { address: string } = await graphFetch(`${wb(itemId)}/tables/${encodeURIComponent(tb.name)}/range?$select=address`);
      const cols: { value: Array<{ name: string }> } = await graphFetch(`${wb(itemId)}/tables/${encodeURIComponent(tb.name)}/columns?$select=name`);
      const sheetName = range.address.includes('!') ? range.address.slice(0, range.address.lastIndexOf('!')).replace(/^'|'$/g, '') : '';
      tables.push({ id: tb.id, name: tb.name, worksheet: sheetName, address: range.address, columns: cols.value.map((c) => c.name) });
    }
  } catch { /* workbook without tables */ }
  return { worksheets, tables };
}

export async function getUsedRangeAddress(itemId: string, worksheet: string): Promise<string> {
  const used: { address: string } = await graphFetch(`${ws(itemId, worksheet)}/usedRange(valuesOnly=true)?$select=address`);
  return used.address;
}

export async function getTableRange(itemId: string, table: string): Promise<{ address: string; columnCount: number }> {
  return graphFetch(`${wb(itemId)}/tables/${encodeURIComponent(table)}/range?$select=address,columnCount`);
}

export async function tableAddRow(itemId: string, table: string, values: Array<string | number | null>): Promise<void> {
  await graphFetch(`${wb(itemId)}/tables/${encodeURIComponent(table)}/rows/add`, {
    method: 'POST', body: JSON.stringify({ index: null, values: [values] }),
  });
}

export async function tableDeleteRow(itemId: string, table: string, index: number): Promise<void> {
  await graphFetch(`${wb(itemId)}/tables/${encodeURIComponent(table)}/rows/itemAt(index=${index})`, { method: 'DELETE' });
}

export async function listWorksheetNames(itemId: string): Promise<string[]> {
  const r: { value: Array<{ name: string }> } = await graphFetch(`${wb(itemId)}/worksheets?$select=name`);
  return r.value.map((w) => w.name);
}

/** Whole used range of a sheet, values only (formulas come back as their
 *  results; empty cells as ''). Her month sheets are ~50 × 22 cells. */
export async function getUsedRange(itemId: string, worksheet: string): Promise<{ address: string; values: unknown[][]; formulas: unknown[][] }> {
  const r: { address: string; values: unknown[][]; formulas: unknown[][] } = await graphFetch(
    `${ws(itemId, worksheet)}/usedRange(valuesOnly=true)?$select=address,values,formulas`);
  return { address: r.address, values: r.values || [], formulas: r.formulas || [] };
}

/** Empty the cells (values only — number formats, borders and merges stay). */
export async function clearRange(itemId: string, worksheet: string, address: string): Promise<void> {
  await graphFetch(`${ws(itemId, worksheet)}/range(address='${encodeURIComponent(address)}')/clear`, {
    method: 'POST', body: JSON.stringify({ applyTo: 'Contents' }),
  });
}

/** Insert blank cells at `address`, pushing what was there down. Only the
 *  named columns move, so the booking / transaction columns beside the
 *  Expenses block are untouched. */
export async function insertCellsDown(itemId: string, worksheet: string, address: string): Promise<void> {
  await graphFetch(`${ws(itemId, worksheet)}/range(address='${encodeURIComponent(address)}')/insert`, {
    method: 'POST', body: JSON.stringify({ shift: 'Down' }),
  });
}

export async function readRange(itemId: string, worksheet: string, address: string): Promise<unknown[][]> {
  const r: { values: unknown[][] } = await graphFetch(`${ws(itemId, worksheet)}/range(address='${encodeURIComponent(address)}')?$select=values`);
  return r.values || [];
}

export async function writeCell(
  itemId: string, worksheet: string, address: string, value: string | number, numberFormat?: string,
): Promise<void> {
  await graphFetch(`${ws(itemId, worksheet)}/range(address='${encodeURIComponent(address)}')`, {
    method: 'PATCH', body: JSON.stringify({ values: [[value]], ...(numberFormat ? { numberFormat: [[numberFormat]] } : {}) }),
  });
}

export async function deleteSheetRow(itemId: string, worksheet: string, row: number): Promise<void> {
  await graphFetch(`${ws(itemId, worksheet)}/range(address='${row}:${row}')/delete`, {
    method: 'POST', body: JSON.stringify({ shift: 'Up' }),
  });
}

// ── Config doc ─────────────────────────────────────────────────────────

export async function getReceiptsConfig(): Promise<OneDriveReceiptsConfig> {
  const snap = await adminDb.doc(CONFIG_DOC).get();
  const d = (snap.exists ? snap.data() : {}) as Partial<OneDriveReceiptsConfig>;
  return { ...d, branchFolders: d.branchFolders || [] };
}

export async function saveReceiptsConfig(patch: Partial<OneDriveReceiptsConfig>): Promise<void> {
  await adminDb.doc(CONFIG_DOC).set({ ...patch, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}
