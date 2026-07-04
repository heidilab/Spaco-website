'use client';
// Thin redirect — admin/articles/[id] handles both create (id='new') and edit.
import { useEffect } from 'react';
import { useRouter } from '@/i18n/routing';

export default function NewArticleRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/admin/articles/_new'); }, [router]);
  return null;
}
