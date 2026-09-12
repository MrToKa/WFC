import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import type { PoolClient } from 'pg';
import { withTransaction } from '../utils/transaction.js';

type Queryable = Pick<PoolClient, 'query'>;
export type MutationParameters = {
  actorId: string;
  resourceType: string;
  resourceId: string;
  idempotencyKey: string;
  expectedRevision: number;
  request: unknown;
};
export type MutationResult<T> = { value: T; revision: number; replayed: boolean };

export class MutationError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'MutationError';
  }
}

export const respondToMutationError = (error: unknown, response: Response): boolean => {
  if (!(error instanceof MutationError)) return false;
  response.status(error.status).json({ error: error.message, code: error.code });
  return true;
};

export const readMutationHeaders = (request: Request): Pick<MutationParameters, 'idempotencyKey' | 'expectedRevision'> => {
  const rawRevision = request.header('If-Match');
  if (!rawRevision) throw new MutationError(428, 'REVISION_REQUIRED', 'Reload this item before saving: its revision is required.');
  const match = /^(?:"(\d+)"|(\d+))$/.exec(rawRevision.trim());
  const expectedRevision = match ? Number(match[1] ?? match[2]) : NaN;
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
    throw new MutationError(400, 'INVALID_REVISION', 'Invalid revision.');
  const idempotencyKey = request.header('Idempotency-Key') ?? '';
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(idempotencyKey))
    throw new MutationError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid operation key is required.');
  return { idempotencyKey, expectedRevision };
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
};

export const getMutationRevision = async (queryable: Queryable, resourceType: string, resourceId: string): Promise<number> => {
  const result = await queryable.query<{ revision: string | number }>(
    'SELECT revision FROM mutation_revisions WHERE resource_type = $1 AND resource_id = $2',
    [resourceType, resourceId],
  );
  const revision = Number(result.rows[0]?.revision ?? 0);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Unsupported mutation revision');
  return revision;
};

/** Must run inside the caller's transaction, before reading the state being edited. */
export const beginVersionedMutation = async <T = unknown>(client: Queryable, parameters: MutationParameters): Promise<{
  replay?: MutationResult<T>;
  complete: (value: T, snapshot?: unknown) => Promise<MutationResult<T>>;
}> => {
  if (!Number.isSafeInteger(parameters.expectedRevision) || parameters.expectedRevision < 0)
    throw new MutationError(400, 'INVALID_REVISION', 'Invalid revision.');
  if (!parameters.actorId || !/^[A-Za-z0-9_.:-]{1,128}$/.test(parameters.idempotencyKey))
    throw new MutationError(400, 'INVALID_OPERATION', 'An authenticated operation key is required.');
  const { actorId, resourceType, resourceId, idempotencyKey } = parameters;
  const requestHash = createHash('sha256').update(JSON.stringify(canonicalize(parameters.request)) ?? 'null').digest('hex');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`wfc:mutation:${resourceType}:${resourceId}`]);
  const previous = await client.query<{ request_hash: string; result: T; revision: string | number }>(
    `SELECT request_hash, result, revision FROM mutation_receipts
     WHERE actor_id = $1 AND resource_type = $2 AND resource_id = $3 AND idempotency_key = $4`,
    [actorId, resourceType, resourceId, idempotencyKey],
  );
  if (previous.rows[0]) {
    const receipt = previous.rows[0];
    if (receipt.request_hash !== requestHash)
      throw new MutationError(409, 'IDEMPOTENCY_CONFLICT', 'This operation key was already used for a different request.');
    return {
      replay: { value: receipt.result, revision: Number(receipt.revision), replayed: true },
      complete: async () => { throw new Error('A replay must not be applied again'); },
    };
  }
  await client.query(
    `INSERT INTO mutation_revisions (resource_type, resource_id, revision) VALUES ($1, $2, 0)
     ON CONFLICT (resource_type, resource_id) DO NOTHING`, [resourceType, resourceId],
  );
  const currentRevision = await getMutationRevision(client, resourceType, resourceId);
  if (currentRevision !== parameters.expectedRevision)
    throw new MutationError(409, 'REVISION_CONFLICT', 'This data has changed. Reload it and review your changes before saving again.');
  let completed = false;
  return { complete: async (value, snapshot) => {
    if (completed) throw new Error('An operation can only complete once');
    completed = true;
    const revision = currentRevision + 1;
    await client.query(
      'UPDATE mutation_revisions SET revision = $3 WHERE resource_type = $1 AND resource_id = $2',
      [resourceType, resourceId, revision],
    );
    if (snapshot !== undefined) await client.query(
      `INSERT INTO mutation_history (resource_type, resource_id, revision, actor_id, snapshot)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [resourceType, resourceId, revision, actorId, JSON.stringify(snapshot)],
    );
    await client.query(
      `INSERT INTO mutation_receipts (actor_id, resource_type, resource_id, idempotency_key, request_hash, result, revision)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [actorId, resourceType, resourceId, idempotencyKey, requestHash, JSON.stringify(value ?? null), revision],
    );
    return { value, revision, replayed: false };
  } };
};

export const withVersionedMutation = async <T>(parameters: MutationParameters,
  operation: (client: PoolClient) => Promise<T>,
  snapshot?: (client: PoolClient, value: T) => Promise<unknown>,
  initialSnapshot?: (client: PoolClient) => Promise<unknown>,
): Promise<MutationResult<T>> => withTransaction(async (client) => {
  const mutation = await beginVersionedMutation<T>(client, parameters);
  if (mutation.replay) return mutation.replay;
  if (initialSnapshot && parameters.expectedRevision === 0) {
    const baseline = await initialSnapshot(client);
    await client.query(`INSERT INTO mutation_history(resource_type, resource_id, revision, actor_id, snapshot)
      VALUES ($1, $2, 0, $3, $4::jsonb) ON CONFLICT (resource_type, resource_id, revision) DO NOTHING`,
    [parameters.resourceType, parameters.resourceId, parameters.actorId, JSON.stringify(baseline)]);
  }
  const value = await operation(client);
  return mutation.complete(value, snapshot ? await snapshot(client, value) : undefined);
});
