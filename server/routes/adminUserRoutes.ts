import type { Request, Response } from 'express';
import { Router } from 'express';
import { pool } from '../db.js';
import type { UserRow } from '../models/user.js';
import { mapUserRow } from '../models/user.js';
import { authenticate, requireAdmin } from '../middleware.js';
import { adminUpdateUserSchema } from '../validators.js';
import { updateUserProfile } from '../services/userService.js';
import { z } from 'zod';
import { replaceEngineerProjects } from '../services/projectAccessService.js';
import { respondToMutationError } from '../services/mutationService.js';

const adminUsersRouter = Router();

adminUsersRouter.use(authenticate, requireAdmin);

adminUsersRouter.put('/users/:userId/project-access', async (req: Request, res: Response) => {
  const id = z.string().uuid().safeParse(req.params.userId);
  const body = z.object({ projectIds: z.array(z.string().uuid()).max(1000) }).strict().safeParse(req.body);
  if (!id.success || !body.success) { res.status(400).json({ error: 'Valid user and project IDs are required' }); return; }
  try {
    res.json(await replaceEngineerProjects(id.data, [...new Set(body.data.projectIds)], req.userId!));
  } catch (error) {
    if (respondToMutationError(error, res)) return;
    console.error('Project assignment failed', error);
    res.status(500).json({ error: 'Failed to update project assignments' });
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
            ARRAY(SELECT pe.project_id FROM project_engineers pe WHERE pe.user_id=users.id ORDER BY pe.project_id) AS engineer_project_ids,
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
            ARRAY(SELECT pe.project_id FROM project_engineers pe WHERE pe.user_id=users.id ORDER BY pe.project_id) AS engineer_project_ids,
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
