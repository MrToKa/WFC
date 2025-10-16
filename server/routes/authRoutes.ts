import type { Request, Response } from 'express';
import { Router } from 'express';
import {
  createUserId,
  hashPassword,
  signAccessToken,
  verifyPassword
} from '../auth.js';
import { pool } from '../db.js';
import type { PublicUser, UserRow } from '../models/user.js';
import { mapUserRow } from '../models/user.js';
import { loginSchema, registerSchema } from '../validators.js';

const authRouter = Router();

authRouter.post(
  '/register',
  async (req: Request, res: Response): Promise<void> => {
    const parseResult = registerSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.flatten() });
      return;
    }

    const { email, password, firstName, lastName } = parseResult.data;
    const passwordHash = await hashPassword(password);
    const userId = createUserId();
    const client = await pool.connect();
    let transactionActive = false;

    try {
      await client.query('BEGIN');
      transactionActive = true;
      await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');

      const existingUsersResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM users`
      );

      const existingUsers = Number(existingUsersResult.rows[0]?.count ?? '0');
      const isFirstUser = existingUsers === 0;

      const result = await client.query<UserRow>(
        `
          INSERT INTO users (id, email, password_hash, first_name, last_name, is_admin)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id,
                    email,
                    password_hash,
                    first_name,
                    last_name,
                    is_admin,
                    created_at,
                    updated_at;
        `,
        [
          userId,
          email.toLowerCase(),
          passwordHash,
          firstName ?? null,
          lastName ?? null,
          isFirstUser
        ]
      );

      await client.query('COMMIT');
      transactionActive = false;

      const user = mapUserRow(result.rows[0]);
      const { token, expiresInSeconds } = signAccessToken(
        user.id,
        user.email,
        user.isAdmin
      );

      res.status(201).json({ user, token, expiresInSeconds });
    } catch (error) {
      if (transactionActive) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          console.error(
            'Failed to rollback register transaction',
            rollbackError
          );
        }
      }

      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: string }).code === '23505'
      ) {
        res.status(409).json({ error: 'Email already in use' });
        return;
      }

      console.error('Register error', error);
      res.status(500).json({ error: 'Failed to register user' });
    } finally {
      client.release();
    }
  }
);

authRouter.post(
  '/login',
  async (req: Request, res: Response): Promise<void> => {
    const parseResult = loginSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.flatten() });
      return;
    }

    const { email, password } = parseResult.data;

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
          WHERE email = $1;
        `,
        [email.toLowerCase()]
      );

      const userRow = result.rows[0];

      if (!userRow) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
      }

      const isValid = await verifyPassword(password, userRow.password_hash);

      if (!isValid) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
      }

      const user: PublicUser = mapUserRow(userRow);
      const { token, expiresInSeconds } = signAccessToken(
        user.id,
        user.email,
        user.isAdmin
      );

      res.json({ user, token, expiresInSeconds });
    } catch (error) {
      console.error('Login error', error);
      res.status(500).json({ error: 'Failed to login' });
    }
  }
);

export { authRouter };
