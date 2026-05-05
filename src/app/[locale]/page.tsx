import HeroSection from '@/components/home/HeroSection';
import Marquee from '@/components/layout/Marquee';
import PromoSection from '@/components/home/PromoSection';
import CollectionSection from '@/components/home/CollectionSection';
import AmenitiesSection from '@/components/home/AmenitiesSection';
import BranchGrid from '@/components/home/BranchGrid';
import JsonLd from '@/components/seo/JsonLd';
import { buildMetadata, pageDefById } from '@/lib/seo';
import { buildOrganizationLd } from '@/lib/jsonLd';
import type { Metadata } from 'next';

export async function generateMetadata({ params }: { params: { locale: string } }): Promise<Metadata> {
  const def = pageDefById('home')!;
  return buildMetadata({
    pageId: 'home',
    locale: params.locale as 'zh' | 'en',
    path: '/',
    fallback: {
      title: def.defaultTitle,
      description: def.defaultDescription,
    },
  });
}

export default function HomePage({ params }: { params: { locale: string } }) {
  const locale = params.locale as 'zh' | 'en';
  return (
    <>
      <JsonLd data={buildOrganizationLd(locale)} />
      <HeroSection />
      <Marquee />
      <PromoSection />
      <CollectionSection />
      <AmenitiesSection />
      <BranchGrid />
    </>
  );
}
