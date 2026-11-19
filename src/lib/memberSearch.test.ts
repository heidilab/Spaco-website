import { describe, expect, it } from 'vitest';
import { matchMembers } from './memberSearch';

const members = [
  { uid: 'a', displayName: 'Chan Tai Man', email: 'tai@example.com', phone: '+852 9267 6171' },
  { uid: 'b', displayName: 'Wong Siu Ming', email: 'siu@example.com', whatsappPhone: '852-6123-4567' },
  { uid: 'c', displayName: '', email: 'nobody@example.com' },
];

describe('matchMembers (連結會員帳號 search)', () => {
  it('returns nothing for an empty search — never the whole roster', () => {
    expect(matchMembers(members, '')).toEqual([]);
    expect(matchMembers(members, '   ')).toEqual([]);
  });

  it('matches by name and email, case-insensitively', () => {
    expect(matchMembers(members, 'tai man').map((m) => m.uid)).toEqual(['a']);
    expect(matchMembers(members, 'SIU@').map((m) => m.uid)).toEqual(['b']);
  });

  it('matches phones by consecutive digits regardless of stored formatting', () => {
    // WhatsApp-stored "+852 9267 6171" — admin types the middle digits only.
    expect(matchMembers(members, '2676').map((m) => m.uid)).toEqual(['a']);
    // Pasted with the country code and dashes.
    expect(matchMembers(members, '+852-6123').map((m) => m.uid)).toEqual(['b']);
    // Matches whatsappPhone as well as phone.
    expect(matchMembers(members, '4567').map((m) => m.uid)).toEqual(['b']);
  });

  it('ignores short digit fragments that would match everyone', () => {
    expect(matchMembers(members, '85')).toEqual([]);
  });

  it('caps the result list', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ uid: String(i), displayName: `Guest ${i}` }));
    expect(matchMembers(many, 'guest', 8)).toHaveLength(8);
  });
});
