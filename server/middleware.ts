import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from './auth.js';
import { pool } from './db.js';

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

export async function requireProjectEditor(req: Request, res: Response, next: NextFunction): Promise<void> {
  const projectId = req.params.projectId ?? /^\/([0-9a-f-]{36})(?:\/|$)/i.exec(req.path)?.[1];
  if (!req.userId) { res.status(401).json({ error: 'Authentication required' }); return; }
  if (!projectId || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(projectId)) {
    res.status(400).json({ error: 'Invalid project ID' }); return;
  }
  try {
    const result = await pool.query<{ is_admin: boolean; assigned: boolean }>(
      `SELECT u.is_admin, EXISTS(SELECT 1 FROM project_engineers pe
        WHERE pe.user_id=u.id AND pe.project_id=$2) AS assigned FROM users u WHERE u.id=$1`,
      [req.userId, projectId]);
    const user = result.rows[0];
    if (!user || (!user.is_admin && !user.assigned)) {
      res.status(403).json({ error: 'Administrator or assigned project engineer access required' }); return;
    }
    req.isAdmin = user.is_admin;
    next();
  } catch (error) {
    console.error('Project access check failed', error);
    res.status(500).json({ error: 'Failed to verify project access' });
  }
}

/** Only the explicit project work areas allow assigned engineers to mutate. */
export function protectDomainMutations(req: Request, res: Response, next: NextFunction): void {
  // This existing report endpoint accepts options in POST but only generates
  // a workbook. Keep its read permission separate from project mutations.
  if (req.method === 'POST' && req.baseUrl?.toLowerCase() === '/api/projects' &&
      /^\/[0-9a-f-]{36}\/trays\/export\/?$/i.test(req.path)) {
    authenticate(req, res, next);
    return;
  }
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  const projectWork = req.baseUrl?.toLowerCase() === '/api/projects' &&
    /^\/[0-9a-f-]{36}\/(?:cables|cable-types|trays|support-distances|change-orders|internal-ncrs)(?:\/|$)/i.test(req.path);
  authenticate(req, res, () => {
    if (projectWork) void requireProjectEditor(req, res, next);
    else void requireAdmin(req, res, next);
  });
}

export function authenticateExports(req: Request, res: Response, next: NextFunction): void {
  if (req.baseUrl?.toLowerCase() === '/api/materials' && (req.method === 'GET' || req.method === 'HEAD') &&
      /(?:^|\/)(?:export(?:-[^/]+)?|download|template)(?:\/|$)/i.test(req.path)) {
    authenticate(req, res, () => { void requireCatalogExporter(req, res, next); });
    return;
  }
  if ((req.method === 'GET' || req.method === 'HEAD') &&
      /(?:^|\/)(?:export(?:-[^/]+)?|download)(?:\/|$)/i.test(req.path)) {
    authenticate(req, res, next);
    return;
  }
  next();
}

export async function requireCatalogExporter(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.userId) { res.status(401).json({ error: 'Authentication required' }); return; }
  try {
    const result = await pool.query<{ is_admin: boolean; is_engineer: boolean }>(
      `SELECT u.is_admin, EXISTS(SELECT 1 FROM project_engineers pe WHERE pe.user_id=u.id) AS is_engineer
       FROM users u WHERE u.id=$1`, [req.userId]);
    const user = result.rows[0];
    if (!user || (!user.is_admin && !user.is_engineer)) {
      res.status(403).json({ error: 'Catalog exports require administrator or project engineer access' }); return;
    }
    next();
  } catch (error) {
    console.error('Catalog export access check failed', error);
    res.status(500).json({ error: 'Failed to verify export access' });
  }
}
