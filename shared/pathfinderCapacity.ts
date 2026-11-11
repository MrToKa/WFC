import { z } from 'zod';

export const LEGACY_PREPARATION_CAPACITY_PROFILE = 'wfc.pf.current-bounded-capture-and-model.v1' as const;
export const LARGE_PREPARATION_CAPACITY_PROFILE = 'wfc.pf.bounded-128m-capture-and-model.v2' as const;
export const EXTENDED_PREPARATION_CAPACITY_PROFILE = 'wfc.pf.bounded-512m-capture-and-model.v3' as const;
export const MAX_PREPARATION_BLOB_BYTES = 512 * 1024 ** 2;
export const preparationCapacityProfileSchema = z.enum([
  LEGACY_PREPARATION_CAPACITY_PROFILE,
  LARGE_PREPARATION_CAPACITY_PROFILE,
  EXTENDED_PREPARATION_CAPACITY_PROFILE,
]);
export type PreparationCapacityProfile = z.infer<typeof preparationCapacityProfileSchema>;

const legacy = Object.freeze({ validationInputBytes: 32 * 1024 ** 2, projectionInputBytes: 32 * 1024 ** 2 });
const large = Object.freeze({ validationInputBytes: 128 * 1024 ** 2, projectionInputBytes: 128 * 1024 ** 2 });

const extended = Object.freeze({ validationInputBytes: MAX_PREPARATION_BLOB_BYTES, projectionInputBytes: MAX_PREPARATION_BLOB_BYTES });

/** A frozen plan selects its input envelope; missing or unknown evidence never falls back. */
export function preparationCapacity(profile: PreparationCapacityProfile) {
  const selected = preparationCapacityProfileSchema.parse(profile);
  return selected === LEGACY_PREPARATION_CAPACITY_PROFILE ? legacy : selected === LARGE_PREPARATION_CAPACITY_PROFILE ? large : extended;
}
