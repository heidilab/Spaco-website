export const metadata = {
  title: 'KPay UAT 測試工具',
  robots: { index: false, follow: false },
};

// /kpay-uat lives outside the [locale] segment, so it must supply its
// own <html>/<body> (the root layout just forwards children).
export default function KpayUatLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-HK">
      <body>{children}</body>
    </html>
  );
}
