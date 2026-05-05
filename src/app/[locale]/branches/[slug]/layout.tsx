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
  return buildMetadata({
    pageId: seoId,
    locale: params.locale as 'zh' | 'en',
    path: `/branches/${params.slug}`,
    fallback: { title: def?.defaultTitle },
  });
}

export default function Layout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { locale: string; slug: string };
}) {
  const locale = params.locale as 'zh' | 'en';
  const branch = branchInfoBySlug(params.slug);
  const venuesInBranch = venuesForBranch(params.slug);
  const url = `${SITE_URL}/${locale}/branches/${params.slug}`;

  const ld: Record<string, unknown>[] = [];
  if (branch && venuesInBranch.length > 0) {
    ld.push(buildLocalBusinessLd({ branch, venuesInBranch, locale, url }));
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
