import { describe, expect, it } from 'vitest';
import { shishaAddOnOptions, shishaOptionsChanged } from './shishaOptions';

// Admin booking detail: saving any add-on change rebuilt the shisha entry
// without `staffSetupTime`, wiping the time the customer asked for; and a
// change to the time alone was not seen as a change, so it could not be saved.
describe('shisha options kept through an admin edit', () => {
  const stored = { pipes: 2, flavors: ['A', 'D'], staffSetup: true, staffSetupTime: '16:00' };
  const editor = { pipes: 2, flavors: ['A', 'D'], staffSetup: true, staffSetupTime: '16:00' };

  it('keeps the customer setup time when the add-on list is rebuilt', () => {
    expect(shishaAddOnOptions(editor)).toEqual(stored);
  });

  it('drops the time once staff setup is switched off, and blank flavour slots', () => {
    expect(shishaAddOnOptions({ ...editor, staffSetup: false })).toEqual({ pipes: 2, flavors: ['A', 'D'], staffSetup: false });
    expect(shishaAddOnOptions({ pipes: 1, flavors: ['', 'B'], staffSetup: false }).flavors).toEqual(['B']);
  });

  it('sees no change when the editor matches the booking', () => {
    expect(shishaOptionsChanged(stored, editor)).toBe(false);
    // Legacy entry without options: defaults to 1 pipe, no setup.
    expect(shishaOptionsChanged(undefined, { pipes: 1, flavors: [], staffSetup: false })).toBe(false);
    // A stale time left on a booking whose staff setup is off is not a change.
    expect(shishaOptionsChanged({ pipes: 1, flavors: ['A'], staffSetup: false, staffSetupTime: '16:00' }, { pipes: 1, flavors: ['A'], staffSetup: false })).toBe(false);
  });

  it('sees a change to the setup time alone', () => {
    expect(shishaOptionsChanged(stored, { ...editor, staffSetupTime: '17:30' })).toBe(true);
    expect(shishaOptionsChanged({ ...stored, staffSetupTime: undefined }, editor)).toBe(true);
  });

  it('still sees pipes, flavour and staff-setup changes', () => {
    expect(shishaOptionsChanged(stored, { ...editor, pipes: 1 })).toBe(true);
    expect(shishaOptionsChanged(stored, { ...editor, flavors: ['A', 'E'] })).toBe(true);
    expect(shishaOptionsChanged(stored, { ...editor, staffSetup: false })).toBe(true);
  });
});
