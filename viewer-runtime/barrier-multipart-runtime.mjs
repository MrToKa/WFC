import { observeMultipartFrame, createBarrierMultipartProducer } from './barrier-producer.mjs';
import { BARRIER_MULTIPART_PRODUCER_PROFILE, barrierMultipartTransportCanonical as canonical,
  validateBarrierMultipartFrameRequest, validateBarrierMultipartStart, validateBarrierMultipartIntentControl } from './barrier-multipart-protocol.mjs';

const failure = (code = 'BARRIER_MULTIPART_FAILED') => Object.assign(new Error(code), { code });
const interrupted = () => new DOMException('Barrier observation stopped.', 'AbortError');
const same = (a, b) => canonical(a) === canonical(b);

/** Per-loaded-model lifecycle. Small control ACKs never wait for the complete
 * producer, and structural completion never becomes collision/write authority.
 * The transport and dependencies are trusted bridge/adapter arguments only. */
export function createBarrierMultipartRuntime(viewer, { descriptor, isCurrent, signal,
  observe = observeMultipartFrame, produce = createBarrierMultipartProducer } = {}) {
  let job, opening = false, disposed = false;
  const current = operationSignal => {
    if (disposed || signal?.aborted || operationSignal?.aborted || isCurrent() !== true) throw interrupted();
  };
  const tuple = { projectId: descriptor.projectId, modelVersionId: descriptor.modelVersionId, contentFingerprint: descriptor.contentFingerprint };
  async function readFrame(request, operationSignal) {
    current(operationSignal);
    if (!validateBarrierMultipartFrameRequest(request) || !same(request, tuple)) throw failure('MODEL_SELECTION_CHANGED');
    const frameObservation = await observe(viewer, tuple, { loadId: descriptor.loadId, isCurrent: () => !disposed && isCurrent(),
      signal: AbortSignal.any([signal, operationSignal].filter(Boolean)) });
    current(operationSignal);
    return { frameObservation, producerProfile: BARRIER_MULTIPART_PRODUCER_PROFILE };
  }
  const owned = request => {
    current();
    if (!validateBarrierMultipartIntentControl(request) || !job || job.intentId !== request.intentId) throw failure('BARRIER_MULTIPART_CONTEXT_CHANGED');
    if (job.error?.code === 'MODEL_SELECTION_CHANGED') throw job.error;
    return job;
  };
  async function start(request, transport, operationSignal) {
    current(operationSignal);
    if (!validateBarrierMultipartStart(request) || opening) throw failure('BARRIER_MULTIPART_CONTEXT_CHANGED');
    if (job) {
      if (job.error?.code === 'MODEL_SELECTION_CHANGED') throw job.error;
      if (job.intentId === request.intentId) {
        if (!same(job.start, request) || job.error || job.writer.pending().length) throw failure('BARRIER_MULTIPART_RECONCILE_REQUIRED');
        return job.writer.snapshot();
      }
      if (!job.done || job.error || job.writer.pending().length) throw failure('BARRIER_MULTIPART_BUSY');
    }
    opening = true;
    try {
      const writer = await transport.open(request, { signal: operationSignal }); current(operationSignal);
      const context = writer.context, session = context.session, scope = session.command.scope;
      if (session.state === 'cancelled' || session.state !== 'admitted' || session.sessionRevision !== request.expectedSessionRevision
        || scope.modelLoadId !== descriptor.loadId || scope.modelScope.projectId !== tuple.projectId
        || scope.modelScope.modelVersionId !== tuple.modelVersionId || scope.modelScope.contentFingerprint !== tuple.contentFingerprint
        || !same(context.context.producerProfile, request.producerProfile)) throw failure('BARRIER_MULTIPART_CONTEXT_CHANGED');
      const remaining = Date.parse(context.context.effectiveDeadline) - Date.now(), startedAt = Date.parse(session.createdAt);
      if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 3600000 || !Number.isFinite(startedAt) || startedAt > Date.now()) throw failure('BARRIER_MULTIPART_DEADLINE');
      const controller = new AbortController(), state = { intentId: request.intentId, start: JSON.parse(canonical(request)), writer,
        controller, done: false, error: null, promise: null, timer: null };
      const combined = AbortSignal.any([controller.signal, signal].filter(Boolean));
      const live = () => !disposed && job === state && !combined.aborted && isCurrent() === true;
      job = state;
      state.timer = setTimeout(() => controller.abort(), remaining);
      state.promise = (async () => {
        try {
          current(combined);
          const events = produce(viewer, { scope, profile: session.command.profile, frameObservation: context.context.frameObservation,
            producerProfile: context.context.producerProfile, loadId: descriptor.loadId, isCurrent: live, signal: combined, startedAt,
            readPages: kind => writer.readPages(kind, { signal: combined }) });
          for await (const event of events) { current(combined); await writer.stage(event, { signal: combined }); current(combined); }
          const status = writer.snapshot();
          if (status.counts.seals !== 4 || Object.values(status.roots).some(root => root === null)) throw failure();
        } catch (error) { state.error = ['BARRIER_MULTIPART_MODEL_CHANGED', 'BARRIER_MULTIPART_FRAME_CHANGED'].includes(error?.code)
          ? failure('MODEL_SELECTION_CHANGED') : error; }
        finally { state.done = true; clearTimeout(state.timer); }
      })();
      // This ACK describes staging only. The owned promise catches every later
      // failure; STATUS reports it without destroying the loaded Viewer.
      return writer.snapshot();
    } finally { opening = false; }
  }
  function status(request) {
    const state = owned(request);
    if (state.error?.code === 'MODEL_SELECTION_CHANGED') throw state.error;
    if (state.writer.snapshot().state !== 'cancelled' && state.error) throw failure(state.writer.pending().length ? 'BARRIER_MULTIPART_RECONCILE_REQUIRED' : 'BARRIER_MULTIPART_FAILED');
    return state.writer.snapshot();
  }
  async function cancel(request, operationSignal) {
    current(operationSignal); const state = owned(request); state.controller.abort();
    let timer;
    try {
      await Promise.race([state.promise, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(failure('BARRIER_MULTIPART_JOIN_REQUIRED')), 10000); })]);
      current(operationSignal); owned(request);
      await state.writer.cancel({ signal: operationSignal }); current(operationSignal);
      return state.writer.snapshot();
    } finally { clearTimeout(timer); }
  }
  async function reconcile(request, operationSignal) {
    current(operationSignal); const state = owned(request);
    if (!state.done) throw failure('BARRIER_MULTIPART_BUSY');
    // Explicit readback of the exact retained command(s), never a stage retry.
    // A failed producer still needs cancellation/new admission after readback.
    for (const pending of state.writer.pending()) {
      current(operationSignal); await state.writer.reconcile(pending.command.idempotencyKey, { signal: operationSignal }); current(operationSignal);
    }
    return state.writer.snapshot();
  }
  function dispose() { if (disposed) return; disposed = true; if (job) { clearTimeout(job.timer); job.controller.abort(); } }
  signal?.addEventListener('abort', dispose, { once: true });
  return { readFrame, start, status, cancel, reconcile, dispose };
}
