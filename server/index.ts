import cors from 'cors';
import { randomUUID } from 'crypto';
import express, { type Request, type Response } from 'express';
import { config } from './config.js';
import { initializeDatabase, pool } from './db.js';
import {
  createUserId,
  hashPassword,
  signAccessToken,
  verifyPassword
} from './auth.js';
import { authenticate, requireAdmin } from './middleware.js';
import {
  adminUpdateUserSchema,
  createProjectSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema,
  updateProjectSchema
} from './validators.js';

type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  first_name: string | null;
  last_name: string | null;
  is_admin: boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

type PublicUser = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  isAdmin: boolean;
  createdAt: string;
  updatedAt: string;
};

type ProjectRow = {
  id: string;
  project_number: string;
  name: string;
  customer: string;
  description: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type PublicProject = {
  id: string;
  projectNumber: string;
  name: string;
  customer: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

const mapUserRow = (row: UserRow): PublicUser => ({
  id: row.id,
  email: row.email,
  firstName: row.first_name ?? null,
  lastName: row.last_name ?? null,
  isAdmin: row.is_admin,
  createdAt:
    typeof row.created_at === 'string'
      ? row.created_at
      : row.created_at.toISOString(),
  updatedAt:
    typeof row.updated_at === 'string'
      ? row.updated_at
      : row.updated_at.toISOString()
});

const mapProjectRow = (row: ProjectRow): PublicProject => ({
  id: row.id,
  projectNumber: row.project_number,
  name: row.name,
  customer: row.customer,
  description: row.description ?? null,
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
        RETURNING *;
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
        console.error('Failed to rollback register transaction', rollbackError);
      }
    }

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
  } finally {
    client.release();
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

app.get(
  '/api/admin/users',
  authenticate,
  requireAdmin,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await pool.query<UserRow>(
        `SELECT * FROM users ORDER BY created_at DESC`
      );
      res.json({ users: result.rows.map(mapUserRow) });
    } catch (error) {
      console.error('Admin list users error', error);
      res.status(500).json({ error: 'Failed to list users' });
    }
  }
);

app.patch(
  '/api/admin/users/:userId',
  authenticate,
  requireAdmin,
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
          RETURNING *;
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
        error.code === '23505'
      ) {
        res.status(409).json({ error: 'Email already in use' });
        return;
      }

      console.error('Admin update user error', error);
      res.status(500).json({ error: 'Failed to update user' });
    }
  }
);

app.delete(
  '/api/admin/users/:userId',
  authenticate,
  requireAdmin,
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

app.post(
  '/api/admin/users/:userId/promote',
  authenticate,
  requireAdmin,
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
          RETURNING *;
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

app.get('/api/projects', async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await pool.query<ProjectRow>(
      `SELECT * FROM projects ORDER BY created_at DESC`
    );
    res.json({ projects: result.rows.map(mapProjectRow) });
  } catch (error) {
    console.error('List projects error', error);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

app.get(
  '/api/projects/:projectId',
  async (req: Request, res: Response): Promise<void> => {
    const { projectId } = req.params;

    if (!projectId) {
      res.status(400).json({ error: 'Project ID is required' });
      return;
    }

    try {
      const result = await pool.query<ProjectRow>(
        `SELECT * FROM projects WHERE id = $1`,
        [projectId]
      );

      const projectRow = result.rows[0];

      if (!projectRow) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      res.json({ project: mapProjectRow(projectRow) });
    } catch (error) {
      console.error('Fetch project error', error);
      res.status(500).json({ error: 'Failed to fetch project details' });
    }
  }
);

app.post(
  '/api/projects',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const parseResult = createProjectSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.flatten() });
      return;
    }

    const { projectNumber, name, customer, description } = parseResult.data;
    const projectId = randomUUID();
    const normalizedDescription =
      description === undefined ? undefined : description.trim();

    try {
      const result = await pool.query<ProjectRow>(
        `
          INSERT INTO projects (id, project_number, name, customer, description)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING *;
        `,
        [
          projectId,
          projectNumber.trim(),
          name.trim(),
          customer.trim(),
          normalizedDescription && normalizedDescription !== ''
            ? normalizedDescription
            : null
        ]
      );

      res.status(201).json({ project: mapProjectRow(result.rows[0]) });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23505'
      ) {
        res.status(409).json({ error: 'Project number already in use' });
        return;
      }

      console.error('Create project error', error);
      res.status(500).json({ error: 'Failed to create project' });
    }
  }
);

app.patch(
  '/api/projects/:projectId',
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

    const { projectNumber, name, customer, description } = parseResult.data;
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

    if (description !== undefined) {
      const normalized = description.trim();
      fields.push(`description = $${index++}`);
      values.push(normalized === '' ? null : normalized);
    }

    fields.push(`updated_at = NOW()`);

    try {
      const result = await pool.query<ProjectRow>(
        `
          UPDATE projects
          SET ${fields.join(', ')}
          WHERE id = $${index}
          RETURNING *;
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
        error.code === '23505'
      ) {
        res.status(409).json({ error: 'Project number already in use' });
        return;
      }

      console.error('Update project error', error);
      res.status(500).json({ error: 'Failed to update project' });
    }
  }
);

app.delete(
  '/api/projects/:projectId',
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
