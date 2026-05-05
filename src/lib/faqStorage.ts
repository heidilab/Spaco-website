import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { DEFAULT_FAQ, FaqContent } from './faqDefaults';

/** Firestore doc holding the editable FAQ payload. */
const FAQ_DOC = doc(db, 'site_content', 'faq');

/** Load the FAQ content from Firestore. Falls back to the defaults so the
 *  public FAQ page always has something to render. */
export async function loadFaqContent(): Promise<FaqContent> {
  const snap = await getDoc(FAQ_DOC);
  if (!snap.exists()) return DEFAULT_FAQ;
  const data = snap.data();
  // Validate the shape — old entries without ids get patched with one.
  const sanitize = (list: unknown): FaqContent['faqItems'] => {
    if (!Array.isArray(list)) return [];
    return list.map((entry, i) => {
      const e = entry as Partial<FaqContent['faqItems'][number]> | undefined;
      return {
        id: (e?.id as string) || `entry-${i}`,
        zh: { q: e?.zh?.q || '', a: e?.zh?.a || '' },
        en: { q: e?.en?.q || '', a: e?.en?.a || '' },
      };
    });
  };
  return {
    guestRules: sanitize(data.guestRules),
    faqItems: sanitize(data.faqItems),
  };
}

/** Persist the FAQ content (admin-only via Firestore rules). */
export async function saveFaqContent(content: FaqContent, updatedBy: string) {
  await setDoc(FAQ_DOC, {
    ...content,
    updatedAt: serverTimestamp(),
    updatedBy,
  });
}
