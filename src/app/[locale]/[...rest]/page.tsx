import { notFound } from 'next/navigation';

// Any path under a locale that no page claims → the locale's not-found
// page (with header / footer), instead of a blank screen.
export default function CatchAll() {
  notFound();
}
