/** MTO is optional reporting metadata. Only an explicit MV entry is excluded;
 * Cable types Purpose and the current tray permission policy authorize routes. */
export function isPathFinderCableEligible(mto: unknown): boolean {
  return mto !== 'MV';
}

/** Internal compatibility class for the geometric engine, never a stored MTO
 * value or a substitute for the exact Purpose-permitted route set. */
export function routingEngineCategory(mto: unknown): 'MV' | 'LV' | 'Control' {
  if (mto === 'MV') return 'MV';
  return mto === 'Control' || mto === 'Instrumentation' ? 'Control' : 'LV';
}
