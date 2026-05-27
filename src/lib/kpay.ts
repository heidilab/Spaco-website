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
 */
export function verifyNotify(opts: {
  method: 'POST';
  url: string;            // path only, e.g. /api/kpay/webhook
  signature: string;
  timestamp: string;
  nonce: string;
  merchantCode: string;
  body: string;
}): boolean {
  const stringToSign = buildSignString({
    method: opts.method,
    url: opts.url,
    timestamp: opts.timestamp,
    nonce: opts.nonce,
    mid: opts.merchantCode,
    body: opts.body,
  });
  try {
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(stringToSign, 'utf8');
    return verifier.verify(getPlatformPublicKey(), opts.signature, 'base64');
  } catch (err) {
    console.warn('[kpay] verifyNotify failed:', err);
    return false;
  }
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
    itemList: input.itemList.map((i) => ({
      itemNo: i.itemNo,
      itemName: i.itemName,
      price: i.price,
      priceCurrency: 'HKD',
      quantity: i.quantity,
    })),
  });

  const headers = signRequest('POST', path, body);
  const res = await fetch(`${getApiBase()}${path}`, {
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
  // Body is empty for GET. Sign string still gets the trailing \n.
  const stringToSign = buildSignString({
    method: 'GET',
    url: path,
    timestamp,
    nonce,
    mid,
    body: '',
  });
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(stringToSign, 'utf8');
  const signature = signer.sign(getPrivateKey(), 'base64');

  const params = new URLSearchParams({
    managedOrderNo: opts.managedOrderNo,
    language,
    [HEADERS.MERCHANT]: mid,
    [HEADERS.NONCE]: nonce,
    [HEADERS.TIMESTAMP]: timestamp,
    [HEADERS.SIGNATURE]: signature,
  });
  return `${getApiBase()}${path}?${params.toString()}`;
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
  const res = await fetch(`${getApiBase()}${path}`, {
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
// Status decoding (from properties + status_code docs)
// ──────────────────────────────────────────────────────────

/** Transaction states reported in webhook payloads.
 *  1 待處理 / 2 處理成功 / 3 處理失敗 / 4 已退貨 / 5 已撤銷 */
export type TransactionState = 1 | 2 | 3 | 4 | 5;

export function isTransactionSuccess(state: number): boolean {
  return state === 2;
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
