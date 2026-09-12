/** Explicit isolated PostgreSQL check; every fixture is rolled back. No storage writes. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { Pool } from 'pg';
import { removeTemplateMetadata } from './templateSnapshotRetentionService.js';

const databaseName = process.argv[2];
if (!databaseName || !/^wfc_verify_[a-z0-9_]+$/.test(databaseName)) throw new Error('An isolated wfc_verify_* database is required.');
const connection = new URL(process.env.WFC_TEST_DATABASE_URL ?? parse(readFileSync('server/.env')).DATABASE_URL);
connection.pathname = `/${databaseName}`;
const pool = new Pool({ connectionString: connection.toString(), max: 1 });
const client = await pool.connect();
try {
  assert.equal((await client.query('SELECT current_database() AS name')).rows[0].name, databaseName);
  await client.query('BEGIN');
  const templateId = randomUUID();
  const versionId = randomUUID();
  const imageKey = `isolated/${templateId}.png`;
  const unusedKey = `isolated/${versionId}.png`;
  await client.query('INSERT INTO template_files (id,object_key,file_name) VALUES ($1,$2,$3)', [templateId, imageKey, `${templateId}.png`]);
  await client.query(`INSERT INTO template_file_versions (id,template_id,version_number,object_key,file_name)
    VALUES ($1,$2,1,$3,$4)`, [versionId, templateId, unusedKey, `${versionId}.png`]);
  await client.query(`INSERT INTO mutation_history(resource_type,resource_id,revision,actor_id,snapshot)
    VALUES ('isolated-retention',$1,1,$2,$3::jsonb)`, [randomUUID(), randomUUID(), JSON.stringify({
    prior: [{ material_snapshot: { imageObjectKey: imageKey } }],
  })]);
  assert.deepEqual(await removeTemplateMetadata(client, templateId), [unusedKey]);
  assert.equal((await client.query('SELECT count(*)::int AS count FROM template_files WHERE id=$1', [templateId])).rows[0].count, 0);
  assert.equal((await client.query('SELECT count(*)::int AS count FROM template_file_versions WHERE id=$1', [versionId])).rows[0].count, 0);
  process.stdout.write('Template deletion retains historical snapshot image keys; unreferenced keys eligible for cleanup. All fixtures rolled back.\n');
} finally {
  await client.query('ROLLBACK');
  client.release();
  await pool.end();
}
