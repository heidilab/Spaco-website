import type { Metadata } from 'next';
import { buildMetadata, pageDefById } from '@/lib/seo';
import { branchInfoBySlug } from '@/lib/branchInfo';
import { buildLocalBusinessLd, buildBreadcrumbLd, venuesForBranch } from '@/lib/jsonLd';
import JsonLd from '@/components/seo/JsonLd';

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://spacohk.com';

export async function generateMetadata({ params }: { params: { locale: string } }): Promise<Metadata> {
  const def = pageDefById('branch-sw')!;
  return buildMetadata({
    pageId: 'branch-sw',
    locale: params.locale as 'zh' | 'en',
    path: '/branches/sheung-wan',
    fallback: { title: def.defaultTitle },
  });
}

export default function Layout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  const locale = params.locale as 'zh' | 'en';
  const branch = branchInfoBySlug('sheung-wan')!;
  const venuesInBranch = venuesForBranch('sheung-wan');
  const url = `${SITE_URL}/${locale}/branches/sheung-wan`;

  const ld: Record<string, unknown>[] = [
    buildLocalBusinessLd({ branch, venuesInBranch, locale, url }),
    buildBreadcrumbLd([
      { name: locale === 'zh' ? '首頁' : 'Home', url: `${SITE_URL}/${locale}` },
      { name: locale === 'zh' ? '派對空間' : 'Spaces', url: `${SITE_URL}/${locale}/#collection` },
      { name: branch.name[locale], url },
    ]),
  ];

  return (
    <>
      <JsonLd data={ld} />
      {children}
    </>
  );
}
