import express, { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { MODEL_LOCATION_MATCH_LIMITS, modelLocationMatchAssignSchema } from '../../shared/pathfinderModelLocationMatch.js';
import { policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { verifyAccessToken } from '../auth.js';
import { requestPrincipal } from './auth.js';
import { PathFinderError } from './errors.js';
import { sendEndpointBindingError } from './endpointBindingRoutes.js';
import { parsePolicyJson } from './policyJson.js';
import type { ModelLocationMatchRepository } from './modelLocationMatch.js';

/** Own this bounded endpoint namespace before the application's generic JSON parser. */
export function createModelLocationMatchRouter(repository: ModelLocationMatchRepository): Router {
  const router = Router({ mergeParams: true, caseSensitive: true });
  const project = (req: Request) => policyUuidSchema.parse(req.params.projectId);
  router.use(async (req, res, next) => {
    if (!/^\/locations\/model-match(?:\/|$)/i.test(req.path)) { next('router'); return; }
    res.setHeader('Cache-Control', 'private, no-store');
    const bearer = /^Bearer\s+(\S+)$/i.exec((req.header('authorization') ?? '').trim())?.[1];
    if (!bearer) { sendEndpointBindingError(res, new PathFinderError('AUTHENTICATION_REQUIRED', 401)); return; }
    try {
      const payload = verifyAccessToken(bearer); req.userId = policyUuidSchema.parse(payload.sub); req.loginId = policyUuidSchema.parse(payload.jti);
      if (!Number.isSafeInteger(payload.exp)) throw Error('expiry'); req.loginExpiresAt = payload.exp! * 1000;
    } catch { sendEndpointBindingError(res, new PathFinderError('LOGIN_REVOKED', 401)); return; }
    try {
      // Repeat current authority inside the command transaction after upload.
      await repository.authorize(project(req), requestPrincipal(req));
      z.object({}).strict().parse(req.query);
      if (req.method === 'POST') {
        const declared = req.header('content-length');
        if (declared !== undefined && (!/^(?:0|[1-9][0-9]*)$(?![\s\S])/.test(declared) || BigInt(declared) > BigInt(MODEL_LOCATION_MATCH_LIMITS.bodyBytes))) {
          res.setHeader('Connection', 'close'); throw new PathFinderError('MODEL_LOCATION_MATCH_BODY_LIMIT', 413);
        }
        if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.header('content-type') ?? '')
          || (req.header('content-encoding') ?? 'identity').toLowerCase() !== 'identity') throw new PathFinderError('ENDPOINT_ENCODING_UNSUPPORTED', 415);
      }
      next();
    } catch (error) { sendEndpointBindingError(res, error); }
  });
  const action = (fn: (req: Request, signal: AbortSignal) => Promise<unknown>) => async (req: Request, res: Response) => {
    const controller = new AbortController(), closed = () => { if (!res.writableEnded) controller.abort(); };
    res.once('close', closed);
    try { res.json(await fn(req, controller.signal)); } catch (error) { if (!res.destroyed) sendEndpointBindingError(res, error); }
    finally { res.removeListener('close', closed); }
  };
  router.get('/locations/model-match/context', action((req, signal) => repository.context(project(req), requestPrincipal(req), signal)));
  router.post('/locations/model-match/assign', express.raw({ type: () => true, limit: MODEL_LOCATION_MATCH_LIMITS.bodyBytes, inflate: false }), action((req, signal) => {
    if (!Buffer.isBuffer(req.body)) throw new PathFinderError('INVALID_ENDPOINT_BINDING_REQUEST', 400);
    const command = modelLocationMatchAssignSchema.parse(parsePolicyJson(req.body, { maxBytes: MODEL_LOCATION_MATCH_LIMITS.bodyBytes }));
    return repository.assign(project(req), requestPrincipal(req), command, signal);
  }));
  router.use((_req, res) => sendEndpointBindingError(res, new PathFinderError('ENDPOINT_METHOD_UNSUPPORTED', 405)));
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => sendEndpointBindingError(res, error));
  return router;
}
