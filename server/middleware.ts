import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from './auth.js';
import { pool } from './db.js';
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
    req.isAdmin = payload.isAdmin === true;
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
    const result = await pool.query<{ is_admin: boolean }>(
      'SELECT is_admin FROM users WHERE id = $1',
      [req.userId],
    );
    if (!result.rows[0]) {
      res.status(401).json({ error: 'Account no longer exists' });
      return;
    }
    req.isAdmin = result.rows[0].is_admin;
    next();
  } catch (error) {
    console.error('Account access check failed', error);
    res.status(500).json({ error: 'Failed to verify account access' });
  }
}

export function requireProjectReadOnly(req: Request, res: Response, next: NextFunction): void {
  if (req.isAdmin || req.method === 'GET' || req.method === 'HEAD') {
    next();
    return;
  }
  res.status(403).json({ error: 'Basic users have read-only project access' });
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
  if (
    !['GET', 'HEAD'].includes(req.method) ||
    !basicProjectReadPaths.some((path) => path.test(req.path))
  ) {
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
