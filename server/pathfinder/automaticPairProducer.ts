import { setTimeout as delay } from 'node:timers/promises';
import type { AutomaticPairOutcome } from '../../shared/pathfinderAutomaticPair.js';
import type { AutomaticPairDispatch } from './automaticPairDispatch.js';
import type { AutomaticPairWriter } from './automaticPairWriter.js';
import { PathFinderError } from './errors.js';

export function automaticPairFailureOutcome(error: unknown, interrupted: boolean): AutomaticPairOutcome {
  const code = error instanceof PathFinderError ? error.code : interrupted ? 'AUTOMATIC_PAIR_INTERRUPTED' : 'AUTOMATIC_PAIR_WRITE_REFUSED';
  const unknown = interrupted || /COMMIT_OUTCOME_UNKNOWN|DATABASE_BUSY/.test(code);
  return { status: unknown ? 'unknown' : /EXPIRED|REVOKED|AUTHORITY|ADMIN_REQUIRED|RESTORE_FENCED/.test(code) ? 'authority-expired'
    : /STALE|SUPERSEDED|SCOPE_CHANGED|CABLE_WRITE_CONFLICT/.test(code) ? 'stale' : 'refused', receiptId: null, code };
}
/** Separate bounded service; importing/constructing does not start it. */
export function createAutomaticPairProducer(dispatch: AutomaticPairDispatch, writer: AutomaticPairWriter) {
  const controller = new AbortController(); let loop: Promise<void> | undefined, ticking: Promise<void> | undefined, lastErrorCode: string | null = null;
  const tick = () => {
    if (controller.signal.aborted) return Promise.resolve(); if (ticking) return ticking;
    ticking = (async () => {
      await dispatch.discover(controller.signal);
      await dispatch.reconcileNext(writer.inspectInTransaction, controller.signal);
      for (let at = 0; at < 5 && !controller.signal.aborted; at++) {
        const claim = await dispatch.claim(controller.signal); if (!claim) return;
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]);
        try { const outcome = await writer.apply(claim, dispatch.fence, signal); await dispatch.finish(claim, outcome); lastErrorCode = null; }
        catch (error) { const outcome = automaticPairFailureOutcome(error, signal.aborted); lastErrorCode = outcome.code ?? null; await dispatch.finish(claim, outcome); }
      }
    })().catch(error => { if (!controller.signal.aborted) lastErrorCode = error instanceof PathFinderError ? error.code : 'AUTOMATIC_PAIR_PRODUCER_UNAVAILABLE'; })
      .finally(() => { ticking = undefined; }); return ticking;
  };
  return { tick, get lastErrorCode() { return lastErrorCode; }, start() {
    if (loop) return; loop = (async () => { while (!controller.signal.aborted) { await tick(); await delay(1000, undefined, { signal: controller.signal }).catch(() => undefined); } })();
  }, async stop() { controller.abort(); await loop; await ticking; } };
}
