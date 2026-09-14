import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from './auth.js';
import { pool } from './db.js';
import { resolveUserRole, type UserRow } from './models/user.js';
import { z } from 'zod';

export type AuthenticatedRequest = Request;

export function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.header('authorization') ?? '';
  const token = /^Bearer\s+(\S+)$/i.exec(authHeader.trim())?.[1];

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    req.userId = payload.sub;
    req.userEmail = payload.email;
    // Nested routers must preserve permissions already resolved from the database.
    if (!req.role) req.isAdmin = payload.isAdmin === true;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export async function requireAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const result = await pool.query<{ is_admin: boolean }>(
      `SELECT is_admin FROM users WHERE id = $1`,
      [req.userId],
    );

    const isAdmin = result.rows[0]?.is_admin ?? false;

    if (!isAdmin) {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }

    req.isAdmin = true;
    req.role = 'admin';
    next();
  } catch (error) {
    console.error('Admin check failed', error);
    res.status(500).json({ error: 'Failed to verify admin access' });
  }
}

// Resolve permissions from the current account, never from a potentially stale JWT role.
export async function loadCurrentUserRole(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  try {
    const result = await pool.query<Pick<UserRow, 'is_admin' | 'role'>>(
      'SELECT is_admin, role FROM users WHERE id = $1',
      [req.userId],
    );
    if (!result.rows[0]) {
      res.status(401).json({ error: 'Account no longer exists' });
      return;
    }
    req.isAdmin = result.rows[0].is_admin;
    req.role = resolveUserRole(result.rows[0]);
    next();
  } catch (error) {
    console.error('Account access check failed', error);
    res.status(500).json({ error: 'Failed to verify account access' });
  }
}

export function requireProjectReadOnly(req: Request, res: Response, next: NextFunction): void {
  // Tray export accepts calculated free space in the body, but never changes stored data.
  const isTrayExport = req.role === 'technician' && req.method === 'POST' &&
    /^\/[0-9a-f-]+\/trays\/export\/?$/i.test(req.path);
  if (req.isAdmin || req.method === 'GET' || req.method === 'HEAD' || isTrayExport) {
    next();
    return;
  }
  res.status(403).json({ error: 'This role has read-only project access' });
}

// Mounted at /:projectId before every project endpoint. New sections are denied by default.
const basicProjectReadPaths = [
  /^\/$/,
  /^\/(cable-types|cables|trays|roxtec|tray-data)\/?$/i,
  /^\/cable-types\/[0-9a-f-]+\/details\/?$/i,
  /^\/cables\/[0-9a-f-]+\/(details|versions)\/?$/i,
  /^\/trays\/[0-9a-f-]+\/?$/i,
  /^\/roxtec\/\d+\/?$/i,
];

const technicianFileReadPaths = [
  /^\/files\/?$/i,
  /^\/files\/[0-9a-f-]+\/(download|versions)\/?$/i,
  /^\/files\/[0-9a-f-]+\/versions\/[0-9a-f-]+\/download\/?$/i,
];

const technicianExportPaths = [
  /^\/(cables|cable-types)\/export\/?$/i,
  /^\/cable-types\/[0-9a-f-]+\/default-materials\/export\/?$/i,
];

export async function requireProjectExport(req: Request, res: Response, next: NextFunction): Promise<void> {
  await loadCurrentUserRole(req, res, () => {
    if (req.isAdmin || req.role === 'technician') next();
    else res.status(403).json({ error: 'Export requires administrator or Technician access' });
  });
}

export async function requireProjectAccess(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { projectId } = req.params;
  if (!req.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  if (!z.string().uuid().safeParse(projectId).success) {
    res.status(400).json({ error: 'Invalid project ID' });
    return;
  }
  if (req.isAdmin) {
    next();
    return;
  }
  const isRead = ['GET', 'HEAD'].includes(req.method);
  const isTechnician = req.role === 'technician';
  const isExport = isTechnician && (
    (isRead && technicianExportPaths.some((path) => path.test(req.path))) ||
    (req.method === 'POST' && /^\/trays\/export\/?$/i.test(req.path))
  );
  const isCableReportExport = /^\/cables\/export\/?$/i.test(req.path) &&
    req.query.view !== undefined && (typeof req.query.view !== 'string' ||
      !['list', 'change-tracker'].includes(req.query.view.toLowerCase()));
  const isAllowedRead = isRead && (basicProjectReadPaths.some((path) => path.test(req.path)) ||
    (isTechnician && technicianFileReadPaths.some((path) => path.test(req.path))));
  if ((!isAllowedRead && !isExport) || (isExport && isCableReportExport)) {
    res.status(403).json({ error: 'This action or project section requires administrator access' });
    return;
  }
  try {
    const result = await pool.query(
      'SELECT 1 FROM user_project_access WHERE user_id = $1 AND project_id = $2',
      [req.userId, projectId],
    );
    if (!result.rows.length) {
      res
        .status(403)
        .json({ error: 'Project access required. Contact an administrator to request access.' });
      return;
    }
    next();
  } catch (error) {
    console.error('Project access check failed', error);
    res.status(500).json({ error: 'Failed to verify project access' });
  }
}
