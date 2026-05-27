import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import {
  createManagedOrder,
  buildCashierRedirectUrl,
  isKpayConfigured,
  signRequest,
  verifyNotify,
} from '@/lib/kpay';

export const runtime = 'nodejs';

/**
 * TEMPORARY one-off — verifies KPay sandbox connectivity end-to-end:
 *
 *   1. Confirms env vars are set
 *   2. Self-test: signs a string with our private key, verifies the
 *      result with our public key (round-trip — both keys came from
 *      KPay so they should be a matched pair)
 *   3. Calls KPay sandbox `/v1/managed/order/add` with a HK$1 test
 *      order — confirms our signature is accepted by KPay
 *   4. Builds + returns the cashier redirect URL so we can eyeball
 *      that the GET params look right
 *
 * Delete this file after green-lighting.
 */
export async function GET(req: NextRequest) {
  const stages: Array<{ stage: string; ok: boolean; detail?: unknown }> = [];

  // Stage 1: env presence
  const configured = isKpayConfigured();
  stages.push({
    stage: 'env_vars',
    ok: configured,
    detail: configured
      ? { mid: process.env.KPAY_MID, apiBase: process.env.KPAY_API_BASE }
      : 'missing one of KPAY_MID / KPAY_PRIVATE_KEY / KPAY_PLATFORM_PUBLIC_KEY / KPAY_API_BASE',
  });
  if (!configured) return NextResponse.json({ ok: false, stages });

  // Stage 2: sign-verify self test with OUR keypair (KPay shipped both
  // our private + our public; round-trip MUST pass).
  let selfTestOk = false;
  let selfTestErr: string | undefined;
  try {
    const headers = signRequest('GET', '/_selftest', '');
    // Derive our public key from our private key for the round-trip
    // verify. The env var is bare base64 — apply the same PEM wrap
    // the lib uses internally so OpenSSL can parse it.
    const rawKey = (process.env.KPAY_PRIVATE_KEY as string).trim().replace(/\\n/g, '\n');
    const pemPriv = rawKey.includes('-----BEGIN')
      ? rawKey
      : `-----BEGIN PRIVATE KEY-----\n${rawKey.match(/.{1,64}/g)?.join('\n') || rawKey}\n-----END PRIVATE KEY-----`;
    const ourPub = crypto.createPublicKey({
      key: pemPriv,
      format: 'pem',
    });
    const stringToSign = [
      'GET',
      '/_selftest',
      headers['K-Timestamp'],
      headers['K-Nonce-Str'],
      headers['K-Merchant-Code'],
      '',
      '',
    ].join('\n');
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(stringToSign, 'utf8');
    selfTestOk = verifier.verify(ourPub, headers['K-Signature'], 'base64');
  } catch (err) {
    selfTestErr = err instanceof Error ? err.message : String(err);
  }
  stages.push({
    stage: 'sign_verify_roundtrip',
    ok: selfTestOk,
    detail: selfTestErr,
  });
  if (!selfTestOk) return NextResponse.json({ ok: false, stages });

  // Stage 3: verifyNotify smoke — sign a payload with the KPay
  // platform key would only work if we had their private key, which
  // we don't. Just confirm verifyNotify rejects garbage cleanly.
  const rejectsGarbage = !verifyNotify({
    method: 'POST',
    url: '/api/kpay/webhook',
    signature: 'aGVsbG8=',
    timestamp: '0',
    nonce: 'x',
    merchantCode: process.env.KPAY_MID as string,
    body: '{}',
  });
  stages.push({
    stage: 'verifyNotify_rejects_garbage',
    ok: rejectsGarbage,
  });

  // Stage 4: live call to KPay sandbox — create a $1 test order.
  const origin = req.nextUrl.origin;
  const managedOutTradeNo = `TEST_${Date.now()}`.slice(0, 32);
  let createOk = false;
  let createDetail: unknown;
  let cashierUrl: string | undefined;
  try {
    const create = await createManagedOrder({
      managedOutTradeNo,
      payAmount: 1,
      returnUrl: `${origin}/zh/book/success?booking_id=TEST`,
      notifyUrl: `${origin}/api/kpay/webhook`,
      itemList: [{
        itemNo: 'TEST001',
        itemName: 'KPay Integration Smoke Test',
        price: 1,
        quantity: 1,
      }],
      orderRemark: 'Automated integration smoke test',
    });
    createOk = create.ok;
    createDetail = create;
    if (create.managedOrderNo) {
      cashierUrl = buildCashierRedirectUrl({
        managedOrderNo: create.managedOrderNo,
      });
    }
  } catch (err) {
    createDetail = err instanceof Error ? err.message : String(err);
  }
  stages.push({
    stage: 'sandbox_create_order',
    ok: createOk,
    detail: createDetail,
  });

  return NextResponse.json({
    ok: stages.every((s) => s.ok),
    stages,
    cashierUrl,
    hint: cashierUrl
      ? 'Open cashierUrl in a browser to see the hosted payment page.'
      : 'Fix earlier stages before testing the cashier UX.',
  });
}
