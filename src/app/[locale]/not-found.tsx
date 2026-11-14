import { Link } from '@/i18n/routing';

// Shown for a path under /zh or /en that does not exist (and by
// notFound() calls). Before this a wrong address rendered a blank page.
export default function NotFound() {
  return (
    <div className="pt-32 pb-24 px-6 text-center">
      <p className="text-6xl font-display font-bold text-pink mb-4">404</p>
      <h1 className="text-2xl font-bold mb-3">搵唔到呢一頁 · Page not found</h1>
      <p className="text-ink-soft mb-8">呢個網址唔存在，或者已經搬走。<br />This address does not exist or has moved.</p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/" className="btn-primary">返回首頁 · Home</Link>
        <Link href="/branches" className="px-5 py-2.5 rounded-xl border border-charcoal/15 bg-white text-sm font-medium hover:bg-cream">所有分店 · Branches</Link>
      </div>
    </div>
  );
}
