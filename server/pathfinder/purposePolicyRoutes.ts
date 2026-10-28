import express, { Router, type NextFunction, type Request, type Response } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { verifyAccessToken } from '../auth.js';
import { policyErrorSchema, policyUuidSchema, policyRevisionSchema } from '../../shared/pathfinderPurposePolicy.js';
import { requestPrincipal } from './auth.js';
import { PathFinderError } from './errors.js';
import { createPurposePolicyRepository, purposePolicyTransaction, PurposePolicyError, type PolicyRevisions } from './purposePolicy.js';
import { readCatalogManifest, readCatalogPage } from './catalog.js';
import { parsePolicyJson, POLICY_BODY_BYTES } from './policyJson.js';
const projectId = (req: Request) => policyUuidSchema.parse((req.params as Record<string, string>).projectId);

export function sendPurposePolicyError(res: Response, error: unknown): void {
  const denied = error instanceof PathFinderError && [401, 403].includes(error.status);
  const rawStatus = (error as { status?: number; type?: string })?.status;
  const oversized = rawStatus === 413 || (error as { type?: string })?.type === 'entity.too.large';
  const unsupportedEncoding = rawStatus === 415;
  const safe = error instanceof PathFinderError ? error : oversized ? new PathFinderError('POLICY_BODY_TOO_LARGE', 413, 'Routing permissions exceed the request limit.') : unsupportedEncoding ? new PathFinderError('POLICY_ENCODING_UNSUPPORTED', 415, 'Use uncompressed UTF-8 JSON.') : error instanceof z.ZodError || rawStatus === 400 ? new PathFinderError('INVALID_POLICY_REQUEST', 400, 'The routing permission request is invalid.') : new PathFinderError('POLICY_FAILURE', 500, 'Routing permissions could not be processed.');
  const current = denied ? null : (error instanceof PurposePolicyError ? error.currentRevisions : null) ?? (res.locals.currentPolicyRevisions as PolicyRevisions | undefined) ?? null;
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(safe.status).json(policyErrorSchema.parse({ schemaVersion: 'pathfinder.policy-error.v1', code: safe.code, message: safe.message, currentRevisions: current }));
}

/** Mount BEFORE generic express.json and the generic project router at /api/projects/:projectId/pathfinder. */
export function createPurposePolicyRouter(pool: Pool): Router {
  const router = Router({ mergeParams: true, caseSensitive: true }), repository = createPurposePolicyRepository(pool);
  const known = (req: Request) => /^\/(?:catalog(?:\/[^/]+\/pages\/[^/]+)?|routing-permissions(?:\/history)?)\/?$/.test(req.path);
  router.use((req, res, next) => {
    if (!known(req)) { next('router'); return; }
    res.setHeader('Cache-Control', 'private, no-store');
    const bearer = /^Bearer\s+(\S+)$/i.exec((req.header('authorization') ?? '').trim())?.[1];
    if (!bearer) { sendPurposePolicyError(res, new PurposePolicyError('AUTHENTICATION_REQUIRED', 401, 'Sign in to manage routing permissions.')); return; }
    try {
      const payload = verifyAccessToken(bearer);
      if (!policyUuidSchema.safeParse(payload.sub).success || !policyUuidSchema.safeParse(payload.jti).success || !Number.isSafeInteger(payload.exp)) throw new Error('identity');
      req.userId = payload.sub; req.loginId = payload.jti; req.loginExpiresAt = payload.exp! * 1000;
      next();
    } catch { sendPurposePolicyError(res, new PurposePolicyError('LOGIN_REVOKED', 401, 'Sign in again.')); }
  });
  // Current authority precedes query/body parsing; every actual operation checks
  // again and retains role/login/project/state locks through its commit.
  router.use(async (req, res, next) => {
    try { res.locals.currentPolicyRevisions = await repository.authorize(policyUuidSchema.parse(projectId(req)), requestPrincipal(req)); next(); }
    catch (error) { sendPurposePolicyError(res, error); }
  });
  router.use((req, res, next) => {
    if (req.method === 'PUT') {
      const declared = req.header('content-length');
      if (declared !== undefined && (!/^(?:0|[1-9][0-9]*)$(?![\s\S])/.test(declared) || BigInt(declared) > BigInt(POLICY_BODY_BYTES))) {
        res.setHeader('Connection', 'close');
        sendPurposePolicyError(res, new PurposePolicyError('POLICY_BODY_TOO_LARGE', 413, 'Routing permissions exceed the request limit.'));
        return;
      }
    }
    next();
  });
  const raw = express.raw({ type: () => true, limit: POLICY_BODY_BYTES, inflate: false });
  router.put('/routing-permissions', raw, async (req, res) => {
    try {
      z.object({}).strict().parse(req.query);
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.header('content-type') ?? '')) throw new PurposePolicyError('POLICY_CONTENT_TYPE_REQUIRED', 415, 'Use application/json with UTF-8.');
      if (!Buffer.isBuffer(req.body)) throw new PurposePolicyError('INVALID_POLICY_JSON', 400, 'Use a JSON request body.');
      const command = parsePolicyJson(req.body);
      res.json(await repository.save(projectId(req), requestPrincipal(req), command));
    } catch (error) { sendPurposePolicyError(res, error); }
  });
  router.get('/routing-permissions', async (req, res) => {
    try { z.object({}).strict().parse(req.query); res.json(await repository.get(projectId(req), requestPrincipal(req))); }
    catch (error) { sendPurposePolicyError(res, error); }
  });
  router.get('/routing-permissions/history', async (req, res) => {
    try {
      const query = z.object({ beforeRevision: policyRevisionSchema.optional(), limit: z.string().regex(/^(?:[1-9]|[1-9][0-9]|100)$(?![\s\S])/).optional() }).strict().parse(req.query);
      res.json(await repository.history(projectId(req), requestPrincipal(req), { beforeRevision: query.beforeRevision, limit: query.limit === undefined ? undefined : Number(query.limit) }));
    } catch (error) { sendPurposePolicyError(res, error); }
  });
  router.get('/catalog', async (req, res) => {
    try { z.object({}).strict().parse(req.query); res.json(await purposePolicyTransaction(pool, projectId(req), requestPrincipal(req), client => readCatalogManifest(client, projectId(req)))); }
    catch (error) { sendPurposePolicyError(res, error); }
  });
  router.get('/catalog/:snapshotId/pages/:pageIndex', async (req, res) => {
    try {
      z.object({}).strict().parse(req.query);
      const snapshotId = policyUuidSchema.parse(req.params.snapshotId), pageIndex = z.string().regex(/^(?:0|[1-9][0-9]?)$(?![\s\S])/).parse(req.params.pageIndex);
      res.json(await purposePolicyTransaction(pool, projectId(req), requestPrincipal(req), client => readCatalogPage(client, projectId(req), snapshotId, Number(pageIndex))));
    } catch (error) { sendPurposePolicyError(res, error); }
  });
  router.use((_req, res) => sendPurposePolicyError(res, new PurposePolicyError('POLICY_METHOD_UNSUPPORTED', 405, 'This routing permission operation is unavailable.')));
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => sendPurposePolicyError(res, error));
  return router;
}
