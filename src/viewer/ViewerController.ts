import { FRAME_PATH, MAX_PATH_POINTS, MAX_PATH_CHUNK_POINTS, isCanonicalPoint, validateEnvelope, type BridgeEnvelope, type ComputedPath, type PickedPoint, type ViewerModelObjectsPage, type ViewerSelection, type ModelCaptureRequest, type ModelCaptureProgress } from '../../viewer-runtime/protocol.mjs';
import { createModelCaptureAssembler } from '../../viewer-runtime/model-capture.mjs';
import { bindCompletedCaptureEvidence,verifyCompletedCaptureEvidence,type CompletedModelCaptureSummary } from '../../viewer-runtime/capture-evidence.mjs';
import { CAPTURE_INPUT_LIMITS, planModelCaptureInput, validateModelCaptureInputAck, validateModelCaptureInputScope, type ModelCaptureInputDescriptor } from '../../viewer-runtime/capture-input.mjs';
import { validatePreparationDiscoveryRequest, validatePreparationDiscoveryPage, type PreparationDiscoveryRequest, type PreparationDiscoveryPage } from '../../viewer-runtime/preparation-input.mjs';
import { watchViewerLogin } from './loginLifecycle';
import { sessionBase, viewerRequest, ViewerAccessError, type ViewerSession, type ModelSelection } from './sessionApi';

type Pending = { envelope: BridgeEnvelope; terminal: string; timer: number; resolve?: (event: ViewerEvent) => void; reject?: (error: Error) => void };
export type ViewerEventIdentity = Readonly<Pick<BridgeEnvelope, 'protocolVersion' | 'instanceId' | 'projectId' | 'modelVersionId' | 'loadId' | 'requestId'>>;
export type ViewerLoadSnapshot = Readonly<{
  instanceId: string; projectId: string; modelVersionId: string; loadId: string;
  selectionRevision: number; ready: boolean;
}>;
export type ViewerEvent = { type: string; payload: Record<string, unknown>; requestId?: string; identity?: ViewerEventIdentity };
export type ViewerOptions = {
  container: HTMLElement; projectId: string; token: string;
  onEvent: (event: ViewerEvent) => void;
};
const uuid = () => crypto.randomUUID();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Starts at captureModel entry, including authorization, input staging and output
// assembly. The frame retains its own 300s limit; this adds only the existing
// 15s access-check/transport allowance and is never renewed by progress replies.
const CAPTURE_WALL_MILLISECONDS = CAPTURE_INPUT_LIMITS.milliseconds + 15_000;

/** One controller owns one iframe, login, project and current load. */
export class ViewerController {
  instanceId = uuid();
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
      pending.reject?.(new Error('Viewer request timed out'));
      this.fail(pending.envelope.type === 'LOAD_MODEL' ? 'MODEL_TIMEOUT' : 'REQUEST_TIMEOUT');
    // A discovery page may build the bounded model-wide property index (300s
    // inside the frame). Allow its terminal reply to arrive before failing load.
    }, pending.envelope.type === 'READ_PREPARATION_OBJECTS' ? 310_000 : ['START_MODEL_CAPTURE', 'READ_MODEL_CAPTURE'].includes(pending.envelope.type) ? 125_000 : ['LOAD_MODEL', 'READ_MODEL_OBJECTS', 'READ_SELECTION'].includes(pending.envelope.type) ? 60_000 : pending.envelope.type === 'PICK_POINT' ? 125_000 : 10_000);
  }

  private send(type: string, payload: Record<string, unknown>, terminal: string, callbacks: Pick<Pending, 'resolve' | 'reject'> = {}): string {
    if (this.disposed) throw new Error('Viewer disposed');
    const envelope = {
      channel: 'wfc-routings-viewer', protocolVersion: 1, instanceId: this.instanceId,
      projectId: this.options.projectId, modelVersionId: this.modelVersionId,
      loadId: this.loadId, requestId: uuid(), type, payload,
    } as BridgeEnvelope;
    if (!validateEnvelope(envelope, 'parent-to-frame')) throw new Error('Invalid Viewer command');
    const pending: Pending = { envelope, terminal, timer: 0, ...callbacks };
    this.pending.set(envelope.requestId, pending);
    this.arm(pending);
    this.iframe.contentWindow?.postMessage(envelope, window.location.origin);
    return envelope.requestId;
  }

  private sendAsync(type: string, payload: Record<string, unknown>, terminal: string): Promise<ViewerEvent> {
    return new Promise((resolve, reject) => { try { this.send(type, payload, terminal, { resolve, reject }); } catch (error) { reject(error); } });
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
    if (message.type === 'WARNING') { this.emit(message.type, message.payload, message.requestId, identity); return; }
    if (message.type !== pending.terminal && message.type !== 'ERROR') return;
    window.clearTimeout(pending.timer);
    this.pending.delete(message.requestId);
    if (message.type === 'ERROR') {
      pending.reject?.(new ViewerAccessError(String(message.payload.code), 0));
      if (pending.envelope.type === 'LOAD_MODEL' || ['SESSION_EXPIRED', 'ACCESS_REVOKED', 'MODEL_SELECTION_CHANGED', 'MODEL_UNAVAILABLE', 'RESOURCE_FAILED'].includes(String(message.payload.code))) {
        this.fail(String(message.payload.code));
      } else this.emit('ERROR', message.payload, message.requestId, identity);
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
    if (message.type === 'PATH_TRANSPARENCY_UPDATED' && (message.payload.routeRequestId !== pending.envelope.payload.routeRequestId || message.payload.percent !== pending.envelope.payload.percent)) {
      pending.reject?.(new Error('Path transparency acknowledgement mismatch')); return;
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

  async load(modelVersionId: string): Promise<void> {
    if (this.disposed || !this.ready && !this.queuedLoad) throw new Error('Viewer runtime is not ready');
    if (!UUID.test(modelVersionId)) throw new Error('Invalid model version ID');
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
      this.instanceId = uuid();
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
    this.loadId = uuid();
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
    const session = this.session;
    if (this.disposed || generation !== this.generation || !session) return;
    try {
      if (Date.parse(session.absoluteExpiresAt) - Date.now() < 200_000) {
        await this.load(session.modelVersionId);
        return;
      }
      const renewed = await this.request<ViewerSession>(`${sessionBase(session.projectId, session.modelVersionId, session.sessionId)}renew`, 'POST', {});
      if (this.disposed || generation !== this.generation) return;
      if (renewed.sessionId !== session.sessionId || renewed.projectId !== session.projectId || renewed.modelVersionId !== session.modelVersionId || renewed.loadId !== session.loadId ||
        renewed.absoluteExpiresAt !== session.absoluteExpiresAt || !Number.isFinite(Date.parse(renewed.expiresAt))) throw new Error('Invalid renewal');
      this.session = renewed;
      this.scheduleRenew(generation);
    } catch (error) {
      if (!this.disposed && generation === this.generation) this.fail(error instanceof ViewerAccessError ? error.code : 'SESSION_RENEW_FAILED');
    }
  }

  private scheduleSelection(generation: number): void {
    window.clearTimeout(this.selectionTimer);
    this.selectionTimer = window.setTimeout(() => void this.checkSelection(generation), 30_000);
  }
  private async checkSelection(generation = this.generation): Promise<boolean> {
    if (this.disposed || !this.session) return false;
    window.clearTimeout(this.selectionTimer);
    try {
      const { selection } = await this.request<{ selection: ModelSelection }>(`/api/projects/${this.options.projectId}/model-versions`);
      if (this.disposed || generation !== this.generation) return false;
      if (selection.activeModelVersionId !== this.modelVersionId || selection.selectionRevision !== this.selectionRevision) throw new ViewerAccessError('MODEL_SELECTION_CHANGED', 409);
      this.scheduleSelection(generation);
      return true;
    } catch (error) {
      if (!this.disposed && generation === this.generation) this.fail(error instanceof ViewerAccessError ? error.code : 'ACCESS_CHECK_FAILED');
      return false;
    }
  }
  private onFocus = (): void => { if (!document.hidden) void this.checkSelection(); };

  async showRoute(rawRouting: string, source: 'manual' | 'cable' = 'manual', cableId: string | null = null): Promise<string | null> {
    if (this.disposed || !this.loaded) throw new Error('Model is not ready');
    this.clearPending(['SHOW_ROUTE', 'ZOOM_ROUTE', 'CLEAR_ROUTE', 'BEGIN_COMPUTED_PATH', 'APPEND_COMPUTED_PATH', 'COMMIT_COMPUTED_PATH', 'PICK_POINT', 'READ_SELECTION', 'SET_PATH_TRANSPARENCY', 'START_MODEL_CAPTURE', 'READ_MODEL_CAPTURE']);
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
    this.clearPending(['SHOW_ROUTE', 'ZOOM_ROUTE', 'CLEAR_ROUTE', 'BEGIN_COMPUTED_PATH', 'APPEND_COMPUTED_PATH', 'COMMIT_COMPUTED_PATH', 'READ_SELECTION', 'SET_PATH_TRANSPARENCY', 'START_MODEL_CAPTURE', 'READ_MODEL_CAPTURE']);
    this.routeRequestId = null;
    const generation = ++this.routeGeneration;
    this.send('CLEAR_ROUTE', { reason: 'selection' }, 'ROUTE_CLEARED');
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
      if (!validatePreparationDiscoveryPage(page) || page.mode !== input.mode || page.rootObjectId !== input.rootObjectId || page.cursor !== input.cursor || JSON.stringify(page.names) !== JSON.stringify(input.names) || page.objects.length > input.limit) throw new Error('Project discovery acknowledgement mismatch');
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

  async setPathTransparency(percent: number): Promise<void> {
    if (!Number.isSafeInteger(percent) || percent < 0 || percent > 100) throw new Error('Transparency must be an integer from 0 to 100');
    const routeRequestId = this.routeRequestId, generation = this.routeGeneration;
    if (!routeRequestId || this.disposed || !this.loaded || !await this.checkSelection() || this.disposed || generation !== this.routeGeneration || routeRequestId !== this.routeRequestId) throw new Error('No drawable route');
    await this.sendAsync('SET_PATH_TRANSPARENCY', { routeRequestId, percent }, 'PATH_TRANSPARENCY_UPDATED');
  }

  cancelPicking(): void {
    for (const pending of [...this.pending.values()]) if (pending.envelope.type === 'PICK_POINT') this.cancel(pending.envelope.requestId);
  }

  async captureModel(request: ModelCaptureRequest, onProgress: (progress: ModelCaptureProgress) => void = () => {}, options: {signal?:AbortSignal;isCurrent?:()=>boolean} = {}): Promise<{ snapshot: unknown; summary: CompletedModelCaptureSummary }> {
    if (this.disposed || !this.loaded) throw new Error('Model is not ready');
    const deadlineAt = Date.now() + CAPTURE_WALL_MILLISECONDS;
    const input:ModelCaptureRequest = JSON.parse(JSON.stringify(request));
    this.clear('selection'); const generation = this.routeGeneration;
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
      if (!await bounded(() => this.checkSelection())) throw new DOMException('Model capture cancelled.', 'AbortError'); current();
      if (!modelVersionId || !loadId) throw new Error('Model capture identity is unavailable');
      const captureId = uuid(); let responses = 0, descriptor: ModelCaptureInputDescriptor | undefined, frozenRequest: ModelCaptureRequest | undefined;
      const round = async (type: string, payload: Record<string, unknown>, terminal: string) => {
        current(); if (++responses > 3000) throw new Error('Model capture exceeded its bounded response budget');
        const value = await bounded(() => this.sendAsync(type, payload, terminal)); current(); return value;
      };
      let reply: ViewerEvent;
      if (input.lookupRouteCodes) reply = await round('START_MODEL_CAPTURE', { captureId, ...input }, 'MODEL_CAPTURE_EVENT');
      else {
        const plan = await bounded(() => planModelCaptureInput(input, { captureId, envelopeIdentity: { instanceId, projectId: this.options.projectId, modelVersionId, loadId }, signal: operation.signal })); current();
        descriptor = plan.descriptor; frozenRequest = plan.request;
        const acknowledged = (event: ViewerEvent, received: number) => {
          const ack = event.payload, ready = received === plan.descriptor.equipmentNameCount;
          if (!validateModelCaptureInputAck(ack) || ack.captureId !== captureId || ack.receivedNameCount !== received || ack.phase !== (ready ? 'ready' : 'receiving') ||
              ack.scopeSha256 !== (ready ? plan.descriptor.scopeSha256 : null) || ack.equipmentNamesSha256 !== (ready ? plan.descriptor.equipmentNamesSha256 : null))
            throw new Error('Model capture input acknowledgement mismatch');
        };
        acknowledged(await round('START_MODEL_CAPTURE', plan.startPayload, 'MODEL_CAPTURE_INPUT_ACK'), 0);
        for (const chunk of plan.chunks) {
          acknowledged(await round('READ_MODEL_CAPTURE', { ...chunk }, 'MODEL_CAPTURE_INPUT_ACK'), chunk.equipmentOffset + chunk.equipmentNames.length);
          onProgress({ index: responses - 1, type: 'input' });
        }
        reply = await round('READ_MODEL_CAPTURE', { captureId, index: 0 }, 'MODEL_CAPTURE_EVENT');
      }
      const assembler = createModelCaptureAssembler({ eventLimit: 3000 - (descriptor ? 1 + descriptor.chunkCount : 0) });
      for (let index = 0; index < 3000; index++) {
        current();
        const event: unknown = JSON.parse(String(reply.payload.eventJson));
        assembler.accept(event);
        const eventRecord = event as Record<string, unknown>;
        onProgress({ index, type: String(eventRecord.type), ...(typeof eventRecord.objectCount === 'number' ? { objectCount: eventRecord.objectCount } : {}) });
        if (reply.payload.done === true) {
          if (eventRecord.type !== 'complete') throw new Error('Model capture ended without a complete receipt');
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
          if (!await bounded(() => this.checkSelection())) throw new DOMException('Model capture cancelled.', 'AbortError'); current();
          if(summary.completedEvidence){
            const evidence=summary.completedEvidence;
            if(!await bounded(() => verifyCompletedCaptureEvidence(evidence))||evidence.binding.loadId!==loadId||evidence.binding.captureId!==captureId||evidence.binding.projectId!==this.options.projectId||evidence.binding.modelVersionId!==modelVersionId)throw new Error('Completed capture evidence binding mismatch');
            const slice=input.preparationSlice;if(slice&&(evidence.binding.sessionId!==slice.sessionId||evidence.binding.partId!==slice.partId||evidence.binding.planSha256!==slice.planSha256||evidence.binding.coordinateFrameId!==slice.coordinateFrameId))throw new Error('Completed preparation evidence binding mismatch');
            summary.completedEvidence=await bounded(() => bindCompletedCaptureEvidence(evidence,{selectionRevision:String(this.selectionRevision),partPayloadSha256:null}));current();
          }else if(input.preparationSlice)throw new Error('Completed preparation capture evidence is missing');
          return { snapshot, summary };
        }
        if (eventRecord.type === 'complete') throw new Error('Model capture completion mismatch');
        reply = await round('READ_MODEL_CAPTURE', { captureId, index: index + 1 }, 'MODEL_CAPTURE_EVENT');
      }
      throw new Error('Model capture exceeded its bounded event budget');
    } catch (error) { if (!this.disposed && generation === this.routeGeneration) this.clear('user'); throw deadlineExpired ? deadlineError : error; }
    finally { window.clearTimeout(wallTimer); options.signal?.removeEventListener('abort',abort); if (this.captureInputAbort === operation) this.captureInputAbort = null; }
  }

  clear(reason: 'user' | 'empty' | 'selection' | 'model-change' | 'logout' = 'user'): string {
    this.captureInputAbort?.abort(); this.captureInputAbort = null;
    ++this.routeGeneration;
    this.routeRequestId = null;
    this.clearPending(['SHOW_ROUTE', 'ZOOM_ROUTE', 'CLEAR_ROUTE', 'BEGIN_COMPUTED_PATH', 'APPEND_COMPUTED_PATH', 'COMMIT_COMPUTED_PATH', 'PICK_POINT', 'READ_SELECTION', 'SET_PATH_TRANSPARENCY', 'START_MODEL_CAPTURE', 'READ_MODEL_CAPTURE']);
    return this.send('CLEAR_ROUTE', { reason }, 'ROUTE_CLEARED');
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
    const requestId = uuid();
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
