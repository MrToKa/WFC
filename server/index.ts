import cors from 'cors';
import express, { type Request, type Response } from 'express';
import { config } from './config.js';
import { initializeDatabase, pool } from './db.js';
import {
  createUserId,
  hashPassword,
  signAccessToken,
  verifyPassword
} from './auth.js';
import { authenticate } from './middleware.js';
import {
  loginSchema,
  registerSchema,
  updateProfileSchema
} from './validators.js';

type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  first_name: string | null;
  last_name: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type PublicUser = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  createdAt: string;
  updatedAt: string;
};

const mapUserRow = (row: UserRow): PublicUser => ({
  id: row.id,
  email: row.email,
  firstName: row.first_name ?? null,
  lastName: row.last_name ?? null,
  createdAt:
    typeof row.created_at === 'string'
      ? row.created_at
      : row.created_at.toISOString(),
  updatedAt:
    typeof row.updated_at === 'string'
      ? row.updated_at
      : row.updated_at.toISOString()
});

const app = express();

app.use(
  cors({
    origin: config.clientOrigin
  })
);
app.use(express.json());

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

app.post('/api/auth/register', async (req: Request, res: Response) => {
  const parseResult = registerSchema.safeParse(req.body);

  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const { email, password, firstName, lastName } = parseResult.data;
  const passwordHash = await hashPassword(password);
  const userId = createUserId();

  try {
    const result = await pool.query<UserRow>(
      `
        INSERT INTO users (id, email, password_hash, first_name, last_name)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *;
      `,
      [userId, email.toLowerCase(), passwordHash, firstName ?? null, lastName ?? null]
    );

    const user = mapUserRow(result.rows[0]);
    const { token, expiresInSeconds } = signAccessToken(user.id, user.email);

    res.status(201).json({ user, token, expiresInSeconds });
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === '23505'
    ) {
      res.status(409).json({ error: 'Email already in use' });
      return;
    }

    console.error('Register error', error);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

app.post('/api/auth/login', async (req: Request, res: Response) => {
  const parseResult = loginSchema.safeParse(req.body);

  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const { email, password } = parseResult.data;

  try {
    const result = await pool.query<UserRow>(
      `SELECT * FROM users WHERE email = $1`,
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

    const user = mapUserRow(userRow);
    const { token, expiresInSeconds } = signAccessToken(user.id, user.email);

    res.json({ user, token, expiresInSeconds });
  } catch (error) {
    console.error('Login error', error);
    res.status(500).json({ error: 'Failed to login' });
  }
});

app.get(
  '/api/users/me',
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    if (!req.userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    try {
      const result = await pool.query<UserRow>(
        `SELECT * FROM users WHERE id = $1`,
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

app.patch(
  '/api/users/me',
  authenticate,
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
          RETURNING *;
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
        error.code === '23505'
      ) {
        res.status(409).json({ error: 'Email already in use' });
        return;
      }

      console.error('Update user error', error);
      res.status(500).json({ error: 'Failed to update user' });
    }
  }
);

app.delete(
  '/api/users/me',
  authenticate,
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

const startServer = async (): Promise<void> => {
  try {
    await initializeDatabase();
    app.listen(config.port, () => {
      console.log(`API listening on http://localhost:${config.port}`);
    });
  } catch (error) {
    console.error('Failed to start server', error);
    process.exit(1);
  }
};

void startServer();
