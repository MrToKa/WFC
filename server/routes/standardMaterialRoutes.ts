import type { Request, Response, Router } from 'express';
import { getMaterialCapability } from '../services/materialCapabilities.js';
import { z } from 'zod';
import { withTransaction } from '../utils/transaction.js';
import type { StandardMaterialOwnerCategory } from '../models/standardMaterial.js';
import { authenticate, requireAdmin } from '../middleware.js';
import {
  createStandardMaterialAssignment,
  deleteStandardMaterialAssignment,
  StandardMaterialDomainError,
  updateStandardMaterialAssignment,
  listStandardMaterialAssignments,
  captureStandardMaterialGraph,
  STANDARD_MATERIAL_MUTATION_SCOPE,
} from '../services/standardMaterialService.js';
import {
  getMutationRevision, readMutationHeaders, respondToMutationError, withVersionedMutation,
} from '../services/mutationService.js';
import { createStandardMaterialSchema, updateStandardMaterialSchema } from '../validators.js';

const uuidSchema = z.string().uuid();

const respondForDomainError = (error: unknown, res: Response): boolean => {
  if (respondToMutationError(error, res)) return true;
  if (!(error instanceof StandardMaterialDomainError)) return false;
  if (
    error.code === 'OWNER_NOT_FOUND' ||
    error.code === 'REFERENCED_MATERIAL_NOT_FOUND' ||
    error.code === 'ASSIGNMENT_NOT_FOUND'
  ) {
    res.status(404).json({ error: error.message, code: error.code });
    return true;
  }
  res.status(409).json({ error: error.message, code: error.code });
  return true;
};

const validateRouteIds = (
  req: Request,
  res: Response,
  ownerParam: string,
  includeAssignment: boolean,
): { ownerId: string; assignmentId?: string } | null => {
  const ownerId = req.params[ownerParam];
  const assignmentId = req.params.assignmentId;
  if (!uuidSchema.safeParse(ownerId).success) {
    res.status(400).json({ error: `Invalid ${ownerParam}` });
    return null;
  }
  if (includeAssignment && !uuidSchema.safeParse(assignmentId).success) {
    res.status(400).json({ error: 'Invalid assignmentId' });
    return null;
  }
  return { ownerId, assignmentId };
};

export const registerStandardMaterialMutationRoutes = (
  router: Router,
  category: StandardMaterialOwnerCategory,
  ownerPath: string,
  ownerParam: string,
): void => {
  router.get(`${ownerPath}/standard-materials`, async (req: Request, res: Response) => {
    const ids = validateRouteIds(req, res, ownerParam, false);
    if (!ids) return;
    try {
      const result = await withTransaction(async (client) => {
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const standardMaterials = await listStandardMaterialAssignments(client, category, ids.ownerId);
        const ownerStatus = await client.query<{ obsolete_at: Date | string | null }>(
          `SELECT obsolete_at FROM ${getMaterialCapability(category).ownerTable} WHERE id = $1`, [ids.ownerId]);
        const mutationRevision = await getMutationRevision(client,
          STANDARD_MATERIAL_MUTATION_SCOPE.resourceType, STANDARD_MATERIAL_MUTATION_SCOPE.resourceId);
        return { standardMaterials, mutationRevision, obsoleteAt: ownerStatus.rows[0]?.obsolete_at ?? null };
      });
      res.setHeader('ETag', `"${result.mutationRevision}"`);
      res.json(result);
    } catch (error) {
      console.error('Read Standard Material composition error', error);
      res.status(500).json({ error: 'Failed to load Standard Material composition' });
    }
  });

  const parameters = (req: Request) => ({
    ...STANDARD_MATERIAL_MUTATION_SCOPE,
    ...readMutationHeaders(req),
    actorId: req.userId ?? '',
    request: { method: req.method, category, params: req.params, body: req.body },
  });

  router.post(
    `${ownerPath}/standard-materials`,
    authenticate,
    requireAdmin,
    async (req: Request, res: Response): Promise<void> => {
      const ids = validateRouteIds(req, res, ownerParam, false);
      if (!ids) return;
      const parsed = createStandardMaterialSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      try {
        const result = await withVersionedMutation(parameters(req), (client) =>
          createStandardMaterialAssignment(client, category, ids.ownerId, parsed.data),
          captureStandardMaterialGraph,
          captureStandardMaterialGraph,
        );
        res.setHeader('ETag', `"${result.revision}"`);
        res.status(201).json({ standardMaterial: result.value, mutationRevision: result.revision });
      } catch (error) {
        if (respondForDomainError(error, res)) return;
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error.code === '23503' || error.code === '23505')
        ) {
          res.status(409).json({ error: 'Standard Material integrity conflict' });
          return;
        }
        console.error('Create Standard Material assignment error', error);
        res.status(500).json({ error: 'Failed to create Standard Material assignment' });
      }
    },
  );

  router.patch(
    `${ownerPath}/standard-materials/:assignmentId`,
    authenticate,
    requireAdmin,
    async (req: Request, res: Response): Promise<void> => {
      const ids = validateRouteIds(req, res, ownerParam, true);
      if (!ids?.assignmentId) return;
      const { ownerId, assignmentId } = ids;
      const parsed = updateStandardMaterialSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      try {
        const result = await withVersionedMutation(parameters(req), (client) =>
          updateStandardMaterialAssignment(
            client,
            category,
            ownerId,
            assignmentId,
            parsed.data,
          ),
          captureStandardMaterialGraph,
          captureStandardMaterialGraph,
        );
        res.setHeader('ETag', `"${result.revision}"`);
        res.json({ standardMaterial: result.value, mutationRevision: result.revision });
      } catch (error) {
        if (respondForDomainError(error, res)) return;
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error.code === '23503' || error.code === '23505')
        ) {
          res.status(409).json({ error: 'Standard Material integrity conflict' });
          return;
        }
        console.error('Update Standard Material assignment error', error);
        res.status(500).json({ error: 'Failed to update Standard Material assignment' });
      }
    },
  );

  router.delete(
    `${ownerPath}/standard-materials/:assignmentId`,
    authenticate,
    requireAdmin,
    async (req: Request, res: Response): Promise<void> => {
      const ids = validateRouteIds(req, res, ownerParam, true);
      if (!ids?.assignmentId) return;
      const { ownerId, assignmentId } = ids;
      try {
        const result = await withVersionedMutation(parameters(req), async (client) => {
          await deleteStandardMaterialAssignment(client, category, ownerId, assignmentId);
          return null;
        }, captureStandardMaterialGraph, captureStandardMaterialGraph);
        res.setHeader('ETag', `"${result.revision}"`);
        res.status(204).send();
      } catch (error) {
        if (respondForDomainError(error, res)) return;
        console.error('Delete Standard Material assignment error', error);
        res.status(500).json({ error: 'Failed to delete Standard Material assignment' });
      }
    },
  );
};
