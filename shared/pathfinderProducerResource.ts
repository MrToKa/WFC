/** Internal broker header; never exposed to the managed browser or ordinary viewer. */
export const PRODUCER_RESOURCE_CAPABILITY_HEADER = 'X-WFC-PF-Producer-Capability';
export const PRODUCER_RESOURCE_LIMITS = Object.freeze({
  capabilityLifetimeMilliseconds: 15 * 60_000, requests: 50_000, responseBytes: 4 * 1024 ** 3,
  retainedSessionsPerProject: 4096, activeCapabilities: 4096, descriptorBytes: 64 * 1024,
});
