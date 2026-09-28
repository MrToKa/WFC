/** Match only complete product identities, using the database index normalization. */
export const materialIdentityPredicate = `
  obsolete_at IS NULL AND
  NULLIF(LOWER(BTRIM(manufacturer)), '') = NULLIF(LOWER(BTRIM($1::text)), '')
  AND NULLIF(LOWER(BTRIM(part_no)), '') = NULLIF(LOWER(BTRIM($2::text)), '')
`;

export const materialIdentityConflict =
  'A material with this Manufacturer + Part No. already exists';

export const isMaterialIdentityConflict = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';

export const isMaterialDeletionBlocked = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === '23514' &&
  'message' in error &&
  error.message === 'Catalog materials must be marked obsolete, not physically deleted';

export const materialDeletionBlockedMessage =
  'Database policy prevents deleting catalog materials. They must be marked obsolete instead.';
