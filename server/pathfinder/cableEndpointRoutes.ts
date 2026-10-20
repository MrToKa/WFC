import express, { Router, type Request, type Response, type NextFunction } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { policyHashSchema, policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { CABLE_ENDPOINT_LIMITS, cableEndpointCommandSchema, cableEndpointEndSchema, cableEndpointErrorSchema } from '../../shared/pathfinderCableEndpoints.js';
import { verifyAccessToken } from '../auth.js';
import { requestPrincipal } from './auth.js';
import { PathFinderError } from './errors.js';
import { parsePolicyJson } from './policyJson.js';
import { createCableEndpointCommands, type CableEndpointCommands } from './cableEndpointCommands.js';
import { CABLE_ENDPOINT_PAIR_LIMITS, cableEndpointPairCommandSchema } from '../../shared/pathfinderCableEndpointPair.js';

export function sendCableEndpointError(res: Response, error: unknown): void {
  const status = (error as { status?: number } | null)?.status;
  const safe = error instanceof PathFinderError ? error : error instanceof z.ZodError || status === 400 ? new PathFinderError('INVALID_CABLE_ENDPOINT_REQUEST', 400)
    : status === 413 ? new PathFinderError('CABLE_ENDPOINT_BODY_LIMIT', 413) : status === 415 ? new PathFinderError('CABLE_ENDPOINT_ENCODING_UNSUPPORTED', 415)
      : new PathFinderError('CABLE_ENDPOINT_OUTCOME_UNKNOWN', 503);
  const message = safe.status === 401 ? 'Sign in again to refresh the current session.' : safe.status === 403 ? 'Administrator access required.'
    : safe.code === 'CABLE_ENDPOINT_COMMAND_CLOSED' ? 'This exact save command was closed and cannot be submitted again.'
      : safe.status === 400 ? 'The cable endpoint request is invalid.' : safe.status === 413 ? 'The cable endpoint request exceeds its supported limit.'
        : safe.status === 415 ? 'Use uncompressed UTF-8 application/json.'
          : 'The cable endpoint changed or is unavailable. Keep an uncertain command until its saved result or closed disposition is confirmed.';
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(safe.status).json(cableEndpointErrorSchema.parse({ schemaVersion: 'wfc.pf.cable-endpoint-error.v1', code: safe.code,
    message, outcome: safe.status >= 500 ? 'unknown' : 'refused' }));
}
/** Owns this entire prefix before generic parsers. Reads use existing-login SELECT-only authority; writes recheck through commit. */
export function createCableEndpointRouter(pool: Pool, repository: CableEndpointCommands = createCableEndpointCommands(pool)): Router {
  const router = Router({ mergeParams: true, caseSensitive: true });
  const requests = new WeakMap<Request, { controller: AbortController; cleanup: () => void }>();
  const begin = (req: Request, res: Response) => {
    const controller = new AbortController(), disconnected = () => controller.abort(), closed = () => { if (!res.writableEnded) controller.abort(); cleanup(); };
    const cleanup = () => { clearTimeout(timeout); req.removeListener('aborted', disconnected); res.removeListener('close', closed); res.removeListener('finish', cleanup); };
    const timeout = setTimeout(() => {
      controller.abort(new PathFinderError('CABLE_ENDPOINT_DEADLINE_EXCEEDED', 503)); cleanup();
      if (!res.destroyed && !res.writableEnded) { res.setHeader('Connection', 'close'); sendCableEndpointError(res, controller.signal.reason); }
    }, 15000);
    req.once('aborted', disconnected); res.once('close', closed); res.once('finish', cleanup);
    const value = { controller, cleanup }; requests.set(req, value); return value;
  };
  const project = (req: Request) => policyUuidSchema.parse(req.params.projectId), cable = (req: Request) => policyUuidSchema.parse(req.params.cableId);
  const end = (req: Request) => cableEndpointEndSchema.parse(req.params.end);
  router.use(async (req, res, next) => {
    if (!/^\/(?:cable-endpoints|cable-endpoint-pairs)(?:\/|$)/i.test(req.path)) { next('router'); return; }
    res.setHeader('Cache-Control', 'private, no-store');
    const bearer = /^Bearer\s+(\S+)$/i.exec((req.header('authorization') ?? '').trim())?.[1];
    if (!bearer) { sendCableEndpointError(res, new PathFinderError('AUTHENTICATION_REQUIRED', 401)); return; }
    try { const value = verifyAccessToken(bearer); req.userId = policyUuidSchema.parse(value.sub); req.loginId = policyUuidSchema.parse(value.jti);
      if (!Number.isSafeInteger(value.exp)) throw Error('expiry'); req.loginExpiresAt = value.exp! * 1000;
    } catch { sendCableEndpointError(res, new PathFinderError('LOGIN_REVOKED', 401)); return; }
    const scope = begin(req, res);
    try {
      await repository.authorize(project(req), requestPrincipal(req), scope.controller.signal); scope.controller.signal.throwIfAborted();
      if (['PUT', 'POST'].includes(req.method)) {
        const maximum = /^\/cable-endpoint-pairs(?:\/|$)/i.test(req.path) ? CABLE_ENDPOINT_PAIR_LIMITS.controlBytes : CABLE_ENDPOINT_LIMITS.controlBytes;
        const declared = req.header('content-length');
        if (declared !== undefined && (!/^(?:0|[1-9][0-9]*)$(?![\s\S])/.test(declared) || BigInt(declared) > BigInt(maximum))) {
          res.setHeader('Connection', 'close'); throw new PathFinderError('CABLE_ENDPOINT_BODY_LIMIT', 413);
        }
        if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.header('content-type') ?? '')) throw new PathFinderError('CABLE_ENDPOINT_CONTENT_TYPE_REQUIRED', 415);
        if ((req.header('content-encoding') ?? 'identity').toLowerCase() !== 'identity') throw new PathFinderError('CABLE_ENDPOINT_ENCODING_UNSUPPORTED', 415);
      }
      next();
    } catch (error) { scope.cleanup(); if (!res.writableEnded && !res.destroyed) sendCableEndpointError(res, error); }
  });
  const empty = (req: Request) => z.object({}).strict().parse(req.query);
  const raw = express.raw({ type: () => true, limit: CABLE_ENDPOINT_LIMITS.controlBytes, inflate: false });
  const body = (req: Request) => { if (!Buffer.isBuffer(req.body)) throw new PathFinderError('INVALID_CABLE_ENDPOINT_REQUEST', 400);
    return cableEndpointCommandSchema.parse(parsePolicyJson(req.body, { maxBytes: CABLE_ENDPOINT_LIMITS.controlBytes })); };
  const pairRaw = express.raw({ type: () => true, limit: CABLE_ENDPOINT_PAIR_LIMITS.controlBytes, inflate: false });
  const pairBody = (req: Request) => { if (!Buffer.isBuffer(req.body)) throw new PathFinderError('INVALID_CABLE_ENDPOINT_REQUEST', 400);
    return cableEndpointPairCommandSchema.parse(parsePolicyJson(req.body, { maxBytes: CABLE_ENDPOINT_PAIR_LIMITS.controlBytes })); };
  const handle = (operation: (req: Request, signal: AbortSignal) => Promise<unknown>) => async (req: Request, res: Response) => {
    const scope = requests.get(req)!;
    try { if (res.writableEnded || res.destroyed) return; scope.controller.signal.throwIfAborted();
      const result = await operation(req, scope.controller.signal); scope.controller.signal.throwIfAborted(); if (!res.destroyed && !res.writableEnded) res.json(result); }
    catch (error) { if (!res.destroyed && !res.writableEnded) sendCableEndpointError(res, error); }
    finally { scope.cleanup(); }
  };
  const base = '/cable-endpoints/:cableId/:end';
  router.get(base, handle((req, signal) => { empty(req); return repository.context(project(req), requestPrincipal(req), cable(req), end(req), signal); }));
  router.get(`${base}/selection`, handle((req, signal) => {
    const query = z.object({ sdkObjectId: z.string().refine(value => /^(?:[1-9][0-9]{0,9})$/.exec(value)?.[0] === value && Number(value) <= 2147483647).transform(Number), contextSha256: policyHashSchema }).strict().parse(req.query);
    return repository.selection(project(req), requestPrincipal(req), cable(req), end(req), query.sdkObjectId, query.contextSha256, signal);
  }));
  router.put(base, raw, handle((req, signal) => { empty(req); return repository.save(project(req), requestPrincipal(req), cable(req), end(req), body(req), signal); }));
  router.post(`${base}/close-pending`, raw, handle((req, signal) => { empty(req); return repository.close(project(req), requestPrincipal(req), cable(req), end(req), body(req), signal); }));
  const pairBase = '/cable-endpoint-pairs/:cableId';
  router.put(pairBase, pairRaw, handle((req, signal) => { empty(req); return repository.savePair(project(req), requestPrincipal(req), cable(req), pairBody(req), signal); }));
  router.post(`${pairBase}/close-pending`, pairRaw, handle((req, signal) => { empty(req); return repository.closePair(project(req), requestPrincipal(req), cable(req), pairBody(req), signal); }));
  router.use((req, res) => { requests.get(req)?.cleanup(); if (!res.writableEnded && !res.destroyed) sendCableEndpointError(res, new PathFinderError('CABLE_ENDPOINT_METHOD_UNSUPPORTED', 405)); });
  router.use((error: unknown, req: Request, res: Response, _next: NextFunction) => { requests.get(req)?.cleanup(); if (!res.writableEnded && !res.destroyed) sendCableEndpointError(res, error); }); return router;
}
