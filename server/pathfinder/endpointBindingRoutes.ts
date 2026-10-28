import express, { Router, type Request, type Response, type NextFunction } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { policyUuidSchema, policyRevisionSchema } from '../../shared/pathfinderPurposePolicy.js';
import { ENDPOINT_BINDING_LIMITS, endpointBindingErrorSchema, endpointBindingWriteSchema, endpointMigrationWriteSchema, endpointMigrationConfirmSchema } from '../../shared/pathfinderEndpointBindings.js';
import { verifyAccessToken } from '../auth.js';
import { requestPrincipal } from './auth.js';
import { PathFinderError } from './errors.js';
import { parsePolicyJson } from './policyJson.js';
import type { EndpointBindingRepository } from './endpointBindingRepository.js';

export function sendEndpointBindingError(res: Response, error: unknown): void {
  const rawStatus = (error as { status?: number } | null)?.status;
  const safe = error instanceof PathFinderError ? error : error instanceof z.ZodError || rawStatus === 400 ? new PathFinderError('INVALID_ENDPOINT_BINDING_REQUEST', 400, 'The endpoint binding request is invalid.') : rawStatus === 413 ? new PathFinderError('ENDPOINT_BODY_LIMIT', 413, 'The endpoint binding request exceeds its limit.') : rawStatus === 415 ? new PathFinderError('ENDPOINT_ENCODING_UNSUPPORTED', 415, 'Use uncompressed UTF-8 application/json.') : new PathFinderError('ENDPOINT_OUTCOME_UNKNOWN', 500, 'The operation could not be confirmed. Keep the same save command for reconciliation.');
  res.setHeader('Cache-Control', 'private, no-store'); res.status(safe.status).json(endpointBindingErrorSchema.parse({ schemaVersion: 'wfc.pf.endpoint-binding-error.v1', code: safe.code, message: safe.message, outcome: safe.status >= 500 ? 'unknown' : 'refused' }));
}
const offset = z.string().refine(v => /^(?:0|[1-9][0-9]{0,6})$/.exec(v)?.[0] === v && Number(v) <= 1_000_000).transform(Number);
const limit = z.string().refine(v => /^(?:[1-9]|[1-9][0-9]|100)$/.exec(v)?.[0] === v).transform(Number);
/** Mount before generic JSON. Prefix ownership includes malformed/case variants, preventing fallback bypasses. */
export function createEndpointBindingRouter(_pool: Pool, repository: EndpointBindingRepository): Router {
  const router = Router({ mergeParams: true, caseSensitive: true });
  const project = (req: Request) => policyUuidSchema.parse(req.params.projectId), location = (req: Request) => policyUuidSchema.parse(req.params.locationId);
  router.use(async (req, res, next) => {
    if (!/^\/(?:endpoint-bindings(?:\/|$)|locations\/[^/]+\/(?:endpoint-binding|binding-history)(?:\/|$))/i.test(req.path)) { next('router'); return; }
    res.setHeader('Cache-Control', 'private, no-store'); const bearer = /^Bearer\s+(\S+)$/i.exec((req.header('authorization') ?? '').trim())?.[1];
    if (!bearer) { sendEndpointBindingError(res, new PathFinderError('AUTHENTICATION_REQUIRED', 401)); return; }
    try { const payload = verifyAccessToken(bearer); req.userId = policyUuidSchema.parse(payload.sub); req.loginId = policyUuidSchema.parse(payload.jti); if (!Number.isSafeInteger(payload.exp)) throw Error('expiry'); req.loginExpiresAt = payload.exp! * 1000; } catch { sendEndpointBindingError(res, new PathFinderError('LOGIN_REVOKED', 401)); return; }
    try {
      await repository.authorize(project(req), requestPrincipal(req));
      if (['POST', 'PUT'].includes(req.method)) {
        const declared = req.header('content-length');
        if (declared !== undefined && (!/^(?:0|[1-9][0-9]*)$(?![\s\S])/.test(declared) || BigInt(declared) > BigInt(ENDPOINT_BINDING_LIMITS.controlBytes))) { res.setHeader('Connection', 'close'); throw new PathFinderError('ENDPOINT_BODY_LIMIT', 413); }
        if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.header('content-type') ?? '')) throw new PathFinderError('ENDPOINT_CONTENT_TYPE_REQUIRED', 415);
        if ((req.header('content-encoding') ?? 'identity').toLowerCase() !== 'identity') throw new PathFinderError('ENDPOINT_ENCODING_UNSUPPORTED', 415);
      }
      next();
    } catch (error) { sendEndpointBindingError(res, error); }
  });
  const emptyQuery = (req: Request) => z.object({}).strict().parse(req.query);
  const raw = express.raw({ type: () => true, limit: ENDPOINT_BINDING_LIMITS.controlBytes, inflate: false });
  const body = (req: Request) => { if (!Buffer.isBuffer(req.body)) throw new PathFinderError('INVALID_ENDPOINT_BINDING_REQUEST', 400); return parsePolicyJson(req.body, { maxBytes: ENDPOINT_BINDING_LIMITS.controlBytes }); };
  const mutate = (operation: (req: Request, signal: AbortSignal) => Promise<unknown>) => async (req: Request, res: Response) => { const controller = new AbortController(), closed = () => { if (!res.writableEnded) controller.abort(); }; res.once('close', closed); try { emptyQuery(req); res.json(await operation(req, controller.signal)); } catch (error) { if (!res.destroyed) sendEndpointBindingError(res, error); } finally { res.removeListener('close', closed); } };
  router.get('/endpoint-bindings', async (req, res) => { try { const options = z.object({ offset: offset.optional(), limit: limit.optional() }).strict().parse(req.query); res.json(await repository.list(project(req), requestPrincipal(req), options)); } catch (error) { sendEndpointBindingError(res, error); } });
  router.get('/locations/:locationId/endpoint-binding', async (req, res) => { try { emptyQuery(req); res.json(await repository.context(project(req), requestPrincipal(req), location(req))); } catch (error) { sendEndpointBindingError(res, error); } });
  router.get('/locations/:locationId/binding-history', async (req, res) => { try { const options = z.object({ beforeRevision: policyRevisionSchema.optional(), limit: limit.optional() }).strict().parse(req.query); res.json(await repository.history(project(req), requestPrincipal(req), location(req), options)); } catch (error) { sendEndpointBindingError(res, error); } });
  router.put('/locations/:locationId/endpoint-binding', raw, mutate((req, signal) => repository.confirm(project(req), requestPrincipal(req), location(req), endpointBindingWriteSchema.parse(body(req)), signal)));
  router.post('/endpoint-bindings/migrations', raw, mutate((req, signal) => repository.migrate(project(req), requestPrincipal(req), endpointMigrationWriteSchema.parse(body(req)), signal)));
  router.post('/endpoint-bindings/migrations/:decisionId/confirm', raw, mutate((req, signal) => repository.confirmMigration(project(req), requestPrincipal(req), policyUuidSchema.parse(req.params.decisionId), endpointMigrationConfirmSchema.parse(body(req)), signal)));
  router.use((_req, res) => sendEndpointBindingError(res, new PathFinderError('ENDPOINT_METHOD_UNSUPPORTED', 405)));
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => sendEndpointBindingError(res, error)); return router;
}
