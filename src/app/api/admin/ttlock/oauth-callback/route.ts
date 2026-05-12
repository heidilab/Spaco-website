/**
 * TTLock OAuth callback — one-time setup endpoint.
 *
 * Visit the authorize URL → log in to TTLock with the account that owns the
 * locks → TTLock redirects here with `?code=…` → we exchange the code for an
 * access_token + refresh_token and render the values so an admin can paste
 * the refresh_token into Vercel / .env.local as TTLOCK_REFRESH_TOKEN.
 *
 * After that, lib/ttlock.ts uses the refresh_token to mint access_tokens
 * indefinitely (until the user revokes the grant). The customer password is
 * no longer needed.
 *
 * This endpoint is intentionally unprotected so the OAuth redirect can land
 * here — but it does nothing more than exchange a one-time code that TTLock
 * already validated. Remove or restrict after setup if you want belt+braces.
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const TTLOCK_API_BASE = process.env.TTLOCK_API_BASE || 'https://euapi.ttlock.com';

interface TokenResp {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  uid?: number;
  openid?: number;
  scope?: string;
  errcode?: number;
  errmsg?: string;
}

function errorPage(title: string, body: string, status = 400): NextResponse {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:680px;margin:60px auto;padding:0 20px;color:#222;line-height:1.6}h1{color:#c33}pre{background:#f4f4f4;padding:14px;border-radius:8px;overflow:auto;font-size:13px}</style>
</head><body><h1>${title}</h1>${body}</body></html>`;
  return new NextResponse(html, { status, headers: { 'Content-Type': 'text/html' } });
}

/** TTLock dev portal probes the callback with a HEAD/POST request to
 *  verify reachability before saving. Reply 200 so the test passes. */
export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}
export async function POST() {
  return new NextResponse('OK', { status: 200 });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const err  = url.searchParams.get('error');

  if (err) {
    return errorPage('TTLock 授權失敗', `<p>TTLock returned <code>error=${err}</code>. 請重新由 authorize URL 開始。</p>`);
  }
  if (!code) {
    // 200 — direct visits and TTLock's "reachability test" both hit this path.
    // Returning 200 makes the dev-portal callback URL test pass; the actual
    // OAuth flow lands here with ?code=… which is handled below.
    return errorPage(
      'TTLock OAuth callback',
      '<p>呢個 endpoint 等緊 TTLock 帶住 <code>?code=…</code> redirect 過嚟。直接 visit 呢條 URL 唔會 work — 要由 authorize URL 開始 OAuth flow。</p>',
      200,
    );
  }

  const clientId     = process.env.TTLOCK_CLIENT_ID;
  const clientSecret = process.env.TTLOCK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return errorPage('Missing env vars', '<p>TTLOCK_CLIENT_ID / TTLOCK_CLIENT_SECRET 未設定，請先喺 .env.local 加返。</p>');
  }

  // Rebuild the exact redirect URI used in the authorize URL. TTLock
  // validates this server-side — must match what's registered in the dev
  // portal, character-for-character.
  const redirectUri = `${url.origin}/api/admin/ttlock/oauth-callback`;

  const body = new URLSearchParams({
    clientId,
    clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  let data: TokenResp;
  try {
    const res = await fetch(`${TTLOCK_API_BASE}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    data = (await res.json()) as TokenResp;
  } catch (e) {
    return errorPage('Network error', `<pre>${e instanceof Error ? e.message : String(e)}</pre>`);
  }

  if (data.errcode || !data.access_token || !data.refresh_token) {
    return errorPage(
      'Token exchange failed',
      `<p>TTLock 拒絕 code → token 換算。原因：</p><pre>${JSON.stringify(data, null, 2)}</pre>
       <p>常見原因：redirect_uri 同 dev portal 註冊嘅唔完全一樣（連 trailing slash 都要對得正）。</p>`,
    );
  }

  const safeAccessPreview  = `${data.access_token.slice(0, 8)}…${data.access_token.slice(-4)}`;
  const safeRefreshPreview = `${data.refresh_token.slice(0, 8)}…${data.refresh_token.slice(-4)}`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>TTLock 授權成功</title>
<style>
  body{font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:680px;margin:60px auto;padding:0 20px;color:#222;line-height:1.6}
  h1{color:#1a7f37}
  .token{background:#fffbe6;border:1px solid #f7d774;padding:14px;border-radius:8px;word-break:break-all;font-family:'SF Mono',Menlo,monospace;font-size:13px;margin:8px 0 20px}
  .meta{color:#666;font-size:13px}
  ol{padding-left:20px}
  code{background:#eef;padding:2px 6px;border-radius:4px;font-size:12px}
</style>
</head><body>
  <h1>✅ TTLock 授權成功</h1>
  <p>copy 低嗰個 <strong>refresh_token</strong>，跟住跟 instructions 加入 env vars。</p>

  <h3>refresh_token（呢個係長期憑證，要 keep secret）</h3>
  <div class="token">${data.refresh_token}</div>

  <h3>access_token (短期，~30 日，唔使存)</h3>
  <p class="meta">${safeAccessPreview} · expires_in: ${data.expires_in}s</p>

  <h3>openid / uid</h3>
  <p class="meta">openid: ${data.openid ?? '(none)'} · uid: ${data.uid ?? '(none)'} · scope: ${data.scope ?? '(none)'}</p>

  <h3>下一步</h3>
  <ol>
    <li>將上面個 refresh_token 加入 <code>.env.local</code>：<br>
      <code>TTLOCK_REFRESH_TOKEN=&lt;paste here&gt;</code></li>
    <li>之後重啟 dev server / Vercel deploy</li>
    <li>之後唔再需要 <code>TTLOCK_USERNAME</code> / <code>TTLOCK_PASSWORD_MD5</code></li>
  </ol>

  <p class="meta">如果你 lost 咗呢個 token：重新走一次 OAuth flow 就會出新嘅。</p>
</body></html>`;

  return new NextResponse(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
}
