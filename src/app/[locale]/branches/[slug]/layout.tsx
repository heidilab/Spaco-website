import type { Metadata } from 'next';
import { buildMetadata, pageDefById, branchSeoIdFromSlug } from '@/lib/seo';
import { branchInfoBySlug } from '@/lib/branchInfo';
import { buildLocalBusinessLd, buildBreadcrumbLd, venuesForBranch } from '@/lib/jsonLd';
import JsonLd from '@/components/seo/JsonLd';

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://spacohk.com';

export async function generateMetadata({
  params,
}: { params: { locale: string; slug: string } }): Promise<Metadata> {
  const seoId = branchSeoIdFromSlug(params.slug);
  const def = pageDefById(seoId);
  let fallbackTitle = def?.defaultTitle;
  if (!fallbackTitle) {
    // Dynamic venue / branch (分店管理) — derive the title from the
    // registry so new branches get real metadata without a code change.
    try {
      const { loadAllVenuesServer } = await import('@/lib/venueRegistryServer');
      const all = await loadAllVenuesServer();
      const hit = all.find((v) => v.slug === params.slug)
        || all.find((v) => v.branchKey === params.slug);
      if (hit) {
        const nmZh = hit.branchKey === params.slug
          ? (hit.branchName?.zh || hit.name.zh) : hit.name.zh;
        const nmEn = hit.branchKey === params.slug
          ? (hit.branchName?.en || hit.name.en) : hit.name.en;
        fallbackTitle = {
          zh: `${nmZh} Party Room | SPACO`,
          en: `${nmEn || nmZh} Party Room | SPACO`,
        };
      }
    } catch { /* registry unreachable */ }
  }
  return buildMetadata({
    pageId: seoId,
    locale: params.locale as 'zh' | 'en',
    path: `/branches/${params.slug}`,
    fallback: { title: fallbackTitle },
  });
}

export default async function Layout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { locale: string; slug: string };
}) {
  const locale = params.locale as 'zh' | 'en';
  const branch = branchInfoBySlug(params.slug);
  let venuesInBranch = venuesForBranch(params.slug);
  const url = `${SITE_URL}/${locale}/branches/${params.slug}`;

  const ld: Record<string, unknown>[] = [];
  if (branch && venuesInBranch.length > 0) {
    ld.push(buildLocalBusinessLd({ branch, venuesInBranch, locale, url }));
  } else {
    // Dynamic branch (分店管理) — build LocalBusiness LD from venue docs.
    try {
      const { loadAllVenuesServer } = await import('@/lib/venueRegistryServer');
      const all = await loadAllVenuesServer();
      const rooms = all.filter((v) =>
        (v.slug === params.slug || v.branchKey === params.slug) && v.active !== false);
      if (rooms.length > 0) {
        venuesInBranch = rooms;
        const first = rooms[0];
        ld.push(buildLocalBusinessLd({
          branch: {
            id: first.branchKey || first.id,
            slug: params.slug,
            seoId: `branch-${first.branchKey || first.id}`,
            name: first.branchName || first.name,
            streetAddress: first.address,
            district: { zh: '', en: '' },
            openingHours: [{
              dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
              opens: '08:00', closes: '23:59',
            }],
          },
          venuesInBranch: rooms,
          locale,
          url,
        }));
      }
    } catch { /* registry unreachable — Organization LD still present */ }
  }
  ld.push(
    buildBreadcrumbLd([
      { name: locale === 'zh' ? '首頁' : 'Home', url: `${SITE_URL}/${locale}` },
      { name: locale === 'zh' ? '派對空間' : 'Spaces', url: `${SITE_URL}/${locale}/#collection` },
      { name: branch?.name[locale] || params.slug, url },
    ]),
  );

  return (
    <>
      <JsonLd data={ld} />
      {children}
    </>
  );
}
