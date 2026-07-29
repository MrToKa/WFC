import type { Request, Response, Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import type { StandardMaterialOwnerCategory } from '../models/standardMaterial.js';
import { authenticate, requireAdmin } from '../middleware.js';
import {
  createStandardMaterialAssignment,
  deleteStandardMaterialAssignment,
  StandardMaterialDomainError,
  updateStandardMaterialAssignment,
} from '../services/standardMaterialService.js';
import {
  createStandardMaterialSchema,
  updateStandardMaterialSchema,
} from '../validators.js';

const uuidSchema = z.string().uuid();

const respondForDomainError = (error: unknown, res: Response): boolean => {
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
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const standardMaterial = await createStandardMaterialAssignment(
          client,
          category,
          ids.ownerId,
          parsed.data,
        );
        await client.query('COMMIT');
        res.status(201).json({ standardMaterial });
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
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
      } finally {
        client.release();
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
      const parsed = updateStandardMaterialSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const standardMaterial = await updateStandardMaterialAssignment(
          client,
          category,
          ids.ownerId,
          ids.assignmentId,
          parsed.data,
        );
        await client.query('COMMIT');
        res.json({ standardMaterial });
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
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
      } finally {
        client.release();
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
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await deleteStandardMaterialAssignment(
          client,
          category,
          ids.ownerId,
          ids.assignmentId,
        );
        await client.query('COMMIT');
        res.status(204).send();
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        if (respondForDomainError(error, res)) return;
        console.error('Delete Standard Material assignment error', error);
        res.status(500).json({ error: 'Failed to delete Standard Material assignment' });
      } finally {
        client.release();
      }
    },
  );
};
