import express, { Router, type Request, type Response, type NextFunction } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { PREPARATION_LIMITS, preparationErrorSchema, preparationPartUploadSchema } from '../../shared/pathfinderPreparation.js';
import { PreparationMergeError } from '../../shared/preparationMerge.js';
import { verifyAccessToken } from '../auth.js';
import { requestPrincipal } from './auth.js';
import { PathFinderError } from './errors.js';
import { parsePolicyJson } from './policyJson.js';
import { preparationTransaction, type PreparationService } from './preparationSessions.js';

export const PREPARATION_PART_TRANSPORT_BYTES = PREPARATION_LIMITS.partBytes + 1024 * 1024;
export function sendPreparationError(res: Response, error: unknown): void {
  const status = (error as { status?: number })?.status;
  const known = error instanceof PathFinderError;
  const safe = known ? error : error instanceof PreparationMergeError ? new PathFinderError('PREPARATION_PART_INVALID', 409, 'The captured part does not match its frozen plan. Refresh and collect it again.') : error instanceof z.ZodError || status === 400 ? new PathFinderError('INVALID_PREPARATION_REQUEST', 400, 'The preparation request is invalid.')
    : status === 413 ? new PathFinderError('PREPARATION_BODY_LIMIT', 413, 'The preparation request exceeds its upload limit.')
      : status === 415 ? new PathFinderError('PREPARATION_ENCODING_UNSUPPORTED', 415, 'Use uncompressed UTF-8 application/json.')
        : new PathFinderError('PREPARATION_OUTCOME_UNKNOWN', 500, 'The operation could not be confirmed. Keep the same command and check its session before retrying.');
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(safe.status).json(preparationErrorSchema.parse({ schemaVersion: 'wfc.pf.preparation-error.v1', code: safe.code, message: safe.message, currentSessionRevision: null, outcome: safe.status >= 500 ? 'unknown' : 'refused' }));
}
/** Mount at /api/projects/:projectId/pathfinder/preparations before generic JSON. */
export function createPreparationRouter(pool: Pool, service: PreparationService): Router {
  const router = Router({ mergeParams: true, caseSensitive: true });
  const project = (req: Request) => policyUuidSchema.parse(req.params.projectId);
  const session = (req: Request) => policyUuidSchema.parse(req.params.sessionId);
  router.use(async (req, res, next) => {
    const bearer = /^Bearer\s+(\S+)$/i.exec((req.header('authorization') ?? '').trim())?.[1];
    if (!bearer) { sendPreparationError(res, new PathFinderError('AUTHENTICATION_REQUIRED', 401, 'Sign in to prepare the project network.')); return; }
    try {
      const payload = verifyAccessToken(bearer); req.userId = policyUuidSchema.parse(payload.sub); req.loginId = policyUuidSchema.parse(payload.jti);
      if (!Number.isSafeInteger(payload.exp)) throw new Error('expiry'); req.loginExpiresAt = payload.exp! * 1000;
    } catch { sendPreparationError(res, new PathFinderError('LOGIN_REVOKED', 401, 'Sign in again.')); return; }
    try {
      await preparationTransaction(pool, project(req), requestPrincipal(req), async () => undefined);
      z.object({}).strict().parse(req.query);
      res.setHeader('Cache-Control', 'private, no-store');
      if (['POST', 'PUT'].includes(req.method)) {
        const bound = req.method === 'PUT' ? PREPARATION_PART_TRANSPORT_BYTES : PREPARATION_LIMITS.controlBytes;
        const length = req.header('content-length');
        if (length !== undefined && (!/^(?:0|[1-9][0-9]*)$(?![\s\S])/.test(length) || BigInt(length) > BigInt(bound))) { res.setHeader('Connection', 'close'); throw new PathFinderError('PREPARATION_BODY_LIMIT', 413); }
        if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.header('content-type') ?? '')) throw new PathFinderError('PREPARATION_CONTENT_TYPE_REQUIRED', 415);
      }
      next();
    } catch (error) { sendPreparationError(res, error); }
  });
  const body = (req: Request, limit: number): unknown => { if (!Buffer.isBuffer(req.body)) throw new PathFinderError('INVALID_PREPARATION_BODY', 400); return parsePolicyJson(req.body, { maxBytes: limit }); };
  const control = express.raw({ type: () => true, limit: PREPARATION_LIMITS.controlBytes, inflate: false });
  router.get('/context', async (req, res) => { try { res.json(await service.context(project(req), requestPrincipal(req))); } catch (error) { sendPreparationError(res, error); } });
  router.get('/', async (req, res) => { try { res.json(await service.index(project(req), requestPrincipal(req))); } catch (error) { sendPreparationError(res, error); } });
  router.post('/', control, async (req, res) => { try { res.json(await service.create(project(req), requestPrincipal(req), body(req, PREPARATION_LIMITS.controlBytes))); } catch (error) { sendPreparationError(res, error); } });
  router.post('/resolutions', control, async (req, res) => { try { res.json(await service.resolve(project(req), requestPrincipal(req), body(req, PREPARATION_LIMITS.controlBytes))); } catch (error) { sendPreparationError(res, error); } });
  router.get('/:sessionId', async (req, res) => { try { res.json(await service.get(project(req), requestPrincipal(req), session(req))); } catch (error) { sendPreparationError(res, error); } });
  router.put('/:sessionId/parts/:partId', express.raw({ type: () => true, limit: PREPARATION_PART_TRANSPORT_BYTES, inflate: false }), async (req, res) => {
    try { const command = preparationPartUploadSchema.parse(body(req, PREPARATION_PART_TRANSPORT_BYTES)); res.json(await service.upload(project(req), requestPrincipal(req), session(req), policyUuidSchema.parse(req.params.partId), command.sessionPlanSha256, command.payload)); } catch (error) { sendPreparationError(res, error); }
  });
  router.post('/:sessionId/publish', control, async (req, res) => { try { res.json(await service.publish(project(req), requestPrincipal(req), session(req), body(req, PREPARATION_LIMITS.controlBytes))); } catch (error) { sendPreparationError(res, error); } });
  router.post('/:sessionId/cancel', control, async (req, res) => { try { res.json(await service.cancel(project(req), requestPrincipal(req), session(req), body(req, PREPARATION_LIMITS.controlBytes))); } catch (error) { sendPreparationError(res, error); } });
  router.use((_req, res) => sendPreparationError(res, new PathFinderError('PREPARATION_METHOD_UNSUPPORTED', 405)));
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => sendPreparationError(res, error));
  return router;
}
