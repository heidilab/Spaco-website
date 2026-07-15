import { redirect } from 'next/navigation';

// The UAT harness lives at /kpay-uat (outside the [locale] segment).
// Catch /zh/kpay-uat + /en/kpay-uat typos and forward.
export default function KpayUatLocaleRedirect() {
  redirect('/kpay-uat');
}
