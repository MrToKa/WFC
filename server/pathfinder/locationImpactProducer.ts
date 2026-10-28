import { setTimeout as delay } from 'node:timers/promises';
import type { LocationImpactRepository } from './locationImpactRepository.js';
import { PathFinderError } from './errors.js';

/** Durable intent consumption, never an engine lane or cable writer. At most five bounded admissions per tick. */
export function createLocationImpactProducer(repository: Pick<LocationImpactRepository, 'claimNext' | 'enrollClaim'>,
  options: { pollMilliseconds?: number; onError?: (code: string) => void } = {}) {
  const interval = options.pollMilliseconds ?? 1000;
  if (!Number.isSafeInteger(interval) || interval < 250 || interval > 15000) throw Error('Invalid location impact producer interval.');
  const controller = new AbortController(); let loop: Promise<void> | undefined, ticking: Promise<void> | undefined, lastErrorCode: string | null = null;
  async function runTick() {
    lastErrorCode = null;
    for (let index = 0; index < 5 && !controller.signal.aborted; index++) {
      try { const claim = await repository.claimNext(controller.signal); if (!claim) return; await repository.enrollClaim(claim, controller.signal); }
      catch (error) { if (controller.signal.aborted) return; lastErrorCode = error instanceof PathFinderError ? error.code : 'LOCATION_IMPACT_PRODUCER_UNAVAILABLE'; try { options.onError?.(lastErrorCode); } catch { lastErrorCode = 'LOCATION_IMPACT_OBSERVER_FAILED'; } }
    }
  }
  return {
    get lastErrorCode() { return lastErrorCode; },
    tick(): Promise<void> { if (controller.signal.aborted) return Promise.resolve(); if (ticking) return ticking; ticking = runTick().finally(() => { ticking = undefined; }); return ticking; },
    start() { if (loop || controller.signal.aborted) return; loop = (async () => { while (!controller.signal.aborted) { await this.tick(); await delay(interval, undefined, { signal: controller.signal }).catch(() => undefined); } })(); },
    async stop() { controller.abort(); await loop; await ticking; },
  };
}
