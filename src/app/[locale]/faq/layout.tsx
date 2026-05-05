import type { Metadata } from 'next';
import { buildMetadata, pageDefById } from '@/lib/seo';
import { DEFAULT_FAQ, FaqContent, FaqEntry } from '@/lib/faqDefaults';
import { buildFaqPageLd } from '@/lib/jsonLd';
import JsonLd from '@/components/seo/JsonLd';

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'spaco-website';

export async function generateMetadata({ params }: { params: { locale: string } }): Promise<Metadata> {
  const def = pageDefById('faq')!;
  return buildMetadata({
    pageId: 'faq',
    locale: params.locale as 'zh' | 'en',
    path: '/faq',
    fallback: { title: def.defaultTitle },
  });
}

// Server-side fetch of FAQ content from Firestore (public read, no auth needed).
// Falls back to DEFAULT_FAQ shipped in code.
async function loadFaqServer(): Promise<FaqContent> {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/site_content/faq`;
    const res = await fetch(url, { next: { revalidate: 60 } });
    if (!res.ok) return DEFAULT_FAQ;
    const data = await res.json();
    const sections = data?.fields?.sections?.mapValue?.fields;
    if (!sections) return DEFAULT_FAQ;
    // The faq doc may store guestRules / faqItems as arrays of map values.
    // Translate Firestore "values" wire format into plain JS shape used by FaqEntry.
    const decode = (key: string): FaqEntry[] => {
      const arr = sections?.[key]?.arrayValue?.values;
      if (!Array.isArray(arr)) return [];
      return arr.map((v: { mapValue?: { fields?: Record<string, unknown> } }) => {
        const f = v.mapValue?.fields || {};
        const get = (k: string) => (f as Record<string, { stringValue?: string }>)[k]?.stringValue || '';
        const getMap = (k: string) => {
          const m = (f as Record<string, { mapValue?: { fields?: Record<string, { stringValue?: string }> } }>)[k]
            ?.mapValue?.fields || {};
          return { q: m.q?.stringValue || '', a: m.a?.stringValue || '' };
        };
        return {
          id: get('id'),
          zh: getMap('zh'),
          en: getMap('en'),
        } as FaqEntry;
      });
    };
    return {
      guestRules: decode('guestRules').length ? decode('guestRules') : DEFAULT_FAQ.guestRules,
      faqItems:   decode('faqItems').length   ? decode('faqItems')   : DEFAULT_FAQ.faqItems,
    };
  } catch {
    return DEFAULT_FAQ;
  }
}

export default async function Layout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  const locale = params.locale as 'zh' | 'en';
  const content = await loadFaqServer();
  const allEntries = [...content.guestRules, ...content.faqItems];
  const ld = buildFaqPageLd(allEntries, locale);
  return (
    <>
      <JsonLd data={ld} />
      {children}
    </>
  );
}
