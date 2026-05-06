import { writeFileSync } from 'fs';
import { getApps, initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

// Server-only Firebase Admin SDK. Bypasses Firestore security rules — used by
// API routes that need to read/write admin-only collections (secrets/, system/)
// where there is no client auth context.
//
// Credentials resolution order:
//   1. FIREBASE_SERVICE_ACCOUNT_KEY  — service account JSON string. Legacy path,
//      may be unavailable when org policy disables service-account key creation.
//   2. GCP_WIF_CONFIG + VERCEL_OIDC_TOKEN — Workload Identity Federation: the
//      Vercel deployment mints an OIDC token that GCP's STS exchanges for a
//      short-lived access token via service-account impersonation. No long-
//      lived secret leaves GCP.
//   3. Application Default Credentials — local dev via
//      `gcloud auth application-default login`.

const projectId =
  process.env.FIREBASE_ADMIN_PROJECT_ID ||
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

/** Bootstrap Workload Identity Federation by materialising the WIF config +
 *  the Vercel OIDC token onto disk, then pointing GOOGLE_APPLICATION_CREDENTIALS
 *  at the config file. Returns true if WIF was wired up. */
function bootstrapWifFromVercel(): boolean {
  const configJson = process.env.GCP_WIF_CONFIG;
  const oidcToken = process.env.VERCEL_OIDC_TOKEN;
  if (!configJson || !oidcToken) return false;

  try {
    // Vercel's only writable filesystem location in serverless functions is /tmp.
    const tokenPath = '/tmp/vercel-oidc-token';
    const configPath = '/tmp/gcp-wif-config.json';

    writeFileSync(tokenPath, oidcToken, { encoding: 'utf8', mode: 0o600 });

    // Force credential_source.file to our token path. Anything else in the
    // user-supplied config (audience, SA impersonation URL) is preserved.
    const config = JSON.parse(configJson) as Record<string, unknown>;
    config.credential_source = { file: tokenPath };
    writeFileSync(configPath, JSON.stringify(config), { encoding: 'utf8' });

    process.env.GOOGLE_APPLICATION_CREDENTIALS = configPath;
    return true;
  } catch (err) {
    console.error('[firebaseAdmin] WIF bootstrap failed:', err);
    return false;
  }
}

function initAdmin() {
  if (getApps().length > 0) return;

  // 1. Service account JSON (legacy / personal projects without org policy)
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (serviceAccountJson) {
    const parsed = JSON.parse(serviceAccountJson);
    initializeApp({ credential: cert(parsed), projectId: parsed.project_id || projectId });
    return;
  }

  // 2. Workload Identity Federation via Vercel OIDC
  if (bootstrapWifFromVercel()) {
    initializeApp({ credential: applicationDefault(), projectId });
    return;
  }

  // 3. ADC (local dev)
  initializeApp({ credential: applicationDefault(), projectId });
}

initAdmin();

export const adminDb: Firestore = getFirestore();
