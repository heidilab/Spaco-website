/**
 * KPay Online Payment Gateway integration (Hong Kong).
 *
 * Auth model: Merchant Mode — we own MID 852124272000001 and sign
 * every request with our private RSA key. KPay verifies with our
 * public key. KPay signs webhook callbacks with their private key;
 * we verify with their public key.
 *
 * Required env vars:
 *   KPAY_MID                  852124272000001 (merchant id)
 *   KPAY_PRIVATE_KEY          our private key (PKCS#8 PEM, base64
 *                             body only OR full -----BEGIN... wrapper)
 *   KPAY_PLATFORM_PUBLIC_KEY  KPay's platform public key (for
 *                             verifying webhook signatures)
 *   KPAY_API_BASE             https://payment.uat.kpay-group.com (sandbox)
 *                             or https://payment.kpay-group.com (prod)
 *
 * Reference: https://online.payment.docs.kpay-group.com/
 */

import crypto from 'crypto';
import { fetch as undiciFetch, ProxyAgent } from 'undici';

/**
 * Static-IP egress proxy for KPay API calls.
 *
 * KPay's LIVE environment firewalls inbound API traffic to 1-3
 * whitelisted fixed IPs, but Vercel serverless functions egress from
 * dynamic IPs. Setting KPAY_PROXY_URL (e.g. a QuotaGuard/Fixie HTTPS
 * proxy URL, http://user:pass@host:port) routes ONLY KPay API calls
 * through that proxy's static IP. Unset → direct connection (fine for
 * the UAT sandbox, which has no IP whitelist).
 *
 * Note: only server→KPay API calls need this. The hosted-cashier
 * redirect is the customer's own browser, and KPay→us webhooks are
 * inbound — neither is affected by the whitelist.
 */
let proxyDispatcher: ProxyAgent | null | undefined;

function getKpayDispatcher(): ProxyAgent | undefined {
  if (proxyDispatcher === undefined) {
    const url = process.env.KPAY_PROXY_URL;
    proxyDispatcher = url ? new ProxyAgent(url) : null;
  }
  return proxyDispatcher ?? undefined;
}

/** fetch() for KPay API calls — honours KPAY_PROXY_URL when set. */
function kpayFetch(url: string, init: RequestInit): Promise<Response> {
  const dispatcher = getKpayDispatcher();
  if (dispatcher) {
    // MUST use undici's own fetch with undici's ProxyAgent. Next.js
    // patches global fetch with a BUNDLED undici whose dispatch-handler
    // interface differs from the npm package's — mixing them throws
    // UND_ERR_INVALID_ARG "invalid onRequestStart method" (broke
    // production checkout on 2026-07-15). Same-package fetch + agent
    // always agree on the interface.
    return undiciFetch(
      url,
      { ...(init as Record<string, unknown>), dispatcher } as never,
    ) as unknown as Promise<Response>;
  }
  return fetch(url, init);
}

const HEADERS = {
  NONCE: 'K-Nonce-Str',
  MERCHANT: 'K-Merchant-Code',
  SIGNATURE: 'K-Signature',
  TIMESTAMP: 'K-Timestamp',
  LANGUAGE: 'K-Language',
} as const;

const ENDPOINTS = {
  /** Create a managed (hosted cashier) order. POST + JSON body. */
  managedOrderAdd: '/v1/managed/order/add',
  /** Customer-facing hosted cashier page. GET with signed query params. */
  webCashier: '/v1/web/managed/order',
  /** H5 / mobile-optimised cashier page. */
  h5Cashier: '/v1/h5/managed/order',
  /** Query managed order result (polling fallback if webhook missed). */
  managedOrderResult: '/v1/managed/order/result',
  /** Refund a settled transaction. POST + JSON body. */
  refund: '/v1/refund',
} as const;

// ──────────────────────────────────────────────────────────
// Env helpers
// ──────────────────────────────────────────────────────────

function readEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[kpay] ${name} is not set`);
  return v;
}

export function getMid(): string {
  return readEnv('KPAY_MID');
}

export function getApiBase(): string {
  return process.env.KPAY_API_BASE || 'https://payment.uat.kpay-group.com';
}

/** Coerce a base64-only or pem-wrapped key into a proper PEM string. */
function normalisePem(raw: string, kind: 'PRIVATE KEY' | 'PUBLIC KEY'): string {
  const trimmed = raw.trim().replace(/\\n/g, '\n');
  if (trimmed.includes('-----BEGIN')) return trimmed;
  // KPay's email attachments are pure base64; wrap with the PEM header/footer.
  const wrapped = trimmed.match(/.{1,64}/g)?.join('\n') || trimmed;
  return `-----BEGIN ${kind}-----\n${wrapped}\n-----END ${kind}-----`;
}

function getPrivateKey(): string {
  return normalisePem(readEnv('KPAY_PRIVATE_KEY'), 'PRIVATE KEY');
}

function getPlatformPublicKey(): string {
  return normalisePem(readEnv('KPAY_PLATFORM_PUBLIC_KEY'), 'PUBLIC KEY');
}

// ──────────────────────────────────────────────────────────
// Signing & verification
// ──────────────────────────────────────────────────────────

/** 32-character alphanumeric nonce. */
export function generateNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  const buf = crypto.randomBytes(32);
  for (let i = 0; i < 32; i++) s += chars[buf[i] % chars.length];
  return s;
}

/**
 * Build the canonical string-to-sign per KPay v4 spec.
 *   method\n
 *   url\n        (path + ?query for GET; path-only for POST)
 *   timestamp\n
 *   nonceStr\n
 *   merchantCode\n
 *   body\n       (empty string for GET)
 *
 * Every line ends with \n, INCLUDING the last one.
 */
function buildSignString(input: {
  method: 'GET' | 'POST' | 'PUT';
  url: string;
  timestamp: string;
  nonce: string;
  mid: string;
  body: string;
}): string {
  return [
    input.method,
    input.url,
    input.timestamp,
    input.nonce,
    input.mid,
    input.body,
    '',
  ].join('\n');
}

export interface SignedHeaders {
  [HEADERS.NONCE]: string;
  [HEADERS.MERCHANT]: string;
  [HEADERS.SIGNATURE]: string;
  [HEADERS.TIMESTAMP]: string;
  [HEADERS.LANGUAGE]: 'zh_HK' | 'en_US';
  'Content-Type': string;
}

/** Sign a request with our merchant private key (SHA256-with-RSA → base64). */
export function signRequest(
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  body: string,
  language: 'zh_HK' | 'en_US' = 'zh_HK',
): SignedHeaders {
  const mid = getMid();
  const timestamp = Date.now().toString();
  const nonce = generateNonce();
  const stringToSign = buildSignString({ method, url, timestamp, nonce, mid, body });

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(stringToSign, 'utf8');
  const signature = signer.sign(getPrivateKey(), 'base64');

  return {
    [HEADERS.NONCE]: nonce,
    [HEADERS.MERCHANT]: mid,
    [HEADERS.SIGNATURE]: signature,
    [HEADERS.TIMESTAMP]: timestamp,
    [HEADERS.LANGUAGE]: language,
    'Content-Type': 'application/json;charset=UTF-8',
  };
}

/**
 * Verify a KPay webhook notification with their platform public key.
 *
 * KPay sends:
 *   K-Signature, K-Timestamp, K-Nonce-Str, K-Merchant-Code headers
 *   POST body (JSON) — pass the RAW body string here, not parsed JSON.
 *
 * KPay's webhook string-to-sign format isn't documented in the materials
 * we have, and verification kept failing with the API-request convention.
 * So we try a handful of plausible variants and accept if ANY of them
 * verifies. The matching variant's name is returned so we can lock the
 * webhook down to that one variant once we know which it is.
 */
export interface VerifyNotifyOpts {
  method: 'POST';
  /** Path-only of OUR webhook URL, e.g. /api/kpay/webhook. */
  url: string;
  /** Full notifyUrl we passed to /v1/managed/order/add (e.g.
   *  https://host/api/kpay/webhook). KPay may sign with this verbatim. */
  fullNotifyUrl?: string;
  signature: string;
  timestamp: string;
  nonce: string;
  merchantCode: string;
  body: string;
}

export interface VerifyNotifyResult {
  ok: boolean;
  /** Name of the variant that verified, or null if none. */
  variant: string | null;
}

function tryVerify(stringToSign: string, signature: string): boolean {
  try {
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(stringToSign, 'utf8');
    return verifier.verify(getPlatformPublicKey(), signature, 'base64');
  } catch {
    return false;
  }
}

/** Run all known KPay-notify signing variants. */
export function verifyNotifyMulti(opts: VerifyNotifyOpts): VerifyNotifyResult {
  const { signature, timestamp: ts, nonce, merchantCode: mid, body, url, fullNotifyUrl } = opts;

  // Variants in priority order. Each builds a different string-to-sign;
  // the first that verifies wins.
  const variants: Array<[string, string]> = [
    // 1. POST-API convention with path-only URL (our current default).
    ['method+path+ts+nonce+mid+body', ['POST', url, ts, nonce, mid, body, ''].join('\n')],
    // 2. Same as #1 but with the FULL notifyUrl as we sent it.
    ...(fullNotifyUrl ? [['method+fullUrl+ts+nonce+mid+body',
      ['POST', fullNotifyUrl, ts, nonce, mid, body, ''].join('\n')] as [string, string]] : []),
    // 3. No method, no URL — just headers + body.
    ['ts+nonce+mid+body', [ts, nonce, mid, body, ''].join('\n')],
    // 4. Method only, no URL.
    ['method+ts+nonce+mid+body', ['POST', ts, nonce, mid, body, ''].join('\n')],
    // 5. Empty URL line (KPay might leave it blank in notify).
    ['method+empty+ts+nonce+mid+body', ['POST', '', ts, nonce, mid, body, ''].join('\n')],
    // 6. Body only — some gateways sign just the raw body.
    ['body', body],
    // 7. Concatenated, no newlines.
    ['concat:ts+nonce+mid+body', ts + nonce + mid + body],
    // 8. Concatenated with body last via &.
    ['concat&', `timestamp=${ts}&nonce=${nonce}&merchantCode=${mid}&body=${body}`],
  ];

  for (const [name, s] of variants) {
    if (tryVerify(s, signature)) return { ok: true, variant: name };
  }
  return { ok: false, variant: null };
}

/** Back-compat wrapper. Returns just the boolean. */
export function verifyNotify(opts: VerifyNotifyOpts): boolean {
  return verifyNotifyMulti(opts).ok;
}

// ──────────────────────────────────────────────────────────
// API: create managed order
// ──────────────────────────────────────────────────────────

export interface CreateManagedOrderInput {
  /** Our own booking-side order id, ≤32 chars. Must be unique. */
  managedOutTradeNo: string;
  /** HK$ amount (BigDecimal, 2 dp). */
  payAmount: number;
  /** Hosted cashier returns redirect to this URL after payment. */
  returnUrl: string;
  /** KPay POSTs the payment result here. HTTPS, no query string. */
  notifyUrl: string;
  itemList: Array<{
    itemNo: string;
    itemName: string;
    price: number;
    quantity: number;
  }>;
  orderRemark?: string;
  /**
   * Which payment methods the hosted cashier shows, in display order
   * (docs: properties.md "Pay Method Order"). Methods not listed are
   * HIDDEN. Values: CARD, ALIPAYCN, ALIPAYHK, WXPAY, UNIONPAY, PAYME,
   * FPS, APPLEPAY, GOOGLEPAY, OCTOPUS. Omit → cashier shows every
   * method enabled on the merchant.
   */
  payMethodOrder?: string[];
}

export interface CreateManagedOrderResult {
  ok: boolean;
  code: number;
  managedOrderNo?: string;
  message?: string;
  /** Headers we should reuse when redirecting the customer (the
   *  same nonce + timestamp + signature pair the cashier endpoint
   *  expects — KPay treats /web/managed/order as a continuation
   *  of the order-add request). Actually we sign a fresh GET for
   *  the cashier separately; this is just metadata. */
}

export async function createManagedOrder(
  input: CreateManagedOrderInput,
): Promise<CreateManagedOrderResult> {
  const path = ENDPOINTS.managedOrderAdd;
  const body = JSON.stringify({
    managedOutTradeNo: input.managedOutTradeNo,
    payAmount: input.payAmount,
    payCurrency: 'HKD',
    notifyUrl: input.notifyUrl,
    returnUrl: input.returnUrl,
    orderRemark: input.orderRemark || '',
    ...(input.payMethodOrder?.length ? { payMethodOrder: input.payMethodOrder } : {}),
    itemList: input.itemList.map((i) => ({
      itemNo: i.itemNo,
      itemName: i.itemName,
      price: i.price,
      priceCurrency: 'HKD',
      quantity: i.quantity,
    })),
  });

  const headers = signRequest('POST', path, body);
  const res = await kpayFetch(`${getApiBase()}${path}`, {
    method: 'POST',
    headers: headers as unknown as Record<string, string>,
    body,
  });
  const data = (await res.json()) as {
    code: number;
    data?: { managedOrderNo: string };
    message?: string;
  };
  return {
    ok: data.code === 10000,
    code: data.code,
    managedOrderNo: data.data?.managedOrderNo,
    message: data.message,
  };
}

// ──────────────────────────────────────────────────────────
// Cashier redirect — build the URL the customer's browser hits
// ──────────────────────────────────────────────────────────

/**
 * Build a signed GET URL pointing at the hosted cashier. Returns
 * the full URL ready to redirect the browser to.
 *
 * Per KPay spec the cashier endpoint takes the same headers as
 * regular API calls but passes them as QUERY STRING parameters.
 */
export function buildCashierRedirectUrl(opts: {
  managedOrderNo: string;
  channel?: 'web' | 'h5';
  language?: 'zh_HK' | 'en_US';
}): string {
  const path = opts.channel === 'h5' ? ENDPOINTS.h5Cashier : ENDPOINTS.webCashier;
  const mid = getMid();
  const timestamp = Date.now().toString();
  const nonce = generateNonce();
  const language = opts.language || 'zh_HK';

  // KPay GET-cashier signature spec (home/signature.md step 2):
  //   "如果GET 請求中有請求參數，URL 末尾應附加 '?' 和對應的請求參數字符串"
  // — i.e. the URL inside the string-to-sign is `path?query`, where
  // `query` is the exact serialised query string the browser will
  // send, MINUS the K-Signature param itself. Order must match what
  // we ultimately put on the final URL, or KPay's verification fails
  // with 40002 簽名無效.
  const paramsForSigning = new URLSearchParams({
    managedOrderNo: opts.managedOrderNo,
    language,
    [HEADERS.MERCHANT]: mid,
    [HEADERS.NONCE]: nonce,
    [HEADERS.TIMESTAMP]: timestamp,
  });
  const signedQueryString = paramsForSigning.toString();
  const stringToSign = buildSignString({
    method: 'GET',
    url: `${path}?${signedQueryString}`,
    timestamp,
    nonce,
    mid,
    body: '',
  });
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(stringToSign, 'utf8');
  const signature = signer.sign(getPrivateKey(), 'base64');

  // Append K-Signature LAST so the final URL matches paramsForSigning
  // plus the signature suffix.
  return `${getApiBase()}${path}?${signedQueryString}&${HEADERS.SIGNATURE}=${encodeURIComponent(signature)}`;
}

// ──────────────────────────────────────────────────────────
// API: query managed order (polling fallback)
// ──────────────────────────────────────────────────────────

export interface QueryManagedOrderResult {
  ok: boolean;
  code: number;
  message?: string;
  /** Raw response data — schema varies by payment method. */
  data?: Record<string, unknown>;
}

export async function queryManagedOrder(
  managedOutTradeNo: string,
): Promise<QueryManagedOrderResult> {
  const params = new URLSearchParams({ managedOutTradeNo });
  const path = `${ENDPOINTS.managedOrderResult}?${params.toString()}`;
  const headers = signRequest('GET', path, '');
  const res = await kpayFetch(`${getApiBase()}${path}`, {
    method: 'GET',
    headers: headers as unknown as Record<string, string>,
  });
  const data = (await res.json()) as {
    code: number;
    data?: Record<string, unknown>;
    message?: string;
  };
  return { ok: data.code === 10000, code: data.code, message: data.message, data: data.data };
}

// ──────────────────────────────────────────────────────────
// API: refund a settled transaction
// ──────────────────────────────────────────────────────────

export interface RefundOrderInput {
  /** A NEW unique merchant trade number for THIS refund, ≤32 chars. */
  outTradeNo: string;
  /**
   * The ORIGINAL transaction's orderNo — the `orderNo` returned in the
   * sales notify callback (stored on payments[].kpayOrderNo) or from a
   * query. ⚠️ NOT the managedOrderNo from order creation — KPay rejects
   * the managedOrderNo here (see /v1/refund docs note).
   */
  oriOrderNo: string;
  /** Refund amount in HKD (BigDecimal, 2 dp) — actual dollars, not cents. */
  refundAmount: number;
  /** KPay POSTs the refund result here (async). HTTPS, no query string. */
  notifyUrl: string;
}

export interface RefundOrderResult {
  ok: boolean;
  code: number;
  /** Refund order number assigned by KPay. */
  orderNo?: string;
  /** Business state: 1=pending 2=success 3=failed. */
  result?: number;
  /** Human-readable reason (e.g. "退款餘額不足" when balance is short). */
  reason?: string;
  message?: string;
}

/**
 * Refund (full or partial) against a prior successful transaction.
 *
 * Note on KPay's fee model: refundable balance = original amount −
 * (payment fee + refund fee). Refunding the FULL original amount right
 * after a single charge typically fails with "退款餘額不足" because the
 * fee was already deducted — this is expected and is exactly what the
 * UAT "refund failure" case verifies.
 */
export async function refundOrder(
  input: RefundOrderInput,
): Promise<RefundOrderResult> {
  const path = ENDPOINTS.refund;
  const body = JSON.stringify({
    outTradeNo: input.outTradeNo,
    oriOrderNo: input.oriOrderNo,
    refundAmount: input.refundAmount,
    notifyUrl: input.notifyUrl,
  });
  const headers = signRequest('POST', path, body);
  const res = await kpayFetch(`${getApiBase()}${path}`, {
    method: 'POST',
    headers: headers as unknown as Record<string, string>,
    body,
  });
  const data = (await res.json()) as {
    code: number;
    data?: { orderNo: string; result: number; reason: string };
    message?: string;
  };
  return {
    ok: data.code === 10000,
    code: data.code,
    orderNo: data.data?.orderNo,
    result: data.data?.result,
    reason: data.data?.reason,
    message: data.message,
  };
}

// ──────────────────────────────────────────────────────────
// Status decoding (from properties + status_code docs)
// ──────────────────────────────────────────────────────────

/** Transaction states reported in webhook payloads.
 *  1 待處理 / 2 處理成功 / 3 處理失敗 / 4 已退貨 / 5 已撤銷 */
export type TransactionState = 1 | 2 | 3 | 4 | 5;

export function isTransactionSuccess(state: number): boolean {
  return state === 2;
}

/**
 * Public origin for returnUrl / notifyUrl.
 *
 * On Vercel PREVIEW deployments (the kpay-integration test site),
 * NEXT_PUBLIC_APP_URL is set to https://spacohk.com — following it
 * would send KPay's payment callbacks to PRODUCTION, which has no
 * KPay webhook, silently losing them (and bouncing the customer to
 * the wrong site after payment). Prefer the deployment's own URL
 * there; production keeps NEXT_PUBLIC_APP_URL.
 */
export function getPublicOrigin(requestOrigin: string): string {
  if (process.env.VERCEL_ENV === 'preview') {
    const host = process.env.VERCEL_BRANCH_URL || process.env.VERCEL_URL;
    if (host) return `https://${host}`;
  }
  return process.env.NEXT_PUBLIC_APP_URL || requestOrigin;
}

/** Connection check — returns true when all 4 required env vars are present. */
export function isKpayConfigured(): boolean {
  return !!(
    process.env.KPAY_MID
    && process.env.KPAY_PRIVATE_KEY
    && process.env.KPAY_PLATFORM_PUBLIC_KEY
    && process.env.KPAY_API_BASE
  );
}
