import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from './auth.js';
import { pool } from './db.js';

export interface AuthenticatedRequest extends Request {
  userId?: string;
  userEmail?: string;
  isAdmin?: boolean;
}

export function authenticate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.header('authorization') ?? '';
  const [, token] = authHeader.split(' ');

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
  next: NextFunction
): Promise<void> {
  if (!req.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const result = await pool.query<{ is_admin: boolean }>(
      `SELECT is_admin FROM users WHERE id = $1`,
      [req.userId]
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
