import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify, parseArgs } from 'node:util';
import { load, ownership, ROOT, contained } from '../pathfinder-local/runtime-lib.mjs';
import { createDocker, writePrivateJson } from '../operations/docker.mjs';
import { assertCanonicalPath } from '../operations/archives.mjs';

// Read-only, lossless registry rows and object metadata. This is not a raw-object
// SHA readback or an atomic backup spanning PostgreSQL and MinIO.
const { values } = parseArgs({ strict: true, options: { runtime: { type: 'string' }, owner: { type: 'string' }, baseline: { type: 'string' }, 'new-project': { type: 'string' } } });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const scratch = path.join(ROOT, 'pathfinder-engine/.scratch/copied-preservation-' + randomUUID());
await fs.mkdir(scratch);
await writePrivateJson(path.join(scratch, 'owner.json'), { format: 'PF-COPIED-PRESERVATION', scratch, owner: values.owner });
const receipt = { schemaVersion: 'pathfinder.copied-project.registry-preservation.v2', status: 'FAIL', recordedAt: new Date().toISOString(), storageProof: 'key-size-etag-lastModified-metadata-only', atomicBackup: false };
try {
  const state = await load(values.runtime);
  assert.equal(state.owner, '8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46'); assert.equal(values.owner, state.owner); assert.equal(state.port, 5191); assert.equal(state.project, 'wfc-pathfinder-local-0cba87606e9b');
  const resources = await ownership(state), api = resources.containers.find(row => row.role === 'api'), pg = resources.containers.find(row => row.role === 'postgres');
  assert.ok(api?.running && pg?.running);
  const docker = await createDocker(), inspected = await docker.inspect(pg.id), address = inspected.NetworkSettings.Networks[state.project + '_backend']?.IPAddress;
  assert.ok(address);
  const tables = ['model_package_identities', 'model_validation_reports', 'model_import_jobs', 'model_versions', 'model_content_reservations', 'model_package_aliases', 'model_storage_ownership',
    'pf_project_state', 'pf_locations', 'pf_location_aliases', 'pf_artifacts', 'pf_model_objects', 'pf_location_bindings', 'pf_location_matches', 'pf_location_events', 'pf_jobs', 'pf_job_items', 'pf_proposals', 'pf_lookup_results', 'pf_synthetic_projects', 'pf_synthetic_proofs', 'pf_reviews', 'pf_apply_receipts'];
  const program = `import{Pool}from'pg';import{Client}from'minio';
const watchdog=setTimeout(()=>process.exit(2),45000);const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000,query_timeout:6000});pool.on('error',()=>{});
const client=await pool.connect();let groups;try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await client.query("SET LOCAL statement_timeout='5s'");const i=(await client.query("SELECT current_database() AS database,host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('transaction_read_only') AS ro")).rows[0];if(i.database!=='wfc_pathfinder_local'||i.address!==${JSON.stringify(address)}||i.port!==5432||i.ro!=='on')throw Error('WRONG_DATABASE');groups={};for(const table of ${JSON.stringify(tables)}){const rows=(await client.query('SELECT to_jsonb(t)::text AS row_text FROM '+table+' t ORDER BY to_jsonb(t)::text LIMIT 100001')).rows;if(rows.length>100000||rows.some(r=>typeof r.row_text!=='string'))throw Error('ROW_BUDGET');groups[table]=rows;}await client.query('COMMIT');}finally{client.release();await pool.end();}
if(process.env.MINIO_ENDPOINT!=='minio'||process.env.WFC_MODEL_BUCKET!=='pf-local-models'||process.env.MINIO_BUCKET_PROJECTS!=='pf-local-project-files'||process.env.MINIO_BUCKET_TEMPLATES!=='pf-local-template-files')throw Error('STORAGE_TARGET');
const s3=new Client({endPoint:'minio',port:9000,useSSL:false,accessKey:process.env.MINIO_ACCESS_KEY,secretKey:process.env.MINIO_SECRET_KEY,retryOptions:{disableRetry:true}}),storage={};for(const bucket of ['pf-local-models','pf-local-project-files','pf-local-template-files']){const rows=[];for await(const o of s3.listObjectsV2(bucket,'',true)){rows.push({key:o.name,size:String(o.size),etag:o.etag,lastModified:o.lastModified?.toISOString()??null});if(rows.length>100000)throw Error('STORAGE_ROW_BUDGET');}rows.sort((a,b)=>a.key.localeCompare(b.key,'en'));storage[bucket]=rows;}const output=JSON.stringify({groups,storage});if(Buffer.byteLength(output)>24*1024**2)throw Error('OUTPUT_BUDGET');await new Promise((r,j)=>process.stdout.write(output+'\\n',e=>e?j(e):r()));clearTimeout(watchdog);`;
  let raw, exitCode = 0;
  try { raw = Buffer.from((await promisify(execFile)('docker', ['exec', api.id, 'node', '--input-type=module', '-e', program], { windowsHide: true, timeout: 50000, maxBuffer: 25 * 1024 ** 2 })).stdout); }
  catch (error) { raw = Buffer.from(error.stdout ?? ''); exitCode = error.code ?? 'EXEC_FAILED'; }
  const rawPath = path.join(scratch, 'registry-storage.private.json'); await fs.writeFile(rawPath, raw, { flag: 'wx', mode: 0o600 });
  receipt.raw = { path: path.relative(ROOT, rawPath).replaceAll('\\', '/'), bytes: raw.length, sha256: sha(raw), exitCode };
  receipt.target = { owner: state.owner, project: state.project, apiId: api.id, apiImage: api.image, pgId: pg.id };
  assert.equal(exitCode, 0); const observed = JSON.parse(raw.toString());
  receipt.groups = Object.fromEntries(Object.entries(observed.groups).map(([k, rows]) => [k, { count: rows.length, sha256: sha(JSON.stringify(rows)) }]));
  receipt.storage = Object.fromEntries(Object.entries(observed.storage).map(([k, rows]) => [k, { count: rows.length, sha256: sha(JSON.stringify(rows)) }]));
  if (values.baseline) {
    assert.match(values['new-project'] ?? '', /^[a-f0-9-]{36}$/);
    const base = path.resolve(values.baseline); assert.ok(contained(path.join(ROOT, 'docs/pathfinder/evidence/copied-project'), base)); await assertCanonicalPath(base);
    const before = JSON.parse(await fs.readFile(base)); assert.equal(before.status, 'PASS'); assert.equal(before.schemaVersion, receipt.schemaVersion); assert.equal(before.target.owner, state.owner);
    const oldPath = path.resolve(ROOT, before.raw.path); assert.ok(contained(path.join(ROOT, 'pathfinder-engine/.scratch'), oldPath)); await assertCanonicalPath(oldPath);
    const oldRaw = await fs.readFile(oldPath); assert.equal(sha(oldRaw), before.raw.sha256); const previous = JSON.parse(oldRaw);
    const comparison = {}, failures = [], details = {};
    const oldVersions = new Set(previous.groups.model_versions.map(r => JSON.parse(r.row_text).id));
    const newVersions = observed.groups.model_versions.map(r => JSON.parse(r.row_text)).filter(r => !oldVersions.has(r.id));
    const newById = new Map(newVersions.map(r => [r.id, r]));
    const newImports = new Set(newVersions.map(r => r.owner_import_id));
    const newReports = new Set(newVersions.map(r => r.validation_report_id));
    const expectedKeys = new Map(newVersions.flatMap(v => (v.manifest?.resources ?? []).map(r => [v.storage_prefix + r.path, String(r.bytes)])));
    if (newVersions.some(v => v.project_id !== values['new-project'] || v.storage_prefix !== 'projects/' + values['new-project'] + '/versions/' + v.id + '/')) failures.push('NEW_VERSION_IDENTITY');
    for (const [table, rows] of Object.entries(previous.groups)) {
      const current = new Set(observed.groups[table].map(r => r.row_text)), old = new Set(rows.map(r => r.row_text));
      const additions = observed.groups[table].filter(r => !old.has(r.row_text));
      comparison[table] = { before: rows.length, unchanged: rows.filter(r => current.has(r.row_text)).length, added: additions.length };
      details[table] = { missingOrChanged: rows.filter(r => !current.has(r.row_text)), additions };
      if (comparison[table].unchanged !== rows.length) failures.push('OLD_ROWS_' + table);
      for (const added of additions) {
        const r = JSON.parse(added.row_text);
        if (['pf_location_bindings', 'pf_jobs', 'pf_job_items', 'pf_proposals', 'pf_lookup_results', 'pf_synthetic_projects', 'pf_synthetic_proofs', 'pf_reviews', 'pf_apply_receipts'].includes(table)) failures.push('UNAUTHORIZED_ADDITION_' + table);
        if (table === 'model_package_identities') failures.push('NEW_SHARED_PACKAGE_IDENTITY');
        else if (table === 'model_validation_reports') { if (!newReports.has(r.id)) failures.push('UNLINKED_REPORT'); }
        else {
          if (r.project_id !== values['new-project']) failures.push('FOREIGN_ADDITION_' + table);
          if (table === 'model_import_jobs' && !newImports.has(r.id)) failures.push('UNLINKED_IMPORT');
          if (table === 'model_storage_ownership' && (!newImports.has(r.import_id) || newById.get(r.model_version_id)?.owner_import_id !== r.import_id || newById.get(r.model_version_id)?.storage_prefix !== r.storage_prefix)) failures.push('UNLINKED_STORAGE');
          if (['model_package_aliases', 'model_content_reservations'].includes(table) && !newById.has(r.model_version_id)) failures.push('UNLINKED_MODEL_REFERENCE');
        }
      }
    }
    const storageComparison = {};
    for (const [bucket, rows] of Object.entries(previous.storage)) {
      const current = new Map(observed.storage[bucket].map(r => [r.key, r])), old = new Set(rows.map(r => r.key));
      storageComparison[bucket] = { before: rows.length, unchanged: rows.filter(r => JSON.stringify(current.get(r.key)) === JSON.stringify(r)).length, added: observed.storage[bucket].filter(r => !old.has(r.key)).length };
      details[bucket] = { missingOrChanged: rows.filter(r => JSON.stringify(current.get(r.key)) !== JSON.stringify(r)), additions: observed.storage[bucket].filter(r => !old.has(r.key)) };
      if (storageComparison[bucket].unchanged !== rows.length) failures.push('OLD_STORAGE_' + bucket);
      for (const added of details[bucket].additions) if (bucket !== 'pf-local-models' || expectedKeys.get(added.key) !== added.size) failures.push('UNEXPECTED_STORAGE_KEY');
    }
    receipt.protectedRows = comparison; receipt.protectedStorage = storageComparison;
    receipt.comparisonFailures = [...new Set(failures)];
    await writePrivateJson(path.join(scratch, 'comparison.private.json'), { baseline: before.raw, current: receipt.raw, protectedRows: comparison, protectedStorage: storageComparison, failures, details });
    assert.equal(failures.length, 0);
  }
  await ownership(state); receipt.status = 'PASS';
} catch { receipt.error = 'COPIED_PRESERVATION_FAILED'; }
const filename = path.join(ROOT, 'docs/pathfinder/evidence/copied-project/registry-preservation-' + Date.now() + '.json');
await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: receipt.status, file: path.relative(ROOT, filename).replaceAll('\\', '/'), error: receipt.error })); process.exitCode = receipt.status === 'PASS' ? 0 : 1;
