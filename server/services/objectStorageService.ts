import type { Readable } from 'node:stream';
import { Client } from 'minio';
import { config } from '../config.js';

const {
  endpoint,
  port,
  useSSL,
  accessKey,
  secretKey,
  projectBucket,
  templateBucket
} = config.objectStorage;

const client = new Client({
  endPoint: endpoint,
  port,
  useSSL,
  accessKey,
  secretKey
});

const buckets = [projectBucket, templateBucket] as const;

export type UploadObjectOptions = {
  bucket: string;
  objectKey: string;
  data: Buffer | Readable | string;
  size?: number;
  contentType?: string | null;
  metadata?: Record<string, string>;
};

export async function initializeObjectStorage(): Promise<void> {
  for (const bucket of buckets) {
    await ensureBucket(bucket);
  }
}

export async function ensureBucket(bucket: string): Promise<void> {
  try {
    const exists = await client.bucketExists(bucket);
    if (!exists) {
      await client.makeBucket(bucket);
    }
  } catch (error) {
    console.error(`Failed to ensure bucket "${bucket}"`, error);
    throw new Error(`Failed to ensure bucket "${bucket}"`);
  }
}

export async function uploadObject({
  bucket,
  objectKey,
  data,
  size,
  contentType,
  metadata
}: UploadObjectOptions): Promise<void> {
  const metaEntries: Record<string, string> = {
    ...(metadata ?? {})
  };

  if (contentType) {
    metaEntries['Content-Type'] = contentType;
  }

  try {
    await client.putObject(bucket, objectKey, data, size, metaEntries);
  } catch (error) {
    console.error(
      `Failed to upload object "${objectKey}" to bucket "${bucket}"`,
      error
    );
    throw new Error('Failed to upload file to object storage');
  }
}

export async function deleteObject(
  bucket: string,
  objectKey: string
): Promise<void> {
  try {
    await client.removeObject(bucket, objectKey);
  } catch (error) {
    console.error(
      `Failed to delete object "${objectKey}" from bucket "${bucket}"`,
      error
    );
    throw new Error('Failed to delete file from object storage');
  }
}

export async function getObjectStream(
  bucket: string,
  objectKey: string
): Promise<Readable> {
  try {
    return await client.getObject(bucket, objectKey);
  } catch (error) {
    console.error(
      `Failed to retrieve object "${objectKey}" from bucket "${bucket}"`,
      error
    );
    throw new Error('Failed to download file from object storage');
  }
}

export function getProjectBucket(): string {
  return projectBucket;
}

export function getTemplateBucket(): string {
  return templateBucket;
}
