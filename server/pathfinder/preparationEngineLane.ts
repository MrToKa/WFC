import type { EngineExecutor, EngineInvocation } from './engineSession.js';
import type { EngineResponse } from './jobContracts.js';
import { PathFinderError } from './errors.js';

type Ticket = {
  request: EngineInvocation; controller: AbortController; running: boolean;
  resolve: (value: EngineResponse) => void; reject: (error: unknown) => void;
  release: () => void;
};
const failure = (code: string, status = 409) => new PathFinderError(code, status);
const hardEngineFailure = (error: unknown): boolean => error !== null && typeof error === 'object' &&
  ['ENGINE_SESSION_REAP_FAILED', 'ENGINE_IMPLEMENTATION_RESTART_REQUIRED'].includes((error as { code?: string }).code ?? '');

/** One bounded preparation request, dispatched only by the advisory-owned worker. */
export function createPreparationEngineLane() {
  let active = false, fatal = false, ticket: Ticket | undefined;
  const settle = (item: Ticket, error?: unknown, value?: EngineResponse) => {
    if (ticket === item) ticket = undefined;
    item.release();
    if (error) item.reject(error); else item.resolve(value!);
  };
  return {
    activate(): void { if (!fatal) active = true; },
    enqueue(request: EngineInvocation, signal: AbortSignal): Promise<EngineResponse> {
      if (!active) return Promise.reject(failure('PREPARATION_WORKER_UNAVAILABLE', 503));
      if (ticket) return Promise.reject(failure('PREPARATION_ENGINE_BUSY'));
      if (request.operation !== 'prepare' || !Number.isSafeInteger(request.timeoutMilliseconds)
        || request.timeoutMilliseconds < 1 || request.timeoutMilliseconds > 120000)
        return Promise.reject(failure('PREPARATION_ENGINE_REQUEST', 400));
      let frozen: EngineInvocation;
      try {
        const text = JSON.stringify(request, (_key, value: unknown) => {
          if (typeof value === 'number' && !Number.isFinite(value)) throw failure('PREPARATION_ENGINE_REQUEST', 400);
          return value;
        });
        if (Buffer.byteLength(text) > 1024 * 1024) throw failure('ENGINE_INPUT_BUDGET', 413);
        frozen = JSON.parse(text) as EngineInvocation;
      } catch (error) { return Promise.reject(error); }
      if (signal.aborted) return Promise.reject(failure('PREPARATION_CANCELLED'));
      return new Promise((resolve, reject) => {
        const controller = new AbortController();
        const item: Ticket = { request: frozen, controller, running: false, resolve, reject, release: () => {} };
        const interrupt = (reason: PathFinderError) => {
          controller.abort(reason);
          // Running work retains admission until the engine has joined its child.
          if (!item.running && ticket === item) settle(item, reason);
        };
        const abort = () => interrupt(failure('PREPARATION_CANCELLED'));
        const timer = setTimeout(() => interrupt(failure('PREPARATION_ENGINE_DEADLINE', 408)), Math.min(120000, frozen.timeoutMilliseconds + 1500));
        item.release = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
        ticket = item;
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
    },
    async runNext(engine: EngineExecutor, workerSignal: AbortSignal): Promise<boolean> {
      const item = ticket;
      if (!item || item.running) return false;
      item.running = true;
      const signal = AbortSignal.any([item.controller.signal, workerSignal]);
      try {
        signal.throwIfAborted();
        const response = await engine.execute(item.request, signal);
        signal.throwIfAborted();
        if (response.requestId !== item.request.requestId)
          throw failure('ENGINE_RESPONSE_IDENTITY', 502);
        settle(item, undefined, response);
      } catch (error) {
        // The original cancellation can precede a failed process join. Its
        // AbortSignal reason must not turn unknown physical ownership into an
        // ordinary cancelled preparation or hide a changed implementation.
        if (hardEngineFailure(error)) { fatal = true; active = false; settle(item, error); }
        else settle(item, signal.aborted
          ? signal.reason instanceof PathFinderError ? signal.reason : failure('PREPARATION_CANCELLED') : error);
      }
      return true;
    },
    close(): void {
      active = false;
      const item = ticket;
      if (!item) return;
      item.controller.abort();
      if (!item.running) settle(item, failure('PREPARATION_WORKER_UNAVAILABLE', 503));
    },
  };
}
