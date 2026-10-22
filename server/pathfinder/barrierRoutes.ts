import express, { Router, type Request, type Response, type NextFunction } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { verifyAccessToken } from '../auth.js';
import { BARRIER_LIMITS, barrierCanonicalJson, barrierCaptureSchema, barrierCaptureCommandSchema, barrierRegistryCommandSchema } from '../../shared/pathfinderBarriers.js';
import { policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { validateBarrierFrameObservation } from '../../viewer-runtime/barrier-capture.mjs';
import { requireViewerOrigin, viewerHttpPolicy, viewerCookieSecret } from '../viewerSessions/http.js';
import { ViewerSessionError } from '../viewerSessions/errors.js';
import { barrierCaptureAdapters } from './barrierCaptureAuthority.js';
import { createBarrierRegistryRepository } from './barrierRegistryRepository.js';
import { barrierCaptureOutcomeQuerySchema } from '../../shared/pathfinderBarrierOutcomes.js';
import { requestPrincipal } from './auth.js';
import { parsePolicyJson } from './policyJson.js';
import { PathFinderError } from './errors.js';

const UPLOAD_BYTES = BARRIER_LIMITS.captureBytes + 16 * 1024;
const errorResponse = (res: Response, error: unknown): void => {
  const status = (error as { status?: number } | null)?.status;
  const failure = error instanceof PathFinderError ? error : error instanceof ViewerSessionError ? new PathFinderError('BARRIER_VIEWER_ACCESS_DENIED', error.status)
    : error instanceof z.ZodError ? new PathFinderError('INVALID_BARRIER_REQUEST', 400)
    : status === 413 ? new PathFinderError('BARRIER_BODY_LIMIT', 413) : status === 415 ? new PathFinderError('BARRIER_CONTENT_TYPE', 415)
      : new PathFinderError('BARRIER_OUTCOME_UNKNOWN', 500, 'The barrier operation could not be confirmed. Retain the exact command before retrying.');
  res.status(failure.status).json({ code: failure.code, error: failure.message });
};

/** Mounted before generic JSON. The upload is under the HttpOnly Viewer cookie's
 * exact session path; normal registry reads/intents need current bearer admin. */
export function createBarrierRouter(pool: Pool, mode: 'admin' | 'viewer' = 'admin'): Router {
  const router = Router({ mergeParams: true, caseSensitive: true });
  const repository = () => createBarrierRegistryRepository(pool, barrierCaptureAdapters());
  const project = (req: Request) => policyUuidSchema.parse(req.params.projectId);
  router.use(async (req, res, next) => {
    if (mode === 'admin' && !/^\/barriers(?:\/|$)/i.test(req.path)) { next('router'); return; }
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const bearer = /^Bearer\s+(\S+)$/i.exec((req.header('authorization') ?? '').trim())?.[1];
      if (!bearer) throw new PathFinderError('AUTHENTICATION_REQUIRED', 401);
      let token: ReturnType<typeof verifyAccessToken>;
      try { token = verifyAccessToken(bearer); req.userId = policyUuidSchema.parse(token.sub); req.loginId = policyUuidSchema.parse(token.jti);
        if (!Number.isSafeInteger(token.exp)) throw Error('expiry');
      } catch { throw new PathFinderError('LOGIN_REVOKED', 401); }
      req.loginExpiresAt = token.exp! * 1000;
      await repository().authorize(project(req), requestPrincipal(req));
      if (['POST', 'PUT'].includes(req.method)) {
        const maximum = mode === 'viewer' ? UPLOAD_BYTES : BARRIER_LIMITS.controlBytes, declared = req.header('content-length');
        if (declared !== undefined && (!/^(?:0|[1-9][0-9]*)$(?![\s\S])/.test(declared) || BigInt(declared) > BigInt(maximum)))
          throw new PathFinderError('BARRIER_BODY_LIMIT', 413);
        if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.header('content-type') ?? '') || req.header('content-encoding'))
          throw new PathFinderError('BARRIER_CONTENT_TYPE', 415);
      }
      if (mode === 'viewer') { requireViewerOrigin(req, viewerHttpPolicy(), true); policyUuidSchema.parse(req.params.modelVersionId); policyUuidSchema.parse(req.params.sessionId); viewerCookieSecret(req.header('cookie')); }
      next();
    } catch (error) { errorResponse(res, error); }
  });
  const query = (req: Request) => z.object({}).strict().parse(req.query);
  const raw = (maximum: number) => express.raw({ type: () => true, limit: maximum, inflate: false });
  const body = (req: Request, maximum: number): unknown => {
    if (!Buffer.isBuffer(req.body)) throw new PathFinderError('INVALID_BARRIER_REQUEST', 400);
    return parsePolicyJson(req.body, { maxBytes: maximum });
  };
  if (mode === 'admin') {
    router.get('/barriers/intents/:intentId/outcome', async (req, res) => { try {
      res.json(await repository().readCaptureOutcome(project(req), requestPrincipal(req), policyUuidSchema.parse(req.params.intentId), barrierCaptureOutcomeQuerySchema.parse(req.query)));
    } catch (error) { errorResponse(res, error); } });
    router.get('/barriers', async (req, res) => { try { query(req); res.json(await repository().get(project(req), requestPrincipal(req))); } catch (error) { errorResponse(res, error); } });
    router.get('/barriers/snapshots', async (req, res) => { try {
      const options = z.object({ offset: z.string().regex(/^(?:0|[1-9][0-9]{0,6})$(?![\s\S])/).transform(Number).refine(value => value <= 1_000_000).optional(),
        limit: z.string().regex(/^[1-9][0-9]{0,2}$(?![\s\S])/).transform(Number).refine(value => value <= 100).optional() }).strict().parse(req.query);
      res.json(await repository().list(project(req), requestPrincipal(req), options));
    } catch (error) { errorResponse(res, error); } });
    router.get('/barriers/snapshots/:snapshotId', async (req, res) => { try { query(req); res.json(await repository().getSnapshot(project(req), requestPrincipal(req), policyUuidSchema.parse(req.params.snapshotId))); } catch (error) { errorResponse(res, error); } });
    router.post('/barriers/intents', raw(BARRIER_LIMITS.controlBytes), async (req, res) => { try { query(req); res.json(await repository().begin(project(req), requestPrincipal(req), barrierCaptureCommandSchema.parse(body(req, BARRIER_LIMITS.controlBytes)))); } catch (error) { errorResponse(res, error); } });
    router.post('/barriers/commands', raw(BARRIER_LIMITS.controlBytes), async (req, res) => { try { query(req); res.json(await repository().command(project(req), requestPrincipal(req), barrierRegistryCommandSchema.parse(body(req, BARRIER_LIMITS.controlBytes)))); } catch (error) { errorResponse(res, error); } });
  } else {
    router.put('/captures/:intentId', raw(UPLOAD_BYTES), async (req, res) => {
      const controller = new AbortController(), closed = () => { if (!res.writableEnded) controller.abort(); };
      res.once('close', closed);
      try {
        query(req);
        const input = z.object({ capture: barrierCaptureSchema, frameObservation: z.unknown().refine(validateBarrierFrameObservation) }).strict().parse(body(req, UPLOAD_BYTES));
        const parameters = req.params as Record<string, string>;
        if (input.capture.scope.modelVersionId !== parameters.modelVersionId || input.capture.scope.projectId !== project(req)) throw new PathFinderError('BARRIER_CAPTURE_SCOPE', 409);
        const who = requestPrincipal(req), adapters = barrierCaptureAdapters({ sessionId: policyUuidSchema.parse(parameters.sessionId),
          cookieSecret: viewerCookieSecret(req.header('cookie')), who, frame: input.frameObservation });
        const active = createBarrierRegistryRepository(pool, adapters);
        res.json(await active.publish(project(req), who, policyUuidSchema.parse(req.params.intentId), Buffer.from(barrierCanonicalJson(input.capture)), controller.signal));
      } catch (error) { if (!res.destroyed) errorResponse(res, error); }
      finally { res.removeListener('close', closed); }
    });
  }
  router.use((_req, res) => errorResponse(res, new PathFinderError('BARRIER_METHOD_UNSUPPORTED', 405)));
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => errorResponse(res, error));
  return router;
}
