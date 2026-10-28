import type { Request, Response } from 'express';
import { z } from 'zod';
import { policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { requestPrincipal } from './auth.js';
import { PathFinderError } from './errors.js';
import type { createInitialFillProgress } from './initialFillProgress.js';

const querySchema = z.object({ cableId: policyUuidSchema.optional() }).strict();
/** Metadata-only GET. The repository rechecks current admin/login and exact actor ownership. */
export function createInitialFillProgressReadHandler(service: ReturnType<typeof createInitialFillProgress>) {
  return async (req: Request, res: Response) => {
    const controller = new AbortController(), disconnect = () => controller.abort();
    const close = () => { if (!res.writableEnded) controller.abort(); };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => { timer = setTimeout(() => {
      const error = new PathFinderError('INITIAL_FILL_PROGRESS_DEADLINE', 503); controller.abort(error); reject(error);
    }, 15000); });
    req.once('aborted', disconnect); res.once('close', close); res.setHeader('Cache-Control', 'private, no-store');
    try {
      const input = querySchema.parse(req.query), projectId = policyUuidSchema.parse(req.params.projectId), impactId = policyUuidSchema.parse(req.params.impactId);
      const value = await Promise.race([service.read(projectId, requestPrincipal(req), { impactId, ...input }, controller.signal), expired]);
      controller.signal.throwIfAborted();
      if (Buffer.byteLength(JSON.stringify(value)) > 32768) throw new PathFinderError('INITIAL_FILL_PROGRESS_LIMIT', 413);
      if (!res.destroyed && !res.writableEnded) res.json(value);
    } catch (error) {
      const safe = error instanceof PathFinderError ? error : error instanceof z.ZodError
        ? new PathFinderError('INVALID_INITIAL_FILL_PROGRESS_REQUEST', 400) : new PathFinderError('INITIAL_FILL_PROGRESS_UNAVAILABLE', 503);
      if (!res.destroyed && !res.writableEnded) res.status(safe.status).json({ code: safe.code,
        error: [401, 403].includes(safe.status) ? 'Current administrator access is required.' : 'Cable update progress is unavailable. Refresh to try again.' });
    } finally { if (timer) clearTimeout(timer); req.removeListener('aborted', disconnect); res.removeListener('close', close); }
  };
}
