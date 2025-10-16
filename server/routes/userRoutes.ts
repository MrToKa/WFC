import type { Request, Response } from 'express';
import { Router } from 'express';
import { hashPassword } from '../auth.js';
import { pool } from '../db.js';
import type { UserRow } from '../models/user.js';
import { mapUserRow } from '../models/user.js';
import { authenticate } from '../middleware.js';
import { updateProfileSchema } from '../validators.js';

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
        [...values, req.userId]
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
