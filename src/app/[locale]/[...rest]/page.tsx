import { notFound } from 'next/navigation';

// Catch-all for every address under /zh or /en that matches no other
// route. Without it, unknown paths fell through to Next's built-in
// not-found rendered inside the root layout — which has no <html>/<body>
// (they live in [locale]/layout.tsx) — so production served an empty
// 404 body. Calling notFound() here renders [locale]/not-found.tsx
// inside the locale layout instead (Header / Footer / translations).
export default function CatchAllPage() {
  notFound();
}
