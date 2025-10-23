import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { Router } from 'express';
import { pool } from '../db.js';
import { mapProjectRow } from '../models/project.js';
import type { ProjectRow } from '../models/project.js';
import { authenticate, requireAdmin } from '../middleware.js';
import {
  createProjectSchema,
  updateProjectSchema
} from '../validators.js';
import { ensureProjectExists } from '../services/projectService.js';
import { cableTypesRouter } from './cableTypesRoutes.js';
import { cablesRouter } from './cablesRoutes.js';
import { traysRouter } from './traysRoutes.js';

const projectsRouter = Router();

const syncSupportDistances = async (
  projectId: string,
  distances: Record<string, number>
): Promise<void> => {
  const entries = Object.entries(distances).filter(([trayType]) => trayType.trim() !== '');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM project_support_distances WHERE project_id = $1;`,
      [projectId]
    );

    for (const [trayType, distance] of entries) {
      await client.query(
        `
          INSERT INTO project_support_distances (
            project_id,
            tray_type,
            support_distance,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, NOW(), NOW())
          ON CONFLICT (project_id, tray_type)
          DO UPDATE
          SET
            support_distance = EXCLUDED.support_distance,
            updated_at = NOW();
        `,
        [projectId, trayType.trim(), distance]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const normalizeSupportDistances = (
  distances: Record<string, number | null>
): Record<string, number> =>
  Object.entries(distances).reduce<Record<string, number>>((acc, [trayType, value]) => {
    if (value !== null && Number.isFinite(value)) {
      acc[trayType] = value;
    }
    return acc;
  }, {});

projectsRouter.get(
  '/',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await pool.query<ProjectRow>(
        `
          SELECT
            p.id,
            p.project_number,
            p.name,
            p.customer,
            p.manager,
            p.description,
            p.secondary_tray_length,
            p.support_distance,
            p.support_weight,
            COALESCE(
              (
                SELECT jsonb_object_agg(d.tray_type, d.support_distance)
                FROM project_support_distances d
                WHERE d.project_id = p.id
              ),
              '{}'::jsonb
            ) AS support_distances,
            p.created_at,
            p.updated_at
          FROM projects p
          ORDER BY p.created_at DESC;
        `
      );
      res.json({ projects: result.rows.map(mapProjectRow) });
    } catch (error) {
      console.error('List projects error', error);
      res.status(500).json({ error: 'Failed to fetch projects' });
    }
  }
);

projectsRouter.get(
  '/:projectId',
  async (req: Request, res: Response): Promise<void> => {
    const { projectId } = req.params;

    if (!projectId) {
      res.status(400).json({ error: 'Project ID is required' });
      return;
    }

    try {
      const project = await ensureProjectExists(projectId);

      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      res.json({ project: mapProjectRow(project) });
    } catch (error) {
      console.error('Fetch project error', error);
      res.status(500).json({ error: 'Failed to fetch project details' });
    }
  }
);

projectsRouter.post(
  '/',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const parseResult = createProjectSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.flatten() });
      return;
    }

    const {
      projectNumber,
      name,
      customer,
      description,
      manager,
      secondaryTrayLength,
      supportDistance,
      supportWeight,
      supportDistances
    } = parseResult.data;
    const projectId = randomUUID();
    const normalizedDescription =
      description === undefined ? undefined : description.trim();
    const normalizedManager = manager === undefined ? undefined : manager.trim();

    try {
      await pool.query<{ id: string }>(
        `
          INSERT INTO projects (
            id,
            project_number,
            name,
            customer,
            manager,
            description,
            secondary_tray_length,
            support_distance,
            support_weight
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING id;
        `,
        [
          projectId,
          projectNumber.trim(),
          name.trim(),
          customer.trim(),
          normalizedManager === undefined || normalizedManager === ''
            ? null
            : normalizedManager,
          normalizedDescription === undefined || normalizedDescription === ''
            ? null
            : normalizedDescription,
          secondaryTrayLength ?? null,
          supportDistance ?? null,
          supportWeight ?? null
        ]
      );

      if (supportDistances !== undefined) {
        await syncSupportDistances(projectId, normalizeSupportDistances(supportDistances));
      }

      const projectRow = await ensureProjectExists(projectId);

      if (!projectRow) {
        res.status(500).json({ error: 'Failed to create project' });
        return;
      }

      res.status(201).json({ project: mapProjectRow(projectRow) });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: string }).code === '23505'
      ) {
        res.status(409).json({ error: 'Project number already in use' });
        return;
      }

      console.error('Create project error', error);
      res.status(500).json({ error: 'Failed to create project' });
    }
  }
);

projectsRouter.patch(
  '/:projectId',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const { projectId } = req.params;

    if (!projectId) {
      res.status(400).json({ error: 'Project ID is required' });
      return;
    }

    const parseResult = updateProjectSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.flatten() });
      return;
    }

    const { projectNumber, name, customer, description, manager, supportDistances } =
      parseResult.data;

    const fields: string[] = [];
    const values: Array<string | number | null> = [];
    let index = 1;

    if (projectNumber !== undefined) {
      fields.push(`project_number = $${index++}`);
      values.push(projectNumber.trim());
    }

    if (name !== undefined) {
      fields.push(`name = $${index++}`);
      values.push(name.trim());
    }

    if (customer !== undefined) {
      fields.push(`customer = $${index++}`);
      values.push(customer.trim());
    }

    if (manager !== undefined) {
      const normalized = manager.trim();
      fields.push(`manager = $${index++}`);
      values.push(normalized === '' ? null : normalized);
    }

    if (description !== undefined) {
      const normalized = description.trim();
      fields.push(`description = $${index++}`);
      values.push(normalized === '' ? null : normalized);
    }

    if (parseResult.data.secondaryTrayLength !== undefined) {
      fields.push(`secondary_tray_length = $${index++}`);
      values.push(parseResult.data.secondaryTrayLength);
    }

    if (parseResult.data.supportDistance !== undefined) {
      fields.push(`support_distance = $${index++}`);
      values.push(parseResult.data.supportDistance);
    }

    if (parseResult.data.supportWeight !== undefined) {
      fields.push(`support_weight = $${index++}`);
      values.push(parseResult.data.supportWeight);
    }

    fields.push(`updated_at = NOW()`);

    try {
      const result = await pool.query<{ id: string }>(
        `
          UPDATE projects
          SET ${fields.join(', ')}
          WHERE id = $${index}
          RETURNING id;
        `,
        [...values, projectId]
      );

      if (result.rowCount === 0) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      if (supportDistances !== undefined) {
        await syncSupportDistances(projectId, normalizeSupportDistances(supportDistances));
      }

      const projectRow = await ensureProjectExists(projectId);

      if (!projectRow) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      res.json({ project: mapProjectRow(projectRow) });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: string }).code === '23505'
      ) {
        res.status(409).json({ error: 'Project number already in use' });
        return;
      }

      console.error('Update project error', error);
      res.status(500).json({ error: 'Failed to update project' });
    }
  }
);

projectsRouter.delete(
  '/:projectId',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const { projectId } = req.params;

    if (!projectId) {
      res.status(400).json({ error: 'Project ID is required' });
      return;
    }

    try {
      const result = await pool.query(
        `DELETE FROM projects WHERE id = $1 RETURNING id`,
        [projectId]
      );

      if (result.rowCount === 0) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      res.status(204).send();
    } catch (error) {
      console.error('Delete project error', error);
      res.status(500).json({ error: 'Failed to delete project' });
    }
  }
);

projectsRouter.use('/:projectId/cable-types', cableTypesRouter);
projectsRouter.use('/:projectId/cables', cablesRouter);
projectsRouter.use('/:projectId/trays', traysRouter);

export { projectsRouter };
