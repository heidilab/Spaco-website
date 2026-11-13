'use client';

import { useEffect } from 'react';

// Browser-tab title for the not-found pages. The `metadata` a not-found
// file exports only reaches the server HTML; in the browser Next keeps the
// title of the route that was being rendered (e.g. the home title), and a
// client-side notFound() never changes the title at all.
export default function NotFoundTitle({ title }: { title: string }) {
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => {
      // Leaving for a page whose title Next considers unchanged: put it
      // back. If Next already wrote the next page's title, leave it.
      if (document.title === title) document.title = previous;
    };
  }, [title]);
  return null;
}
