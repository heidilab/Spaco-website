import { NextRequest, NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'fs';
import { requireCronSecret } from '@/lib/adminAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Diagnostic endpoint for the Workload Identity Federation bootstrap.
 * Reports presence (NOT values) of the env vars + whether the WIF JSON
 * is structurally valid. Safe to expose: returns no secrets.
 *
 * Hit GET /api/debug/wif?key=spaco-debug to see status.
 */
export async function GET(req: NextRequest) {
  // CRON_SECRET-gated (was a hardcoded ?key=spaco-debug, an internet-wide
  // info-leak). Invoke with Authorization: Bearer <CRON_SECRET>.
  const gate = requireCronSecret(req);
  if (gate) return gate;

  const wifConfigRaw = process.env.GCP_WIF_CONFIG;
  const oidcToken = process.env.VERCEL_OIDC_TOKEN;
  const gac = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const saKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

  const out: Record<string, unknown> = {
    env: {
      VERCEL: !!process.env.VERCEL,
      VERCEL_ENV: process.env.VERCEL_ENV || null,
      VERCEL_OIDC_TOKEN_present: !!oidcToken,
      VERCEL_OIDC_TOKEN_length: oidcToken?.length ?? 0,
      GCP_WIF_CONFIG_present: !!wifConfigRaw,
      GCP_WIF_CONFIG_length: wifConfigRaw?.length ?? 0,
      FIREBASE_SERVICE_ACCOUNT_KEY_present: !!saKey,
      GOOGLE_APPLICATION_CREDENTIALS: gac || null,
    },
  };

  // Inspect WIF config structure
  if (wifConfigRaw) {
    try {
      const parsed = JSON.parse(wifConfigRaw) as Record<string, unknown>;
      out.wif_config = {
        type: parsed.type,
        audience: parsed.audience,
        token_url: parsed.token_url,
        service_account_impersonation_url:
          (parsed.service_account_impersonation_url as string | undefined)?.replace(
            /\/serviceAccounts\/.*$/,
            '/serviceAccounts/***@***.iam.gserviceaccount.com:generateAccessToken',
          ),
        credential_source_keys: Object.keys(parsed.credential_source || {}),
      };
    } catch (err) {
      out.wif_config_error = err instanceof Error ? err.message : String(err);
    }
  }

  // Check files written by bootstrap
  out.files = {
    '/tmp/vercel-oidc-token': existsSync('/tmp/vercel-oidc-token'),
    '/tmp/gcp-wif-config.json': existsSync('/tmp/gcp-wif-config.json'),
  };
  if (existsSync('/tmp/gcp-wif-config.json')) {
    try {
      const written = JSON.parse(readFileSync('/tmp/gcp-wif-config.json', 'utf8')) as Record<string, unknown>;
      out.written_config = {
        type: written.type,
        credential_source: written.credential_source,
      };
    } catch (err) {
      out.written_config_error = err instanceof Error ? err.message : String(err);
    }
  }

  // Try to actually use Firebase Admin
  try {
    const { adminDb } = await import('@/lib/firebaseAdmin');
    const snap = await adminDb.collection('bookings').limit(1).get();
    out.firestore_test = { ok: true, size: snap.size };
  } catch (err) {
    out.firestore_test = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack?.split('\n').slice(0, 5).join('\n') : null,
    };
  }

  return NextResponse.json(out, { status: 200 });
}
