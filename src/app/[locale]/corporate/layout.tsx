import type { Metadata } from 'next';
import { buildMetadata, pageDefById } from '@/lib/seo';

export async function generateMetadata({ params }: { params: { locale: string } }): Promise<Metadata> {
  const def = pageDefById('corporate')!;
  return buildMetadata({
    pageId: 'corporate',
    locale: params.locale as 'zh' | 'en',
    path: '/corporate',
    fallback: { title: def.defaultTitle },
  });
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
