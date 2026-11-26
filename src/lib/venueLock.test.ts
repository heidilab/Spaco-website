import { describe, expect, it } from 'vitest';
import { venueHasNoElectronicLock } from './venueLock';

describe('venueHasNoElectronicLock', () => {
  it('is true only when 分店管理 ticked 不使用電子門鎖', () => {
    expect(venueHasNoElectronicLock({ noElectronicLock: true })).toBe(true);
    expect(venueHasNoElectronicLock({ noElectronicLock: false })).toBe(false);
    expect(venueHasNoElectronicLock({})).toBe(false);
    expect(venueHasNoElectronicLock(undefined)).toBe(false);
    expect(venueHasNoElectronicLock(null)).toBe(false);
  });
});
