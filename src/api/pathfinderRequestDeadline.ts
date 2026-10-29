const cancelled = (signal: AbortSignal): unknown =>
  signal.reason ?? new DOMException('The request was cancelled.', 'AbortError');

/** Covers fetch and every body read even when the underlying promise ignores abort. */
export function pathFinderRequestDeadline(
  caller: AbortSignal | undefined,
  milliseconds: number,
  timeoutError: () => Error,
) {
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0 || milliseconds > 180_000)
    throw new RangeError('Invalid Path Finder request deadline.');
  if (caller?.aborted) throw cancelled(caller);
  const controller = new AbortController(), expiresAt = performance.now() + milliseconds;
  const forward = () => controller.abort(caller ? cancelled(caller) : undefined);
  caller?.addEventListener('abort', forward, { once: true });
  if (caller?.aborted) forward();
  const timer = setTimeout(() => controller.abort(timeoutError()), milliseconds);
  const check = () => {
    if (!controller.signal.aborted && performance.now() >= expiresAt)
      controller.abort(timeoutError());
    if (controller.signal.aborted) throw cancelled(controller.signal);
  };
  function wait<T>(work: () => Promise<T>, onLate?: (value: T) => void): Promise<T> {
    check();
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => controller.signal.removeEventListener('abort', onAbort);
      const refuse = (error: unknown) => {
        if (settled) return;
        settled = true; cleanup(); reject(error);
      };
      const onAbort = () => refuse(cancelled(controller.signal));
      const discard = (value: T) => { try { onLate?.(value); } catch { /* best-effort disposal */ } };
      controller.signal.addEventListener('abort', onAbort, { once: true });
      if (controller.signal.aborted) { onAbort(); return; }
      let pending: Promise<T>;
      try { pending = work(); } catch (error) { refuse(error); return; }
      // Attach both handlers so a late rejection cannot become unhandled after timeout.
      Promise.resolve(pending).then(value => {
        if (settled) { discard(value); return; }
        try { check(); } catch (error) { discard(value); refuse(error); return; }
        settled = true; cleanup(); resolve(value);
      }, refuse);
    });
  }
  return {
    signal: controller.signal,
    check,
    wait,
    dispose() { clearTimeout(timer); caller?.removeEventListener('abort', forward); },
  };
}

/** Disposal must not prolong the request when a stream's cancel promise stalls. */
export function discardPathFinderBody(body: ReadableStream<Uint8Array> | null) {
  try { void body?.cancel().catch(() => {}); } catch { /* already locked/closed */ }
}
export function releasePathFinderReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
  try { void reader.cancel().catch(() => {}); } catch { /* cancellation is best effort */ }
  try { reader.releaseLock(); } catch { /* a nonconforming reader may retain a pending read */ }
}
