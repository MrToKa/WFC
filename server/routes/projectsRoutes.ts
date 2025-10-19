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

projectsRouter.get(
  '/',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await pool.query<ProjectRow>(
        `
          SELECT
            id,
            project_number,
            name,
            customer,
            manager,
            description,
            secondary_tray_length,
            created_at,
            updated_at
          FROM projects
          ORDER BY created_at DESC;
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
      secondaryTrayLength
    } = parseResult.data;
    const projectId = randomUUID();
    const normalizedDescription =
      description === undefined ? undefined : description.trim();
    const normalizedManager = manager === undefined ? undefined : manager.trim();

    try {
      const result = await pool.query<ProjectRow>(
        `
          INSERT INTO projects (
            id,
            project_number,
            name,
            customer,
            manager,
            description,
            secondary_tray_length
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING
            id,
            project_number,
            name,
            customer,
            manager,
            description,
            secondary_tray_length,
            created_at,
            updated_at;
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
          secondaryTrayLength ?? null
        ]
      );

      res.status(201).json({ project: mapProjectRow(result.rows[0]) });
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

    const { projectNumber, name, customer, description, manager } =
      parseResult.data;

    const fields: string[] = [];
    const values: Array<string | null> = [];
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

    fields.push(`updated_at = NOW()`);

    try {
      const result = await pool.query<ProjectRow>(
        `
          UPDATE projects
          SET ${fields.join(', ')}
          WHERE id = $${index}
          RETURNING
            id,
            project_number,
            name,
            customer,
            manager,
            description,
            secondary_tray_length,
            created_at,
            updated_at;
        `,
        [...values, projectId]
      );

      const projectRow = result.rows[0];

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
