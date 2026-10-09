import { describe, it, expect } from 'vitest';
import { conflictIdsFor } from './venueConflicts';
import { Venue } from '@/types';
const venue = (id: string, conflictsWith?: string[]) => ({ id, spaceGroup: 'floor', conflictsWith }) as Venue;
describe('independent room blocking', () => {
  it('keeps rooms A and B independent while each blocks the full floor', () => {
    const all = [venue('a', ['full']), venue('b', ['full']), venue('full', ['a', 'b'])];
    expect(conflictIdsFor('a', all).sort()).toEqual(['a', 'full']);
    expect(conflictIdsFor('b', all).sort()).toEqual(['b', 'full']);
    expect(conflictIdsFor('full', all).sort()).toEqual(['a', 'b', 'full']);
  });
  it('respects explicitly clearing every selection', () => {
    expect(conflictIdsFor('a', [venue('a', []), venue('b', [])])).toEqual(['a']);
  });
  it('preserves legacy group blocking for unconfigured rooms', () => {
    expect(conflictIdsFor('a', [venue('a'), venue('b')])).toEqual(['a', 'b']);
  });
  it('honours reverse blocking', () => {
    expect(conflictIdsFor('a', [venue('a', []), venue('full', ['a'])])).toEqual(['a', 'full']);
  });
});
