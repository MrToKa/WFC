import express, { Router, type Request, type Response, type NextFunction } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { geometryTraceErrorSchema, geometryTraceCreateSchema, captureEvidenceUploadSchema, GEOMETRY_TRACE_LIMITS } from '../../shared/pathfinderGeometryTrace.js';
import { verifyAccessToken } from '../auth.js';
import { requestPrincipal } from './auth.js';
import { PathFinderError } from './errors.js';
import { parsePolicyJson } from './policyJson.js';
import type { GeometryTraceRepository } from './geometryTraceRepository.js';

export const CAPTURE_EVIDENCE_TRANSPORT_BYTES = GEOMETRY_TRACE_LIMITS.evidenceBytes + 4096;
export function sendGeometryTraceError(res: Response, error: unknown): void {
  const rawStatus = (error as { status?: number } | null)?.status;
  const safe = error instanceof PathFinderError ? error : error instanceof z.ZodError || rawStatus === 400 ? new PathFinderError('INVALID_GEOMETRY_TRACE_REQUEST', 400, 'The geometry trace request is invalid.') : rawStatus === 413 ? new PathFinderError('GEOMETRY_TRACE_BODY_LIMIT', 413, 'The geometry trace request exceeds its limit.') : rawStatus === 415 ? new PathFinderError('GEOMETRY_TRACE_ENCODING_UNSUPPORTED', 415, 'Use uncompressed UTF-8 application/json.') : new PathFinderError('GEOMETRY_TRACE_OUTCOME_UNKNOWN', 500, 'The operation could not be confirmed. Keep the same command and reconcile its trace.');
  res.setHeader('Cache-Control', 'private, no-store'); res.status(safe.status).json(geometryTraceErrorSchema.parse({ schemaVersion: 'wfc.pf.geometry-trace-error.v1', code: safe.code, message: safe.message, outcome: safe.status >= 500 ? 'unknown' : 'refused' }));
}
const offset = z.string().refine(v => /^(?:0|[1-9][0-9]{0,6})$/.exec(v)?.[0] === v && Number(v) <= 1_000_000).transform(Number);
const limit = z.string().refine(v => /^(?:[1-9]|[1-9][0-9]|100)$/.exec(v)?.[0] === v).transform(Number);
/** Mount before generic JSON at /api/projects/:projectId/pathfinder; only owns its two prefixes. */
export function createGeometryTraceRouter(_pool: Pool, repository: GeometryTraceRepository): Router {
  const router = Router({ mergeParams: true, caseSensitive: true });
  const project = (req: Request) => policyUuidSchema.parse(req.params.projectId), trace = (req: Request) => policyUuidSchema.parse(req.params.traceId);
  router.use(async (req, res, next) => {
    if (!/^\/(?:geometry-traces|geometry-evidence)(?:\/|$)/i.test(req.path)) { next('router'); return; }
    res.setHeader('Cache-Control', 'private, no-store'); const bearer = /^Bearer\s+(\S+)$/i.exec((req.header('authorization') ?? '').trim())?.[1];
    if (!bearer) { sendGeometryTraceError(res, new PathFinderError('AUTHENTICATION_REQUIRED', 401)); return; }
    try { const payload = verifyAccessToken(bearer); req.userId = policyUuidSchema.parse(payload.sub); req.loginId = policyUuidSchema.parse(payload.jti); if (!Number.isSafeInteger(payload.exp)) throw Error('expiry'); req.loginExpiresAt = payload.exp! * 1000; } catch { sendGeometryTraceError(res, new PathFinderError('LOGIN_REVOKED', 401)); return; }
    try { await repository.authorize(project(req), requestPrincipal(req));
      if (['POST', 'PUT'].includes(req.method)) { const bound = req.path.startsWith('/geometry-evidence/') ? CAPTURE_EVIDENCE_TRANSPORT_BYTES : GEOMETRY_TRACE_LIMITS.controlBytes, length = req.header('content-length'); if (length !== undefined && (!/^(?:0|[1-9][0-9]*)$(?![\s\S])/.test(length) || BigInt(length) > BigInt(bound))) { res.setHeader('Connection', 'close'); throw new PathFinderError('GEOMETRY_TRACE_BODY_LIMIT', 413); } if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.header('content-type') ?? '')) throw new PathFinderError('GEOMETRY_TRACE_CONTENT_TYPE_REQUIRED', 415); }
      next();
    } catch (error) { sendGeometryTraceError(res, error); }
  });
  const emptyQuery = (req: Request) => z.object({}).strict().parse(req.query);
  const body = (req: Request, maxBytes: number) => { if (!Buffer.isBuffer(req.body)) throw new PathFinderError('INVALID_GEOMETRY_TRACE_REQUEST', 400); return parsePolicyJson(req.body, { maxBytes }); };
  router.post('/geometry-traces', express.raw({ type: () => true, limit: GEOMETRY_TRACE_LIMITS.controlBytes, inflate: false }), async (req, res) => { const controller = new AbortController(), closed = () => { if (!res.writableEnded) controller.abort(); }; res.once('close', closed); try { emptyQuery(req); res.json(await repository.create(project(req), requestPrincipal(req), geometryTraceCreateSchema.parse(body(req, GEOMETRY_TRACE_LIMITS.controlBytes)), controller.signal)); } catch (error) { if (!res.destroyed) sendGeometryTraceError(res, error); } finally { res.removeListener('close', closed); } });
  router.get('/geometry-traces', async (req, res) => { try { const options = z.object({ offset: offset.optional(), limit: limit.optional(), aggregateId: policyUuidSchema.optional(), modelVersionId: policyUuidSchema.optional(), projectTrayId: policyUuidSchema.optional() }).strict().parse(req.query); res.json(await repository.list(project(req), requestPrincipal(req), options)); } catch (error) { sendGeometryTraceError(res, error); } });
  router.get('/geometry-traces/:traceId/manifest', async (req, res) => { try { emptyQuery(req); res.json(await repository.get(project(req), requestPrincipal(req), trace(req))); } catch (error) { sendGeometryTraceError(res, error); } });
  router.get('/geometry-traces/:traceId/objects', async (req, res) => { try { const options = z.object({ offset: offset.optional(), limit: limit.optional() }).strict().parse(req.query); res.json(await repository.objects(project(req), requestPrincipal(req), trace(req), options)); } catch (error) { sendGeometryTraceError(res, error); } });
  router.get('/geometry-traces/:traceId/diagnostics', async (req, res) => { try { const options = z.object({ offset: offset.optional(), limit: limit.optional() }).strict().parse(req.query); res.json(await repository.diagnostics(project(req), requestPrincipal(req), trace(req), options)); } catch (error) { sendGeometryTraceError(res, error); } });
  router.get('/geometry-traces/:traceId/objects/:objectRevisionId', async (req, res) => { try { emptyQuery(req); res.json(await repository.object(project(req), requestPrincipal(req), trace(req), policyUuidSchema.parse(req.params.objectRevisionId))); } catch (error) { sendGeometryTraceError(res, error); } });
  router.put('/geometry-evidence/sessions/:sessionId/parts/:partId', express.raw({ type: () => true, limit: CAPTURE_EVIDENCE_TRANSPORT_BYTES, inflate: false }), async (req, res) => { const controller = new AbortController(), closed = () => { if (!res.writableEnded) controller.abort(); }; res.once('close', closed); try { emptyQuery(req); res.json(await repository.evidencePut(project(req), requestPrincipal(req), policyUuidSchema.parse(req.params.sessionId), policyUuidSchema.parse(req.params.partId), captureEvidenceUploadSchema.parse(body(req, CAPTURE_EVIDENCE_TRANSPORT_BYTES)), controller.signal)); } catch (error) { if (!res.destroyed) sendGeometryTraceError(res, error); } finally { res.removeListener('close', closed); } });
  router.get('/geometry-evidence/sessions/:sessionId/parts/:partId', async (req, res) => { try { emptyQuery(req); res.json(await repository.evidenceGet(project(req), requestPrincipal(req), policyUuidSchema.parse(req.params.sessionId), policyUuidSchema.parse(req.params.partId))); } catch (error) { sendGeometryTraceError(res, error); } });
  router.use((_req, res) => sendGeometryTraceError(res, new PathFinderError('GEOMETRY_TRACE_METHOD_UNSUPPORTED', 405)));
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => sendGeometryTraceError(res, error)); return router;
}
