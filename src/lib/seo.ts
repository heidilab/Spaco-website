import {
  collection, doc, getDoc, getDocs, setDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { SeoEntry, SeoDefaults } from '@/types';
import type { Metadata } from 'next';

// `site_seo` collection layout:
//   - `_default`  →  global SeoDefaults
//   - `<pageId>`  →  per-page SeoEntry  (e.g. 'home', 'corporate', 'branch-cwb', …)

const PROJECT_ID =
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'spaco-website';
const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://spacohk.com';

// ────────────────────────────────────────────────────────────
// Server-side reads via Firestore REST API
// ────────────────────────────────────────────────────────────
//
// `site_seo` docs are publicly readable (Firestore rules: `allow read: if true`)
// so no auth needed. Used in `generateMetadata` server functions.

interface FirestoreField {
  stringValue?: string;
  booleanValue?: boolean;
  mapValue?: { fields?: Record<string, FirestoreField> };
}

function unwrap(v: FirestoreField | undefined): unknown {
  if (!v) return undefined;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.mapValue?.fields) {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v.mapValue.fields)) {
      o[k] = unwrap(val);
    }
    return o;
  }
  return undefined;
}

async function fetchSeoDoc<T>(docId: string): Promise<T | null> {
  const url =
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/site_seo/${encodeURIComponent(docId)}`;
  try {
    const res = await fetch(url, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.fields) return null;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data.fields as Record<string, FirestoreField>)) {
      out[k] = unwrap(v);
    }
    return out as T;
  } catch {
    return null;
  }
}

export async function getSeoDefaults(): Promise<SeoDefaults> {
  return (await fetchSeoDoc<SeoDefaults>('_default')) || {};
}

export async function getSeoEntry(pageId: string): Promise<SeoEntry | null> {
  return await fetchSeoDoc<SeoEntry>(pageId);
}

// ────────────────────────────────────────────────────────────
// `buildMetadata` — used inside `generateMetadata` server fns
// ────────────────────────────────────────────────────────────

interface BuildMetadataInput {
  pageId: string;
  locale: 'zh' | 'en';
  /** Path (no locale prefix) — used to build canonical URL. e.g. '/corporate' */
  path: string;
  /** Hardcoded fallback if Firestore has nothing. */
  fallback?: SeoEntry;
}

export async function buildMetadata({
  pageId, locale, path, fallback,
}: BuildMetadataInput): Promise<Metadata> {
  const [defaults, entry] = await Promise.all([
    getSeoDefaults(),
    getSeoEntry(pageId),
  ]);

  const pick = (
    field: 'title' | 'description' | 'keywords',
    fbValue?: string,
  ): string | undefined => {
    return entry?.[field]?.[locale]
      || fallback?.[field]?.[locale]
      || defaults[field]?.[locale]
      || fbValue;
  };

  const title = pick('title');
  const description = pick('description');
  const keywords = pick('keywords');
  const ogImage = entry?.ogImage || fallback?.ogImage || defaults.ogImage;
  const siteName = defaults.siteName?.[locale];
  const noindex = entry?.noindex ?? fallback?.noindex ?? false;

  const canonicalPath = locale === 'en' ? `/en${path}` : `/zh${path}`;
  const canonical = `${SITE_URL}${canonicalPath}`;

  return {
    metadataBase: new URL(SITE_URL),
    title,
    description,
    keywords,
    alternates: {
      canonical,
      languages: {
        'zh-HK': `${SITE_URL}/zh${path}`,
        'en':    `${SITE_URL}/en${path}`,
      },
    },
    robots: noindex ? { index: false, follow: false } : undefined,
    openGraph: {
      type: 'website',
      url: canonical,
      title,
      description,
      siteName,
      locale: locale === 'zh' ? 'zh_HK' : 'en_US',
      images: ogImage ? [{ url: ogImage }] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: ogImage ? [ogImage] : undefined,
      site: defaults.twitterHandle,
    },
    themeColor: defaults.themeColor,
  };
}

// ────────────────────────────────────────────────────────────
// Client-side writes (admin UI uses these via Firebase SDK)
// ────────────────────────────────────────────────────────────

export async function saveSeoEntry(
  pageId: string,
  entry: SeoEntry | SeoDefaults,
  uid: string,
) {
  await setDoc(
    doc(db, 'site_seo', pageId),
    { ...entry, updatedAt: serverTimestamp(), updatedBy: uid },
    { merge: true },
  );
}

export async function getAllSeoEntries(): Promise<Record<string, SeoEntry & { id: string }>> {
  const snap = await getDocs(collection(db, 'site_seo'));
  const out: Record<string, SeoEntry & { id: string }> = {};
  for (const d of snap.docs) {
    out[d.id] = { id: d.id, ...d.data() } as SeoEntry & { id: string };
  }
  return out;
}

export async function getSeoEntryClient(pageId: string): Promise<SeoEntry | null> {
  const snap = await getDoc(doc(db, 'site_seo', pageId));
  if (!snap.exists()) return null;
  return snap.data() as SeoEntry;
}

// ────────────────────────────────────────────────────────────
// Page registry — single source of truth for which pages exist
// ────────────────────────────────────────────────────────────

export interface SeoPageDef {
  id: string;
  path: string; // path without locale prefix
  label: { zh: string; en: string };
  defaultTitle?: { zh: string; en: string };
  defaultDescription?: { zh: string; en: string };
}

export const SEO_PAGES: SeoPageDef[] = [
  {
    id: 'home',
    path: '/',
    label: { zh: '首頁', en: 'Home' },
    defaultTitle: {
      zh: 'SPACO — 賦予專屬空間無限可能',
      en: 'SPACO — Multifunctional Space',
    },
    defaultDescription: {
      zh: '香港高級全自助多功能活動空間，設有 BBQ、Shisha、桌球、打邊爐等設施。銅鑼灣、灣仔、上環、尖沙咀四間分店。',
      en: 'Hong Kong premium self-service multifunctional event space — BBQ, Shisha, pool, hotpot. Four branches: Causeway Bay, Wan Chai, Sheung Wan, TST.',
    },
  },
  {
    id: 'corporate',
    path: '/corporate',
    label: { zh: '商務活動', en: 'Corporate' },
    defaultTitle: { zh: '商務活動 — SPACO', en: 'Corporate Events — SPACO' },
  },
  {
    id: 'corporate-package',
    path: '/corporate-package',
    label: { zh: '企業包場', en: 'Corporate Package' },
    defaultTitle: {
      zh: '企業包場 · 尖沙咀 — SPACO',
      en: 'Corporate Package · TST — SPACO',
    },
    defaultDescription: {
      zh: 'SPACO 尖沙咀企業包場，平日 9am–5pm 5 小時 HK$4,800 包場價，含飲品任飲，可加 BBQ。九龍核心，HR 一鍵搞掂。',
      en: 'SPACO TST corporate package — weekday 9am–5pm 5-hour exclusive at HK$4,800, drinks included, optional BBQ. Kowloon core, HR-friendly.',
    },
  },
  {
    id: 'family',
    path: '/family',
    label: { zh: '親子派對', en: 'Family Parties' },
    defaultTitle: { zh: '親子派對 — SPACO', en: 'Family Parties — SPACO' },
  },
  {
    id: 'guidelines',
    path: '/guidelines',
    label: { zh: '預訂須知', en: 'Booking Guidelines' },
    defaultTitle: { zh: '預訂須知 — SPACO', en: 'Booking Guidelines — SPACO' },
  },
  {
    id: 'faq',
    path: '/faq',
    label: { zh: '常見問題', en: 'FAQ' },
    defaultTitle: { zh: '常見問題 — SPACO', en: 'FAQ — SPACO' },
  },
  {
    id: 'branch-cwb',
    path: '/branches/causeway-bay',
    label: { zh: '銅鑼灣分店', en: 'Causeway Bay Branch' },
    defaultTitle: { zh: '銅鑼灣旗艦店 — SPACO', en: 'Causeway Bay — SPACO' },
  },
  {
    id: 'branch-wc',
    path: '/branches/wan-chai',
    label: { zh: '灣仔分店', en: 'Wan Chai Branch' },
    defaultTitle: { zh: '灣仔商務空間 — SPACO', en: 'Wan Chai — SPACO' },
  },
  {
    id: 'branch-sw',
    path: '/branches/sheung-wan',
    label: { zh: '上環分店', en: 'Sheung Wan Branch' },
    defaultTitle: { zh: '上環海景旗艦店 — SPACO', en: 'Sheung Wan — SPACO' },
  },
  {
    id: 'branch-tst',
    path: '/branches/tsim-sha-tsui',
    label: { zh: '尖沙咀分店', en: 'TST Branch' },
    defaultTitle: { zh: '尖沙咀店 — SPACO', en: 'TST — SPACO' },
  },
];

export function pageDefById(id: string): SeoPageDef | undefined {
  return SEO_PAGES.find((p) => p.id === id);
}

/** Map a branch slug to the SEO page id used in Firestore. */
export function branchSeoIdFromSlug(slug: string): string {
  if (slug.startsWith('sheung-wan')) return 'branch-sw';
  if (slug === 'causeway-bay') return 'branch-cwb';
  if (slug === 'wan-chai') return 'branch-wc';
  if (slug === 'tsim-sha-tsui') return 'branch-tst';
  return `branch-${slug}`;
}
