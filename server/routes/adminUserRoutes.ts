import type { Request, Response } from 'express';
import { Router } from 'express';
import { hashPassword } from '../auth.js';
import { pool } from '../db.js';
import type { UserRow } from '../models/user.js';
import { mapUserRow } from '../models/user.js';
import { authenticate, requireAdmin } from '../middleware.js';
import { adminUpdateUserSchema } from '../validators.js';

const adminUsersRouter = Router();

adminUsersRouter.use(authenticate, requireAdmin);

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

    const { email, firstName, lastName, password } = parseResult.data;
    const fields: string[] = [];
    const values: Array<string | null> = [];
    let index = 1;

    if (email !== undefined) {
      fields.push(`email = $${index++}`);
      values.push(email.toLowerCase());
    }

    if (firstName !== undefined) {
      fields.push(`first_name = $${index++}`);
      values.push(firstName);
    }

    if (lastName !== undefined) {
      fields.push(`last_name = $${index++}`);
      values.push(lastName);
    }

    if (password !== undefined) {
      const hashed = await hashPassword(password);
      fields.push(`password_hash = $${index++}`);
      values.push(hashed);
    }

    fields.push(`updated_at = NOW()`);

    try {
      const result = await pool.query<UserRow>(
        `
          UPDATE users
          SET ${fields.join(', ')}
          WHERE id = $${index}
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
        [...values, targetUserId]
      );

      const userRow = result.rows[0];

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
