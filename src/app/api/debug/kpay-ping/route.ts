import { NextRequest, NextResponse } from 'next/server';
import { fetch as undiciFetch, ProxyAgent } from 'undici';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// TEMPORARY connectivity diagnostic for the KPay outage (2026-07-21).
// Reports: proxy env presence, egress IP through the proxy, and whether
// the KPay API host answers (any HTTP status = reachable). No secrets in
// the response. Gated by a hardcoded one-off token; REMOVE after the
// incident is resolved.
const DIAG_TOKEN = 'spaco-diag-kpay-9f3e71';

export async function GET(req: NextRequest) {
  if (req.headers.get('x-diag-token') !== DIAG_TOKEN) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const out: Record<string, unknown> = {
    proxyConfigured: !!process.env.KPAY_PROXY_URL,
    apiBase: process.env.KPAY_API_BASE || '(unset → uat default)',
    midSet: !!process.env.KPAY_MID,
  };

  const proxyUrl = process.env.KPAY_PROXY_URL;
  const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

  // 1. Egress IP through the proxy (what KPay's whitelist sees).
  try {
    const r = await undiciFetch('https://api.ipify.org', dispatcher ? ({ dispatcher } as never) : undefined);
    out.egressIp = { status: r.status, ip: (await r.text()).slice(0, 60) };
  } catch (err) {
    out.egressIp = { error: err instanceof Error ? err.message : String(err) };
  }

  // 2. KPay API host reachability through the same path checkout uses.
  //    An unsigned POST is expected to be REJECTED by KPay with a JSON
  //    error — any HTTP response proves the proxy + network + KPay WAF
  //    let us through. A thrown fetch = proxy/network dead. A 403 = KPay
  //    blocking our IP.
  try {
    const base = process.env.KPAY_API_BASE || 'https://payment.uat.kpay-group.com';
    const r = await undiciFetch(`${base}/api/entry/managed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      ...(dispatcher ? { dispatcher } : {}),
    } as never);
    out.kpayApi = { status: r.status, bodyHead: (await r.text()).slice(0, 200) };
  } catch (err) {
    out.kpayApi = { error: err instanceof Error ? err.message : String(err) };
  }

  return NextResponse.json(out);
}
