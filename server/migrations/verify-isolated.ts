/** Explicit PostgreSQL integration verification. Never accepts the WFC database. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { Pool, type PoolClient } from 'pg';
import { assertDatabaseCompatible } from './runner.js';

const databaseName = process.argv[2];
if (!databaseName || !/^wfc_verify_[a-z0-9_]+$/.test(databaseName)) {
  throw new Error('Pass an explicitly created disposable database named wfc_verify_*. Production databases are refused.');
}
const settings = parse(readFileSync('server/.env'));
const connection = new URL(process.env.DATABASE_URL ?? settings.DATABASE_URL);
connection.pathname = `/${databaseName}`;
process.env.DATABASE_URL = connection.toString();
const { beginVersionedMutation, MutationError } = await import('../services/mutationService.js');
const { createStandardMaterialAssignment, StandardMaterialDomainError } = await import('../services/standardMaterialService.js');
const pool = new Pool({ connectionString: connection.toString(), max: 6 });
const actorId = randomUUID();
const resources: string[] = [];
const materialIds: string[] = [];
const resourceType = 'isolated-verification';

const transaction = async <T>(operation: (client: PoolClient) => Promise<T>): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const makeCounter = async (): Promise<string> => {
  const resourceId = randomUUID();
  resources.push(resourceId);
  await pool.query('INSERT INTO wfc_verification_counters (id,amount) VALUES ($1,0)', [resourceId]);
  return resourceId;
};
const mutate = (resourceId: string, key: string, failAfterComplete = false, delta = 1) => transaction(async (client) => {
  const operation = await beginVersionedMutation<{ amount: number }>(client, {
    actorId, resourceType, resourceId, idempotencyKey: key, expectedRevision: 0, request: { delta },
  });
  if (operation.replay) return operation.replay;
  const result = await client.query<{ amount: number }>(
    'UPDATE wfc_verification_counters SET amount=amount+$2 WHERE id=$1 RETURNING amount', [resourceId, delta],
  );
  const saved = await operation.complete(result.rows[0], { id: resourceId, ...result.rows[0] });
  if (failAfterComplete) throw new Error('Injected failure after row/history/receipt');
  return saved;
});

try {
  const identity = await pool.query<{ database: string }>('SELECT current_database() AS database');
  assert.equal(identity.rows[0].database, databaseName);
  await assertDatabaseCompatible(pool);
  await pool.query('CREATE TABLE IF NOT EXISTS wfc_verification_counters (id UUID PRIMARY KEY, amount INTEGER NOT NULL)');

  const staleResource = await makeCounter();
  const stale = await Promise.allSettled([mutate(staleResource, 'first-key'), mutate(staleResource, 'second-key')]);
  assert.equal(stale.filter((item) => item.status === 'fulfilled').length, 1);
  const conflict = stale.find((item) => item.status === 'rejected');
  assert(conflict?.status === 'rejected' && conflict.reason instanceof MutationError && conflict.reason.code === 'REVISION_CONFLICT');

  const retryResource = await makeCounter();
  const retries = await Promise.all([mutate(retryResource, 'same-key'), mutate(retryResource, 'same-key')]);
  assert.equal(retries.filter((item) => item.replayed).length, 1);
  assert.equal((await pool.query('SELECT amount FROM wfc_verification_counters WHERE id=$1', [retryResource])).rows[0].amount, 1);
  await assert.rejects(() => mutate(retryResource, 'same-key', false, 2),
    (error: unknown) => error instanceof MutationError && error.code === 'IDEMPOTENCY_CONFLICT');

  const failureResource = await makeCounter();
  await assert.rejects(() => mutate(failureResource, 'failure-key', true), /Injected failure/);
  assert.equal((await pool.query('SELECT amount FROM wfc_verification_counters WHERE id=$1', [failureResource])).rows[0].amount, 0);
  for (const table of ['mutation_revisions', 'mutation_history', 'mutation_receipts']) {
    assert.equal((await pool.query(`SELECT 1 FROM ${table} WHERE resource_type=$1 AND resource_id=$2`, [resourceType, failureResource])).rowCount, 0);
  }

  for (let index = 0; index < 2; index += 1) {
    const id = randomUUID();
    materialIds.push(id);
    await pool.query('INSERT INTO material_cable_installation_materials (id,type) VALUES ($1,$2)', [id, `Synthetic verification ${id}`]);
  }
  const link = (owner: string, child: string) => transaction((client) => createStandardMaterialAssignment(client,
    'cable-installation-material', owner, { referencedMaterialId: child, quantity: 1, unit: 'pcs' }));
  const graph = await Promise.allSettled([link(materialIds[0], materialIds[1]), link(materialIds[1], materialIds[0])]);
  assert.equal(graph.filter((item) => item.status === 'fulfilled').length, 1);
  const cycle = graph.find((item) => item.status === 'rejected');
  assert(cycle?.status === 'rejected' && cycle.reason instanceof StandardMaterialDomainError && cycle.reason.code === 'CYCLE');
  console.log(JSON.stringify({ database: databaseName, checks: {
    staleConcurrentEdit: 'one commit / one 409', repeatedConcurrentRequest: 'one commit / one replay',
    changedPayloadSameKey: '409', failedTransaction: 'row/revision/history/receipt rolled back',
    reciprocalGraphLinks: 'one commit / one CYCLE',
  } }));
} finally {
  // Only IDs created by this invocation in the guarded isolated database.
  if (materialIds.length) {
    await pool.query('DELETE FROM material_cable_installation_standard_materials WHERE cable_installation_material_id=ANY($1::uuid[])', [materialIds]);
    await pool.query('UPDATE material_cable_installation_materials SET obsolete_at=NOW() WHERE id=ANY($1::uuid[])', [materialIds]);
  }
  for (const table of ['mutation_history', 'mutation_receipts', 'mutation_revisions']) {
    if (resources.length) await pool.query(`DELETE FROM ${table} WHERE resource_type=$1 AND resource_id=ANY($2::uuid[])`, [resourceType, resources]);
  }
  if (resources.length) await pool.query('DELETE FROM wfc_verification_counters WHERE id=ANY($1::uuid[])', [resources]);
  await pool.end();
}
