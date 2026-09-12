// @vitest-environment node
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import type { PoolClient } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('../db.js', () => ({ pool: database }));
import { beginVersionedMutation, readMutationHeaders, withVersionedMutation } from './mutationService.js';

const parameters = {
  actorId: '00000000-0000-4000-8000-000000000001',
  resourceType: 'test-composition',
  resourceId: '00000000-0000-4000-8000-000000000002',
  expectedRevision: 4,
  idempotencyKey: 'operation-1',
  request: { a: 1, b: 2 },
};
const hash = createHash('sha256').update('{"a":1,"b":2}').digest('hex');

const clientStub = (revision = 4, receipt?: unknown) => {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('FROM mutation_receipts')) return { rows: receipt ? [receipt] : [] };
    if (sql.startsWith('SELECT revision')) return { rows: [{ revision }] };
    return { rows: [], rowCount: 1 };
  });
  const release = vi.fn();
  return { query, release, client: { query, release } as unknown as PoolClient };
};

beforeEach(() => vi.clearAllMocks());

describe('versioned mutation boundary', () => {
  it('captures the first legacy revision before changing its stored rows', async () => {
    const { client, query } = clientStub(0);
    database.connect.mockResolvedValue(client);
    await withVersionedMutation({ ...parameters, expectedRevision: 0 },
      async (connection) => { await connection.query('DELETE FROM example'); return null; },
      async () => ({ components: [] }), async () => ({ components: [{ id: 'old-part' }] }));
    const calls = query.mock.calls as unknown as [string, unknown[] | undefined][];
    const baseline = calls.findIndex(([sql]) => sql.includes('VALUES ($1, $2, 0,'));
    expect(baseline).toBeGreaterThan(0);
    expect(baseline).toBeLessThan(calls.findIndex(([sql]) => sql === 'DELETE FROM example'));
    expect(calls[baseline][1]?.[3]).toBe('{"components":[{"id":"old-part"}]}');
    expect(calls.at(-1)?.[0]).toBe('COMMIT');
  });
  it('rejects a stale edit before executing the operation or storing a receipt', async () => {
    const { client, query } = clientStub(5);
    database.connect.mockResolvedValue(client);
    const operation = vi.fn();
    await expect(withVersionedMutation(parameters, operation)).rejects.toMatchObject({
      status: 409, code: 'REVISION_CONFLICT',
    });
    expect(operation).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO mutation_receipts'))).toBe(false);
  });

  it('replays the same payload despite property ordering and a now stale revision', async () => {
    const { client, query } = clientStub(8, { request_hash: hash, result: { id: 'saved-id' }, revision: 5 });
    const mutation = await beginVersionedMutation(client, { ...parameters, request: { b: 2, a: 1 } });
    expect(mutation.replay).toEqual({ value: { id: 'saved-id' }, revision: 5, replayed: true });
    expect(query.mock.calls.some(([sql]) => sql.startsWith('SELECT revision'))).toBe(false);
    await expect(mutation.complete({})).rejects.toThrow('A replay must not be applied again');
  });

  it('rejects reuse of an operation key for different content', async () => {
    const { client } = clientStub(8, { request_hash: hash, result: {}, revision: 5 });
    await expect(beginVersionedMutation(client, { ...parameters, request: { a: 99, b: 2 } }))
      .rejects.toMatchObject({ status: 409, code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('commits the result, next revision and full snapshot in one transaction', async () => {
    const { client, query, release } = clientStub();
    database.connect.mockResolvedValue(client);
    const snapshot = { components: [{ id: 'part', quantity: 2, price: 12 }] };
    await expect(withVersionedMutation(parameters, async () => ({ id: 'saved-id' }), async () => snapshot))
      .resolves.toEqual({ value: { id: 'saved-id' }, revision: 5, replayed: false });
    const calls = query.mock.calls as unknown as [string, unknown[] | undefined][];
    expect(calls[0][0]).toBe('BEGIN');
    expect(calls.find(([sql]) => sql.startsWith('INSERT INTO mutation_history'))?.[1]?.[4]).toBe(JSON.stringify(snapshot));
    expect(calls.find(([sql]) => sql.startsWith('INSERT INTO mutation_receipts'))?.[1]?.[6]).toBe(5);
    expect(calls.at(-1)?.[0]).toBe('COMMIT');
    expect(release).toHaveBeenCalledOnce();
  });

  it('rolls back when snapshot capture fails after the domain write', async () => {
    const { client, query, release } = clientStub();
    database.connect.mockResolvedValue(client);
    await expect(withVersionedMutation(parameters,
      async (connection) => { await connection.query('UPDATE example SET value = 1'); return {}; },
      async () => { throw new Error('Snapshot capture failed'); },
    )).rejects.toThrow('Snapshot capture failed');
    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(query).not.toHaveBeenCalledWith('COMMIT');
    expect(release).toHaveBeenCalledOnce();
  });
});

describe('mutation headers', () => {
  const request = (revision?: string, key = 'test-key') => ({
    header: (name: string) => name === 'If-Match' ? revision : key,
  }) as unknown as Request;

  it('requires a revision from the state the user edited', () => {
    expect(() => readMutationHeaders(request())).toThrow('its revision is required');
  });
  it.each(['*', 'W/"2"', '-1', '1.5', '9007199254740992'])('rejects unsafe revision %s', (revision) => {
    expect(() => readMutationHeaders(request(revision))).toThrow('Invalid revision');
  });
  it('accepts an explicit zero revision and a valid operation key', () => {
    expect(readMutationHeaders(request('"0"'))).toEqual({ expectedRevision: 0, idempotencyKey: 'test-key' });
  });
});
