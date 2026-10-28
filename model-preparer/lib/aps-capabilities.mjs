// Internal factory capabilities. These distinguish trusted adapter families;
// they do not sandbox arbitrary server-side code or authorize a mutation.
const providers = new WeakSet(), costProviders = new WeakSet();
export function brandAPSProvider(provider) { providers.add(provider); return provider; }
export function isAPSProvider(provider) { return provider !== null && typeof provider === 'object' && providers.has(provider); }
export function brandAPSCostProvider(provider) { costProviders.add(provider); return provider; }
export function isAPSCostProvider(provider) { return provider !== null && typeof provider === 'object' && costProviders.has(provider); }
