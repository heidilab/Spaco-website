import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { Article } from '@/types';

// Firestore `articles` collection. Public read for published; admin write.
// Slug uniqueness is enforced application-side (Firestore composite index
// on slug+status would help — for now we scan).

const COLLECTION = 'articles';

/** Public list — only published, newest first. */
export async function listPublishedArticles(): Promise<Article[]> {
  const q = query(
    collection(db, COLLECTION),
    where('status', '==', 'published'),
  );
  const snap = await getDocs(q);
  const items = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Article));
  return items.sort((a, b) => {
    const ta = (a.publishedAt as { toMillis?: () => number } | null)?.toMillis?.() ?? 0;
    const tb = (b.publishedAt as { toMillis?: () => number } | null)?.toMillis?.() ?? 0;
    return tb - ta;
  });
}

/** Admin list — all statuses, newest first by updatedAt. */
export async function listAllArticles(): Promise<Article[]> {
  const snap = await getDocs(collection(db, COLLECTION));
  const items = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Article));
  return items.sort((a, b) => {
    const ta = (a.updatedAt as { toMillis?: () => number } | null)?.toMillis?.() ?? 0;
    const tb = (b.updatedAt as { toMillis?: () => number } | null)?.toMillis?.() ?? 0;
    return tb - ta;
  });
}

/** Lookup by slug (for /articles/[slug]). */
export async function getArticleBySlug(slug: string): Promise<Article | null> {
  const q = query(collection(db, COLLECTION), where('slug', '==', slug));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() } as Article;
}

/** Lookup by id (for admin edit). */
export async function getArticleById(id: string): Promise<Article | null> {
  const snap = await getDoc(doc(db, COLLECTION, id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as Article;
}

/** Create. Returns the new doc id. */
export async function createArticle(
  data: Omit<Article, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<string> {
  const payload = {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...(data.status === 'published' ? { publishedAt: serverTimestamp() } : {}),
  };
  const ref = await addDoc(collection(db, COLLECTION), payload);
  return ref.id;
}

/** Patch update. If transitioning draft → published for the first time,
 *  also stamps publishedAt. */
export async function updateArticle(
  id: string,
  patch: Partial<Omit<Article, 'id' | 'createdAt'>>,
): Promise<void> {
  const existing = await getArticleById(id);
  const transitioningToPublished =
    patch.status === 'published'
    && existing?.status !== 'published'
    && !existing?.publishedAt;

  const finalPatch: Record<string, unknown> = {
    ...patch,
    updatedAt: serverTimestamp(),
    ...(transitioningToPublished ? { publishedAt: serverTimestamp() } : {}),
  };
  await updateDoc(doc(db, COLLECTION, id), finalPatch);
}

/** Hard delete. */
export async function deleteArticle(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION, id));
}

/** Server-side overwrite (used by admin migrations / seed scripts). */
export async function upsertArticle(id: string, data: Article): Promise<void> {
  await setDoc(doc(db, COLLECTION, id), data);
}

/** Slug uniqueness check — used by admin form before save. Excludes the
 *  given articleId so editing one's own slug doesn't false-positive. */
export async function isSlugTaken(slug: string, excludeId?: string): Promise<boolean> {
  const q = query(collection(db, COLLECTION), where('slug', '==', slug));
  const snap = await getDocs(q);
  return snap.docs.some((d) => d.id !== excludeId);
}

/** Slugify a Chinese/English title into a URL-safe slug. Falls back to
 *  the id-prefix for purely Chinese titles where ASCII chars are scarce. */
export function makeSlug(input: string): string {
  const ascii = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')   // strip combining marks
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  if (ascii.length >= 3) return ascii;
  // Pure-CJK title: use timestamp-suffixed prefix so it's still URL-safe.
  return `post-${Date.now().toString(36)}`;
}
