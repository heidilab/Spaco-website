// JSON-LD for the booking pages — the highest-traffic customer pages
// previously had zero schema (flagged by the AI-friendliness audit).
// Emits the same LocalBusiness + Breadcrumb nodes as the branch intro
// pages so search/AI engines understand these URLs too.

import { branchInfoBySlug } from '@/lib/branchInfo';
import { buildLocalBusinessLd, buildBreadcrumbLd, venuesForBranch } from '@/lib/jsonLd';
import JsonLd from '@/components/seo/JsonLd';

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://spacohk.com';

export default async function Layout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string; branchSlug: string }>;
}) {
  const { locale: rawLocale, branchSlug } = await params;
  const locale = rawLocale as 'zh' | 'en';
  const branch = branchInfoBySlug(branchSlug);
  const venuesInBranch = venuesForBranch(branchSlug);
  const url = `${SITE_URL}/${locale}/book/${branchSlug}`;

  const ld: Record<string, unknown>[] = [];
  if (branch && venuesInBranch.length > 0) {
    ld.push(buildLocalBusinessLd({ branch, venuesInBranch, locale, url }));
    ld.push(
      buildBreadcrumbLd([
        { name: locale === 'zh' ? '首頁' : 'Home', url: `${SITE_URL}/${locale}` },
        { name: branch.name[locale], url },
      ]),
    );
  }

  return (
    <>
      {ld.length > 0 && <JsonLd data={ld} />}
      {children}
    </>
  );
}
