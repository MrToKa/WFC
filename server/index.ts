import cors from 'cors';
import { randomUUID } from 'crypto';
import express, { type Request, type Response } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import path from 'node:path';
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
  createCableTypeSchema,
  createProjectSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema,
  updateCableTypeSchema,
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

type CableTypeRow = {
  id: string;
  project_id: string;
  name: string;
  tag: string | null;
  purpose: string | null;
  diameter_mm: string | number | null;
  weight_kg_per_m: string | number | null;
  from_location: string | null;
  to_location: string | null;
  routing: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type PublicCableType = {
  id: string;
  projectId: string;
  name: string;
  tag: string | null;
  purpose: string | null;
  diameterMm: number | null;
  weightKgPerM: number | null;
  fromLocation: string | null;
  toLocation: string | null;
  routing: string | null;
  createdAt: string;
  updatedAt: string;
};

const toNumberOrNull = (value: string | number | null): number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const numericValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
};

const mapCableTypeRow = (row: CableTypeRow): PublicCableType => ({
  id: row.id,
  projectId: row.project_id,
  name: row.name,
  tag: row.tag ?? null,
  purpose: row.purpose ?? null,
  diameterMm: toNumberOrNull(row.diameter_mm),
  weightKgPerM: toNumberOrNull(row.weight_kg_per_m),
  fromLocation: row.from_location ?? null,
  toLocation: row.to_location ?? null,
  routing: row.routing ?? null,
  createdAt:
    typeof row.created_at === 'string'
      ? row.created_at
      : row.created_at.toISOString(),
  updatedAt:
    typeof row.updated_at === 'string'
      ? row.updated_at
      : row.updated_at.toISOString()
});

const MAX_IMPORT_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMPORT_FILE_SIZE }
});

const CABLE_EXCEL_HEADERS = {
  tag: 'Tag',
  name: 'Type',
  purpose: 'Purpose',
  diameter: 'Diameter [mm]',
  weight: 'Weight [kg/m]',
  from: 'From Location',
  to: 'To Location',
  routing: 'Routing'
} as const;

const normalizeOptionalString = (value: string | null | undefined): string | null => {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

const sanitizeFileSegment = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';

const ensureProjectExists = async (projectId: string): Promise<ProjectRow | null> => {
  if (!projectId) {
    return null;
  }

  const result = await pool.query<ProjectRow>(`SELECT * FROM projects WHERE id = $1`, [
    projectId
  ]);

  return result.rows[0] ?? null;
};

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

app.get(
  '/api/projects/:projectId/cable-types',
  async (req: Request, res: Response): Promise<void> => {
    const { projectId } = req.params;

    if (!projectId) {
      res.status(400).json({ error: 'Project ID is required' });
      return;
    }

    try {
      const project = await ensureProjectExists(projectId);

      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const result = await pool.query<CableTypeRow>(
        `
          SELECT *
          FROM cable_types
          WHERE project_id = $1
          ORDER BY name ASC;
        `,
        [projectId]
      );

      res.json({ cableTypes: result.rows.map(mapCableTypeRow) });
    } catch (error) {
      console.error('List cable types error', error);
      res.status(500).json({ error: 'Failed to fetch cable types' });
    }
  }
);

app.post(
  '/api/projects/:projectId/cable-types',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const { projectId } = req.params;

    if (!projectId) {
      res.status(400).json({ error: 'Project ID is required' });
      return;
    }

    let project: ProjectRow | null;
    try {
      project = await ensureProjectExists(projectId);
    } catch (error) {
      console.error('Verify project for cable type create error', error);
      res.status(500).json({ error: 'Failed to verify project' });
      return;
    }

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const parseResult = createCableTypeSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.flatten() });
      return;
    }

    const { name, tag, purpose, diameterMm, weightKgPerM, fromLocation, toLocation, routing } =
      parseResult.data;

    const normalizedTag = normalizeOptionalString(tag ?? null);
    const normalizedPurpose = normalizeOptionalString(purpose ?? null);
    const normalizedFrom = normalizeOptionalString(fromLocation ?? null);
    const normalizedTo = normalizeOptionalString(toLocation ?? null);
    const normalizedRouting = normalizeOptionalString(routing ?? null);
    const normalizedDiameter = diameterMm ?? null;
    const normalizedWeight = weightKgPerM ?? null;

    try {
      const duplicateResult = await pool.query<{ id: string }>(
        `
          SELECT id
          FROM cable_types
          WHERE project_id = $1
            AND lower(name) = lower($2)
          LIMIT 1;
        `,
        [projectId, name]
      );

      if (duplicateResult.rowCount > 0) {
        res.status(409).json({ error: 'A cable type with this name already exists for the project' });
        return;
      }

      const result = await pool.query<CableTypeRow>(
        `
          INSERT INTO cable_types (
            id,
            project_id,
            name,
            tag,
            purpose,
            diameter_mm,
            weight_kg_per_m,
            from_location,
            to_location,
            routing
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING *;
        `,
        [
          randomUUID(),
          projectId,
          name.trim(),
          normalizedTag,
          normalizedPurpose,
          normalizedDiameter,
          normalizedWeight,
          normalizedFrom,
          normalizedTo,
          normalizedRouting
        ]
      );

      res.status(201).json({ cableType: mapCableTypeRow(result.rows[0]) });
    } catch (error) {
      console.error('Create cable type error', error);
      res.status(500).json({ error: 'Failed to create cable type' });
    }
  }
);

app.patch(
  '/api/projects/:projectId/cable-types/:cableTypeId',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const { projectId, cableTypeId } = req.params;

    if (!projectId || !cableTypeId) {
      res.status(400).json({ error: 'Project ID and cable type ID are required' });
      return;
    }

    let project: ProjectRow | null;
    try {
      project = await ensureProjectExists(projectId);
    } catch (error) {
      console.error('Verify project for cable type update error', error);
      res.status(500).json({ error: 'Failed to verify project' });
      return;
    }

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const parseResult = updateCableTypeSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.flatten() });
      return;
    }

    const { name, tag, purpose, diameterMm, weightKgPerM, fromLocation, toLocation, routing } =
      parseResult.data;

    const updates: string[] = [];
    const values: Array<string | number | null> = [];
    let index = 1;

    if (name !== undefined) {
      try {
        const duplicateResult = await pool.query<{ id: string }>(
          `
            SELECT id
            FROM cable_types
            WHERE project_id = $1
              AND lower(name) = lower($2)
              AND id <> $3
            LIMIT 1;
          `,
          [projectId, name, cableTypeId]
        );

        if (duplicateResult.rowCount > 0) {
          res.status(409).json({
            error: 'A cable type with this name already exists for the project'
          });
          return;
        }
      } catch (error) {
        console.error('Duplicate cable type check error', error);
        res.status(500).json({ error: 'Failed to update cable type' });
        return;
      }

      updates.push(`name = $${index++}`);
      values.push(name.trim());
    }

    if (tag !== undefined) {
      updates.push(`tag = $${index++}`);
      values.push(normalizeOptionalString(tag ?? null));
    }

    if (purpose !== undefined) {
      updates.push(`purpose = $${index++}`);
      values.push(normalizeOptionalString(purpose ?? null));
    }

    if (diameterMm !== undefined) {
      updates.push(`diameter_mm = $${index++}`);
      values.push(diameterMm ?? null);
    }

    if (weightKgPerM !== undefined) {
      updates.push(`weight_kg_per_m = $${index++}`);
      values.push(weightKgPerM ?? null);
    }

    if (fromLocation !== undefined) {
      updates.push(`from_location = $${index++}`);
      values.push(normalizeOptionalString(fromLocation ?? null));
    }

    if (toLocation !== undefined) {
      updates.push(`to_location = $${index++}`);
      values.push(normalizeOptionalString(toLocation ?? null));
    }

    if (routing !== undefined) {
      updates.push(`routing = $${index++}`);
      values.push(normalizeOptionalString(routing ?? null));
    }

    updates.push(`updated_at = NOW()`);

    try {
      const result = await pool.query<CableTypeRow>(
        `
          UPDATE cable_types
          SET ${updates.join(', ')}
          WHERE id = $${index}
            AND project_id = $${index + 1}
          RETURNING *;
        `,
        [...values, cableTypeId, projectId]
      );

      const cableType = result.rows[0];

      if (!cableType) {
        res.status(404).json({ error: 'Cable type not found' });
        return;
      }

      res.json({ cableType: mapCableTypeRow(cableType) });
    } catch (error) {
      console.error('Update cable type error', error);
      res.status(500).json({ error: 'Failed to update cable type' });
    }
  }
);

app.delete(
  '/api/projects/:projectId/cable-types/:cableTypeId',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const { projectId, cableTypeId } = req.params;

    if (!projectId || !cableTypeId) {
      res.status(400).json({ error: 'Project ID and cable type ID are required' });
      return;
    }

    let project: ProjectRow | null;
    try {
      project = await ensureProjectExists(projectId);
    } catch (error) {
      console.error('Verify project for cable type delete error', error);
      res.status(500).json({ error: 'Failed to verify project' });
      return;
    }

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    try {
      const result = await pool.query(
        `
          DELETE FROM cable_types
          WHERE id = $1
            AND project_id = $2;
        `,
        [cableTypeId, projectId]
      );

      if (result.rowCount === 0) {
        res.status(404).json({ error: 'Cable type not found' });
        return;
      }

      res.status(204).send();
    } catch (error) {
      console.error('Delete cable type error', error);
      res.status(500).json({ error: 'Failed to delete cable type' });
    }
  }
);

app.post(
  '/api/projects/:projectId/cable-types/import',
  authenticate,
  requireAdmin,
  upload.single('file'),
  async (req: Request, res: Response): Promise<void> => {
    const { projectId } = req.params;

    if (!projectId) {
      res.status(400).json({ error: 'Project ID is required' });
      return;
    }

    let project: ProjectRow | null;
    try {
      project = await ensureProjectExists(projectId);
    } catch (error) {
      console.error('Verify project for cable type import error', error);
      res.status(500).json({ error: 'Failed to verify project' });
      return;
    }

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'An .xlsx file is required' });
      return;
    }

    const extension = path.extname(req.file.originalname ?? '').toLowerCase();

    if (extension !== '.xlsx') {
      res.status(400).json({ error: 'Only .xlsx files are supported' });
      return;
    }

    let worksheet: XLSX.WorkSheet | null = null;

    try {
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];

      if (!sheetName) {
        res.status(400).json({ error: 'The workbook does not contain any sheets' });
        return;
      }

      worksheet = workbook.Sheets[sheetName];
    } catch (error) {
      console.error('Read cable import workbook error', error);
      res.status(400).json({ error: 'Failed to read Excel workbook' });
      return;
    }

    type CableImportRow = Record<string, unknown>;

    const rows = XLSX.utils.sheet_to_json<CableImportRow>(worksheet, {
      defval: '',
      raw: false
    });

    const summary = {
      inserted: 0,
      updated: 0,
      skipped: 0
    };

    const prepared: Array<{
      key: string;
      name: string;
      tag: string | null;
      purpose: string | null;
      diameter: number | null;
      weight: number | null;
      fromLocation: string | null;
      toLocation: string | null;
      routing: string | null;
    }> = [];

    const seenKeys = new Set<string>();

    const readNumeric = (raw: unknown): number | null => {
      if (raw === undefined || raw === null) {
        return null;
      }

      if (typeof raw === 'number') {
        return Number.isFinite(raw) ? raw : null;
      }

      const text = String(raw).trim();

      if (text === '') {
        return null;
      }

      const normalised = text.replace(',', '.');
      const parsed = Number(normalised);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const readString = (raw: unknown): string | null =>
      raw === undefined || raw === null ? null : normalizeOptionalString(String(raw));

    for (const row of rows) {
      const rawName = row[CABLE_EXCEL_HEADERS.name] as unknown;
      const name = typeof rawName === 'number' ? String(rawName) : String(rawName ?? '').trim();

      if (name === '') {
        summary.skipped += 1;
        continue;
      }

      const key = name.toLowerCase();

      if (seenKeys.has(key)) {
        summary.skipped += 1;
        continue;
      }

      seenKeys.add(key);

      prepared.push({
        key,
        name,
        tag: readString(row[CABLE_EXCEL_HEADERS.tag]),
        purpose: readString(row[CABLE_EXCEL_HEADERS.purpose]),
        diameter: readNumeric(row[CABLE_EXCEL_HEADERS.diameter]),
        weight: readNumeric(row[CABLE_EXCEL_HEADERS.weight]),
        fromLocation: readString(row[CABLE_EXCEL_HEADERS.from]),
        toLocation: readString(row[CABLE_EXCEL_HEADERS.to]),
        routing: readString(row[CABLE_EXCEL_HEADERS.routing])
      });
    }

    if (prepared.length === 0) {
      try {
        const existing = await pool.query<CableTypeRow>(
          `
            SELECT *
            FROM cable_types
            WHERE project_id = $1
            ORDER BY name ASC;
          `,
          [projectId]
        );

        res.json({
          summary,
          cableTypes: existing.rows.map(mapCableTypeRow)
        });
      } catch (error) {
        console.error('Fetch cable types after empty import error', error);
        res.status(500).json({
          error: 'No rows imported and failed to fetch existing cable types',
          summary
        });
      }
      return;
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const existingResult =
        prepared.length > 0
          ? await client.query<CableTypeRow>(
              `
                SELECT *
                FROM cable_types
                WHERE project_id = $1
                  AND lower(name) = ANY($2::text[]);
              `,
              [projectId, prepared.map((row) => row.key)]
            )
          : { rows: [] as CableTypeRow[] };

      const existingMap = new Map<string, CableTypeRow>();

      for (const existing of existingResult.rows) {
        existingMap.set(existing.name.toLowerCase(), existing);
      }

      for (const row of prepared) {
        const existing = existingMap.get(row.key);

        if (existing) {
          await client.query(
            `
              UPDATE cable_types
              SET
                tag = $1,
                purpose = $2,
                diameter_mm = $3,
                weight_kg_per_m = $4,
                from_location = $5,
                to_location = $6,
                routing = $7,
                updated_at = NOW()
              WHERE id = $8;
            `,
            [
              row.tag,
              row.purpose,
              row.diameter,
              row.weight,
              row.fromLocation,
              row.toLocation,
              row.routing,
              existing.id
            ]
          );
          summary.updated += 1;
        } else {
          await client.query(
            `
              INSERT INTO cable_types (
                id,
                project_id,
                name,
                tag,
                purpose,
                diameter_mm,
                weight_kg_per_m,
                from_location,
                to_location,
                routing
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);
            `,
            [
              randomUUID(),
              projectId,
              row.name,
              row.tag,
              row.purpose,
              row.diameter,
              row.weight,
              row.fromLocation,
              row.toLocation,
              row.routing
            ]
          );
          summary.inserted += 1;
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Import cable types error', error);
      res.status(500).json({ error: 'Failed to import cable types' });
      return;
    } finally {
      client.release();
    }

    try {
      const refreshed = await pool.query<CableTypeRow>(
        `
          SELECT *
          FROM cable_types
          WHERE project_id = $1
          ORDER BY name ASC;
        `,
        [projectId]
      );

      res.json({
        summary,
        cableTypes: refreshed.rows.map(mapCableTypeRow)
      });
    } catch (error) {
      console.error('Fetch cable types after import error', error);
      res.status(500).json({
        error: 'Cable types imported but failed to refresh list',
        summary
      });
    }
  }
);

app.get(
  '/api/projects/:projectId/cable-types/export',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const { projectId } = req.params;

    if (!projectId) {
      res.status(400).json({ error: 'Project ID is required' });
      return;
    }

    let project: ProjectRow | null;
    try {
      project = await ensureProjectExists(projectId);
    } catch (error) {
      console.error('Verify project for cable type export error', error);
      res.status(500).json({ error: 'Failed to verify project' });
      return;
    }

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    try {
      const result = await pool.query<CableTypeRow>(
        `
          SELECT *
          FROM cable_types
          WHERE project_id = $1
          ORDER BY name ASC;
        `,
        [projectId]
      );

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Cable Types', {
        views: [{ state: 'frozen', ySplit: 1 }]
      });

      const columns = [
        { name: CABLE_EXCEL_HEADERS.name, key: 'type', width: 32 },
        { name: CABLE_EXCEL_HEADERS.purpose, key: 'purpose', width: 36 },
        { name: CABLE_EXCEL_HEADERS.diameter, key: 'diameter', width: 18 },
        { name: CABLE_EXCEL_HEADERS.weight, key: 'weight', width: 18 }
      ] as const;

      const rows = result.rows.map((row) => [
        row.name ?? '',
        row.purpose ?? '',
        row.diameter_mm !== null && row.diameter_mm !== ''
          ? Number(row.diameter_mm)
          : '',
        row.weight_kg_per_m !== null && row.weight_kg_per_m !== ''
          ? Number(row.weight_kg_per_m)
          : ''
      ]);

      const table = worksheet.addTable({
        name: 'CableTypes',
        ref: 'A1',
        headerRow: true,
        totalsRow: false,
        style: {
          theme: 'TableStyleLight8',
          showFirstColumn: false,
          showLastColumn: false,
          showRowStripes: true,
          showColumnStripes: false
        },
        columns: columns.map((column) => ({ name: column.name })),
        rows: rows.length > 0 ? rows : [['', '', '', '']]
      });

      table.commit();

      columns.forEach((column, index) => {
        worksheet.getColumn(index + 1).width = column.width;
        if (column.key === 'diameter' || column.key === 'weight') {
          worksheet.getColumn(index + 1).numFmt = '#,##0.00';
        }
      });

      const buffer = await workbook.xlsx.writeBuffer();

      const projectSegment = sanitizeFileSegment(project.project_number);
      const fileName = `${projectSegment}-cables.xlsx`;

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

      res.send(Buffer.from(buffer));
    } catch (error) {
      console.error('Export cable types error', error);
      res.status(500).json({ error: 'Failed to export cable types' });
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
