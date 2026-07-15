import { auth } from './firebase';

/**
 * fetch() wrapper for admin API routes gated by requireAdmin(). Attaches
 * the current admin's Firebase ID token as `Authorization: Bearer …` so
 * the server can verify staff role. Use for every call to an admin route
 * that mutates data or reads sensitive info.
 *
 * Throws 'Not signed in' if there's no authenticated user. Mirrors the
 * fetch() signature; merges the Authorization header into any headers
 * the caller passes.
 */
export async function adminApiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  const token = await user.getIdToken();
  return fetch(input, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });
}
