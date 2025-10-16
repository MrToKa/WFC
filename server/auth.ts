import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { config } from './config.js';

export interface JwtPayload {
  sub: string;
  email: string;
  isAdmin?: boolean;
  iat?: number;
  exp?: number;
}

export interface AuthToken {
  token: string;
  expiresInSeconds: number;
}

export function createUserId(): string {
  return randomUUID();
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, config.bcryptRounds);
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signAccessToken(
  userId: string,
  email: string,
  isAdmin: boolean
): AuthToken {
  const expiresInSeconds = 60 * 60 * 24 * 7; // 7 days
  const token = jwt.sign(
    { sub: userId, email, isAdmin } satisfies Omit<JwtPayload, 'iat' | 'exp'>,
    config.jwtSecret,
    { expiresIn: expiresInSeconds }
  );
  return { token, expiresInSeconds };
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, config.jwtSecret) as JwtPayload;
}
