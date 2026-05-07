import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc, updateDoc,
  query, where, serverTimestamp, writeBatch,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from './firebase';
import { SiteImage, SiteContentSection } from '@/types';

// ============ SITE IMAGES ============

export async function uploadSiteImage(
  file: File,
  key: string,
  section: string,
  alt: string,
  order?: number
): Promise<SiteImage> {
  // Random suffix avoids collisions when the same key is uploaded twice in
  // the same millisecond (e.g., bulk multi-file upload).
  const rand = Math.random().toString(36).slice(2, 7);
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
  const storageRef = ref(storage, `site-images/${key}-${Date.now()}-${rand}.${ext}`);
  await uploadBytes(storageRef, file);
  const url = await getDownloadURL(storageRef);

  const docRef = doc(collection(db, 'site_images'));
  const imageData: Omit<SiteImage, 'id'> = {
    key,
    url,
    alt,
    section,
    uploadedAt: serverTimestamp(),
    ...(typeof order === 'number' ? { order } : {}),
  };
  await setDoc(docRef, imageData);

  return { id: docRef.id, ...imageData } as SiteImage;
}

// ============ Branch photos: bulk upload + reorder ============
//
// New mental model for branch photo galleries: photos are an ordered list
// (no fixed slot count). Each photo has a unique random `key` and an explicit
// `order` field. Display order = `order` ASC, with fallback to legacy key
// suffix for pre-existing data.

/** Sort comparator: prefer explicit `order`, fall back to numeric key suffix. */
export function compareSiteImages(a: SiteImage, b: SiteImage): number {
  const ao = typeof a.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER;
  const bo = typeof b.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER;
  if (ao !== bo) return ao - bo;
  // Both lack order → fall back to legacy numeric suffix in key (e.g. cwb-3)
  const an = parseInt(a.key.split('-').pop() || '0');
  const bn = parseInt(b.key.split('-').pop() || '0');
  return an - bn;
}

/** Upload many files into a section as a contiguous ordered batch.
 *  `keyPrefix` is used for the Firestore `key` field; each file gets a
 *  unique `key = keyPrefix-{timestamp}-{rand}` so existing slot-based
 *  consumers never see a collision. */
export async function uploadSiteImagesBulk(
  files: File[],
  section: string,
  keyPrefix: string,
  startingOrder: number,
): Promise<SiteImage[]> {
  const uploaded: SiteImage[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const rand = Math.random().toString(36).slice(2, 7);
    const uniqueKey = `${keyPrefix}-${Date.now()}-${rand}`;
    const img = await uploadSiteImage(
      file, uniqueKey, section, uniqueKey, startingOrder + i
    );
    uploaded.push(img);
  }
  return uploaded;
}

/** Persist a new ordering: takes an array of image IDs in the desired order
 *  and writes `order` field accordingly. Single batched write. */
export async function reorderSiteImages(orderedIds: string[]) {
  const batch = writeBatch(db);
  orderedIds.forEach((id, idx) => {
    batch.update(doc(db, 'site_images', id), { order: idx });
  });
  await batch.commit();
}

/** Update a single image's `order` (used during drag-drop). */
export async function setSiteImageOrder(id: string, order: number) {
  await updateDoc(doc(db, 'site_images', id), { order });
}

/** Set / clear an image's click-through URL (used by the homepage promo
 *  section so admins can choose where each promo card links to). Pass
 *  `null` to clear. */
export async function setSiteImageLinkUrl(id: string, linkUrl: string | null) {
  await updateDoc(doc(db, 'site_images', id), {
    // Firestore can't store undefined; use deleteField semantics via empty string ⇒ undefined
    linkUrl: linkUrl ?? '',
  });
}

export async function getSiteImages(section?: string): Promise<SiteImage[]> {
  let q;
  if (section) {
    q = query(collection(db, 'site_images'), where('section', '==', section));
  } else {
    q = query(collection(db, 'site_images'));
  }
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as SiteImage));
}

export async function getSiteImageByKey(key: string): Promise<SiteImage | null> {
  const q = query(collection(db, 'site_images'), where('key', '==', key));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() } as SiteImage;
}

export async function deleteSiteImage(id: string, url: string) {
  await deleteDoc(doc(db, 'site_images', id));
  try {
    const storageRef = ref(storage, url);
    await deleteObject(storageRef);
  } catch {
    // Storage deletion may fail if URL format differs
  }
}

// ============ SITE CONTENT ============

export async function getSiteContent(pageId: string): Promise<SiteContentSection | null> {
  const snap = await getDoc(doc(db, 'site_content', pageId));
  if (!snap.exists()) return null;
  return snap.data().sections as SiteContentSection;
}

export async function updateSiteContent(
  pageId: string,
  sections: SiteContentSection,
  updatedBy: string
) {
  await setDoc(doc(db, 'site_content', pageId), {
    sections,
    updatedAt: serverTimestamp(),
    updatedBy,
  }, { merge: true });
}

export async function getAllSiteContent(): Promise<Record<string, SiteContentSection>> {
  const snap = await getDocs(collection(db, 'site_content'));
  const result: Record<string, SiteContentSection> = {};
  snap.docs.forEach((d) => {
    result[d.id] = d.data().sections as SiteContentSection;
  });
  return result;
}

// ============ STAFF MANAGEMENT ============

export async function getAllStaff() {
  const snap = await getDocs(collection(db, 'admin_users'));
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}

export async function setStaffRole(
  uid: string,
  role: 'admin' | 'cs' | 'cleaner' | 'marketing',
  displayName: string,
  email: string,
  addedBy: string
) {
  await setDoc(doc(db, 'admin_users', uid), {
    role,
    displayName,
    email,
    addedAt: serverTimestamp(),
    addedBy,
  });
}

export async function removeStaff(uid: string) {
  await deleteDoc(doc(db, 'admin_users', uid));
}

export async function findUserByEmail(email: string) {
  const q = query(collection(db, 'users'), where('email', '==', email));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { uid: d.id, ...d.data() };
}
