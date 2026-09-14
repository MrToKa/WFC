import type { Request, Response } from 'express';
import { Router } from 'express';
import { pool } from '../db.js';
import type { UserRow } from '../models/user.js';
import { mapUserRow } from '../models/user.js';
import { authenticate, requireAdmin } from '../middleware.js';
import { adminUpdateUserSchema } from '../validators.js';
import { updateUserProfile } from '../services/userService.js';
import { z } from 'zod';
import { withTransaction } from '../utils/transaction.js';

const adminUsersRouter = Router();

adminUsersRouter.use(authenticate, requireAdmin);

adminUsersRouter.get('/users/:userId/projects', async (req: Request, res: Response) => {
  if (!z.string().uuid().safeParse(req.params.userId).success) {
    res.status(400).json({ error: 'Invalid user ID' });
    return;
  }
  try {
    const user = await pool.query('SELECT id FROM users WHERE id = $1', [req.params.userId]);
    if (!user.rows.length) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const result = await pool.query<{ project_id: string }>(
      'SELECT project_id FROM user_project_access WHERE user_id = $1 ORDER BY project_id',
      [req.params.userId],
    );
    res.json({ projectIds: result.rows.map((row) => row.project_id) });
  } catch (error) {
    console.error('List project access error', error);
    res.status(500).json({ error: 'Failed to load project access' });
  }
});

adminUsersRouter.put('/users/:userId/projects', async (req: Request, res: Response) => {
  const parsed = z.object({ projectIds: z.array(z.string().uuid()).max(10000) }).strict().safeParse(req.body);
  if (!z.string().uuid().safeParse(req.params.userId).success || !parsed.success) {
    res.status(400).json({ error: 'Provide a valid user ID and list of project IDs' });
    return;
  }
  const projectIds = [...new Set(parsed.data.projectIds)];
  try {
    const outcome = await withTransaction(async (client) => {
      // Serialize simultaneous access changes for this account.
      const user = await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [req.params.userId]);
      if (!user.rows.length) return 'missing-user';
      const projects = await client.query('SELECT id FROM projects WHERE id = ANY($1::uuid[]) FOR KEY SHARE', [projectIds]);
      if (projects.rows.length !== projectIds.length) return 'missing-project';
      await client.query('DELETE FROM user_project_access WHERE user_id = $1', [req.params.userId]);
      await client.query(
        'INSERT INTO user_project_access (user_id, project_id) SELECT $1, unnest($2::uuid[])',
        [req.params.userId, projectIds],
      );
      return 'saved';
    });
    if (outcome === 'missing-user') {
      res.status(404).json({ error: 'User not found' });
    } else if (outcome === 'missing-project') {
      res.status(400).json({ error: 'One or more projects no longer exist' });
    } else {
      res.json({ projectIds });
    }
  } catch (error) {
    console.error('Update project access error', error);
    res.status(500).json({ error: 'Failed to update project access' });
  }
});

adminUsersRouter.get(
  '/users',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await pool.query<UserRow>(
        `
          SELECT
            id,
            email,
            password_hash,
            first_name,
            last_name,
            is_admin,
            created_at,
            updated_at
          FROM users
          ORDER BY created_at DESC;
        `
      );
      res.json({ users: result.rows.map(mapUserRow) });
    } catch (error) {
      console.error('Admin list users error', error);
      res.status(500).json({ error: 'Failed to list users' });
    }
  }
);

adminUsersRouter.patch(
  '/users/:userId',
  async (req: Request, res: Response): Promise<void> => {
    const targetUserId = req.params.userId;

    if (!targetUserId) {
      res.status(400).json({ error: 'User ID is required' });
      return;
    }

    if (req.userId === targetUserId) {
      res.status(400).json({
        error: 'Use your account page to update your own profile'
      });
      return;
    }

    const parseResult = adminUpdateUserSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.flatten() });
      return;
    }

    try {
      const userRow = await updateUserProfile(targetUserId, parseResult.data);

      if (!userRow) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      res.json({ user: mapUserRow(userRow) });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: string }).code === '23505'
      ) {
        res.status(409).json({ error: 'Email already in use' });
        return;
      }

      console.error('Admin update user error', error);
      res.status(500).json({ error: 'Failed to update user' });
    }
  }
);

adminUsersRouter.delete(
  '/users/:userId',
  async (req: Request, res: Response): Promise<void> => {
    const targetUserId = req.params.userId;

    if (!targetUserId) {
      res.status(400).json({ error: 'User ID is required' });
      return;
    }

    if (req.userId === targetUserId) {
      res.status(400).json({
        error: 'Admins cannot delete their own account from the admin panel'
      });
      return;
    }

    try {
      const result = await pool.query(
        `DELETE FROM users WHERE id = $1 RETURNING id`,
        [targetUserId]
      );

      if (result.rowCount === 0) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      res.status(204).send();
    } catch (error) {
      console.error('Admin delete user error', error);
      res.status(500).json({ error: 'Failed to delete user' });
    }
  }
);

adminUsersRouter.post(
  '/users/:userId/promote',
  async (req: Request, res: Response): Promise<void> => {
    const targetUserId = req.params.userId;

    if (!targetUserId) {
      res.status(400).json({ error: 'User ID is required' });
      return;
    }

    if (req.userId === targetUserId) {
      res
        .status(400)
        .json({ error: 'You already have administrative permissions' });
      return;
    }

    try {
      const existingResult = await pool.query<{ is_admin: boolean }>(
        `SELECT is_admin FROM users WHERE id = $1`,
        [targetUserId]
      );

      const existingUser = existingResult.rows[0];

      if (!existingUser) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      if (existingUser.is_admin) {
        res.status(409).json({ error: 'User is already an admin' });
        return;
      }

      const result = await pool.query<UserRow>(
        `
          UPDATE users
          SET is_admin = TRUE,
              updated_at = NOW()
          WHERE id = $1
          RETURNING
            id,
            email,
            password_hash,
            first_name,
            last_name,
            is_admin,
            created_at,
            updated_at;
        `,
        [targetUserId]
      );

      const userRow = result.rows[0];

      if (!userRow) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      res.json({ user: mapUserRow(userRow) });
    } catch (error) {
      console.error('Admin promote user error', error);
      res.status(500).json({ error: 'Failed to promote user to admin' });
    }
  }
);

export { adminUsersRouter };
