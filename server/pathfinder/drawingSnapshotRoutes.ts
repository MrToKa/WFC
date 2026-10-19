import express, { Router, type NextFunction, type Request, type Response } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { drawingErrorSchema } from '../../shared/pathfinderDrawingPolicy.js';
import { DRAWING_EXPORT_BODY_BYTES, drawingExportWriteSchema, drawingSettingsWriteSchema } from '../../shared/trayDrawingSnapshot.js';
import { verifyAccessToken } from '../auth.js';
import { requestPrincipal } from './auth.js';
import { drawingAccessTransaction } from './drawingAccess.js';
import { readPurposePolicyState } from './policySchema.js';
import { readTrayDrawingSnapshot, saveTrayDrawingSettings } from './drawingSnapshots.js';
import { exportTrayDrawing } from './drawingExports.js';
import { parsePolicyJson, POLICY_BODY_BYTES } from './policyJson.js';
import { PathFinderError } from './errors.js';

const identifiers = (req: Request) => ({ projectId: policyUuidSchema.parse(req.params.projectId), trayId: policyUuidSchema.parse(req.params.trayId) });

export function sendDrawingError(res: Response, error: unknown): void {
  const raw = error as { status?: number; type?: string };
  const safe = error instanceof PathFinderError ? error : error instanceof z.ZodError ? new PathFinderError('INVALID_DRAWING_REQUEST', 400, 'The drawing request or inputs are invalid.')
    : raw?.status === 413 || raw?.type === 'entity.too.large' ? new PathFinderError('DRAWING_BODY_LIMIT', 413, 'The drawing request exceeds the upload limit.')
      : raw?.status === 415 ? new PathFinderError('DRAWING_ENCODING_UNSUPPORTED', 415, 'Use uncompressed UTF-8 application/json.')
        : raw?.status === 400 ? new PathFinderError('INVALID_DRAWING_REQUEST', 400, 'The drawing request is invalid.')
      : new PathFinderError('DRAWING_FAILURE', 500, 'The tray drawing could not be processed. Refresh before retrying.');
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(safe.status).json(drawingErrorSchema.parse({ schemaVersion: 'pathfinder.drawing-error.v1', code: safe.code, message: safe.message, currentRevisions: [401, 403].includes(safe.status) ? null : res.locals.drawingRevisions ?? null }));
}
/** Mount before generic JSON parsing; existing view/edit rights are rechecked through commit. */
export function createDrawingSnapshotRouter(pool: Pool): Router {
  const router = Router({ mergeParams: true });
  const endpoint = /^\/(drawing-snapshot|drawing-settings|drawing-export)\/?$/;
  router.use((req, _res, next) => endpoint.test(req.path) ? next() : next('router'));
  router.use((req, res, next) => {
    const bearer = /^Bearer\s+(\S+)$/i.exec((req.header('authorization') ?? '').trim())?.[1];
    if (!bearer) { sendDrawingError(res, new PathFinderError('AUTHENTICATION_REQUIRED', 401, 'Sign in to view the tray drawing.')); return; }
    try {
      const payload = verifyAccessToken(bearer);
      req.userId = policyUuidSchema.parse(payload.sub); req.loginId = policyUuidSchema.parse(payload.jti);
      if (!Number.isSafeInteger(payload.exp)) throw new Error('Invalid expiry');
      req.loginExpiresAt = payload.exp! * 1000; next();
    } catch { sendDrawingError(res, new PathFinderError('LOGIN_REVOKED', 401, 'Sign in again.')); }
  });
  router.use(async (req, res, next) => {
    try {
      const { projectId } = identifiers(req);
      z.object({}).strict().parse(req.query);
      if (!(['GET', 'HEAD'].includes(req.method) && /^\/drawing-snapshot\/?$/.test(req.path) || req.method === 'PUT' && /^\/drawing-settings\/?$/.test(req.path) || req.method === 'POST' && /^\/drawing-export\/?$/.test(req.path))) throw new PathFinderError('DRAWING_METHOD_UNSUPPORTED', 405, 'This drawing operation is unavailable.');
      const edit = !['GET', 'HEAD'].includes(req.method);
      await drawingAccessTransaction(pool, projectId, requestPrincipal(req), async c => {
        const state = await readPurposePolicyState(c, projectId);
        res.locals.drawingRevisions = { catalogRevision: state.catalogRevision, drawingPolicyRevision: state.drawingPolicyRevision, drawingInputRevision: state.drawingInputRevision };
      }, { edit });
      if (edit) {
        const bound = req.path.startsWith('/drawing-export') ? DRAWING_EXPORT_BODY_BYTES : POLICY_BODY_BYTES;
        const length = req.header('content-length');
        if (length !== undefined && (!/^(0|[1-9][0-9]*)$(?![\s\S])/.test(length) || BigInt(length) > BigInt(bound))) { res.setHeader('Connection', 'close'); throw new PathFinderError('DRAWING_BODY_LIMIT', 413, 'The drawing request exceeds the upload limit.'); }
        if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.header('content-type') ?? '')) throw new PathFinderError('DRAWING_CONTENT_TYPE_REQUIRED', 415, 'Use UTF-8 application/json.');
      }
      res.setHeader('Cache-Control', 'private, no-store'); next();
    } catch (error) { sendDrawingError(res, error); }
  });
  router.get('/drawing-snapshot', async (req, res) => {
    try { const { projectId, trayId } = identifiers(req); res.json(await drawingAccessTransaction(pool, projectId, requestPrincipal(req), (c, auth) => readTrayDrawingSnapshot(c, projectId, trayId, auth))); }
    catch (error) { sendDrawingError(res, error); }
  });
  router.put('/drawing-settings', express.raw({ type: () => true, limit: POLICY_BODY_BYTES, inflate: false }), async (req, res) => {
    try {
      const { projectId, trayId } = identifiers(req), who = requestPrincipal(req);
      if (!Buffer.isBuffer(req.body)) throw new PathFinderError('INVALID_DRAWING_BODY', 400);
      const command = drawingSettingsWriteSchema.parse(parsePolicyJson(req.body));
      res.json(await drawingAccessTransaction(pool, projectId, who, (c, auth) => saveTrayDrawingSettings(c, projectId, trayId, who, command, auth), { edit: true }));
    } catch (error) { sendDrawingError(res, error); }
  });
  router.post('/drawing-export', express.raw({ type: () => true, limit: DRAWING_EXPORT_BODY_BYTES, inflate: false }), async (req, res) => {
    try {
      if (!Buffer.isBuffer(req.body)) throw new PathFinderError('INVALID_DRAWING_BODY', 400);
      const command = drawingExportWriteSchema.parse(parsePolicyJson(req.body, { maxBytes: DRAWING_EXPORT_BODY_BYTES }));
      const { projectId, trayId } = identifiers(req);
      res.json(await exportTrayDrawing(pool, projectId, trayId, requestPrincipal(req), command));
    } catch (error) { sendDrawingError(res, error); }
  });
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => sendDrawingError(res, error));
  return router;
}
