import type { Request, Response } from 'express';
import { z } from 'zod';
import { requestPrincipal } from './auth.js';
import { PathFinderError } from './errors.js';
import type { CableWorkflowRepository } from './cableWorkflowRepository.js';

/** Mounted behind requireAdmin; the repository rechecks the existing current login without DML. */
export function createCableWorkflowReadHandlers(repository: CableWorkflowRepository) {
  const read = (kind: 'page' | 'detail') => async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const abort = new AbortController(), disconnected = () => abort.abort(), closed = () => { if (!res.writableEnded) abort.abort(); };
    req.once('aborted', disconnected); res.once('close', closed);
    try {
      const who = requestPrincipal(req), projectId = req.params.projectId;
      const result = kind === 'page' ? await repository.page(projectId, who, req.query, abort.signal, true)
        : await repository.detail(projectId, who, req.params.cableId, req.query, abort.signal, true);
      if (!res.destroyed && !abort.signal.aborted) res.json(result);
    } catch (error) {
      if (!res.destroyed && !abort.signal.aborted) {
        const safe = error instanceof PathFinderError ? error : error instanceof z.ZodError
          ? new PathFinderError('INVALID_WORKFLOW_QUERY', 400) : new PathFinderError('WORKFLOW_READ_UNAVAILABLE', 503);
        const message = safe.status === 401 ? 'Sign in again to refresh the current session.' : safe.status === 403 ? 'Administrator access required.'
          : safe.code === 'WORKFLOW_CURSOR_INVALID' ? 'The cable list changed. Refresh it from the beginning.'
            : safe.status === 400 ? 'Use the supported cable filters, search, preferences and cursor.'
              : safe.code === 'WORKFLOW_ADMISSION_LIMIT' ? 'The retained calculation history exceeds this diagnostic read limit.'
                : safe.status === 404 ? 'This project cable is unavailable.' : 'Cable diagnostics are unavailable. Refresh the current project.';
        res.status(safe.status).json({ code: safe.code, error: message });
      }
    } finally { req.removeListener('aborted', disconnected); res.removeListener('close', closed); }
  };
  return { page: read('page'), detail: read('detail') };
}
