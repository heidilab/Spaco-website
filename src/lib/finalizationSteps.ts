// The steps of the payment follow-up job and its retry bookkeeping — PURE
// (site review 2026-11-13, #8). lib/finalizeBooking runs the steps;
// lib/paymentFinalization runs the job.

export const FINALIZE_STEPS = ['slots', 'email', 'lock', 'staff', 'gcal'] as const;
export type FinalizeStep = (typeof FINALIZE_STEPS)[number];

/** After this many attempts the job stops and staff are told. */
export const MAX_FINALIZATION_ATTEMPTS = 6;

/** Which steps a job still has to do, given the ones recorded as done. */
export function remainingSteps(done: Partial<Record<FinalizeStep, boolean>> | undefined): FinalizeStep[] {
  return FINALIZE_STEPS.filter((s) => !done?.[s]);
}

/** The job's next state after an attempt. */
export function nextJobState(attempts: number, failed: FinalizeStep[]): 'done' | 'pending' | 'failed' {
  if (failed.length === 0) return 'done';
  return attempts >= MAX_FINALIZATION_ATTEMPTS ? 'failed' : 'pending';
}
