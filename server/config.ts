import { config as loadEnv } from 'dotenv';
import os from 'node:os';
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

const parseOrigins = (
  value: string | undefined
): string | string[] | boolean | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  if (trimmed === '*') {
    return true;
  }

  if (trimmed.toLowerCase() === 'true') {
    return true;
  }

  if (trimmed.toLowerCase() === 'false') {
    return false;
  }

  const origins = trimmed.split(',').map((origin) => origin.trim()).filter(Boolean);
  if (origins.length === 0) {
    return undefined;
  }
  return origins.length === 1 ? origins[0] : origins;
};

const getLocalNetworkOrigins = (port: string): string[] => {
  const interfaces = os.networkInterfaces();
  const origins = new Set<string>();

  for (const iface of Object.values(interfaces)) {
    if (!iface) {
      continue;
    }

    for (const addressInfo of iface) {
      if (addressInfo.family !== 'IPv4' || addressInfo.internal) {
        continue;
      }

      origins.add(`http://${addressInfo.address}:${port}`);
    }
  }

  return Array.from(origins);
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

const defaultClientOrigin =
  process.env.NODE_ENV === 'production' ? 'http://localhost:5173' : true;

const parsedClientOrigin = parseOrigins(process.env.CLIENT_ORIGIN);
const apiHost = process.env.API_HOST ?? '0.0.0.0';
const clientPort = process.env.CLIENT_PORT ?? '5173';

const combineClientOrigins = (): string | string[] | boolean => {
  if (typeof parsedClientOrigin === 'boolean') {
    return parsedClientOrigin;
  }

  const origins = new Set<string>();

  const addOrigin = (origin: string | string[] | undefined): void => {
    if (!origin) {
      return;
    }
    if (Array.isArray(origin)) {
      origin.forEach((value) => origins.add(value));
      return;
    }
    origins.add(origin);
  };

  addOrigin(parsedClientOrigin);

  if (process.env.NODE_ENV !== 'production') {
    origins.add(`http://localhost:${clientPort}`);
    getLocalNetworkOrigins(clientPort).forEach((origin) => origins.add(origin));
  }

  if (origins.size === 0) {
    return defaultClientOrigin;
  }

  const originArray = Array.from(origins);

  if (originArray.length === 1) {
    return originArray[0];
  }

  return originArray;
};

const clientOrigin = combineClientOrigins();

const httpsEnabled = parseBoolean(process.env.API_USE_HTTPS, false);
const httpsKeyPath = process.env.API_TLS_KEY_PATH;
const httpsCertPath = process.env.API_TLS_CERT_PATH;
const httpsCaPath = process.env.API_TLS_CA_PATH;
const httpsPassphrase = process.env.API_TLS_PASSPHRASE;

if (httpsEnabled && (!httpsKeyPath || !httpsCertPath)) {
  throw new Error(
    'API_TLS_KEY_PATH and API_TLS_CERT_PATH must be set when API_USE_HTTPS is enabled'
  );
}

export const config = {
  host: apiHost,
  port: parseNumber(process.env.API_PORT, 4000),
  databaseUrl,
  jwtSecret,
  clientOrigin,
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
  },
  https: {
    enabled: httpsEnabled,
    keyPath: httpsKeyPath,
    certPath: httpsCertPath,
    caPath: httpsCaPath,
    passphrase: httpsPassphrase
  }
} as const;
