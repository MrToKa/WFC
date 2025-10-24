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

type NormalizedSupportOverrides = Record<
  string,
  {
    distance: number | null;
    supportId: string | null;
  }
>;

const syncSupportDistances = async (
  projectId: string,
  overrides: NormalizedSupportOverrides
): Promise<void> => {
  const entries = Object.entries(overrides)
    .map(([trayType, value]) => [trayType.trim(), value] as const)
    .filter(
      ([trayType, value]) =>
        trayType !== '' && (value.distance !== null || value.supportId !== null)
    );

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM project_support_distances WHERE project_id = $1;`,
      [projectId]
    );

    for (const [trayType, value] of entries) {
      await client.query(
        `
          INSERT INTO project_support_distances (
            project_id,
            tray_type,
            support_distance,
            support_id,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, NOW(), NOW())
          ON CONFLICT (project_id, tray_type)
          DO UPDATE
          SET
            support_distance = EXCLUDED.support_distance,
            support_id = EXCLUDED.support_id,
            updated_at = NOW();
        `,
        [projectId, trayType, value.distance, value.supportId]
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

type SupportOverrideInput =
  | {
      distance?: unknown;
      supportId?: unknown;
    }
  | number
  | null
  | undefined;

const normalizeSupportDistances = (
  distances: Record<string, SupportOverrideInput>
): NormalizedSupportOverrides => {
  const parseNumeric = (value: unknown): number | null => {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }

    if (typeof value === 'string') {
      const normalized = value.trim().replace(',', '.');
      if (normalized === '') {
        return null;
      }
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  };

  return Object.entries(distances).reduce<NormalizedSupportOverrides>(
    (acc, [trayType, rawValue]) => {
      const normalizedTrayType = trayType.trim();
      if (normalizedTrayType === '') {
        return acc;
      }

      let distance: number | null = null;
      let supportId: string | null = null;

      if (
        rawValue !== null &&
        rawValue !== undefined &&
        typeof rawValue === 'object' &&
        !Array.isArray(rawValue)
      ) {
        const candidate = rawValue as {
          distance?: unknown;
          supportId?: unknown;
        };

        if (candidate.distance !== undefined) {
          distance = candidate.distance === null ? null : parseNumeric(candidate.distance);
        }

        if (candidate.supportId !== undefined) {
          if (
            candidate.supportId === null ||
            (typeof candidate.supportId === 'string' &&
              candidate.supportId.trim() === '')
          ) {
            supportId = null;
          } else if (typeof candidate.supportId === 'string') {
            supportId = candidate.supportId.trim();
          }
        }
      } else {
        distance = parseNumeric(rawValue);
      }

      if (distance === null && supportId === null) {
        return acc;
      }

      acc[normalizedTrayType] = { distance, supportId };
      return acc;
    },
    {}
  );
};

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
                SELECT jsonb_object_agg(
                  d.tray_type,
                  jsonb_build_object(
                    'distance', d.support_distance,
                    'supportId', d.support_id,
                    'supportType', s.support_type
                  )
                )
                FROM project_support_distances d
                LEFT JOIN material_supports s ON s.id = d.support_id
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
