import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

// next-intl 3.22+: use awaited requestLocale, return locale + messages
export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;
  if (!locale || !(routing.locales as readonly string[]).includes(locale)) {
    locale = routing.defaultLocale;
  }
  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
  };
});
