import { getApps, initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

// Server-only Firebase Admin SDK. Bypasses Firestore security rules — used by
// API routes that need to read/write admin-only collections (secrets/, system/)
// where there is no client auth context.
//
// Credentials resolution order:
//   1. FIREBASE_SERVICE_ACCOUNT_KEY env var — JSON string of service account
//      (used in production / Vercel where ADC isn't available).
//   2. Application Default Credentials — local dev via
//      `gcloud auth application-default login`.

const projectId =
  process.env.FIREBASE_ADMIN_PROJECT_ID ||
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

function initAdmin() {
  if (getApps().length > 0) return;

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (serviceAccountJson) {
    const parsed = JSON.parse(serviceAccountJson);
    initializeApp({ credential: cert(parsed), projectId: parsed.project_id || projectId });
    return;
  }

  initializeApp({ credential: applicationDefault(), projectId });
}

initAdmin();

export const adminDb: Firestore = getFirestore();
