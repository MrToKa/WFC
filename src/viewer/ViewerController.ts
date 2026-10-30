import { digestSha256 } from '../utils/sha256';
import { generateId } from '@/utils/generateId';
import { FRAME_PATH, MAX_PATH_POINTS, MAX_PATH_CHUNK_POINTS, isCanonicalPoint, validateEnvelope, type BridgeEnvelope, type ComputedPath, type PickedPoint, type ViewerModelObjectsPage, type ViewerSelection, type ViewerTrayRootSelection, type ModelCaptureRequest, type ModelCaptureProgress } from '../../viewer-runtime/protocol.mjs';
import { createModelCaptureAssembler } from '../../viewer-runtime/model-capture.mjs';
import { createBarrierCaptureAssembler, validateBarrierCaptureRequest, validateBarrierFrameObservation, barrierFrameObservationHashInput, type BarrierCaptureRequest } from '../../viewer-runtime/barrier-capture.mjs';
import { validateBarrierMultipartFrameRequest, validateBarrierMultipartStart, validateBarrierMultipartIntentControl,
  type BarrierMultipartStart, type BarrierMultipartStatus, type BarrierMultipartProducerProfile } from '../../viewer-runtime/barrier-multipart-protocol.mjs';
import type { BarrierFrameObservation } from '../../viewer-runtime/barrier-capture.mjs';
import { BARRIER_LIMITS, barrierCanonicalJson, barrierCaptureSchema } from '../../shared/pathfinderBarriers';
import { bindCompletedCaptureEvidence,verifyCompletedCaptureEvidence,type CompletedModelCaptureSummary } from '../../viewer-runtime/capture-evidence.mjs';
import { CAPTURE_INPUT_LIMITS, planModelCaptureInput, validateModelCaptureInputAck, validateModelCaptureInputScope, type ModelCaptureInputDescriptor } from '../../viewer-runtime/capture-input.mjs';
import { validatePreparationDiscoveryRequest, validatePreparationDiscoveryPage, type PreparationDiscoveryRequest, type PreparationDiscoveryPage } from '../../viewer-runtime/preparation-input.mjs';
import { watchViewerLogin } from './loginLifecycle';
import { supportedBarrierCaptureCommandSchema, supportedBarrierPublicationOutcomeSchema as barrierPublicationOutcomeSchema,
  supportedBarrierSnapshotReferenceSchema as barrierSnapshotReferenceSchema, type AnyBarrierCaptureCommand } from '../../shared/pathfinderBarrierSupported';
import { sessionBase, viewerRequest, ViewerAccessError, type ViewerSession, type ModelSelection } from './sessionApi';

type Pending = { envelope: BridgeEnvelope; terminal: string; timer: number; resolve?: (event: ViewerEvent) => void; reject?: (error: Error) => void; quietRecoverableErrors?: boolean };
type LifecycleScope = Readonly<{
  generation: number; session: ViewerSession; modelVersionId: string | null; loadId: string | null;
  selectionRevision: number | null; deadline: number; signal: AbortSignal;
}>;
export type ViewerEventIdentity = Readonly<Pick<BridgeEnvelope, 'protocolVersion' | 'instanceId' | 'projectId' | 'modelVersionId' | 'loadId' | 'requestId'>>;
export type ViewerLoadSnapshot = Readonly<{
  instanceId: string; projectId: string; modelVersionId: string; loadId: string;
  selectionRevision: number; ready: boolean;
}>;
export type ViewerEvent = { type: string; payload: Record<string, unknown>; requestId?: string; identity?: ViewerEventIdentity };
/** Aggregate diagnostics only: no capture identity, model data or raw error text. */
export type ViewerCaptureTiming = Readonly<{
  outcome: 'completed' | 'refused' | 'cancelled' | 'deadline';
  wallMs: number; roundCount: number; inputChunkCount: number; eventCount: number;
  roundWaitMs: number; maxRoundWaitMs: number;
  initialSelectionMs: number; finalSelectionMs: number;
  planningMs: number; assemblyMs: number; evidenceHashMs: number;
}>;
export type ViewerOptions = {
  container: HTMLElement; projectId: string; token: string;
  onEvent: (event: ViewerEvent) => void;
  onCaptureTiming?: (timing: ViewerCaptureTiming) => void | Promise<void>;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Starts at captureModel entry, including authorization, input staging and output
// assembly. The frame retains its own 300s limit; this adds only the existing
// 15s access-check/transport allowance and is never renewed by progress replies.
const CAPTURE_WALL_MILLISECONDS = CAPTURE_INPUT_LIMITS.milliseconds + 15_000;
const CAPTURE_TIMING_MAX_MILLISECONDS = CAPTURE_WALL_MILLISECONDS * 2;
// Pinned SDK isolation/restoration traverses the model's hierarchy and fragment
// visibility synchronously. Large-model appearance work needs a bounded allowance
// beyond the small BEGIN/APPEND messages; authorization checks remain unchanged.
const MODEL_APPEARANCE_TIMEOUT_MILLISECONDS = 60_000;
const LIFECYCLE_RETRY_DELAYS = [250, 750] as const;
const transientLifecycleFailure = (error: unknown): boolean => error instanceof ViewerAccessError
  ? error.status === 408 || error.status === 429 || error.status >= 500
  : error instanceof TypeError || error instanceof DOMException && error.name === 'TimeoutError';
const captureTimingNow = (): number => { try { const value = performance.now(); return Number.isFinite(value) ? value : 0; } catch { return 0; } };
const captureTimingValue = (value: number, maximum = CAPTURE_TIMING_MAX_MILLISECONDS): number => Number.isFinite(value) ? Math.min(maximum, Math.max(0, Math.round(value))) : 0;

/** One controller owns one iframe, login, project and current load. */
export class ViewerController {
  instanceId = generateId();
  iframe: HTMLIFrameElement;
  private disposed = false;
  private ready = false;
  private loaded = false;
  private helloSeen = false;
  private generation = 0;
  private modelVersionId: string | null = null;
  private loadId: string | null = null;
  private session: ViewerSession | null = null;
  private routeRequestId: string | null = null;
  private trayDisplayGeneration: number | null = null;
  private activeLoadRequestId: string | null = null;
  private selectionRevision: number | null = null;
  private pending = new Map<string, Pending>();
  private requests = new Set<AbortController>();
  private renewTimer?: number;
  private selectionTimer?: number;
  private handshakeTimer: number;
  private unwatch: () => void;
  private queuedLoad: { modelVersionId: string; finish: () => void } | null = null;
  private captureInputAbort: AbortController | null = null;
  private lifecycleAbort = new AbortController();
  private selectionCheck: { scope: LifecycleScope; promise: Promise<boolean> } | null = null;

  constructor(private readonly options: ViewerOptions) {
    if (!UUID.test(options.projectId)) throw new Error('Invalid project ID');
    this.iframe = this.createFrame();
    window.addEventListener('message', this.onMessage);
    window.addEventListener('focus', this.onFocus);
    document.addEventListener('visibilitychange', this.onFocus);
    this.unwatch = watchViewerLogin(options.token, () => this.dispose('logout'));
    this.handshakeTimer = window.setTimeout(() => this.fail('RUNTIME_TIMEOUT'), 10_000);
    options.container.append(this.iframe);
  }

  private createFrame(): HTMLIFrameElement {
    const iframe = document.createElement('iframe');
    iframe.title = 'Protected 3D model';
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    iframe.referrerPolicy = 'same-origin';
    iframe.style.cssText = 'width:100%;height:100%;border:0;display:block;min-height:0;background:#f5f5f5';
    iframe.src = `${FRAME_PATH}?instanceId=${this.instanceId}&projectId=${this.options.projectId}`;
    return iframe;
  }

  private emit(type: string, payload: Record<string, unknown> = {}, requestId?: string, identity?: ViewerEventIdentity): void {
    if (!this.disposed) this.options.onEvent({ type, payload, requestId, ...(identity ? { identity: Object.freeze({ ...identity }) } : {}) });
  }

  /** A detached current-load identity; resolving load() alone does not make it ready. */
  getLoadSnapshot(): ViewerLoadSnapshot | null {
    if (this.disposed || !this.modelVersionId || !this.loadId || !Number.isSafeInteger(this.selectionRevision) || this.selectionRevision === null || this.selectionRevision < 0) return null;
    return Object.freeze({ instanceId: this.instanceId, projectId: this.options.projectId, modelVersionId: this.modelVersionId,
      loadId: this.loadId, selectionRevision: this.selectionRevision, ready: this.loaded });
  }

  private arm(pending: Pending): void {
    window.clearTimeout(pending.timer);
    pending.timer = window.setTimeout(() => {
      if (!this.pending.delete(pending.envelope.requestId)) return;
      pending.reject?.(pending.envelope.type === 'READ_TRAY_ROOT_SELECTION'
        ? new ViewerAccessError('TRAY_ROOT_SELECTION_UNAVAILABLE', 0) : new Error('Viewer request timed out'));
      if (pending.envelope.type.includes('BARRIER_MULTIPART')) {
        this.cancel(pending.envelope.requestId);
        this.emit('ERROR', { code: 'BARRIER_MULTIPART_RECONCILE_REQUIRED', message: 'Barrier control timed out. Check the retained capture status before trying another command.', retryable: true, operation: pending.envelope.type });
        return;
      }
      if (pending.envelope.type === 'SHOW_LOCATION' || pending.envelope.type === 'SHOW_TRAY') {
        const cancelId = this.cancel(pending.envelope.requestId), cancellation = this.pending.get(cancelId);
        // Cancellation is best-effort cleanup after a display timeout. A lost
        // cleanup ACK must not turn this recoverable failure into model loss.
        if (cancellation) { window.clearTimeout(cancellation.timer); this.pending.delete(cancelId); }
        const tray = pending.envelope.type === 'SHOW_TRAY';
        this.emit('ERROR', { code: tray ? 'TRAY_UNAVAILABLE' : 'LOCATION_UNAVAILABLE', message: tray ? 'The tray could not be shown. Try again.' : 'The location could not be shown. Try again.', retryable: true, operation: pending.envelope.type });
        return;
      }
      if (pending.envelope.type === 'READ_TRAY_ROOT_SELECTION') {
        const cancelId = this.cancel(pending.envelope.requestId), cancellation = this.pending.get(cancelId);
        // A lost metadata reply or cleanup ACK does not unload the current
        // model. Retire this request so its late response cannot fill a draft.
        if (cancellation) { window.clearTimeout(cancellation.timer); this.pending.delete(cancelId); }
        if (!pending.quietRecoverableErrors) this.emit('ERROR', { code: 'TRAY_ROOT_SELECTION_UNAVAILABLE', message: 'Reading the selected tray roots timed out. Keep the intended objects selected and try again.', retryable: true, operation: 'READ_TRAY_ROOT_SELECTION' });
        return;
      }
      this.fail(pending.envelope.type === 'LOAD_MODEL' ? 'MODEL_TIMEOUT' : 'REQUEST_TIMEOUT');
    // A discovery page may build the bounded model-wide property index (300s
    // inside the frame). Allow its terminal reply to arrive before failing load.
    }, pending.envelope.type === 'READ_TRAY_ROOT_SELECTION' ? 15_000 : pending.envelope.type.includes('BARRIER_MULTIPART') ? 195_000 : pending.envelope.type === 'READ_PREPARATION_OBJECTS' ? 310_000 : ['START_MODEL_CAPTURE', 'READ_MODEL_CAPTURE', 'START_BARRIER_CAPTURE', 'READ_BARRIER_CAPTURE'].includes(pending.envelope.type) ? 125_000 : ['CLEAR_ROUTE', 'COMMIT_COMPUTED_PATH', 'SET_PATH_TRANSPARENCY', 'SHOW_LOCATION', 'SHOW_TRAY'].includes(pending.envelope.type) ? MODEL_APPEARANCE_TIMEOUT_MILLISECONDS : ['LOAD_MODEL', 'READ_MODEL_OBJECTS', 'READ_SELECTION'].includes(pending.envelope.type) ? 60_000 : pending.envelope.type === 'PICK_POINT' ? 125_000 : 10_000);
  }

  private send(type: string, payload: Record<string, unknown>, terminal: string, callbacks: Pick<Pending, 'resolve' | 'reject' | 'quietRecoverableErrors'> = {}): string {
    if (this.disposed) throw new Error('Viewer disposed');
    const envelope = {
      channel: 'wfc-routings-viewer', protocolVersion: 1, instanceId: this.instanceId,
      projectId: this.options.projectId, modelVersionId: this.modelVersionId,
      loadId: this.loadId, requestId: generateId(), type, payload,
    } as BridgeEnvelope;
    if (!validateEnvelope(envelope, 'parent-to-frame')) throw new Error('Invalid Viewer command');
    const pending: Pending = { envelope, terminal, timer: 0, ...callbacks };
    this.pending.set(envelope.requestId, pending);
    this.arm(pending);
    this.iframe.contentWindow?.postMessage(envelope, window.location.origin);
    return envelope.requestId;
  }

  private sendAsync(type: string, payload: Record<string, unknown>, terminal: string, options: Pick<Pending, 'quietRecoverableErrors'> = {}): Promise<ViewerEvent> {
    return new Promise((resolve, reject) => { try { this.send(type, payload, terminal, { resolve, reject, ...options }); } catch (error) { reject(error); } });
  }

  private onMessage = (event: MessageEvent): void => {
    if (this.disposed || event.origin !== window.location.origin || event.source !== this.iframe.contentWindow) return;
    const message = validateEnvelope(event.data, 'frame-to-parent');
    if (!message || message.instanceId !== this.instanceId || message.projectId !== this.options.projectId) return;
    const identity: ViewerEventIdentity = { protocolVersion: 1, instanceId: message.instanceId, projectId: message.projectId,
      modelVersionId: message.modelVersionId, loadId: message.loadId, requestId: message.requestId };
    if (message.type === 'HELLO') {
      if (this.helloSeen || message.modelVersionId !== null || message.loadId !== null) return;
      this.helloSeen = true;
      this.send('INIT', { locale: 'en', expectedSdkVersion: '7.130.0' }, 'RUNTIME_READY');
      return;
    }
    const pending = this.pending.get(message.requestId);
    if (!pending && message.type === 'ERROR' && message.requestId === this.activeLoadRequestId &&
      message.modelVersionId === this.modelVersionId && message.loadId === this.loadId) {
      this.fail(String(message.payload.code));
      return;
    }
    if (!pending || message.modelVersionId !== pending.envelope.modelVersionId || message.loadId !== pending.envelope.loadId ||
      message.modelVersionId !== this.modelVersionId || message.loadId !== this.loadId) return;
    if (message.type === 'MODEL_PROGRESS' && pending.envelope.type === 'LOAD_MODEL') {
      this.arm(pending);
      this.emit(message.type, message.payload, message.requestId, identity);
      return;
    }
    if (message.type === 'MODEL_CAPTURE_PROGRESS' && ['START_MODEL_CAPTURE', 'READ_MODEL_CAPTURE'].includes(pending.envelope.type) && message.payload.captureId === pending.envelope.payload.captureId) {
      this.arm(pending); this.emit(message.type, message.payload, message.requestId, identity); return;
    }
    if (message.type === 'BARRIER_CAPTURE_PROGRESS' && ['START_BARRIER_CAPTURE', 'READ_BARRIER_CAPTURE'].includes(pending.envelope.type) && message.payload.captureId === pending.envelope.payload.captureId) {
      this.arm(pending); this.emit(message.type, message.payload, message.requestId, identity); return;
    }
    if (message.type === 'WARNING') { this.emit(message.type, message.payload, message.requestId, identity); return; }
    if (message.type !== pending.terminal && message.type !== 'ERROR') return;
    window.clearTimeout(pending.timer);
    this.pending.delete(message.requestId);
    if (message.type === 'ERROR') {
      pending.reject?.(new ViewerAccessError(String(message.payload.code), 0));
      if (pending.envelope.type === 'LOAD_MODEL' || ['SESSION_EXPIRED', 'ACCESS_REVOKED', 'MODEL_SELECTION_CHANGED', 'BARRIER_CAPTURE_MODEL_CHANGED', 'MODEL_UNAVAILABLE', 'RESOURCE_FAILED'].includes(String(message.payload.code))) {
        this.fail(String(message.payload.code));
      } else if (!(pending.envelope.type === 'READ_TRAY_ROOT_SELECTION' && pending.quietRecoverableErrors)) this.emit('ERROR', message.payload, message.requestId, identity);
      return;
    }
    if (message.type === 'RUNTIME_READY') {
      window.clearTimeout(this.handshakeTimer);
      this.ready = true;
      if (this.queuedLoad) {
        const queued = this.queuedLoad;
        this.queuedLoad = null;
        void this.load(queued.modelVersionId).finally(queued.finish);
        return;
      }
    }
    if (message.type === 'MODEL_LOADED') {
      this.loaded = true;
      this.iframe.style.visibility = 'visible';
    }
    if (message.type === 'ROUTE_RESULT') {
      if (message.payload.rawRouting !== pending.envelope.payload.rawRouting || message.payload.source !== pending.envelope.payload.source || message.payload.cableId !== pending.envelope.payload.cableId) {
        this.fail('ROUTE_RESULT_MISMATCH');
        return;
      }
      if (Number(message.payload.drawableCount) > 0 && Number(message.payload.lineCount) > 0) this.routeRequestId = message.requestId;
      else this.routeRequestId = null;
    }
    if (message.type === 'COMPUTED_PATH_UPDATED') {
      const expectedPhase = pending.envelope.type === 'BEGIN_COMPUTED_PATH' ? 'begun' : pending.envelope.type === 'APPEND_COMPUTED_PATH' ? 'appended' : 'displayed';
      const expectedCount = expectedPhase === 'begun' ? 0 : expectedPhase === 'appended' ? Number(pending.envelope.payload.offset) + (pending.envelope.payload.points as unknown[]).length : undefined;
      if (message.payload.pathId !== pending.envelope.payload.pathId || message.payload.phase !== expectedPhase || expectedCount !== undefined && message.payload.received !== expectedCount) {
        pending.reject?.(new Error('Computed path acknowledgement mismatch')); this.fail('ROUTE_RESULT_MISMATCH'); return;
      }
      if (expectedPhase === 'displayed') this.routeRequestId = message.requestId;
    }
    if (message.type === 'MODEL_CAPTURE_EVENT' && (message.payload.captureId !== pending.envelope.payload.captureId || message.payload.index !== (pending.envelope.type === 'START_MODEL_CAPTURE' ? 0 : pending.envelope.payload.index))) {
      pending.reject?.(new Error('Model capture identity mismatch')); this.fail('ROUTE_RESULT_MISMATCH'); return;
    }
    if (message.type === 'BARRIER_CAPTURE_EVENT' && (message.payload.captureId !== pending.envelope.payload.captureId || message.payload.index !== (pending.envelope.type === 'START_BARRIER_CAPTURE' ? 0 : pending.envelope.payload.index))) {
      pending.reject?.(new Error('Barrier capture identity mismatch')); this.fail('ROUTE_RESULT_MISMATCH'); return;
    }
    if (message.type === 'PATH_TRANSPARENCY_UPDATED' && (message.payload.routeRequestId !== pending.envelope.payload.routeRequestId || message.payload.percent !== pending.envelope.payload.percent)) {
      pending.reject?.(new Error('Path transparency acknowledgement mismatch')); return;
    }
    if (message.type === 'LOCATION_SHOWN' && message.payload.sdkObjectId !== pending.envelope.payload.sdkObjectId) {
      pending.reject?.(new Error('Location acknowledgement mismatch')); return;
    }
    if (message.type === 'TRAY_SHOWN' && JSON.stringify(message.payload.sdkObjectIds) !== JSON.stringify(pending.envelope.payload.sdkObjectIds)) {
      pending.reject?.(new Error('Tray acknowledgement mismatch')); return;
    }
    pending.resolve?.({ type: message.type, payload: message.payload, requestId: message.requestId, identity });
    this.emit(message.type, message.payload, message.requestId, identity);
  };

  private clearPending(types?: string[]): void {
    for (const [id, pending] of this.pending) {
      if (!types || types.includes(pending.envelope.type)) {
        window.clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.reject?.(new DOMException('Viewer request cancelled.', 'AbortError'));
      }
    }
  }

  private async request<T>(path: string, method: 'GET' | 'POST' | 'DELETE' = 'GET', body?: unknown): Promise<T> {
    const abort = new AbortController();
    const timeout = window.setTimeout(() => abort.abort(), 15_000);
    this.requests.add(abort);
    try { return await viewerRequest<T>(path, this.options.token, { method, body, signal: abort.signal }); }
    finally { window.clearTimeout(timeout); this.requests.delete(abort); }
  }

  private lifecycleScope(generation: number): LifecycleScope | null {
    if (this.disposed || generation !== this.generation || !this.session) return null;
    const session = { ...this.session };
    return { generation, session, modelVersionId: this.modelVersionId, loadId: this.loadId, selectionRevision: this.selectionRevision,
      deadline: Math.min(Date.parse(session.expiresAt), Date.parse(session.absoluteExpiresAt)), signal: this.lifecycleAbort.signal };
  }

  private currentLifecycle(scope: LifecycleScope): boolean {
    return !this.disposed && !scope.signal.aborted && scope.generation === this.generation && scope.session.sessionId === this.session?.sessionId
      && scope.modelVersionId === this.modelVersionId && scope.loadId === this.loadId && scope.selectionRevision === this.selectionRevision;
  }

  private assertLifecycle(scope: LifecycleScope): void {
    if (!this.currentLifecycle(scope)) throw new DOMException('Viewer lifecycle request cancelled.', 'AbortError');
    if (!Number.isFinite(scope.deadline) || Date.now() >= scope.deadline) throw new ViewerAccessError('SESSION_EXPIRED', 410);
  }

  private cancelLifecycle(): void {
    this.lifecycleAbort.abort(); this.lifecycleAbort = new AbortController(); this.selectionCheck = null;
  }

  /** Only live selection reads and same-session renewal use these bounded retries. */
  private async lifecycleRequest<T>(scope: LifecycleScope, path: string, method: 'GET' | 'POST', validate: (value: unknown) => T): Promise<T> {
    for (let attempt = 0; ; ++attempt) {
      this.assertLifecycle(scope);
      try {
        const value = await this.lifecycleAttempt(scope, path, method);
        this.assertLifecycle(scope);
        return validate(value);
      } catch (error) {
        this.assertLifecycle(scope);
        if (!transientLifecycleFailure(error) || attempt >= LIFECYCLE_RETRY_DELAYS.length) throw error;
        await this.lifecycleDelay(scope, LIFECYCLE_RETRY_DELAYS[attempt]);
      }
    }
  }

  private async lifecycleAttempt(scope: LifecycleScope, path: string, method: 'GET' | 'POST'): Promise<unknown> {
    this.assertLifecycle(scope);
    const abort = new AbortController(); this.requests.add(abort);
    let timer: number | undefined, cancelled: () => void = () => {};
    const interrupted = new Promise<never>((_resolve, reject) => {
      const stop = (error: Error) => { reject(error); abort.abort(); };
      cancelled = () => stop(new DOMException('Viewer lifecycle request cancelled.', 'AbortError'));
      scope.signal.addEventListener('abort', cancelled, { once: true });
      timer = window.setTimeout(() => stop(Date.now() >= scope.deadline ? new ViewerAccessError('SESSION_EXPIRED', 410)
        : new DOMException('Viewer lifecycle request timed out.', 'TimeoutError')), Math.min(15_000, scope.deadline - Date.now()));
    });
    try {
      // Race explicitly: an interrupted fetch may still resolve, but it cannot
      // extend this load's existing session grant or publish a stale check.
      return await Promise.race([viewerRequest<unknown>(path, this.options.token,
        { method, ...(method === 'POST' ? { body: {} } : {}), signal: abort.signal }), interrupted]);
    } finally {
      window.clearTimeout(timer); scope.signal.removeEventListener('abort', cancelled); this.requests.delete(abort);
    }
  }

  private async lifecycleDelay(scope: LifecycleScope, milliseconds: number): Promise<void> {
    this.assertLifecycle(scope);
    let timer: number | undefined, cancelled: () => void = () => {};
    try {
      await new Promise<void>((resolve, reject) => {
        cancelled = () => reject(new DOMException('Viewer lifecycle retry cancelled.', 'AbortError'));
        scope.signal.addEventListener('abort', cancelled, { once: true });
        timer = window.setTimeout(resolve, Math.min(milliseconds, scope.deadline - Date.now()));
      });
      this.assertLifecycle(scope);
    } finally { window.clearTimeout(timer); scope.signal.removeEventListener('abort', cancelled); }
  }

  async load(modelVersionId: string): Promise<void> {
    if (this.disposed || !this.ready && !this.queuedLoad) throw new Error('Viewer runtime is not ready');
    if (!UUID.test(modelVersionId)) throw new Error('Invalid model version ID');
    this.cancelLifecycle();
    this.captureInputAbort?.abort(); this.captureInputAbort = null;
    if (this.modelVersionId || this.queuedLoad) {
      const old = this.queuedLoad;
      this.queuedLoad = null;
      old?.finish();
      ++this.generation;
      ++this.routeGeneration;
      this.clearPending();
      for (const request of this.requests) request.abort();
      window.clearTimeout(this.renewTimer);
      window.clearTimeout(this.selectionTimer);
      window.clearTimeout(this.handshakeTimer);
      if (this.session) void this.closeSession(this.session);
      this.session = null;
      this.retireFrame('reload');
      this.instanceId = generateId();
      this.modelVersionId = null;
      this.loadId = null;
      this.ready = false;
      this.loaded = false;
      this.helloSeen = false;
      this.routeRequestId = null;
      this.activeLoadRequestId = null;
      this.selectionRevision = null;
      this.iframe = this.createFrame();
      this.options.container.append(this.iframe);
      this.handshakeTimer = window.setTimeout(() => this.fail('RUNTIME_TIMEOUT'), 10_000);
      this.emit('MODEL_LOADING');
      return new Promise<void>(finish => { this.queuedLoad = { modelVersionId, finish }; });
    }
    const generation = ++this.generation;
    ++this.routeGeneration;
    this.iframe.style.visibility = 'hidden';
    for (const pending of [...this.pending.values()]) {
      if (['LOAD_MODEL', 'SHOW_ROUTE'].includes(pending.envelope.type)) this.cancel(pending.envelope.requestId);
    }
    const previousSession = this.session;
    this.session = null;
    this.loaded = false;
    this.routeRequestId = null;
    this.clearPending();
    window.clearTimeout(this.renewTimer);
    window.clearTimeout(this.selectionTimer);
    for (const request of this.requests) request.abort();
    this.modelVersionId = modelVersionId;
    this.loadId = generateId();
    this.emit('MODEL_LOADING');
    if (previousSession) void this.closeSession(previousSession);
    try {
      const { selection } = await this.request<{ selection: ModelSelection }>(`/api/projects/${this.options.projectId}/model-versions`);
      if (this.disposed || generation !== this.generation) return;
      if (selection.activeModelVersionId !== modelVersionId) throw new ViewerAccessError('MODEL_SELECTION_CHANGED', 409);
      this.selectionRevision = selection.selectionRevision;
      const session = await this.request<ViewerSession>(sessionBase(this.options.projectId, modelVersionId), 'POST', { loadId: this.loadId });
      if (this.disposed || generation !== this.generation) { void this.closeSession(session); return; }
      if (!UUID.test(session.sessionId) || session.projectId !== this.options.projectId || session.modelVersionId !== modelVersionId || session.loadId !== this.loadId ||
        !Number.isFinite(Date.parse(session.expiresAt)) || !Number.isFinite(Date.parse(session.absoluteExpiresAt))) throw new Error('Invalid session response');
      this.session = session;
      this.activeLoadRequestId = this.send('LOAD_MODEL', { sessionId: session.sessionId }, 'MODEL_LOADED');
      this.scheduleRenew(generation);
      this.scheduleSelection(generation);
    } catch (error) {
      if (!this.disposed && generation === this.generation) this.fail(error instanceof ViewerAccessError ? error.code : 'SESSION_FAILED');
    }
  }

  private scheduleRenew(generation: number): void {
    this.renewTimer = window.setTimeout(() => void this.renew(generation), 180_000);
  }

  private async renew(generation: number): Promise<void> {
    const scope = this.lifecycleScope(generation);
    if (!scope) return;
    const session = scope.session;
    try {
      this.assertLifecycle(scope);
      if (Date.parse(session.absoluteExpiresAt) - Date.now() < 200_000) {
        await this.load(session.modelVersionId);
        return;
      }
      const renewed = await this.lifecycleRequest(scope, `${sessionBase(session.projectId, session.modelVersionId, session.sessionId)}renew`, 'POST', value => {
        if (!value || typeof value !== 'object') throw new Error('Invalid renewal');
        const result = value as ViewerSession;
        if (result.sessionId !== session.sessionId || result.projectId !== session.projectId || result.modelVersionId !== session.modelVersionId || result.loadId !== session.loadId
          || result.absoluteExpiresAt !== session.absoluteExpiresAt || typeof result.expiresAt !== 'string' || !Number.isFinite(Date.parse(result.expiresAt))
          || Date.parse(result.expiresAt) > Date.parse(session.absoluteExpiresAt)) throw new Error('Invalid renewal');
        if (Date.parse(result.expiresAt) <= Date.now()) throw new ViewerAccessError('SESSION_EXPIRED', 410);
        return result;
      });
      if (!this.currentLifecycle(scope)) return;
      this.session = renewed;
      this.scheduleRenew(generation);
    } catch (error) {
      if (this.currentLifecycle(scope)) this.fail(error instanceof ViewerAccessError && !transientLifecycleFailure(error) ? error.code : 'SESSION_RENEW_FAILED');
    }
  }

  private scheduleSelection(generation: number): void {
    window.clearTimeout(this.selectionTimer);
    this.selectionTimer = window.setTimeout(() => void this.checkSelection(generation), 30_000);
  }
  private async checkSelection(generation = this.generation): Promise<boolean> {
    const scope = this.lifecycleScope(generation);
    if (!scope) return false;
    const active = this.selectionCheck;
    if (active && this.currentLifecycle(active.scope)) return active.promise;
    window.clearTimeout(this.selectionTimer);
    const check = { scope, promise: this.performSelectionCheck(scope) };
    this.selectionCheck = check;
    void check.promise.finally(() => { if (this.selectionCheck === check) this.selectionCheck = null; });
    return check.promise;
  }

  private async performSelectionCheck(scope: LifecycleScope): Promise<boolean> {
    try {
      const selection = await this.lifecycleRequest(scope, `/api/projects/${this.options.projectId}/model-versions`, 'GET', value => {
        if (!value || typeof value !== 'object' || !('selection' in value) || !value.selection || typeof value.selection !== 'object') throw new Error('Invalid model selection');
        const result = value.selection as ModelSelection;
        if (!Number.isSafeInteger(result.selectionRevision) || result.selectionRevision < 0
          || result.activeModelVersionId !== null && (typeof result.activeModelVersionId !== 'string' || !UUID.test(result.activeModelVersionId))) throw new Error('Invalid model selection');
        return result;
      });
      if (!this.currentLifecycle(scope)) return false;
      if (selection.activeModelVersionId !== scope.modelVersionId || selection.selectionRevision !== scope.selectionRevision) throw new ViewerAccessError('MODEL_SELECTION_CHANGED', 409);
      this.scheduleSelection(scope.generation);
      return true;
    } catch (error) {
      if (this.currentLifecycle(scope)) this.fail(error instanceof ViewerAccessError && !transientLifecycleFailure(error) ? error.code : 'ACCESS_CHECK_FAILED');
      return false;
    }
  }
  private onFocus = (): void => { if (!document.hidden) void this.checkSelection(); };

  async showRoute(rawRouting: string, source: 'manual' | 'cable' = 'manual', cableId: string | null = null): Promise<string | null> {
    if (this.disposed || !this.loaded) throw new Error('Model is not ready');
    this.clearPending(['SHOW_ROUTE', 'ZOOM_ROUTE', 'CLEAR_ROUTE', 'BEGIN_COMPUTED_PATH', 'APPEND_COMPUTED_PATH', 'COMMIT_COMPUTED_PATH', 'PICK_POINT', 'READ_SELECTION', 'READ_TRAY_ROOT_SELECTION', 'SET_PATH_TRANSPARENCY', 'SHOW_LOCATION', 'SHOW_TRAY', 'START_MODEL_CAPTURE', 'READ_MODEL_CAPTURE', 'START_BARRIER_CAPTURE', 'READ_BARRIER_CAPTURE']);
    this.routeRequestId = null;
    const generation = ++this.routeGeneration;
    // Clear immediately, even for malformed input or a superseded access check.
    this.send('CLEAR_ROUTE', { reason: 'selection' }, 'ROUTE_CLEARED');
    if (!await this.checkSelection() || this.disposed || generation !== this.routeGeneration) return null;
    return this.send('SHOW_ROUTE', { rawRouting, source, cableId }, 'ROUTE_RESULT');
  }
  private routeGeneration = 0;
  /** Render the engine's exact ordered metre points; no browser route fitting. */
  async showComputedPath(path: ComputedPath): Promise<string | null> {
    if (this.disposed || !this.loaded) throw new Error('Model is not ready');
    if (!UUID.test(path.pathId) || !Array.isArray(path.points) || path.points.length < 1 || path.points.length > MAX_PATH_POINTS || !path.points.every(isCanonicalPoint) || !Array.isArray(path.objectIds) || path.objectIds.length > 512 || !path.objectIds.every(id => Number.isInteger(id) && id > 0 && id <= 2147483647) || new Set(path.objectIds).size !== path.objectIds.length) throw new Error('Invalid computed path');
    // Freeze caller-owned arrays before asynchronous selection and capability checks.
    const points = path.points.map(point => [...point]), objectIds = [...path.objectIds], pathId = path.pathId;
    this.clearPending(['SHOW_ROUTE', 'ZOOM_ROUTE', 'CLEAR_ROUTE', 'BEGIN_COMPUTED_PATH', 'APPEND_COMPUTED_PATH', 'COMMIT_COMPUTED_PATH', 'READ_SELECTION', 'READ_TRAY_ROOT_SELECTION', 'SET_PATH_TRANSPARENCY', 'SHOW_LOCATION', 'SHOW_TRAY', 'START_MODEL_CAPTURE', 'READ_MODEL_CAPTURE', 'START_BARRIER_CAPTURE', 'READ_BARRIER_CAPTURE']);
    this.routeRequestId = null;
    const generation = ++this.routeGeneration;
    // BEGIN clears the frame's previous route too. Do not arm its small-message
    // timer while a preceding whole-model visibility restoration still runs.
    await this.sendAsync('CLEAR_ROUTE', { reason: 'selection' }, 'ROUTE_CLEARED');
    if (this.disposed || generation !== this.routeGeneration) return null;
    if (!await this.checkSelection() || this.disposed || generation !== this.routeGeneration) return null;
    const begin = await this.sendAsync('BEGIN_COMPUTED_PATH', { pathId, pointCount: points.length, objectIds }, 'COMPUTED_PATH_UPDATED');
    if (begin.payload.pathId !== pathId || begin.payload.phase !== 'begun' || begin.payload.received !== 0) throw new Error('Computed path acknowledgement mismatch');
    for (let offset = 0; offset < points.length; offset += MAX_PATH_CHUNK_POINTS) {
      if (this.disposed || generation !== this.routeGeneration) return null;
      const chunk = points.slice(offset, offset + MAX_PATH_CHUNK_POINTS);
      const reply = await this.sendAsync('APPEND_COMPUTED_PATH', { pathId, offset, points: chunk }, 'COMPUTED_PATH_UPDATED');
      if (reply.payload.pathId !== pathId || reply.payload.phase !== 'appended' || reply.payload.received !== offset + chunk.length) throw new Error('Computed path acknowledgement mismatch');
    }
    if (!await this.checkSelection() || this.disposed || generation !== this.routeGeneration) return null;
    const committed = await this.sendAsync('COMMIT_COMPUTED_PATH', { pathId }, 'COMPUTED_PATH_UPDATED');
    if (committed.payload.pathId !== pathId || committed.payload.phase !== 'displayed' || committed.payload.received !== points.length) throw new Error('Computed path acknowledgement mismatch');
    return committed.requestId ?? null;
  }

  async pickPoint(): Promise<PickedPoint> {
    if (this.disposed || !this.loaded || !await this.checkSelection()) throw new Error('Model is not ready');
    const reply = await this.sendAsync('PICK_POINT', {}, 'POINT_PICKED');
    return reply.payload as unknown as PickedPoint;
  }

  async readModelObjects(cursor = 0, query = '', limit = 16): Promise<ViewerModelObjectsPage> {
    if (this.disposed || !this.loaded || !await this.checkSelection()) throw new Error('Model is not ready');
    const reply = await this.sendAsync('READ_MODEL_OBJECTS', { cursor, query, limit }, 'MODEL_OBJECTS');
    if (reply.payload.cursor !== cursor || reply.payload.query !== query) throw new Error('Model metadata acknowledgement mismatch');
    return reply.payload as unknown as ViewerModelObjectsPage;
  }

  async discoverPreparationObjects(request: PreparationDiscoveryRequest, options: {signal?:AbortSignal;isCurrent?:()=>boolean} = {}): Promise<PreparationDiscoveryPage> {
    if (!validatePreparationDiscoveryRequest(request)) throw new Error('Invalid project discovery scope');
    const input:PreparationDiscoveryRequest = JSON.parse(JSON.stringify(request)), generation = this.routeGeneration, instanceId = this.instanceId, modelId = this.modelVersionId, loadId = this.loadId;
    const current = () => { if (this.disposed || !this.loaded || options.signal?.aborted || options.isCurrent?.() === false || generation !== this.routeGeneration || instanceId !== this.instanceId || modelId !== this.modelVersionId || loadId !== this.loadId) throw new DOMException('Project discovery cancelled.','AbortError'); };
    current(); if (!await this.checkSelection()) throw new DOMException('Project discovery cancelled.','AbortError'); current();
    let requestId:string|undefined;
    const abort = () => { if (requestId && this.pending.has(requestId) && !this.disposed) this.cancel(requestId); };
    options.signal?.addEventListener('abort',abort,{once:true});
    try {
      current();
      const reply = await new Promise<ViewerEvent>((resolve,reject) => { try { requestId = this.send('READ_PREPARATION_OBJECTS', input as unknown as Record<string,unknown>, 'PREPARATION_OBJECTS',{resolve,reject}); } catch(error) { reject(error); } });
      current();
      const page = reply.payload;
      if (!validatePreparationDiscoveryPage(page) || page.mode !== input.mode || page.rootObjectId !== input.rootObjectId || page.cursor !== input.cursor || JSON.stringify(page.names) !== JSON.stringify(input.names) || page.objects.length > input.limit
        || JSON.stringify(page.rootObjectIds) !== JSON.stringify(input.rootObjectIds)
        || page.includeAnchors !== input.includeAnchors
        || input.visibilityScope&&page.visibilityScope.contentSha256!==input.visibilityScope.contentSha256) throw new Error('Project discovery acknowledgement mismatch');
      if (!await this.checkSelection()) throw new DOMException('Project discovery cancelled.','AbortError'); current();
      return page;
    } finally { options.signal?.removeEventListener('abort',abort); }
  }

  async readSelection(): Promise<ViewerSelection> {
    const generation = this.routeGeneration;
    if (this.disposed || !this.loaded || !await this.checkSelection() || this.disposed || generation !== this.routeGeneration) throw new Error('Model is not ready');
    const reply = await this.sendAsync('READ_SELECTION', {}, 'MODEL_SELECTION');
    return reply.payload as unknown as ViewerSelection;
  }

  async readTrayRootSelection(options: { quiet?: boolean } = {}): Promise<ViewerTrayRootSelection> {
    const generation = this.routeGeneration;
    if (this.disposed || !this.loaded || !await this.checkSelection() || this.disposed || generation !== this.routeGeneration) throw new Error('Model is not ready');
    const reply = await this.sendAsync('READ_TRAY_ROOT_SELECTION', {}, 'TRAY_ROOT_SELECTION', { quietRecoverableErrors: options.quiet === true });
    if (this.disposed || !this.loaded || generation !== this.routeGeneration || !await this.checkSelection()
      || this.disposed || generation !== this.routeGeneration) throw new Error('Model is not ready');
    return reply.payload as unknown as ViewerTrayRootSelection;
  }

  /** Reveal and focus one object without changing selection or route ownership. */
  async showLocation(sdkObjectId: number): Promise<void> {
    if (!Number.isSafeInteger(sdkObjectId) || sdkObjectId <= 0 || sdkObjectId > 2147483647) throw new Error('Invalid location object');
    const { instanceId, modelVersionId, loadId, selectionRevision, generation, routeGeneration } = this;
    const current = () => {
      if (this.disposed || !this.loaded || !modelVersionId || !loadId || this.instanceId !== instanceId || this.modelVersionId !== modelVersionId
        || this.loadId !== loadId || this.selectionRevision !== selectionRevision || this.generation !== generation || this.routeGeneration !== routeGeneration)
        throw new DOMException('Location display cancelled.', 'AbortError');
    };
    current();
    if (!await this.checkSelection()) throw new Error('Model is not ready');
    current();
    await this.sendAsync('SHOW_LOCATION', { sdkObjectId }, 'LOCATION_SHOWN');
    current();
  }

  /** Inspect resolved tray roots in Ghost mode, replacing the previous route display. */
  async showTray(sdkObjectIds: number[]): Promise<void> {
    if (!Array.isArray(sdkObjectIds) || sdkObjectIds.length === 0 || sdkObjectIds.length > 512) throw new Error('Invalid tray objects');
    const ids = [...sdkObjectIds];
    if (!ids.every(id => Number.isSafeInteger(id) && id > 0 && id <= 2147483647) || new Set(ids).size !== ids.length) throw new Error('Invalid tray objects');
    const { instanceId, modelVersionId, loadId, selectionRevision, generation } = this;
    let routeGeneration = this.routeGeneration;
    const current = () => {
      if (this.disposed || !this.loaded || !modelVersionId || !loadId || this.instanceId !== instanceId || this.modelVersionId !== modelVersionId
        || this.loadId !== loadId || this.selectionRevision !== selectionRevision || this.generation !== generation || this.routeGeneration !== routeGeneration)
        throw new DOMException('Tray display cancelled.', 'AbortError');
    };
    current();
    if (!await this.checkSelection()) throw new Error('Model is not ready');
    current();
    this.resetRouteRequests();
    routeGeneration = this.routeGeneration;
    this.trayDisplayGeneration = routeGeneration;
    await this.sendAsync('SHOW_TRAY', { sdkObjectIds: ids }, 'TRAY_SHOWN');
    current();
  }

  /** Restore the model and wait until the viewer confirms that Ghost was cleared. */
  async hideTray(): Promise<void> {
    // A newer route owns its own appearance; stale panel cleanup must leave it alone.
    if (this.trayDisplayGeneration !== this.routeGeneration) return;
    if (this.disposed || !this.loaded || !this.modelVersionId || !this.loadId) throw new Error('Model is not ready');
    const { generation, modelVersionId, loadId } = this;
    this.resetRouteRequests();
    const routeGeneration = this.routeGeneration;
    this.trayDisplayGeneration = routeGeneration;
    await this.sendAsync('CLEAR_ROUTE', { reason: 'user', preserveCamera: true }, 'ROUTE_CLEARED');
    if (this.disposed || !this.loaded || this.generation !== generation || this.modelVersionId !== modelVersionId
      || this.loadId !== loadId || this.routeGeneration !== routeGeneration) throw new DOMException('Tray display cancelled.', 'AbortError');
    this.trayDisplayGeneration = null;
  }

  async setPathTransparency(percent: number): Promise<void> {
    if (!Number.isSafeInteger(percent) || percent < 0 || percent > 100) throw new Error('Transparency must be an integer from 0 to 100');
    const routeRequestId = this.routeRequestId, generation = this.routeGeneration;
    if (!routeRequestId || this.disposed || !this.loaded || !await this.checkSelection() || this.disposed || generation !== this.routeGeneration || routeRequestId !== this.routeRequestId) throw new Error('No drawable route');
    await this.sendAsync('SET_PATH_TRANSPARENCY', { routeRequestId, percent }, 'PATH_TRANSPARENCY_UPDATED');
  }

  cancelPicking(): void {
    for (const pending of [...this.pending.values()]) if (pending.envelope.type === 'PICK_POINT') this.cancel(pending.envelope.requestId);
  }

  /** Small controls only. Geometry pages stay inside the protected cookie path;
   * a structural staging status never authorizes publication or cable writes. */
  private async barrierMultipartControl(type: string, payload: Record<string, unknown>, terminal: string): Promise<ViewerEvent> {
    if (this.disposed || !this.loaded || !this.loadId || !this.modelVersionId) throw new Error('Barrier observation is unavailable');
    const { instanceId, loadId, modelVersionId, selectionRevision } = this;
    const current = () => !this.disposed && this.loaded && this.instanceId === instanceId && this.loadId === loadId
      && this.modelVersionId === modelVersionId && this.selectionRevision === selectionRevision;
    if (!await this.checkSelection() || !current()) throw new Error('Barrier observation context changed');
    const result = await this.sendAsync(type, payload, terminal);
    if (!current() || !await this.checkSelection() || !current()) throw new Error('Barrier observation context changed');
    return result;
  }

  async readBarrierMultipartFrame(contentFingerprint: string): Promise<{ frameObservation: BarrierFrameObservation; producerProfile: BarrierMultipartProducerProfile }> {
    const request = { projectId: this.options.projectId, modelVersionId: this.modelVersionId, contentFingerprint };
    if (!validateBarrierMultipartFrameRequest(request)) throw new Error('Invalid barrier frame request');
    const result = await this.barrierMultipartControl('READ_BARRIER_MULTIPART_FRAME', request, 'BARRIER_MULTIPART_FRAME');
    if ((result.payload.frameObservation as BarrierFrameObservation).contentFingerprint !== contentFingerprint) throw new Error('Barrier observation frame changed');
    return result.payload as unknown as { frameObservation: BarrierFrameObservation; producerProfile: BarrierMultipartProducerProfile };
  }

  async startBarrierMultipart(request: BarrierMultipartStart): Promise<BarrierMultipartStatus> {
    if (!validateBarrierMultipartStart(request)) throw new Error('Invalid barrier observation request');
    const input = JSON.parse(JSON.stringify(request)) as BarrierMultipartStart;
    const result = await this.barrierMultipartControl('START_BARRIER_MULTIPART', input, 'BARRIER_MULTIPART_STATUS');
    if (result.payload.intentId !== input.intentId) throw new Error('Barrier observation response changed');
    return result.payload as unknown as BarrierMultipartStatus;
  }

  async barrierMultipartStatus(intentId: string, cancel = false): Promise<BarrierMultipartStatus> {
    const request = { intentId };
    if (!validateBarrierMultipartIntentControl(request)) throw new Error('Invalid barrier observation identity');
    const result = await this.barrierMultipartControl(cancel ? 'CANCEL_BARRIER_MULTIPART' : 'STATUS_BARRIER_MULTIPART', request, 'BARRIER_MULTIPART_STATUS');
    if (result.payload.intentId !== intentId) throw new Error('Barrier observation response changed');
    return result.payload as unknown as BarrierMultipartStatus;
  }

  async reconcileBarrierMultipart(intentId: string): Promise<BarrierMultipartStatus> {
    const request = { intentId };
    if (!validateBarrierMultipartIntentControl(request)) throw new Error('Invalid barrier observation identity');
    const result = await this.barrierMultipartControl('RECONCILE_BARRIER_MULTIPART', request, 'BARRIER_MULTIPART_STATUS');
    if (result.payload.intentId !== intentId) throw new Error('Barrier observation response changed');
    return result.payload as unknown as BarrierMultipartStatus;
  }

  /** Selected barrier geometry is a separate observation, never a ready certificate. */
  async captureBarriers(request: BarrierCaptureRequest, options: { signal?: AbortSignal; isCurrent?: () => boolean } = {}) {
    if (!validateBarrierCaptureRequest(request) || this.disposed || !this.loaded) throw new Error('Barrier capture is unavailable');
    const input: BarrierCaptureRequest = JSON.parse(JSON.stringify(request));
    this.clear('selection');
    const generation = this.routeGeneration, { instanceId, modelVersionId, loadId } = this;
    if (!loadId || !modelVersionId || input.scope.projectId !== this.options.projectId || input.scope.modelVersionId !== modelVersionId
      || input.scope.selectionRevision !== String(this.selectionRevision)) throw new Error('Barrier capture scope changed');
    const operation = new AbortController(); this.captureInputAbort = operation;
    const ownedRequests = new Set<string>();
    const abort = () => { operation.abort(); for (const pending of [...this.pending.values()])
      if (!this.disposed && ownedRequests.has(pending.envelope.requestId)) this.cancel(pending.envelope.requestId); };
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    const deadlineAt = Date.now() + CAPTURE_WALL_MILLISECONDS;
    let rejectDeadline!: (error: Error) => void;
    const deadline = new Promise<never>((_resolve, reject) => { rejectDeadline = reject; });
    void deadline.catch(() => {});
    const timer = window.setTimeout(() => { rejectDeadline(new Error('Barrier capture deadline exceeded')); abort(); }, CAPTURE_WALL_MILLISECONDS);
    const current = () => {
      if (this.disposed || operation.signal.aborted || options.isCurrent?.() === false || Date.now() >= deadlineAt
        || this.routeGeneration !== generation || this.instanceId !== instanceId || this.modelVersionId !== modelVersionId
        || this.loadId !== loadId || String(this.selectionRevision) !== input.scope.selectionRevision)
        throw new DOMException('Barrier capture cancelled or changed.', 'AbortError');
    };
    const bounded = async <T,>(invoke: () => Promise<T>) => { current(); const value = await Promise.race([invoke(), deadline]); current(); return value; };
    const round = (type: string, payload: Record<string, unknown>) => new Promise<ViewerEvent>((resolve, reject) => {
      try { ownedRequests.add(this.send(type, payload, 'BARRIER_CAPTURE_EVENT', { resolve, reject })); } catch (error) { reject(error); }
    });
    try {
      if (!await bounded(() => this.checkSelection())) throw new Error('Barrier model selection changed');
      const assembler = createBarrierCaptureAssembler({ expectedRequest: input, loadId, eventLimit: 3000 });
      let reply = await bounded(() => round('START_BARRIER_CAPTURE', { ...input }));
      for (let index = 0; index < 3000; index++) {
        current();
        if (reply.payload.captureId !== input.captureId || reply.payload.index !== index) throw new Error('Barrier capture reply mismatch');
        const event: unknown = JSON.parse(String(reply.payload.eventJson)); assembler.accept(event);
        if (reply.payload.done === true) {
          if ((event as { type?: string }).type !== 'complete') throw new Error('Barrier capture ended incompletely');
          const result = await bounded(() => assembler.finish());
          if (!await bounded(() => this.checkSelection())) throw new Error('Barrier model selection changed');
          return result;
        }
        reply = await bounded(() => round('READ_BARRIER_CAPTURE', { captureId: input.captureId, index: index + 1 }));
      }
      throw new Error('Barrier capture response budget exceeded');
    } catch (error) { abort(); throw error; }
    finally { window.clearTimeout(timer); options.signal?.removeEventListener('abort', abort); if (this.captureInputAbort === operation) this.captureInputAbort = null; }
  }

  /** The upload stays on the same-origin session cookie path. It cannot borrow a
   * different login/model/load, and an uncertain response is never retried here. */
  async publishBarriers(intentId: string, observation: Awaited<ReturnType<ViewerController['captureBarriers']>>, signal?: AbortSignal, onWriteStarted?: () => void, expectedCommand?: AnyBarrierCaptureCommand) {
    if (!UUID.test(intentId) || this.disposed || !this.loaded || !this.session || !await this.checkSelection()) throw new Error('Barrier publication is unavailable');
    const session = this.session, capture = barrierCaptureSchema.parse(observation.capture), frame = JSON.parse(JSON.stringify(observation.frameObservation)) as typeof observation.frameObservation;
    const command = expectedCommand === undefined ? null : supportedBarrierCaptureCommandSchema.parse(expectedCommand);
    const mixed = command?.schemaVersion === 'wfc.pf.barrier-capture-command.v2';
    if (command && (barrierCanonicalJson(command.scope) !== barrierCanonicalJson(capture.scope)
      || barrierCanonicalJson(command.selectedParents) !== barrierCanonicalJson(capture.selectedParents))) throw new Error('Barrier publication original command changed');
    const publicationGeneration = this.generation;
    const sameSession = () => {
      const live = this.session;
      return !this.disposed && this.loaded && this.generation === publicationGeneration && live !== null
        && live.sessionId === session.sessionId && live.projectId === session.projectId && live.modelVersionId === session.modelVersionId
        && live.loadId === session.loadId && live.absoluteExpiresAt === session.absoluteExpiresAt
        && this.modelVersionId === session.modelVersionId && this.loadId === session.loadId;
    };
    if (capture.captureId !== intentId || capture.scope.projectId !== session.projectId || capture.scope.modelVersionId !== session.modelVersionId
      || capture.scope.selectionRevision !== String(this.selectionRevision) || !validateBarrierFrameObservation(frame) || frame.loadId !== session.loadId
      || frame.projectId !== capture.scope.projectId || frame.modelVersionId !== capture.scope.modelVersionId
      || frame.contentFingerprint !== capture.scope.contentFingerprint) throw new Error('Barrier publication scope changed');
    const frameDigest = [...new Uint8Array(await digestSha256(new TextEncoder().encode(barrierCanonicalJson(barrierFrameObservationHashInput(frame)))))]
      .map(value => value.toString(16).padStart(2, '0')).join('');
    if (frameDigest !== frame.contentSha256 || !sameSession()) throw new Error('Barrier publication frame changed');
    if (new TextEncoder().encode(JSON.stringify(observation)).byteLength > BARRIER_LIMITS.captureBytes + 16 * 1024) throw new Error('Barrier publication exceeds its byte limit');
    const controller = new AbortController(); this.requests.add(controller);
    let rejectCancellation!: (error: Error) => void;
    const cancelled = new Promise<never>((_resolve, reject) => { rejectCancellation = reject; }); void cancelled.catch(() => {});
    const onCancelled = () => rejectCancellation(new DOMException('Barrier publication cancelled; reconcile its receipt before retrying.', 'AbortError'));
    controller.signal.addEventListener('abort', onCancelled, { once: true });
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    const timer = window.setTimeout(abort, 180_000);
    try {
      controller.signal.throwIfAborted();
      if (!sameSession() || String(this.selectionRevision) !== capture.scope.selectionRevision) throw new Error('Barrier publication context changed before upload');
      // Only this protected transport boundary can distinguish a local
      // preflight refusal from a PUT whose acknowledgement may be lost.
      onWriteStarted?.();
      const upload = viewerRequest<unknown>(
        sessionBase(session.projectId, session.modelVersionId, session.sessionId) + 'barriers/captures/' + intentId,
        this.options.token, { method: 'PUT', body: { capture, frameObservation: frame }, signal: controller.signal });
      const result = await Promise.race([upload, cancelled]);
      if (controller.signal.aborted || !sameSession()
        || String(this.selectionRevision) !== capture.scope.selectionRevision) throw new Error('Barrier publication response arrived after its context changed');
      const outcome = barrierPublicationOutcomeSchema.parse(result);
      if (outcome.schemaVersion === 'wfc.pf.barrier-publication-refusal.v1') {
        const captureDigest = [...new Uint8Array(await digestSha256(new TextEncoder().encode(barrierCanonicalJson(capture))))]
          .map(value => value.toString(16).padStart(2, '0')).join('');
        if (controller.signal.aborted || !sameSession() || String(this.selectionRevision) !== capture.scope.selectionRevision
          || outcome.intentId !== intentId || outcome.captureSha256 !== captureDigest || outcome.frameSha256 !== frameDigest)
          throw new Error('Barrier refusal receipt scope changed');
        if (command) {
          const commandDigest = [...new Uint8Array(await digestSha256(new TextEncoder().encode(barrierCanonicalJson(command))))]
            .map(value => value.toString(16).padStart(2, '0')).join('');
          if (controller.signal.aborted || !sameSession() || String(this.selectionRevision) !== capture.scope.selectionRevision
            || outcome.commandSha256 !== commandDigest) throw new Error('Barrier refusal original command changed');
        }
        return outcome;
      }
      const snapshot = barrierSnapshotReferenceSchema.parse(outcome.snapshot);
      if ((outcome.schemaVersion === 'wfc.pf.barrier-publication-receipt.v2') !== mixed
        || snapshot.mode !== (mixed ? 'mixed-mesh-set' : 'mesh-set')
        || barrierCanonicalJson(snapshot.scope) !== barrierCanonicalJson(capture.scope)) throw new Error('Barrier publication receipt scope changed');
      return outcome;
    } finally { window.clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', onCancelled); this.requests.delete(controller); }
  }

  async captureModel(request: ModelCaptureRequest, onProgress: (progress: ModelCaptureProgress) => void = () => {}, options: {signal?:AbortSignal;isCurrent?:()=>boolean} = {}): Promise<{ snapshot: unknown; summary: CompletedModelCaptureSummary }> {
    const timingStartedAt = captureTimingNow();
    const deadlineAt = Date.now() + CAPTURE_WALL_MILLISECONDS;
    const timing = { roundCount: 0, inputChunkCount: 0, eventCount: 0, roundWaitMs: 0, maxRoundWaitMs: 0,
      initialSelectionMs: 0, finalSelectionMs: 0, planningMs: 0, assemblyMs: 0, evidenceHashMs: 0 };
    type Phase = 'initialSelectionMs' | 'finalSelectionMs' | 'planningMs' | 'assemblyMs' | 'evidenceHashMs';
    const elapsed = (start: number) => { const value = captureTimingNow() - start; return Number.isFinite(value) ? Math.min(CAPTURE_TIMING_MAX_MILLISECONDS, Math.max(0, value)) : 0; };
    const measure = async <T,>(phase: Phase, invoke: () => Promise<T>): Promise<T> => {
      const start = captureTimingNow(); try { return await invoke(); } finally { timing[phase] += elapsed(start); }
    };
    const measureSync = <T,>(phase: Phase, invoke: () => T): T => {
      const start = captureTimingNow(); try { return invoke(); } finally { timing[phase] += elapsed(start); }
    };
    let outcome: ViewerCaptureTiming['outcome'] = 'refused';
    try {
      if (this.disposed || !this.loaded) throw new Error('Model is not ready');
      const input:ModelCaptureRequest = measureSync('planningMs', () => JSON.parse(JSON.stringify(request)));
      this.clear('selection', { preserveCamera: true }); const generation = this.routeGeneration;
      const operation = new AbortController(); this.captureInputAbort = operation;
      const abort = () => { operation.abort(); for (const pending of [...this.pending.values()]) if (['START_MODEL_CAPTURE','READ_MODEL_CAPTURE'].includes(pending.envelope.type) && !this.disposed) this.cancel(pending.envelope.requestId); };
      options.signal?.addEventListener('abort',abort,{once:true}); if (options.signal?.aborted) abort();
      const { instanceId, modelVersionId, loadId } = this;
      const deadlineError = new ViewerAccessError('EXTRACTION_FAILED', 0);
      let deadlineExpired = false, rejectDeadline!: (error: Error) => void;
      const deadline = new Promise<never>((_resolve, reject) => { rejectDeadline = reject; });
      // A synchronous boundary may detect expiry before the first awaited race.
      // Keep that rejection observed without allowing any late SDK work to resume.
      void deadline.catch(() => {});
      const expire = () => {
        if (deadlineExpired) return;
        deadlineExpired = true;
        outcome = 'deadline';
        rejectDeadline(deadlineError);
        abort();
      };
      const wallTimer = window.setTimeout(expire, Math.max(0, deadlineAt - Date.now()));
      const current = () => {
        if (deadlineExpired || Date.now() >= deadlineAt) { expire(); throw deadlineError; }
        if (this.disposed || operation.signal.aborted || options.isCurrent?.() === false || generation !== this.routeGeneration || instanceId !== this.instanceId || modelVersionId !== this.modelVersionId || loadId !== this.loadId)
          throw new DOMException('Model capture cancelled.', 'AbortError');
      };
      const bounded = async <T,>(invoke: () => Promise<T>): Promise<T> => {
        current(); const value = await Promise.race([invoke(), deadline]); current(); return value;
      };
      try {
        current();
        if (!await measure('initialSelectionMs', () => bounded(() => this.checkSelection()))) throw new DOMException('Model capture cancelled.', 'AbortError'); current();
        if (!modelVersionId || !loadId) throw new Error('Model capture identity is unavailable');
        const captureId = generateId(); let responses = 0, descriptor: ModelCaptureInputDescriptor | undefined, frozenRequest: ModelCaptureRequest | undefined;
        const round = async (type: string, payload: Record<string, unknown>, terminal: string) => {
          current(); if (++responses > 3000) throw new Error('Model capture exceeded its bounded response budget');
          timing.roundCount++;
          const start = captureTimingNow();
          try { const value = await bounded(() => this.sendAsync(type, payload, terminal)); current(); return value; }
          finally { const duration = elapsed(start); timing.roundWaitMs += duration; timing.maxRoundWaitMs = Math.max(timing.maxRoundWaitMs, duration); }
        };
        let reply: ViewerEvent;
        if (input.lookupRouteCodes) reply = await round('START_MODEL_CAPTURE', { captureId, ...input }, 'MODEL_CAPTURE_EVENT');
        else {
          const plan = await measure('planningMs', () => bounded(() => planModelCaptureInput(input, { captureId, envelopeIdentity: { instanceId, projectId: this.options.projectId, modelVersionId, loadId }, signal: operation.signal }))); current();
          descriptor = plan.descriptor; frozenRequest = plan.request;
          const acknowledged = (event: ViewerEvent, received: number) => {
            const ack = event.payload, ready = received === plan.descriptor.equipmentNameCount;
            if (!validateModelCaptureInputAck(ack) || ack.captureId !== captureId || ack.receivedNameCount !== received || ack.phase !== (ready ? 'ready' : 'receiving') ||
                ack.scopeSha256 !== (ready ? plan.descriptor.scopeSha256 : null) || ack.equipmentNamesSha256 !== (ready ? plan.descriptor.equipmentNamesSha256 : null))
              throw new Error('Model capture input acknowledgement mismatch');
          };
          acknowledged(await round('START_MODEL_CAPTURE', plan.startPayload, 'MODEL_CAPTURE_INPUT_ACK'), 0);
          for (const chunk of plan.chunks) {
            timing.inputChunkCount++;
            acknowledged(await round('READ_MODEL_CAPTURE', { ...chunk }, 'MODEL_CAPTURE_INPUT_ACK'), chunk.equipmentOffset + chunk.equipmentNames.length);
            onProgress({ index: responses - 1, type: 'input' });
          }
          reply = await round('READ_MODEL_CAPTURE', { captureId, index: 0 }, 'MODEL_CAPTURE_EVENT');
        }
        const assembler = createModelCaptureAssembler({ eventLimit: 3000 - (descriptor ? 1 + descriptor.chunkCount : 0) });
        for (let index = 0; index < 3000; index++) {
          current();
          const event: unknown = measureSync('assemblyMs', () => { const value: unknown = JSON.parse(String(reply.payload.eventJson)); assembler.accept(value); return value; });
          timing.eventCount++;
          const eventRecord = event as Record<string, unknown>;
          onProgress({ index, type: String(eventRecord.type), ...(typeof eventRecord.objectCount === 'number' ? { objectCount: eventRecord.objectCount } : {}) });
          if (reply.payload.done === true) {
            if (eventRecord.type !== 'complete') throw new Error('Model capture ended without a complete receipt');
            const { snapshot, summary } = measureSync('assemblyMs', () => {
              const snapshot = assembler.finish(), summary = assembler.summary();
              if (descriptor) {
                const inputScope = (snapshot as { capture?: { inputScope?: unknown } }).capture?.inputScope;
                if (!validateModelCaptureInputScope(inputScope) || Object.entries(descriptor).some(([key, value]) => inputScope[key as keyof typeof inputScope] !== value))
                  throw new Error('Completed model capture input scope mismatch');
                const scope = summary.scope as Record<string, unknown> | undefined;
                const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
                if (!scope || !frozenRequest || !equal(scope.equipmentNames, frozenRequest.equipmentNames) || !equal(scope.inputScope, inputScope) ||
                    (frozenRequest.preparationSlice ? !equal(scope.preparationSlice,frozenRequest.preparationSlice) : frozenRequest.routeRules ? !equal(scope.routeRules, frozenRequest.routeRules) : !equal(scope.routeCodes, frozenRequest.routeCodes?.map(code => '/' + code)) || !equal(scope.allowedCategories, frozenRequest.allowedCategories)))
                  throw new Error('Completed model capture request summary mismatch');
              }
              return { snapshot, summary };
            });
            if (!await measure('finalSelectionMs', () => bounded(() => this.checkSelection()))) throw new DOMException('Model capture cancelled.', 'AbortError'); current();
            if(summary.completedEvidence){
              const evidence=summary.completedEvidence;
              if(!await measure('evidenceHashMs', () => bounded(() => verifyCompletedCaptureEvidence(evidence)))||evidence.binding.loadId!==loadId||evidence.binding.captureId!==captureId||evidence.binding.projectId!==this.options.projectId||evidence.binding.modelVersionId!==modelVersionId)throw new Error('Completed capture evidence binding mismatch');
              const slice=input.preparationSlice;if(slice&&(evidence.binding.sessionId!==slice.sessionId||evidence.binding.partId!==slice.partId||evidence.binding.planSha256!==slice.planSha256||evidence.binding.coordinateFrameId!==slice.coordinateFrameId))throw new Error('Completed preparation evidence binding mismatch');
              summary.completedEvidence=await measure('evidenceHashMs', () => bounded(() => bindCompletedCaptureEvidence(evidence,{selectionRevision:String(this.selectionRevision),partPayloadSha256:null})));current();
            }else if(input.preparationSlice)throw new Error('Completed preparation capture evidence is missing');
            outcome = 'completed';
            return { snapshot, summary };
          }
          if (eventRecord.type === 'complete') throw new Error('Model capture completion mismatch');
          reply = await round('READ_MODEL_CAPTURE', { captureId, index: index + 1 }, 'MODEL_CAPTURE_EVENT');
        }
        throw new Error('Model capture exceeded its bounded event budget');
      } catch (error) { if (!this.disposed && generation === this.routeGeneration) this.clear('user', { preserveCamera: true }); throw deadlineExpired ? deadlineError : error; }
      finally { window.clearTimeout(wallTimer); options.signal?.removeEventListener('abort',abort); if (this.captureInputAbort === operation) this.captureInputAbort = null; }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') outcome = 'cancelled';
      throw error;
    } finally {
      // Never let diagnostics alter a capture result, including asynchronous or
      // throwing sinks. Values are bounded elapsed times, not CPU/acceptance claims.
      const result: ViewerCaptureTiming = Object.freeze({ outcome, wallMs: captureTimingValue(elapsed(timingStartedAt)),
        roundCount: captureTimingValue(timing.roundCount, 3000), inputChunkCount: captureTimingValue(timing.inputChunkCount, 3000), eventCount: captureTimingValue(timing.eventCount, 3000),
        roundWaitMs: captureTimingValue(timing.roundWaitMs), maxRoundWaitMs: captureTimingValue(timing.maxRoundWaitMs),
        initialSelectionMs: captureTimingValue(timing.initialSelectionMs), finalSelectionMs: captureTimingValue(timing.finalSelectionMs),
        planningMs: captureTimingValue(timing.planningMs), assemblyMs: captureTimingValue(timing.assemblyMs), evidenceHashMs: captureTimingValue(timing.evidenceHashMs) });
      try { void Promise.resolve(this.options.onCaptureTiming?.(result)).catch(() => {}); } catch { /* Optional diagnostics are isolated from the operation. */ }
    }
  }

  private resetRouteRequests(): void {
    this.captureInputAbort?.abort(); this.captureInputAbort = null;
    this.trayDisplayGeneration = null;
    ++this.routeGeneration;
    this.routeRequestId = null;
    this.clearPending(['SHOW_ROUTE', 'ZOOM_ROUTE', 'CLEAR_ROUTE', 'BEGIN_COMPUTED_PATH', 'APPEND_COMPUTED_PATH', 'COMMIT_COMPUTED_PATH', 'PICK_POINT', 'READ_SELECTION', 'READ_TRAY_ROOT_SELECTION', 'SET_PATH_TRANSPARENCY', 'SHOW_LOCATION', 'SHOW_TRAY', 'START_MODEL_CAPTURE', 'READ_MODEL_CAPTURE', 'START_BARRIER_CAPTURE', 'READ_BARRIER_CAPTURE']);
  }
  clear(reason: 'user' | 'empty' | 'selection' | 'model-change' | 'logout' = 'user', options: { preserveCamera?: boolean } = {}): string {
    this.resetRouteRequests();
    return this.send('CLEAR_ROUTE', { reason, ...(options.preserveCamera ? { preserveCamera: true } : {}) }, 'ROUTE_CLEARED');
  }
  zoom(): string {
    if (!this.routeRequestId) throw new Error('No drawable route');
    return this.send('ZOOM_ROUTE', { routeRequestId: this.routeRequestId }, 'ROUTE_ZOOMED');
  }
  cancel(targetRequestId: string): string {
    if (this.activeLoadRequestId === targetRequestId) this.activeLoadRequestId = null;
    const target = this.pending.get(targetRequestId);
    if (target) { window.clearTimeout(target.timer); this.pending.delete(targetRequestId); target.reject?.(new DOMException('Viewer request cancelled.', 'AbortError')); }
    return this.send('CANCEL_REQUEST', { targetRequestId }, 'REQUEST_CANCELLED');
  }
  private async closeSession(session: ViewerSession): Promise<void> {
    try { await viewerRequest<void>(sessionBase(session.projectId, session.modelVersionId, session.sessionId).slice(0, -1), this.options.token, { method: 'DELETE', signal: AbortSignal.timeout(5_000) }); }
    catch { /* Parent no longer renews; server TTL is bounded to five minutes. */ }
  }
  private fail(code: string): void {
    this.emit('ERROR', { code, message: '3D access has ended. Check your access and load the model again.', retryable: true, operation: 'viewer' });
    this.dispose('reload');
  }
  dispose(reason: 'unmount' | 'project-change' | 'logout' | 'reload' = 'unmount'): void {
    this.captureInputAbort?.abort(); this.captureInputAbort = null;
    if (this.disposed) return;
    this.disposed = true;
    this.cancelLifecycle();
    ++this.generation;
    ++this.routeGeneration;
    this.loaded = false;
    this.clearPending();
    window.clearTimeout(this.handshakeTimer);
    window.clearTimeout(this.renewTimer);
    window.clearTimeout(this.selectionTimer);
    this.unwatch();
    window.removeEventListener('message', this.onMessage);
    window.removeEventListener('focus', this.onFocus);
    document.removeEventListener('visibilitychange', this.onFocus);
    for (const request of this.requests) request.abort();
    this.requests.clear();
    const session = this.session;
    this.session = null;
    if (session) void this.closeSession(session);
    this.queuedLoad?.finish();
    this.queuedLoad = null;
    this.retireFrame(reason);
  }

  private retireFrame(reason: 'unmount' | 'project-change' | 'logout' | 'reload'): void {
    const iframe = this.iframe;
    const requestId = generateId();
    const { instanceId, modelVersionId, loadId } = this;
    const message = { channel: 'wfc-routings-viewer', protocolVersion: 1, instanceId,
      projectId: this.options.projectId, modelVersionId, loadId,
      requestId, type: 'DISPOSE', payload: { reason } };
    iframe.style.display = 'none';
    iframe.style.visibility = 'hidden';
    const remove = () => {
      window.clearTimeout(deadline);
      window.removeEventListener('message', acknowledged);
      iframe.remove();
    };
    const acknowledged = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== iframe.contentWindow) return;
      const ack = validateEnvelope(event.data, 'frame-to-parent');
      if (ack?.type === 'DISPOSED' && ack.requestId === requestId && ack.instanceId === instanceId && ack.projectId === this.options.projectId && ack.modelVersionId === modelVersionId && ack.loadId === loadId) remove();
    };
    const deadline = window.setTimeout(remove, 2_000);
    window.addEventListener('message', acknowledged);
    iframe.contentWindow?.postMessage(message, location.origin);
  }
}
