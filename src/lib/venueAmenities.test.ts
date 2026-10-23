import { describe, expect, it } from 'vitest';
import { venueAmenityItems } from './venueAmenities';

describe('venueAmenityItems — ticked boxes + free text both show (Heidi 2026-10-24)', () => {
  it('keeps ticked default amenities when the free-text list is filled', () => {
    const items = venueAmenityItems(
      { amenities: ['mahjong', 'hotpot'], amenitiesText: { zh: 'Poker\n音響設備連2枝無線咪\n' } },
      'zh',
    );
    expect(items).toEqual(['麻將', '火鍋', 'Poker', '音響設備連2枝無線咪']);
  });
  it('falls back to the checkbox list alone when no text was typed', () => {
    expect(venueAmenityItems({ amenities: ['bbq'] }, 'en')).toEqual(['Outdoor BBQ']);
  });
  it('removes duplicates (case-insensitive) and splits on 、 , ，', () => {
    expect(venueAmenityItems({ amenities: ['mahjong'], amenitiesText: { zh: '麻將、火鍋,poker，Poker' } }, 'zh'))
      .toEqual(['麻將', '火鍋', 'poker']);
  });
  it('uses the zh text on the en page when only zh was filled', () => {
    expect(venueAmenityItems({ amenities: [], amenitiesText: { zh: '街機' } }, 'en')).toEqual(['街機']);
  });
});
