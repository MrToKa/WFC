import { PathFinderError } from './errors.js';

/** A publication/frame or its retained capture may change after admission. These
 * exact refusals invalidate a calculation without invalidating its readable
 * history. Never classify authority, implementation, abort or raw I/O errors by
 * a name/prefix/status: those must retain their independent failure boundary. */
const expected = new Map<string, number>([
  ['BARRIER_CALCULATION_SCOPE_CHANGED', 409],
  ['BARRIER_CONTEXT_CHANGED', 409],
  ['BARRIER_CURRENT_FRAME_UNAVAILABLE', 409],
  ['BARRIER_CALCULATION_STORAGE_INVALID', 409],
  ['BARRIER_BLOB_INTEGRITY', 409],
  ['BARRIER_READY_SNAPSHOT_REQUIRED', 409],
  ['BARRIER_CALCULATION_DEADLINE', 503],
  ['BARRIER_STORAGE_BUSY', 503],
]);

export function isExpectedBarrierCurrentnessError(error: unknown): error is PathFinderError {
  return error instanceof PathFinderError && expected.get(error.code) === error.status;
}

export const barrierHistoricalUnavailableMessage = 'The registered barrier scope changed or became unavailable. '
  + 'This historical result remains available for inspection and cannot be applied. Refresh barriers and calculate again.';
