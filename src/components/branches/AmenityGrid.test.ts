import { describe, expect, it } from 'vitest';
import { resolveAmenity } from './AmenityGrid';

// Heidi 2026-10-25: 火鍋／街機／波波池／彈跳床／兒童玩具 showed the generic
// people icon on the HART page.
describe('amenity icon matching', () => {
  it.each([
    ['火鍋', '火鍋'], ['hotpot', '火鍋'], ['打邊爐', '火鍋'],
    ['街機', '街機'], ['Arcade', '街機'],
    ['波波池', '波波池'], ['ball pit', '波波池'],
    ['彈跳床', '彈跳床'], ['大跳床', '彈跳床'], ['trampoline', '彈跳床'],
    ['兒童玩具', '兒童玩具'], ['Kids toys', '兒童玩具'],
    ['燒烤', '戶外 BBQ'], ['bbq', '戶外 BBQ'],
    ['桌球', '桌球'], ['麻將', '麻將'],
  ])('%s → %s card', (raw, zh) => {
    const e = resolveAmenity(raw);
    expect(e.label.zh).toBe(zh);
    expect(e.icon.displayName ?? e.icon.name ?? '').not.toBe('Users');
  });
  it('unknown text keeps the raw label with the generic icon', () => {
    expect(resolveAmenity('神秘設施').label.zh).toBe('神秘設施');
  });
});
