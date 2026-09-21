import type { Request, Response } from 'express';
import { Router } from 'express';
import { pool } from '../db.js';
import type { UserRow } from '../models/user.js';
import { mapUserRow } from '../models/user.js';
import { authenticate } from '../middleware.js';
import { cableListColumnsSchema, updateProfileSchema } from '../validators.js';
import { CABLE_LIST_COLUMN_IDS, type CableListColumnId } from '../models/cableListColumns.js';
import { updateUserProfile } from '../services/userService.js';

const userRouter = Router();

userRouter.use(authenticate);

userRouter.get('/me/cable-list-columns', async (req: Request, res: Response): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const result = await pool.query<{ cable_list_columns: CableListColumnId[] | null }>(
      'SELECT cable_list_columns FROM users WHERE id = $1',
      [req.userId],
    );
    const row = result.rows[0];
    if (!row) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({ columns: row.cable_list_columns ?? CABLE_LIST_COLUMN_IDS });
  } catch (error) {
    console.error('Fetch cable list columns error', error);
    res.status(500).json({ error: 'Failed to load cable list columns' });
  }
});

userRouter.put('/me/cable-list-columns', async (req: Request, res: Response): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const parsed = cableListColumnsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  // Use the authenticated account only; project roles do not restrict personal preferences.
  const columns = CABLE_LIST_COLUMN_IDS.filter((column) => parsed.data.columns.includes(column));
  try {
    const result = await pool.query<{ cable_list_columns: CableListColumnId[] }>(
      `UPDATE users SET cable_list_columns = $1 WHERE id = $2 RETURNING cable_list_columns`,
      [columns, req.userId],
    );
    if (!result.rows[0]) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({ columns: result.rows[0].cable_list_columns });
  } catch (error) {
    console.error('Save cable list columns error', error);
    res.status(500).json({ error: 'Failed to save cable list columns' });
  }
});

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
            role,
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
