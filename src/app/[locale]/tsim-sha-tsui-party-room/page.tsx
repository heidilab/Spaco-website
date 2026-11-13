// 尖沙咀 landing page for Google Ads (Heidi 2026-11-13).
//
// A stand-alone page — deliberately NOT in the site menu — that an ad on a
// 尖沙咀 keyword points to: the 尖沙咀 branches, each with its main photo,
// name, size, capacity and a short intro, linking to the branch's own page.
// Address: /zh/tsim-sha-tsui-party-room (and /en/…).
//
// Content comes from 分店管理 (lib/districtLanding), so a photo, size or
// 簡介 changed there shows here; title / description are editable in
// SEO 管理 under 「尖沙咀廣告頁」.

import type { Metadata } from 'next';
import { buildMetadata, pageDefById } from '@/lib/seo';
import { buildBreadcrumbLd } from '@/lib/jsonLd';
import JsonLd from '@/components/seo/JsonLd';
import DistrictLanding from '@/components/branch/DistrictLanding';
import { districtBranchCards, DISTRICTS, type DistrictBranchCard } from '@/lib/districtLanding';
import { venues as staticVenues } from '@/lib/venues';

// Read the registry per request (it caches for a minute) — never freeze a
// build-time copy of the branch list into the page.
export const dynamic = 'force-dynamic';

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://spacohk.com';
const DISTRICT = DISTRICTS.tst;
const PATH = `/${DISTRICT.path}`;

export async function generateMetadata({ params }: { params: { locale: string } }): Promise<Metadata> {
  const def = pageDefById(DISTRICT.seoId);
  return buildMetadata({
    pageId: DISTRICT.seoId,
    locale: params.locale as 'zh' | 'en',
    path: PATH,
    fallback: { title: def?.defaultTitle, description: def?.defaultDescription },
  });
}

async function loadCards(): Promise<DistrictBranchCard[]> {
  try {
    const { loadActiveVenuesServer } = await import('@/lib/venueRegistryServer');
    return districtBranchCards(await loadActiveVenuesServer(), DISTRICT);
  } catch {
    // Registry unreachable — the built-in venue list; the browser retries.
    return districtBranchCards(staticVenues.map((v) => ({ ...v, active: true })), DISTRICT);
  }
}

export default async function Page({ params }: { params: { locale: string } }) {
  const locale = (params.locale === 'en' ? 'en' : 'zh') as 'zh' | 'en';
  const cards = await loadCards();
  const url = `${SITE_URL}/${locale}${PATH}`;
  const ld = [
    buildBreadcrumbLd([
      { name: locale === 'zh' ? '首頁' : 'Home', url: `${SITE_URL}/${locale}` },
      { name: `${DISTRICT.name[locale]} Party Room`, url },
    ]),
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: `${DISTRICT.name[locale]} Party Room`,
      itemListElement: cards.map((c, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: c.name[locale] || c.name.zh,
        url: `${SITE_URL}/${locale}/branches/${c.slug}`,
      })),
    },
  ];
  return (
    <>
      <JsonLd data={ld} />
      <DistrictLanding district="tst" initial={cards} locale={locale} />
    </>
  );
}
