import type { Request, Response } from 'express';
import { Router } from 'express';
import { pool } from '../db.js';
import type { UserRow } from '../models/user.js';
import { mapUserRow } from '../models/user.js';
import { authenticate } from '../middleware.js';
import { updateProfileSchema } from '../validators.js';
import { updateUserProfile } from '../services/userService.js';

const userRouter = Router();

userRouter.use(authenticate);

userRouter.get(
  '/me',
  async (req: Request, res: Response): Promise<void> => {
    if (!req.userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

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
          WHERE id = $1;
        `,
        [req.userId]
      );

      const userRow = result.rows[0];

      if (!userRow) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      res.json({ user: mapUserRow(userRow) });
    } catch (error) {
      console.error('Fetch user error', error);
      res.status(500).json({ error: 'Failed to fetch user' });
    }
  }
);

userRouter.patch(
  '/me',
  async (req: Request, res: Response): Promise<void> => {
    if (!req.userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const parseResult = updateProfileSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.flatten() });
      return;
    }

    try {
      const userRow = await updateUserProfile(req.userId, parseResult.data);

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

      console.error('Update user error', error);
      res.status(500).json({ error: 'Failed to update user' });
    }
  }
);

userRouter.delete(
  '/me',
  async (req: Request, res: Response): Promise<void> => {
    if (!req.userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    try {
      await pool.query(`DELETE FROM users WHERE id = $1`, [req.userId]);
      res.status(204).send();
    } catch (error) {
      console.error('Delete user error', error);
      res.status(500).json({ error: 'Failed to delete user' });
    }
  }
);

export { userRouter };
