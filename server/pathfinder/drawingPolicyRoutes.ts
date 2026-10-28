import express, { Router, type NextFunction, type Request, type Response } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { policyErrorSchema, policyUuidSchema, policyRevisionSchema } from '../../shared/pathfinderPurposePolicy.js';
import { verifyAccessToken } from '../auth.js';
import { requestPrincipal } from './auth.js';
import { PathFinderError } from './errors.js';
import { PurposePolicyError, type PolicyRevisions } from './purposePolicy.js';
import { createDrawingPolicyRepository, DrawingPolicyError } from './drawingPolicy.js';
import { parsePolicyJson, POLICY_BODY_BYTES } from './policyJson.js';

export function sendDrawingPolicyError(res: Response, error: unknown): void {
  const rawStatus = (error as { status?: number; type?: string })?.status;
  const denied = error instanceof PathFinderError && [401, 403].includes(error.status);
  const safe = error instanceof PathFinderError ? error : rawStatus === 413 || (error as { type?: string })?.type === 'entity.too.large' ? new DrawingPolicyError('POLICY_BODY_TOO_LARGE', 413, 'Cable positioning exceeds the request limit.') : rawStatus === 415 ? new DrawingPolicyError('POLICY_ENCODING_UNSUPPORTED', 415, 'Use uncompressed UTF-8 JSON.') : error instanceof z.ZodError || rawStatus === 400 ? new DrawingPolicyError('INVALID_POLICY_REQUEST', 400, 'The cable positioning request is invalid.') : new DrawingPolicyError('DRAWING_POLICY_FAILURE', 500, 'Cable positioning could not be processed.');
  const current = denied ? null : (error instanceof PurposePolicyError ? error.currentRevisions : null) ?? (res.locals.currentPolicyRevisions as PolicyRevisions | undefined) ?? null;
  const message = safe.code === 'POLICY_FAILURE' ? 'Cable positioning could not be processed. Refresh before retrying the same save.' : safe.message;
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(safe.status).json(policyErrorSchema.parse({ schemaVersion: 'pathfinder.policy-error.v1', code: safe.code, message, currentRevisions: current }));
}

/** Mount before generic JSON parsing at /api/projects/:projectId/pathfinder. */
export function createDrawingPurposePolicyRouter(pool: Pool): Router {
  const router = Router({ mergeParams: true, caseSensitive: true }), repository = createDrawingPolicyRepository(pool);
  const project = (req: Request) => policyUuidSchema.parse((req.params as Record<string, string>).projectId);
  router.use((req, res, next) => {
    if (!/^\/drawing-positioning(?:\/history)?\/?$/.test(req.path)) { next('router'); return; }
    res.setHeader('Cache-Control', 'private, no-store');
    const bearer = /^Bearer\s+(\S+)$/i.exec((req.header('authorization') ?? '').trim())?.[1];
    if (!bearer) { sendDrawingPolicyError(res, new DrawingPolicyError('AUTHENTICATION_REQUIRED', 401, 'Sign in to manage cable positioning.')); return; }
    try {
      const payload = verifyAccessToken(bearer);
      if (!policyUuidSchema.safeParse(payload.sub).success || !policyUuidSchema.safeParse(payload.jti).success || !Number.isSafeInteger(payload.exp)) throw new Error('identity');
      req.userId = payload.sub; req.loginId = payload.jti; req.loginExpiresAt = payload.exp! * 1000; next();
    } catch { sendDrawingPolicyError(res, new DrawingPolicyError('LOGIN_REVOKED', 401, 'Sign in again.')); }
  });
  router.use(async (req, res, next) => {
    try { res.locals.currentPolicyRevisions = await repository.authorize(project(req), requestPrincipal(req)); next(); }
    catch (error) { sendDrawingPolicyError(res, error); }
  });
  router.use((req, res, next) => {
    if (req.method === 'PUT') {
      const declared = req.header('content-length');
      if (declared !== undefined && (!/^(?:0|[1-9][0-9]*)$(?![\s\S])/.test(declared) || BigInt(declared) > BigInt(POLICY_BODY_BYTES))) {
        res.setHeader('Connection', 'close'); sendDrawingPolicyError(res, new DrawingPolicyError('POLICY_BODY_TOO_LARGE', 413, 'Cable positioning exceeds the request limit.')); return;
      }
    }
    next();
  });
  const raw = express.raw({ type: () => true, limit: POLICY_BODY_BYTES, inflate: false });
  router.put('/drawing-positioning', raw, async (req, res) => {
    try {
      z.object({}).strict().parse(req.query);
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.header('content-type') ?? '')) throw new DrawingPolicyError('POLICY_CONTENT_TYPE_REQUIRED', 415, 'Use application/json with UTF-8.');
      if (!Buffer.isBuffer(req.body)) throw new DrawingPolicyError('INVALID_POLICY_JSON', 400, 'Use a JSON request body.');
      res.json(await repository.save(project(req), requestPrincipal(req), parsePolicyJson(req.body)));
    } catch (error) { sendDrawingPolicyError(res, error); }
  });
  router.get('/drawing-positioning', async (req, res) => {
    try { z.object({}).strict().parse(req.query); res.json(await repository.get(project(req), requestPrincipal(req))); }
    catch (error) { sendDrawingPolicyError(res, error); }
  });
  router.get('/drawing-positioning/history', async (req, res) => {
    try {
      const query = z.object({ beforeRevision: policyRevisionSchema.optional(), limit: z.string().regex(/^(?:[1-9]|[1-9][0-9]|100)$(?![\s\S])/).optional() }).strict().parse(req.query);
      res.json(await repository.history(project(req), requestPrincipal(req), { beforeRevision: query.beforeRevision, limit: query.limit === undefined ? undefined : Number(query.limit) }));
    } catch (error) { sendDrawingPolicyError(res, error); }
  });
  router.use((_req, res) => sendDrawingPolicyError(res, new DrawingPolicyError('POLICY_METHOD_UNSUPPORTED', 405, 'This cable positioning operation is unavailable.')));
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => sendDrawingPolicyError(res, error));
  return router;
}

export const drawingPurposePolicyRouter = createDrawingPurposePolicyRouter;
