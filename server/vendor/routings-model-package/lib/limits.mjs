import { fail } from './errors.mjs';

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;

export const DEFAULT_LIMITS = Object.freeze({
  maxArchiveBytes: 2 * GiB,
  maxTotalResourceBytes: 8 * GiB,
  maxFiles: 100000,
  maxFileBytes: 2 * GiB,
  maxManifestBytes: 32 * MiB,
  maxNestedBytes: 256 * MiB,
  maxNestedTotalBytes: GiB,
  maxDepth: 16,
  maxExpansionRatio: 1200,
  maxMs: 600000,
});

// Callers can tighten resource limits for tests or deployment; they cannot
// silently widen the fixed v1 safety profile.
export function resolveLimits(overrides = {}) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    fail('INVALID_MANIFEST', 'Limits must be an object.');
  }
  const result = { ...DEFAULT_LIMITS };
  for (const [key, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(DEFAULT_LIMITS, key) || !Number.isSafeInteger(value) || value < 1 || value > DEFAULT_LIMITS[key]) {
      fail('INVALID_MANIFEST', 'Limit overrides must be positive integers no greater than the v1 defaults.', { key });
    }
    result[key] = value;
  }
  return Object.freeze(result);
}
