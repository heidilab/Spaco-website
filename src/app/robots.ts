import type { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://spacohk.com';

// Major AI crawlers — explicit Allow signals discoverability.
// Each gets the same disallow list (admin / api) as anonymous traffic.
const AI_BOTS = [
  'GPTBot',          // OpenAI
  'ChatGPT-User',    // ChatGPT browse-with-bing / OAI Search
  'OAI-SearchBot',   // OpenAI search
  'ClaudeBot',       // Anthropic crawler
  'Claude-Web',      // Anthropic browse
  'anthropic-ai',    // Anthropic legacy UA
  'PerplexityBot',   // Perplexity
  'Perplexity-User', // Perplexity browse
  'Google-Extended', // Google Bard / Gemini training opt-in
  'Applebot-Extended', // Apple AI
  'CCBot',           // Common Crawl (training data for many LLMs)
  'cohere-ai',       // Cohere
  'Bytespider',      // ByteDance / Doubao
  'Diffbot',         // Diffbot
  'FacebookBot',     // Meta AI
  'Meta-ExternalAgent',
];

const DISALLOWED_PATHS = ['/zh/admin', '/en/admin', '/api'];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // Default — applies to all crawlers (Googlebot, Bingbot, etc.)
      {
        userAgent: '*',
        allow: '/',
        disallow: DISALLOWED_PATHS,
      },
      // Explicit allow per AI bot — same rules but acts as a positive signal.
      ...AI_BOTS.map((userAgent) => ({
        userAgent,
        allow: '/',
        disallow: DISALLOWED_PATHS,
      })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
