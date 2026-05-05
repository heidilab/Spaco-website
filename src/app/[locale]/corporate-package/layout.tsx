import type { Metadata } from 'next';
import { buildMetadata, pageDefById } from '@/lib/seo';

export async function generateMetadata({ params }: { params: { locale: string } }): Promise<Metadata> {
  const def = pageDefById('corporate-package')!;
  return buildMetadata({
    pageId: 'corporate-package',
    locale: params.locale as 'zh' | 'en',
    path: '/corporate-package',
    fallback: {
      title: def.defaultTitle,
      description: def.defaultDescription,
    },
  });
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
