import type { AddOnOptions } from '@/types';

/** The Shisha sub-options an admin editor holds while a booking is open. */
export interface ShishaEditorState {
  pipes: number;
  /** One entry per head; '' = flavour not picked yet. */
  flavors: string[];
  staffSetup: boolean;
  /** HH:mm the customer wants staff to set the shisha up. */
  staffSetupTime?: string;
}

/**
 * The `options` stored on a booking's shisha add-on, built from the
 * editor state. ONE builder for every place an admin page rebuilds the
 * add-on list: the save path used to hand-build this without
 * `staffSetupTime`, so saving any add-on change on a booking with staff
 * setup wiped the customer's setup time (the supplier email then read
 * "setup time not provided").
 */
export function shishaAddOnOptions(state: ShishaEditorState): AddOnOptions {
  return {
    pipes: state.pipes,
    flavors: (state.flavors || []).filter((f) => !!f),
    staffSetup: state.staffSetup,
    // The time only means something while staff setup is on.
    ...(state.staffSetup && state.staffSetupTime ? { staffSetupTime: state.staffSetupTime } : {}),
  };
}

/** Setup time that actually applies ('' when staff setup is off). */
function effectiveSetupTime(o: { staffSetup?: boolean; staffSetupTime?: string } | undefined): string {
  return o?.staffSetup ? (o.staffSetupTime || '') : '';
}

/**
 * Has the admin changed anything about the shisha (pipes, a flavour,
 * staff setup, or the setup TIME) compared with what the booking stores?
 * The quantity (heads) is diffed separately by the caller.
 */
export function shishaOptionsChanged(stored: AddOnOptions | undefined, state: ShishaEditorState): boolean {
  const line = (arr: string[] | undefined) => (arr || []).map((f) => f || '').join(',');
  return (stored?.pipes ?? 1) !== state.pipes
    || !!stored?.staffSetup !== state.staffSetup
    || line(stored?.flavors) !== line(state.flavors)
    || effectiveSetupTime(stored) !== effectiveSetupTime(state);
}
