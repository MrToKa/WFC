// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { initializeModelRegistry } from '../modelRegistry/schema.js';
import { createModelRegistryRepository } from '../modelRegistry/repository.js';
import { toImportDto } from '../modelRegistry/types.js';

const projectId = '11111111-1111-4111-8111-111111111111';
const requestedBy = '22222222-2222-4222-8222-222222222222';
const idempotencyKey = '33333333-3333-4333-8333-333333333333';
const sha256 = 'a'.repeat(64);
const input = { projectId, requestedBy, idempotencyKey, archiveSha256: sha256, expectedBytes: 12 };

function fixture(options: { commitError?: Error; duplicate?: boolean; differentHash?: boolean } = {}) {
  const release = vi.fn();
  const statements: string[] = [];
  const row = {
    id: '44444444-4444-4444-8444-444444444444', project_id: projectId, requested_by: requestedBy,
    idempotency_key: idempotencyKey, archive_sha256: options.differentHash ? 'b'.repeat(64) : sha256,
    expected_bytes: '12', owner_token: '55555555-5555-4555-8555-555555555555', received_bytes: '0',
    state: 'receiving', model_version_id: null, failure: null, verification_report: null,
    duplicate: false, cleaned_at: null, staging_cleaned_at: null,
    created_at: new Date('2026-10-16T00:00:00Z'), updated_at: new Date('2026-10-16T00:00:00Z'),
  };
  const query = vi.fn(async (sql: string) => {
    statements.push(sql);
    if (sql === 'COMMIT' && options.commitError) throw options.commitError;
    if (sql.startsWith('SELECT id FROM projects')) return { rows: [{ id: projectId }] };
    if (sql.includes('INSERT INTO model_import_jobs')) return { rows: options.duplicate ? [] : [row] };
    if (sql.startsWith('SELECT * FROM model_import_jobs')) return { rows: [row] };
    if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
    return { rows: [] };
  });
  const client = { query, release } as unknown as PoolClient;
  const connect = vi.fn(async () => client);
  const pool = { connect, query } as unknown as Pool;
  return { pool, client, query, release, statements, connect };
}

describe('model registry connection and failure boundaries', () => {
  it('does no I/O when the repository is constructed', () => {
    const test = fixture();
    createModelRegistryRepository(test.pool);
    expect(test.connect).not.toHaveBeenCalled();
  });

  it('holds a newly created import session before COMMIT and releases it exactly once', async () => {
    const test = fixture();
    const result = await createModelRegistryRepository(test.pool).beginImport(input);
    expect(result.duplicate).toBe(false);
    expect(result.lock).toBeDefined();
    expect(test.statements.findIndex(sql => sql.includes('pg_try_advisory_lock'))).toBeLessThan(test.statements.indexOf('COMMIT'));
    expect(test.release).not.toHaveBeenCalled();
    expect(toImportDto(result.job)).not.toHaveProperty('ownerToken');
    expect(toImportDto(result.job)).not.toHaveProperty('archiveSha256');
    expect(toImportDto(result.job)).not.toHaveProperty('verificationReport');
    expect(toImportDto(result.job)).not.toHaveProperty('stagingCleanedAt');
    await result.lock?.release();
    await result.lock?.release();
    expect(test.query.mock.calls.filter(([sql]) => sql.includes('pg_advisory_unlock'))).toHaveLength(1);
    expect(test.release).toHaveBeenCalledTimes(1);
  });

  it('does not claim another worker when the idempotency request already exists', async () => {
    const test = fixture({ duplicate: true });
    const result = await createModelRegistryRepository(test.pool).beginImport(input);
    expect(result.duplicate).toBe(true);
    expect(result.lock).toBeUndefined();
    expect(test.statements.some(sql => sql.includes('pg_try_advisory_lock'))).toBe(false);
    expect(test.release).toHaveBeenCalledTimes(1);
  });

  it('observes an existing request without opening a retained session and still binds its identity', async () => {
    const test = fixture();
    const repository = createModelRegistryRepository(test.pool);
    const job = await repository.findImportByRequest(input);
    expect(job?.idempotencyKey).toBe(idempotencyKey);
    expect(test.connect).not.toHaveBeenCalled();
    expect(test.statements.some(sql => sql.includes('INSERT') || sql.includes('pg_try_advisory_lock'))).toBe(false);
    await expect(repository.findImportByRequest({ ...input, expectedBytes: 13 })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 });
    await expect(repository.findImportByRequest({ ...input, archiveSha256: 'b'.repeat(64) })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 });
  });

  it('refuses the same request key with a changed archive identity', async () => {
    const test = fixture({ duplicate: true, differentHash: true });
    await expect(createModelRegistryRepository(test.pool).beginImport(input)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 });
    expect(test.statements).not.toContain('COMMIT');
    expect(test.release).toHaveBeenCalledWith(true);
  });

  it('destroys the locked session after an ambiguous commit reply', async () => {
    const failure = new Error('lost commit reply');
    const test = fixture({ commitError: failure });
    await expect(createModelRegistryRepository(test.pool).beginImport(input)).rejects.toBe(failure);
    expect(test.release).toHaveBeenCalledOnce();
    expect(test.release).toHaveBeenCalledWith(true);
    expect(test.statements).toContain('ROLLBACK');
  });

  it('preserves an initializer failure even when rollback fails', async () => {
    const failure = new Error('schema refused');
    const rollback = new Error('connection lost');
    const test = fixture();
    test.query.mockImplementation(async sql => {
      if (sql === 'ROLLBACK') throw rollback;
      if (sql !== 'BEGIN') throw failure;
      return { rows: [] };
    });
    await expect(initializeModelRegistry(test.pool)).rejects.toBe(failure);
    expect(test.release).toHaveBeenCalledOnce();
  });
});
