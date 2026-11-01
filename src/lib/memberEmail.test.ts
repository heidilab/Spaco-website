import { describe, it, expect } from 'vitest';
import { normalizeMemberEmail } from './memberEmail';

describe('normalizeMemberEmail', () => {
  it('trims and lower-cases a valid address', () => {
    expect(normalizeMemberEmail('  Almenng@Yahoo.com.hk ')).toBe('almenng@yahoo.com.hk');
  });

  it('accepts multi-label country domains', () => {
    expect(normalizeMemberEmail('a.b@mail.example.co.uk')).toBe('a.b@mail.example.co.uk');
  });

  it('rejects malformed input', () => {
    expect(normalizeMemberEmail('')).toBeNull();
    expect(normalizeMemberEmail('   ')).toBeNull();
    expect(normalizeMemberEmail('no-at-sign')).toBeNull();
    expect(normalizeMemberEmail('@yahoo.com.hk')).toBeNull();
    expect(normalizeMemberEmail('a@@b.com')).toBeNull();
    expect(normalizeMemberEmail('a@localhost')).toBeNull();
    expect(normalizeMemberEmail('a@yahoo.com.h1')).toBeNull();
    expect(normalizeMemberEmail('a b@yahoo.com.hk')).toBeNull();
    expect(normalizeMemberEmail('a@-bad.com')).toBeNull();
    expect(normalizeMemberEmail(42)).toBeNull();
    expect(normalizeMemberEmail(null)).toBeNull();
  });
});
