import type { Request, Response } from 'express';
import { Router } from 'express';
import { pool } from '../db.js';
import { authenticate } from '../middleware.js';
import { ensureProjectExists } from '../services/projectService.js';
import {
  mapRoxtecEntryRow,
  type RoxtecEntryRow
} from '../models/roxtecEntry.js';

type RoxtecEntriesRequest = Request & {
  params: {
    projectId: string;
    roxtecId?: string;
  };
  body: {
    revision?: unknown;
    tag?: unknown;
    type?: unknown;
    description?: unknown;
  };
};

const normalizeOptionalString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

const parseRoxtecId = (value: string | undefined): number | null => {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

export const roxtecEntriesRouter = (() => {
  const router = Router({ mergeParams: true });

  router.get('/', async (req: RoxtecEntriesRequest, res: Response): Promise<void> => {
    const { projectId } = req.params;

    if (!projectId) {
      res.status(400).json({ error: 'Project ID is required' });
      return;
    }

    const project = await ensureProjectExists(projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    try {
      const result = await pool.query<RoxtecEntryRow>(
        `
          SELECT
            project_id,
            id,
            revision,
            tag,
            type,
            description,
            created_at,
            updated_at
          FROM project_roxtec_entries
          WHERE project_id = $1
          ORDER BY id ASC;
        `,
        [projectId]
      );

      res.json({ entries: result.rows.map(mapRoxtecEntryRow) });
    } catch (error) {
      console.error('Failed to list Roxtec entries', error);
      res.status(500).json({ error: 'Failed to load Roxtec entries' });
    }
  });

  router.get('/:roxtecId', async (req: RoxtecEntriesRequest, res: Response): Promise<void> => {
    const { projectId, roxtecId } = req.params;

    if (!projectId) {
      res.status(400).json({ error: 'Project ID is required' });
      return;
    }

    const entryId = parseRoxtecId(roxtecId);
    if (entryId === null) {
      res.status(400).json({ error: 'Roxtec ID is required' });
      return;
    }

    const project = await ensureProjectExists(projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    try {
      const result = await pool.query<RoxtecEntryRow>(
        `
          SELECT
            project_id,
            id,
            revision,
            tag,
            type,
            description,
            created_at,
            updated_at
          FROM project_roxtec_entries
          WHERE project_id = $1 AND id = $2;
        `,
        [projectId, entryId]
      );

      const entry = result.rows[0];
      if (!entry) {
        res.status(404).json({ error: 'Roxtec entry not found' });
        return;
      }

      res.json({ entry: mapRoxtecEntryRow(entry) });
    } catch (error) {
      console.error('Failed to fetch Roxtec entry', error);
      res.status(500).json({ error: 'Failed to fetch Roxtec entry' });
    }
  });

  router.post(
    '/',
    authenticate,
    async (req: RoxtecEntriesRequest, res: Response): Promise<void> => {
      const { projectId } = req.params;

      if (!projectId) {
        res.status(400).json({ error: 'Project ID is required' });
        return;
      }

      if (!req.userId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const project = await ensureProjectExists(projectId);
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const revision = normalizeOptionalString(req.body?.revision);
      const tag = normalizeOptionalString(req.body?.tag);
      const type = normalizeOptionalString(req.body?.type);
      const description = normalizeOptionalString(req.body?.description);

      if (!revision || !tag || !type) {
        res.status(400).json({ error: 'Revision, tag, and type are required' });
        return;
      }

      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        await client.query('LOCK TABLE project_roxtec_entries IN EXCLUSIVE MODE');

        const nextIdResult = await client.query<{ next_id: number }>(
          `
            SELECT COALESCE(MAX(id), 0) + 1 AS next_id
            FROM project_roxtec_entries
            WHERE project_id = $1;
          `,
          [projectId]
        );

        const nextId = nextIdResult.rows[0]?.next_id ?? 1;

        const insertResult = await client.query<RoxtecEntryRow>(
          `
            INSERT INTO project_roxtec_entries (
              project_id,
              id,
              revision,
              tag,
              type,
              description,
              created_at,
              updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
            RETURNING
              project_id,
              id,
              revision,
              tag,
              type,
              description,
              created_at,
              updated_at;
          `,
          [projectId, nextId, revision, tag, type, description]
        );

        await client.query('COMMIT');

        const entry = insertResult.rows[0];
        if (!entry) {
          res.status(500).json({ error: 'Failed to create Roxtec entry' });
          return;
        }

        res.status(201).json({ entry: mapRoxtecEntryRow(entry) });
      } catch (error) {
        await client.query('ROLLBACK');
        console.error('Failed to create Roxtec entry', error);
        res.status(500).json({ error: 'Failed to create Roxtec entry' });
      } finally {
        client.release();
      }
    }
  );

  router.patch('/:roxtecId', authenticate, async (req: RoxtecEntriesRequest, res: Response): Promise<void> => {
    const { projectId, roxtecId } = req.params;

    if (!projectId) {
      res.status(400).json({ error: 'Project ID is required' });
      return;
    }

    if (!req.userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const entryId = parseRoxtecId(roxtecId);
    if (entryId === null) {
      res.status(400).json({ error: 'Roxtec ID is required' });
      return;
    }

    const project = await ensureProjectExists(projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const revision = normalizeOptionalString(req.body?.revision);
    const tag = normalizeOptionalString(req.body?.tag);
    const type = normalizeOptionalString(req.body?.type);
    const description = normalizeOptionalString(req.body?.description);

    if (!revision || !tag || !type) {
      res.status(400).json({ error: 'Revision, tag, and type are required' });
      return;
    }

    try {
      const result = await pool.query<RoxtecEntryRow>(
        `
          UPDATE project_roxtec_entries
          SET
            revision = $3,
            tag = $4,
            type = $5,
            description = $6,
            updated_at = NOW()
          WHERE project_id = $1 AND id = $2
          RETURNING
            project_id,
            id,
            revision,
            tag,
            type,
            description,
            created_at,
            updated_at;
        `,
        [projectId, entryId, revision, tag, type, description]
      );

      const entry = result.rows[0];
      if (!entry) {
        res.status(404).json({ error: 'Roxtec entry not found' });
        return;
      }

      res.json({ entry: mapRoxtecEntryRow(entry) });
    } catch (error) {
      console.error('Failed to update Roxtec entry', error);
      res.status(500).json({ error: 'Failed to update Roxtec entry' });
    }
  });

  router.delete('/:roxtecId', authenticate, async (req: RoxtecEntriesRequest, res: Response): Promise<void> => {
    const { projectId, roxtecId } = req.params;

    if (!projectId) {
      res.status(400).json({ error: 'Project ID is required' });
      return;
    }

    if (!req.userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const entryId = parseRoxtecId(roxtecId);
    if (entryId === null) {
      res.status(400).json({ error: 'Roxtec ID is required' });
      return;
    }

    const project = await ensureProjectExists(projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    try {
      const result = await pool.query(
        `
          DELETE FROM project_roxtec_entries
          WHERE project_id = $1 AND id = $2
          RETURNING id;
        `,
        [projectId, entryId]
      );

      if (result.rowCount === 0) {
        res.status(404).json({ error: 'Roxtec entry not found' });
        return;
      }

      res.status(204).send();
    } catch (error) {
      console.error('Failed to delete Roxtec entry', error);
      res.status(500).json({ error: 'Failed to delete Roxtec entry' });
    }
  });

  return router;
})();