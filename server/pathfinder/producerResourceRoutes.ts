import { Router, type Request, type Response } from 'express';
import { pipeline } from 'node:stream/promises';
import type { ModelResourceReader } from '../modelRegistry/storage.js';
import { ModelStorageError } from '../modelRegistry/storage.js';
import { requireViewerOrigin, resourceManifestPath, resourceRange, validateViewerQuery, viewerHttpPolicy, type ViewerHttpPolicy } from '../viewerSessions/http.js';
import { ViewerSessionError, viewerError } from '../viewerSessions/errors.js';
import { viewerUuid } from '../viewerSessions/service.js';
import { PRODUCER_RESOURCE_CAPABILITY_HEADER, PRODUCER_RESOURCE_LIMITS } from '../../shared/pathfinderProducerResource.js';
import { PathFinderError } from './errors.js';
import type { ProducerResourceIdentity, ProducerResourceService } from './producerResourceService.js';

/** Root may inject run/resource/storage from the existing bounded Viewer runtime. */
export type ProducerResourceRuntime = {
  service: ProducerResourceService; storage: ModelResourceReader;
  run<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T>;
  resource<T>(bytes: number, work: () => Promise<T>): Promise<T>;
};
function headers(res: Response): void {
  res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
}
function capability(req: Request): string {
  const name = PRODUCER_RESOURCE_CAPABILITY_HEADER.toLowerCase(); let count = 0;
  for (let i = 0; i < req.rawHeaders.length; i += 2) if (req.rawHeaders[i].toLowerCase() === name) count++;
  const value = req.header(PRODUCER_RESOURCE_CAPABILITY_HEADER);
  if (count !== 1 || !/^[A-Za-z0-9_-]{43}$(?![\s\S])/.test(value ?? '') || req.header('authorization') !== undefined || req.header('cookie') !== undefined) throw new ViewerSessionError('AUTH_REQUIRED', 401);
  return value!;
}
function encodedJson(value: unknown): Buffer {
  const bytes = Buffer.from(JSON.stringify(value));
  if (bytes.length > PRODUCER_RESOURCE_LIMITS.descriptorBytes) throw new ViewerSessionError('PRODUCER_RESOURCE_BUDGET', 429);
  return bytes;
}
function json(req: Request, res: Response, bytes: Buffer): void {
  res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Content-Length', bytes.length); res.status(200).end(req.method === 'HEAD' ? undefined : bytes);
}
/** Mounted before human middleware. Only this separate capture-capability family is claimed. */
export function createProducerResourceRouter(options: { runtime: ProducerResourceRuntime; policy?: ViewerHttpPolicy }): Router {
  const router = Router(), { runtime } = options, policy = options.policy ?? viewerHttpPolicy();
  router.use((req, res, next) => {
    const raw = req.originalUrl.split('?')[0];
    if (!/^\/api\/projects\/[^/]+\/model-versions\/[^/]+\/producer-sessions(?:\/|$)/i.test(raw)) { next(); return; }
    headers(res); const disconnected = new AbortController();
    const onDisconnect = () => { if (!res.writableFinished) disconnected.abort(); }; res.once('close', onDisconnect);
    void runtime.run(async stopping => {
      const signal = AbortSignal.any([stopping, disconnected.signal]); signal.throwIfAborted();
      const secure = requireViewerOrigin(req, policy, false).secure;
      if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); throw new ViewerSessionError('METHOD_NOT_ALLOWED', 405); }
      const scope = /^\/api\/projects\/([^/]+)\/model-versions\/([^/]+)\/producer-sessions\/([^/]+)(?:\/.*)?$/.exec(raw);
      if (!scope) throw new ViewerSessionError('RESOURCE_NOT_FOUND', 404);
      const projectId = viewerUuid(scope[1]), modelVersionId = viewerUuid(scope[2]), sessionId = viewerUuid(scope[3]);
      const identity: ProducerResourceIdentity = { projectId, modelVersionId, sessionId, capability: capability(req) };
      // Charge every admitted capability request, including unknown actions,
      // denied query/path/range and failed resource I/O. Rechecks never charge.
      runtime.service.reserveRequest(identity);
      const match = /^\/api\/projects\/([^/]+)\/model-versions\/([^/]+)\/producer-sessions\/([^/]+)\/(descriptor|resources|pathfinder-authorization)(?:\/(.*))?$/.exec(raw);
      if (!match) throw new ViewerSessionError('RESOURCE_NOT_FOUND', 404);
      validateViewerQuery(req.originalUrl, match[4] === 'resources' ? `${secure ? 'https' : 'http'}://${req.header('host')}` : undefined);
      if (match[4] === 'pathfinder-authorization') {
        if (match[5] !== undefined) throw new ViewerSessionError('RESOURCE_NOT_FOUND', 404);
        const value = await runtime.service.authorizePathFinder(identity, signal), bytes = encodedJson(value);
        const current = await runtime.service.authorizePathFinder(identity, signal);
        if (current.loadId !== value.loadId) throw new ViewerSessionError('SESSION_REVOKED', 410);
        signal.throwIfAborted(); runtime.service.reserveResponse(identity, req.method === 'HEAD' ? 0 : bytes.length); json(req, res, bytes); return;
      }
      const authorized = await runtime.service.authorizeResource(identity, signal);
      if (match[4] !== 'resources') {
        if (match[5] !== undefined) throw new ViewerSessionError('RESOURCE_NOT_FOUND', 404);
        const value = {
          projectId, modelVersionId, loadId: authorized.session.loadId, contentFingerprint: authorized.version.contentFingerprint,
          supportProfile: authorized.version.supportProfile, format: authorized.version.format, sdkVersion: authorized.version.sdkVersion,
          entrypoint: authorized.version.entrypoint, resourceCount: authorized.version.resourceCount, totalBytes: authorized.version.totalBytes,
        };
        const bytes = encodedJson(value); await runtime.service.authorizeResource(identity, signal); signal.throwIfAborted();
        runtime.service.reserveResponse(identity, req.method === 'HEAD' ? 0 : bytes.length); json(req, res, bytes); return;
      }
      const manifestPath = resourceManifestPath(match[5] ?? ''), resource = authorized.version.manifest.resources.find(r => r.path === manifestPath);
      if (!resource) throw new ViewerSessionError('RESOURCE_NOT_FOUND', 404);
      let range: ReturnType<typeof resourceRange>;
      try { range = resourceRange(req.header('range'), resource.bytes); } catch (error) { res.setHeader('Content-Range', `bytes */${resource.bytes}`); throw error; }
      await runtime.resource(resource.bytes, async () => {
        let verified: Awaited<ReturnType<ModelResourceReader['readVerifiedResource']>>;
        try { verified = await runtime.storage.readVerifiedResource(authorized.version.storagePrefix, resource, signal); }
        catch (error) {
          if (error instanceof ModelStorageError && error.code === 'STORAGE_EXHAUSTED') throw new ViewerSessionError('STORAGE_EXHAUSTED', 507);
          if (error instanceof ModelStorageError && error.code === 'STORAGE_INTEGRITY_FAILED') throw new ViewerSessionError('MODEL_UNAVAILABLE', 409);
          throw new ViewerSessionError('RESOURCE_FAILED', 502);
        }
        try {
          signal.throwIfAborted(); const current = await runtime.service.authorizeResource(identity, signal), same = current.version.manifest.resources.find(r => r.path === resource.path);
          if (current.session.loadId !== authorized.session.loadId || current.version.storagePrefix !== authorized.version.storagePrefix || current.version.contentFingerprint !== authorized.version.contentFingerprint || same?.sha256 !== resource.sha256 || same?.bytes !== resource.bytes) throw new ViewerSessionError('MODEL_UNAVAILABLE', 409);
          const bytes = range ? range.end - range.start + 1 : resource.bytes;
          runtime.service.reserveResponse(identity, req.method === 'HEAD' ? 0 : bytes); signal.throwIfAborted();
          res.setHeader('Accept-Ranges', 'bytes'); res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Content-Length', bytes);
          if (range) res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${resource.bytes}`);
          res.status(range ? 206 : 200);
          if (req.method === 'HEAD' || resource.bytes === 0) { res.end(); return; }
          await pipeline(verified.handle.createReadStream({ autoClose: false, start: range?.start ?? 0, end: range?.end ?? resource.bytes - 1 }), res, { signal });
        } finally { await verified.close(); }
      });
    }).catch(error => {
      if (res.headersSent || res.destroyed) { if (!res.destroyed) res.destroy(); return; }
      const safe = error instanceof PathFinderError ? error : viewerError(error); res.status(safe.status).json({ code: safe.code, error: safe.message });
    }).finally(() => res.off('close', onDisconnect));
  });
  return router;
}
