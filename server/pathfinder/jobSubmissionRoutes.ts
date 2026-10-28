import type { Request, Response } from 'express';
import { z } from 'zod';
import { calculationSubmissionRefusalSchema } from '../../shared/pathfinderCalculationSubmission.js';
import { requestPrincipal } from './auth.js';
import { uuid } from './contracts.js';
import { PathFinderError } from './errors.js';
import { createJobSchema, type JobPrincipal } from './jobContracts.js';

type CreateJob = (projectId: string, principal: JobPrincipal, input: z.infer<typeof createJobSchema>) => Promise<unknown>;

/** Both matching and admission use principalTransaction. Its COMMIT failures
 * become PATHFINDER_COMMIT_OUTCOME_UNKNOWN/503. A 409 from create therefore
 * cannot describe a committed job for this invocation. Send this evidence only
 * here, and never reinterpret an older request whose response was lost. */
export function createJobSubmissionHandler(create: CreateJob) {
  return async (req: Request, res: Response): Promise<void> => {
    let result: unknown;
    try {
      const projectId = uuid.parse(req.params.projectId);
      uuid.parse(req.userId);
      result = await create(projectId, requestPrincipal(req), createJobSchema.parse(req.body));
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ code: 'INVALID_PATHFINDER_REQUEST', error: 'Invalid PathFinder request.' });
        return;
      }
      if (error instanceof PathFinderError && error.status === 409) {
        res.status(409).json(calculationSubmissionRefusalSchema.parse({
          schemaVersion: 'wfc.pf.calculation-submission-refusal.v1', calculationSubmitted: false,
          code: error.code, error: error.message,
        }));
        return;
      }
      const safe = error instanceof PathFinderError ? error : new PathFinderError('PATHFINDER_FAILURE', 500, 'PathFinder operation failed.');
      if (!(error instanceof PathFinderError)) console.error('PathFinder calculation submission failed', error);
      res.status(safe.status).json({ code: safe.code, error: safe.message });
      return;
    }
    // Response failures after a committed create are never labeled as refusals.
    res.status(202).json(result);
  };
}
