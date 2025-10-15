import { config as loadEnv } from 'dotenv';
import path from 'node:path';

loadEnv({ path: path.resolve(process.cwd(), 'server', '.env') });

const parseNumber = (value: string | undefined, fallback: number): number => {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return parsed;
};

const databaseUrl = process.env.DATABASE_URL;
const jwtSecret = process.env.JWT_SECRET;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set');
}

if (!jwtSecret) {
  throw new Error('JWT_SECRET is not set');
}

export const config = {
  port: parseNumber(process.env.API_PORT, 4000),
  databaseUrl,
  jwtSecret,
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
  bcryptRounds: parseNumber(process.env.BCRYPT_ROUNDS, 10)
} as const;
