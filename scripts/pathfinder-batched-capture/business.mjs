import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { promisify, parseArgs } from 'node:util';
import { execFile } from 'node:child_process';
import assert from 'node:assert/strict';
import { load, ownership, ROOT, contained } from '../pathfinder-local/runtime-lib.mjs';
import { createDocker } from '../operations/docker.mjs';
import { assertCanonicalPath } from '../operations/archives.mjs';

const { values } = parseArgs({ strict: true, options: { runtime: { type: 'string' }, owner: { type: 'string' }, baseline: { type: 'string' }, 'allow-new': { type: 'boolean', default: false } } });
const hash = value => createHash('sha256').update(typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(value)).digest('hex');
const receipt = { schemaVersion: 'pathfinder.batched-capture.protected-business.v2', projection: 'lossless-postgresql-jsonb-text', status: 'FAIL', recordedAt: new Date().toISOString() };
const scratch = path.join(ROOT, 'pathfinder-engine/.scratch/capture-business-' + randomUUID()); await fs.mkdir(scratch);
await fs.writeFile(path.join(scratch, 'owner.json'), JSON.stringify({ format: 'WFC-PF-CAPTURE-BUSINESS', scratch, owner: values.owner, createdAt: receipt.recordedAt }), { flag: 'wx' });
try {
  const state = await load(values.runtime); assert.equal(state.owner, values.owner); assert.equal(state.port, 5191); assert.notEqual(state.project, 'wfc-pathfinder-local');
  const resources = await ownership(state), api = resources.containers.find(row => row.role === 'api'), pg = resources.containers.find(row => row.role === 'postgres'); assert.ok(api?.running && pg?.running);
  const docker = await createDocker(), inspect = await docker.inspect(pg.id), address = inspect.NetworkSettings.Networks[state.project + '_backend']?.IPAddress; assert.ok(address);
  const sql = { projects: 'SELECT id::text AS key,to_jsonb(t)::text AS row_text FROM projects t ORDER BY id LIMIT 100001', types: 'SELECT id::text AS key,to_jsonb(t)::text AS row_text FROM cable_types t ORDER BY id LIMIT 100001', cables: 'SELECT id::text AS key,to_jsonb(t)::text AS row_text FROM cables t ORDER BY id LIMIT 100001', selections: 'SELECT project_id::text AS key,to_jsonb(t)::text AS row_text FROM project_model_selections t ORDER BY project_id LIMIT 100001' };
  const program = `import{Pool}from'pg';const watchdog=setTimeout(()=>process.exit(2),30000);const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000,query_timeout:6000});pool.on('error',()=>{});const client=await pool.connect();try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await client.query("SET LOCAL statement_timeout='5s'");const identity=(await client.query("SELECT current_database() AS database,host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('transaction_read_only') AS ro")).rows[0];if(identity.database!=='wfc_pathfinder_local'||identity.address!==${JSON.stringify(address)}||identity.port!==5432||identity.ro!=='on')throw Error('WRONG_DATABASE');const probe=(await client.query("SELECT to_jsonb(1.00000000000000001::numeric) AS na,to_jsonb(1.00000000000000002::numeric) AS nb,to_jsonb(1.00000000000000001::numeric)::text AS nta,to_jsonb(1.00000000000000002::numeric)::text AS ntb,to_jsonb(9007199254740992::bigint) AS ia,to_jsonb(9007199254740993::bigint) AS ib,to_jsonb(9007199254740992::bigint)::text AS ita,to_jsonb(9007199254740993::bigint)::text AS itb")).rows[0];const precisionControl={numericDecodedEqual:probe.na===probe.nb,numericTextDistinct:probe.nta!==probe.ntb,bigintDecodedEqual:probe.ia===probe.ib,bigintTextDistinct:probe.ita!==probe.itb};if(!Object.values(precisionControl).every(Boolean))throw Error('PRECISION_CONTROL');const groups={};for(const[k,query]of Object.entries(${JSON.stringify(sql)})){const rows=(await client.query(query)).rows;if(rows.length>100000||rows.some(r=>typeof r.key!=='string'||typeof r.row_text!=='string'))throw Error('ROW_BUDGET');groups[k]=rows;}await client.query('COMMIT');await new Promise((resolve,reject)=>process.stdout.write(JSON.stringify({identity,precisionControl,groups})+'\\n',e=>e?reject(e):resolve()));}finally{client.release();await pool.end();clearTimeout(watchdog);}`;
  let raw, exitCode = 0;
  try { const result = await promisify(execFile)('docker', ['exec', api.id, 'node', '--input-type=module', '-e', program], { windowsHide: true, timeout: 35000, maxBuffer: 32 * 1024 ** 2 }); raw = Buffer.from(result.stdout); }
  catch (error) { raw = Buffer.from(error.stdout ?? ''); exitCode = error.code ?? 'EXEC_FAILED'; }
  const rawFile = path.join(scratch, 'business.private.json'); await fs.writeFile(rawFile, raw, { flag: 'wx' });
  receipt.raw = { path: path.relative(ROOT, rawFile).replaceAll('\\', '/'), bytes: raw.length, sha256: hash(raw), exitCode }; receipt.target = { owner: state.owner, project: state.project, apiId: api.id, apiImage: api.image, pgId: pg.id };
  assert.equal(exitCode, 0); const observed = JSON.parse(raw.toString()); receipt.precisionControl = observed.precisionControl; receipt.groups = Object.fromEntries(Object.entries(observed.groups).map(([name, rows]) => [name, { count: rows.length, sha256: hash(rows) }]));
  if (values.baseline) {
    const baselinePath = path.resolve(values.baseline); assert.ok(contained(path.join(ROOT, 'docs/pathfinder/evidence/batched-capture'), baselinePath)); await assertCanonicalPath(baselinePath);
    const before = JSON.parse(await fs.readFile(baselinePath, 'utf8')); assert.equal(before.status, 'PASS'); assert.equal(before.target.owner, state.owner); assert.equal(before.schemaVersion, receipt.schemaVersion); assert.equal(before.projection, receipt.projection);
    const privateBefore = path.resolve(ROOT, before.raw.path); assert.ok(contained(path.join(ROOT, 'pathfinder-engine/.scratch'), privateBefore)); await assertCanonicalPath(privateBefore);
    const beforeBytes = await fs.readFile(privateBefore); assert.equal(hash(beforeBytes), before.raw.sha256);
    const beforeGroups = JSON.parse(beforeBytes.toString()).groups;
    receipt.protectedRows = Object.fromEntries(Object.entries(beforeGroups).map(([name, rows]) => {
      const key = row => row.key, byId = new Map(observed.groups[name].map(row => [key(row), row])), originalIds = new Set(rows.map(key));
      return [name, { before: rows.length, unchanged: rows.filter(row => byId.has(key(row)) && hash(row) === hash(byId.get(key(row)))).length, added: observed.groups[name].filter(row => !originalIds.has(key(row))).length }];
    }));
    // Full row comparisons are retained privately before asserting preservation.
    const diff = { baseline: before.raw, current: receipt.raw, protectedRows: receipt.protectedRows };
    await fs.writeFile(path.join(scratch, 'comparison.private.json'), JSON.stringify(diff, null, 2) + '\n', { flag: 'wx' });
    assert.ok(Object.values(receipt.protectedRows).every(group => group.before === group.unchanged && (values['allow-new'] || group.added === 0)));
  }
  await ownership(state); receipt.status = 'PASS';
} catch (error) { receipt.error = error instanceof assert.AssertionError ? 'BUSINESS_PRESERVATION_ASSERTION' : 'BUSINESS_CAPTURE_FAILED'; }
receipt.finishedAt = new Date().toISOString(); const file = path.join(ROOT, 'docs/pathfinder/evidence/batched-capture/business-' + Date.now() + '.json');
await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: receipt.status, file: path.relative(ROOT, file).replaceAll('\\', '/'), error: receipt.error })); process.exitCode = receipt.status === 'PASS' ? 0 : 1;
