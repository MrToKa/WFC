/** Byte limit for a stored proposal's dependencies and full engine result.
 * Geometry and barrier evidence share this budget; write receipts are bounded separately. */
export const RETAINED_PROPOSAL_BYTES = 1024 * 1024;

/** Receipts retain the inputs as well as the before/after snapshots and write provenance. */
export const RETAINED_WRITE_RECEIPT_BYTES = RETAINED_PROPOSAL_BYTES + 256 * 1024;
