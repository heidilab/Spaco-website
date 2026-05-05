// Decoration style options for the birthday package.
// Single source of truth — admin upload, family page, booking picker,
// and booking record all reference this list.

export type DecorationId = 'blue' | 'pink' | 'khaki';

export interface DecorationStyle {
  id: DecorationId;
  /** Site image key (matches admin upload slot in `/admin/content`). */
  imageKey: string;
  label: { zh: string; en: string };
  description: { zh: string; en: string };
  /** Tailwind gradient class for the fallback visual when no image uploaded. */
  fallbackGradient: string;
}

export const DECORATION_STYLES: DecorationStyle[] = [
  {
    id: 'blue',
    imageKey: 'decor-blue',
    label: { zh: '藍色', en: 'Blue' },
    description: {
      zh: '清新海洋系，男孩生日 / 中性主題首選',
      en: 'Fresh ocean palette — popular for boys & gender-neutral themes',
    },
    fallbackGradient: 'bg-gradient-cool',
  },
  {
    id: 'pink',
    imageKey: 'decor-pink',
    label: { zh: '粉紅色', en: 'Pink' },
    description: {
      zh: '浪漫粉嫩，女孩生日 / 公主主題',
      en: 'Romantic pastel — perfect for girls & princess themes',
    },
    fallbackGradient: 'bg-gradient-pink',
  },
  {
    id: 'khaki',
    imageKey: 'decor-khaki',
    label: { zh: '卡其色', en: 'Khaki' },
    description: {
      zh: '質感簡約，適合大人款生日 / 簡約風',
      en: 'Sophisticated neutral — ideal for adult & minimalist styling',
    },
    fallbackGradient: 'bg-gradient-warm',
  },
];

export function getDecorationById(id: string): DecorationStyle | undefined {
  return DECORATION_STYLES.find((d) => d.id === id);
}
