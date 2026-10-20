import { Router, type Request, type Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { authenticate } from '../middleware.js';
import { ModelStorageError } from '../modelRegistry/storage.js';
import { ViewerSessionError, viewerError } from '../viewerSessions/errors.js';
import { requireViewerOrigin, resourceManifestPath, resourceRange, validateViewerQuery, viewerCookieSecret, viewerHttpPolicy, type ViewerHttpPolicy } from '../viewerSessions/http.js';
import { getViewerRuntime, type ViewerRuntime } from '../viewerSessions/runtime.js';
import { viewerUuid } from '../viewerSessions/service.js';
import type { ResourceIdentity, ViewerPrincipal, ViewerSessionDto } from '../viewerSessions/types.js';

function privateHeaders(res: Response): void {
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Cross-Origin-Resource-Policy','same-origin');
}
async function authenticated(req: Request,res: Response): Promise<ViewerPrincipal | null> {
  let accepted = false;
  authenticate(req,res,() => { accepted = true; });
  if (!accepted) return null;
  if (!req.loginId || !req.loginExpiresAt || !req.userId) throw new ViewerSessionError('LOGIN_REFRESH_REQUIRED',401);
  return { userId: req.userId,loginId: req.loginId,loginExpiresAt: req.loginExpiresAt };
}
async function body(req: Request,signal: AbortSignal): Promise<Record<string,unknown>> {
  if (req.header('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json' || req.header('content-encoding')) throw new ViewerSessionError('INVALID_VIEWER_REQUEST',415);
  const chunks: Buffer[] = []; let bytes = 0;
  const abort = (): void => { req.destroy(); };
  const timeout = AbortSignal.timeout(10_000),active = AbortSignal.any([signal,timeout]);
  active.addEventListener('abort',abort,{once:true});
  try {
    active.throwIfAborted();
    for await (const chunk of req) {
      active.throwIfAborted();
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += data.length;
      if (bytes > 2048) throw new ViewerSessionError('INVALID_VIEWER_REQUEST',413);
      chunks.push(data);
    }
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid body');
    return parsed as Record<string,unknown>;
  } catch (error) { if (error instanceof ViewerSessionError) throw error; throw new ViewerSessionError('INVALID_VIEWER_REQUEST'); }
  finally { active.removeEventListener('abort',abort); }
}
function cookiePath(session: ViewerSessionDto): string {
  return `/api/projects/${session.projectId}/model-versions/${session.modelVersionId}/viewer-sessions/${session.sessionId}/`;
}
function setCookie(res: Response,session: ViewerSessionDto,secret: string,secure: boolean): void {
  res.cookie('wfc_viewer_session',secret,{ path: cookiePath(session),httpOnly: true,sameSite: 'strict',secure,
    maxAge: Math.max(0,new Date(session.expiresAt).getTime()-Date.now()) });
}
function method(res: Response,allowed: string): never {
  res.setHeader('Allow',allowed); throw new ViewerSessionError('METHOD_NOT_ALLOWED',405);
}
function json(req: Request,res: Response,value: unknown): void {
  const encoded = Buffer.from(JSON.stringify(value));
  res.setHeader('Content-Type','application/json; charset=utf-8'); res.setHeader('Content-Length',encoded.length);
  res.status(200).end(req.method === 'HEAD' ? undefined : encoded);
}

/** Mounted before global CORS/body/Bearer project middleware; this router owns only exact private viewer paths. */
export function createViewerSessionRouter(options: { runtime?: ViewerRuntime; policy?: ViewerHttpPolicy } = {}): Router {
  const router = Router(),policy = options.policy ?? viewerHttpPolicy();
  router.use((req,res,next) => {
    const raw = req.originalUrl.split('?')[0];
    const logout = /^\/api\/viewer-sessions\/revoke-login\/?$/.test(raw);
    // Express's other routers are case-insensitive. Claim aliases as private too,
    // while the canonical route parser below still rejects them with safe JSON.
    const family = /^\/api\/viewer-sessions(?:\/|$)/i.test(raw)
      || /^\/api\/projects\/[^/]+\/model-versions\/[^/]+\/viewer-sessions(?:\/|$)/i.test(raw);
    if (!family) { next(); return; }
    privateHeaders(res);
    const runtime = options.runtime ?? getViewerRuntime();
    const disconnected = new AbortController();
    const onDisconnect = (): void => { if (!res.writableFinished) disconnected.abort(); };
    res.once('close',onDisconnect);
    void runtime.run(async stopping => {
      const signal = AbortSignal.any([stopping,disconnected.signal]);
      const secure = requireViewerOrigin(req,policy,!['GET','HEAD'].includes(req.method)).secure;
      if (logout) {
        validateViewerQuery(req.originalUrl);
        if (req.method !== 'POST') method(res,'POST');
        const who = await authenticated(req,res); if (!who) return;
        await runtime.service.revokeLogin(who); res.status(204).end(); return;
      }
      const match = /^\/api\/projects\/([^/]+)\/model-versions\/([^/]+)\/viewer-sessions(?:\/([^/]+)(?:\/(renew|descriptor|resources|pathfinder-authorization|routing-bindings)(?:\/(.*))?)?)?\/?$/.exec(raw);
      if (!match) throw new ViewerSessionError('RESOURCE_NOT_FOUND',404);
      validateViewerQuery(req.originalUrl,match[4] === 'resources' && ['GET','HEAD'].includes(req.method)
        ? `${secure ? 'https' : 'http'}://${req.header('host')}` : undefined);
      const projectId = viewerUuid(match[1]),modelVersionId = viewerUuid(match[2]);
      if (!match[3]) {
        if (req.method !== 'POST') method(res,'POST');
        const who = await authenticated(req,res); if (!who) return;
        const parsed = await body(req,signal);
        if (Object.keys(parsed).length !== 1 || !('loadId' in parsed)) throw new ViewerSessionError('INVALID_VIEWER_REQUEST');
        const created = await runtime.service.create({ principal: who,projectId,modelVersionId,loadId: viewerUuid(parsed.loadId) });
        setCookie(res,created.session,created.cookieSecret,secure); res.status(201).json(created.session); return;
      }
      const sessionId = viewerUuid(match[3]);
      if (!match[4]) {
        if (req.method !== 'DELETE') method(res,'DELETE');
        const who = await authenticated(req,res); if (!who) return;
        await runtime.service.revoke({ principal: who,projectId,modelVersionId,sessionId });
        res.clearCookie('wfc_viewer_session',{ path: `/api/projects/${projectId}/model-versions/${modelVersionId}/viewer-sessions/${sessionId}/`,httpOnly: true,sameSite: 'strict',secure });
        res.status(204).end(); return;
      }
      const identity: ResourceIdentity = { projectId,modelVersionId,sessionId,cookieSecret: viewerCookieSecret(req.header('cookie')) };
      if (match[4] === 'renew') {
        if (req.method !== 'POST') method(res,'POST');
        const who = await authenticated(req,res); if (!who) return;
        const parsed = await body(req,signal);
        if (Object.keys(parsed).length) throw new ViewerSessionError('INVALID_VIEWER_REQUEST');
        const session = await runtime.service.renew({ ...identity,principal: who });
        setCookie(res,session,identity.cookieSecret,secure); res.status(200).json(session); return;
      }
      if (!['GET','HEAD'].includes(req.method)) method(res,'GET, HEAD');
      if (match[4] === 'pathfinder-authorization') {
        if (match[5]) throw new ViewerSessionError('RESOURCE_NOT_FOUND',404);
        json(req,res,await runtime.service.authorizePathFinder(identity));
        return;
      }
      if (match[4] === 'routing-bindings') {
        if (match[5]) throw new ViewerSessionError('RESOURCE_NOT_FOUND',404);
        json(req,res,await runtime.service.routingBindings(identity));
        return;
      }
      const authorized = await runtime.service.authorizeResource(identity);
      if (match[4] === 'descriptor') {
        if (match[5]) throw new ViewerSessionError('RESOURCE_NOT_FOUND',404);
        const v = authorized.version;
        json(req,res,{ projectId,modelVersionId,loadId: authorized.session.loadId,contentFingerprint: v.contentFingerprint,
          supportProfile: v.supportProfile,format: v.format,sdkVersion: v.sdkVersion,entrypoint: v.entrypoint,resourceCount: v.resourceCount,totalBytes: v.totalBytes });
        return;
      }
      const manifestPath = resourceManifestPath(match[5] ?? '');
      const resource = authorized.version.manifest.resources.find(item => item.path === manifestPath);
      if (!resource) throw new ViewerSessionError('RESOURCE_NOT_FOUND',404);
      let range: ReturnType<typeof resourceRange>;
      try { range = resourceRange(req.header('range'),resource.bytes); }
      catch (error) { res.setHeader('Content-Range',`bytes */${resource.bytes}`); throw error; }
      await runtime.resource(resource.bytes,async () => {
        let verified: Awaited<ReturnType<typeof runtime.storage.readVerifiedResource>>;
        try { verified = await runtime.storage.readVerifiedResource(authorized.version.storagePrefix,resource,signal); }
        catch (error) {
          if (error instanceof ModelStorageError && error.code === 'STORAGE_INTEGRITY_FAILED') {
            await runtime.service.markUnavailable(projectId,modelVersionId);
            throw new ViewerSessionError('MODEL_UNAVAILABLE',409);
          }
          if (error instanceof ModelStorageError && error.code === 'STORAGE_EXHAUSTED') throw new ViewerSessionError('STORAGE_EXHAUSTED',507);
          throw new ViewerSessionError('RESOURCE_FAILED',502);
        }
        try {
          // Resource I/O holds no DB transaction. Fence logout/selection/ACL changes after it.
          signal.throwIfAborted();
          const current = await runtime.service.authorizeResource(identity);
          const same = current.version.manifest.resources.find(item => item.path === resource.path);
          if (current.version.storagePrefix !== authorized.version.storagePrefix || current.version.contentFingerprint !== authorized.version.contentFingerprint ||
            same?.sha256 !== resource.sha256 || same.bytes !== resource.bytes) throw new ViewerSessionError('MODEL_UNAVAILABLE',409);
          signal.throwIfAborted();
          res.setHeader('Accept-Ranges','bytes'); res.setHeader('Content-Type','application/octet-stream');
          res.setHeader('Content-Length',range ? range.end-range.start+1 : resource.bytes);
          if (range) res.setHeader('Content-Range',`bytes ${range.start}-${range.end}/${resource.bytes}`);
          res.status(range ? 206 : 200);
          if (req.method === 'HEAD' || resource.bytes === 0) { res.end(); return; }
          const source = verified.handle.createReadStream({ autoClose: false,start: range?.start ?? 0,end: range?.end ?? resource.bytes-1 });
          await pipeline(source,res,{signal});
        } finally { await verified.close(); }
      });
    }).catch(error => {
      if (res.headersSent || res.destroyed) { if (!res.destroyed) res.destroy(); return; }
      const safe = viewerError(error); res.status(safe.status).json({ code: safe.code,error: safe.message });
    }).finally(() => { res.off('close',onDisconnect); });
  });
  return router;
}
