import { FRAME_PATH, validateEnvelope, type BridgeEnvelope } from '../../viewer-runtime/protocol.mjs';
import { watchViewerLogin } from './loginLifecycle';
import { sessionBase, viewerRequest, ViewerAccessError, type ViewerSession, type ModelSelection } from './sessionApi';

type Pending = { envelope: BridgeEnvelope; terminal: string; timer: number };
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
      this.fail(pending.envelope.type === 'LOAD_MODEL' ? 'MODEL_TIMEOUT' : 'REQUEST_TIMEOUT');
    }, pending.envelope.type === 'LOAD_MODEL' ? 60_000 : 10_000);
  }

  private send(type: string, payload: Record<string, unknown>, terminal: string): string {
    if (this.disposed) throw new Error('Viewer disposed');
    const envelope = {
      channel: 'wfc-routings-viewer', protocolVersion: 1, instanceId: this.instanceId,
      projectId: this.options.projectId, modelVersionId: this.modelVersionId,
      loadId: this.loadId, requestId: uuid(), type, payload,
    } as BridgeEnvelope;
    if (!validateEnvelope(envelope, 'parent-to-frame')) throw new Error('Invalid Viewer command');
    const pending: Pending = { envelope, terminal, timer: 0 };
    this.pending.set(envelope.requestId, pending);
    this.arm(pending);
    this.iframe.contentWindow?.postMessage(envelope, window.location.origin);
    return envelope.requestId;
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
    if (message.type === 'WARNING') { this.emit(message.type, message.payload, message.requestId, identity); return; }
    if (message.type !== pending.terminal && message.type !== 'ERROR') return;
    window.clearTimeout(pending.timer);
    this.pending.delete(message.requestId);
    if (message.type === 'ERROR') {
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
    this.emit(message.type, message.payload, message.requestId, identity);
  };

  private clearPending(types?: string[]): void {
    for (const [id, pending] of this.pending) {
      if (!types || types.includes(pending.envelope.type)) {
        window.clearTimeout(pending.timer);
        this.pending.delete(id);
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
    this.clearPending(['SHOW_ROUTE', 'ZOOM_ROUTE', 'CLEAR_ROUTE']);
    this.routeRequestId = null;
    const generation = ++this.routeGeneration;
    // Clear immediately, even for malformed input or a superseded access check.
    this.send('CLEAR_ROUTE', { reason: 'selection' }, 'ROUTE_CLEARED');
    if (!await this.checkSelection() || this.disposed || generation !== this.routeGeneration) return null;
    return this.send('SHOW_ROUTE', { rawRouting, source, cableId }, 'ROUTE_RESULT');
  }
  private routeGeneration = 0;
  clear(reason: 'user' | 'empty' | 'selection' | 'model-change' | 'logout' = 'user'): string {
    ++this.routeGeneration;
    this.routeRequestId = null;
    this.clearPending(['SHOW_ROUTE', 'ZOOM_ROUTE', 'CLEAR_ROUTE']);
    return this.send('CLEAR_ROUTE', { reason }, 'ROUTE_CLEARED');
  }
  zoom(): string {
    if (!this.routeRequestId) throw new Error('No drawable route');
    return this.send('ZOOM_ROUTE', { routeRequestId: this.routeRequestId }, 'ROUTE_ZOOMED');
  }
  cancel(targetRequestId: string): string {
    if (this.activeLoadRequestId === targetRequestId) this.activeLoadRequestId = null;
    const target = this.pending.get(targetRequestId);
    if (target) { window.clearTimeout(target.timer); this.pending.delete(targetRequestId); }
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
