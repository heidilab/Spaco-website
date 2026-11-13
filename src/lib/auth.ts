import {
  signInWithPopup,
  signInWithRedirect,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  User,
  updateProfile,
} from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from './firebase';

const googleProvider = new GoogleAuthProvider();

export async function signInWithGoogle() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    await upsertUserProfile(result.user);
    return result.user;
  } catch (err) {
    // Popup blocked (common in in-app browsers / strict settings) —
    // fall back to full-page redirect. The auth-state listener +
    // ensureUserProfile pick things up after Google bounces back.
    const code = (err as { code?: string })?.code || '';
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, googleProvider);
      return null;
    }
    throw err;
  }
}

export async function signInWithEmail(email: string, password: string) {
  const result = await signInWithEmailAndPassword(auth, email, password);
  await upsertUserProfile(result.user);
  return result.user;
}

export async function registerWithEmail(
  email: string,
  password: string,
  displayName: string
) {
  const result = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(result.user, { displayName });
  await upsertUserProfile(result.user);
  return result.user;
}

export async function signOut() {
  await firebaseSignOut(auth);
}

export function onAuthChange(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, callback);
}

/** Ensure the users/{uid} profile doc exists — safe to call on every
 *  auth-state change. Self-heals accounts whose doc creation was
 *  interrupted at sign-up (e.g. #5JfJu5Ca: Google popup succeeded but
 *  the page navigated away before the setDoc finished, leaving an auth
 *  user invisible to member admin). */
export async function ensureUserProfile(user: User) {
  try {
    await upsertUserProfile(user);
  } catch (err) {
    console.warn('[Auth] ensureUserProfile failed (non-blocking):', err);
  }
}

async function upsertUserProfile(user: User) {
  const userRef = doc(db, 'users', user.uid);
  const snap = await getDoc(userRef);

  if (!snap.exists()) {
    await setDoc(userRef, {
      email: user.email,
      displayName: user.displayName || '',
      photoURL: user.photoURL || '',
      phone: '',
      loyaltyPoints: 0,
      createdAt: serverTimestamp(),
      lastLogin: serverTimestamp(),
    });
    // Send the welcome email asynchronously — failure must not block sign-up.
    if (user.email) {
      fetch('/api/email/welcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: user.email,
          customerName: user.displayName || user.email.split('@')[0],
        }),
      }).catch((err) => console.warn('[welcome email] non-blocking failure:', err));
    }
  } else {
    // The name used to be written only when the doc was first created, so
    // a doc created before the name was known (sign-up interrupted, or
    // email registration racing its own updateProfile) stayed nameless —
    // staff saw those members as 「訪客」 (Heidi 2026-11-13). Fill a MISSING
    // name / photo from the sign-in account on every sign-in; never
    // overwrite one the member already has (they can edit it themselves).
    const stored = snap.data() as { displayName?: string; photoURL?: string };
    const patch: Record<string, unknown> = { lastLogin: serverTimestamp() };
    const accountName = (user.displayName || '').trim().slice(0, 200);
    if (!(stored.displayName || '').trim() && accountName) patch.displayName = accountName;
    if (!stored.photoURL && user.photoURL) patch.photoURL = user.photoURL;
    await setDoc(userRef, patch, { merge: true });
  }
}

export async function isAdmin(uid: string): Promise<boolean> {
  const adminRef = doc(db, 'admin_users', uid);
  const snap = await getDoc(adminRef);
  return snap.exists();
}

export async function getStaffRole(uid: string): Promise<'admin' | 'cs' | 'cleaner' | 'marketing' | null> {
  const adminRef = doc(db, 'admin_users', uid);
  const snap = await getDoc(adminRef);
  if (!snap.exists()) return null;
  const data = snap.data();
  return ['admin', 'cs', 'cleaner', 'marketing'].includes(data.role) ? data.role : null;
}
