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

const parseBoolean = (
  value: string | undefined,
  fallback: boolean
): boolean => {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
};

const databaseUrl = process.env.DATABASE_URL;
const jwtSecret = process.env.JWT_SECRET;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set');
}

if (!jwtSecret) {
  throw new Error('JWT_SECRET is not set');
}

const minioAccessKey = process.env.MINIO_ACCESS_KEY;
const minioSecretKey = process.env.MINIO_SECRET_KEY;

if (!minioAccessKey) {
  throw new Error('MINIO_ACCESS_KEY is not set');
}

if (!minioSecretKey) {
  throw new Error('MINIO_SECRET_KEY is not set');
}

export const config = {
  port: parseNumber(process.env.API_PORT, 4000),
  databaseUrl,
  jwtSecret,
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
  bcryptRounds: parseNumber(process.env.BCRYPT_ROUNDS, 10),
  objectStorage: {
    endpoint: process.env.MINIO_ENDPOINT ?? 'localhost',
    port: parseNumber(process.env.MINIO_PORT, 9000),
    useSSL: parseBoolean(process.env.MINIO_USE_SSL, false),
    accessKey: minioAccessKey,
    secretKey: minioSecretKey,
    projectBucket: process.env.MINIO_BUCKET_PROJECTS ?? 'wfc-project-files',
    templateBucket:
      process.env.MINIO_BUCKET_TEMPLATES ?? 'wfc-template-files',
    urlExpirySeconds: parseNumber(process.env.MINIO_URL_EXPIRY_SECONDS, 900)
  }
} as const;
