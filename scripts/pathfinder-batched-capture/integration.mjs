import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { load, ownership, ROOT, contained } from '../pathfinder-local/runtime-lib.mjs';
import { createDocker } from '../operations/docker.mjs';
import { assertCanonicalPath } from '../operations/archives.mjs';

const { values } = parseArgs({ strict: true, options: { runtime: { type: 'string' }, owner: { type: 'string' }, 'compiled-server': { type: 'string' } } });
const hash = value => createHash('sha256').update(value).digest('hex');
const receipt = { schemaVersion: 'pathfinder.batched-capture.repository-sql.v1', status: 'FAIL', recordedAt: new Date().toISOString() };
try {
  const state = await load(values.runtime);
  assert.equal(state.owner, values.owner); assert.equal(state.port, 5191);
  assert.notEqual(state.project, 'wfc-pathfinder-local'); assert.equal(state.restore?.inventoriesEqual, true);
  const compiled = path.resolve(values['compiled-server']);
  assert.ok(contained(path.join(ROOT, 'pathfinder-engine/.scratch'), compiled)); await assertCanonicalPath(compiled, { directory: true });
  const files = ['candidateEligibilityIntegration.js', 'repository.js'];
  const expected = Object.fromEntries(await Promise.all(files.map(async file => [file, hash(await fs.readFile(path.join(compiled, 'server/pathfinder', file)))])));
  const resources = await ownership(state), api = resources.containers.find(row => row.role === 'api'), pg = resources.containers.find(row => row.role === 'postgres');
  assert.ok(api?.running && pg?.running);
  const docker = await createDocker(), actualApi = await docker.inspect(api.id), actualPg = await docker.inspect(pg.id);
  assert.equal(actualApi.Config.Labels['wfc.pathfinder.owner'], state.owner); assert.equal(actualPg.Config.Labels['wfc.pathfinder.owner'], state.owner);
  const network = state.project + '_backend', address = actualPg.NetworkSettings.Networks[network]?.IPAddress;
  assert.ok(address && actualApi.NetworkSettings.Networks[network]);
  const target = { database: 'wfc_pathfinder_local', serverAddress: address, serverPort: 5432, syntheticProjectId: state.syntheticDemo?.projectId };
  assert.match(target.syntheticProjectId ?? '', /^[a-f0-9-]{36}$/);
  receipt.target = { owner: state.owner, project: state.project, apiId: api.id, apiImage: api.image, postgresId: pg.id, postgresImage: pg.image, network, sql: target };
  receipt.expectedCompiled = expected;
  const program = `import fs from 'node:fs/promises';import {createHash} from 'node:crypto';import {Pool} from 'pg';
const watchdog=setTimeout(()=>{process.stdout.write(JSON.stringify({status:'FAIL',code:'SQL_HELPER_DEADLINE'})+'\\n',()=>process.exit(2));setTimeout(()=>process.exit(2),200);},55000);
const expected=${JSON.stringify(expected)},observed={};for(const file of Object.keys(expected)){observed[file]=createHash('sha256').update(await fs.readFile('/app/server/dist/server/pathfinder/'+file)).digest('hex');if(observed[file]!==expected[file])throw Error('COMPILED_ARTIFACT_MISMATCH');}
const {runCandidateEligibilityIntegration}=await import('/app/server/dist/server/pathfinder/candidateEligibilityIntegration.js');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000,query_timeout:5000});let poolError=false;pool.on('error',()=>{poolError=true;});
let result;try{result=await runCandidateEligibilityIntegration(pool,${JSON.stringify(target)});}finally{await pool.end();}await new Promise((resolve,reject)=>process.stdout.write(JSON.stringify({compiled:observed,poolError,result})+'\\n',error=>error?reject(error):resolve()));clearTimeout(watchdog);`;
  // Bound both the child and retained output. Only the new owned API executes it.
  const raw = await new Promise(resolve => {
    const child = spawn('docker', ['exec', '-i', api.id, 'node', '--input-type=module'], { cwd: ROOT, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = []; let count = 0, stderr = '', overflow = false, settled = false, stdinError = false;
    const finish = (exitCode, timedOut = false, spawnError = false) => { if (settled) return; settled = true; clearTimeout(timer); resolve({ bytes: Buffer.concat(chunks), exitCode, stderrBytes: Buffer.byteLength(stderr), overflow, timedOut, spawnError, stdinError }); };
    const timer = setTimeout(() => { child.kill(); finish(null, true); }, 60000);
    child.stdout.on('data', chunk => { count += chunk.length; if (count > 1048576) { overflow = true; child.kill(); } else chunks.push(chunk); });
    child.stderr.on('data', chunk => { if (stderr.length < 4096) stderr += chunk.toString(); });
    child.on('error', () => finish(null, false, true));
    child.on('close', code => finish(code));
    child.stdin.on('error', () => { stdinError = true; });
    child.stdin.end(program);
  });
  const evidence = path.join(ROOT, 'docs/pathfinder/evidence/batched-capture'); await fs.mkdir(evidence, { recursive: true });
  const rawFile = path.join(evidence, 'repository-sql-raw-' + Date.now() + '.json');
  await fs.writeFile(rawFile, raw.bytes, { flag: 'wx' });
  receipt.raw = { file: path.relative(ROOT, rawFile).replaceAll('\\', '/'), bytes: raw.bytes.length, sha256: hash(raw.bytes), exitCode: raw.exitCode, stderrBytes: raw.stderrBytes, overflow: raw.overflow, timedOut: raw.timedOut, spawnError: raw.spawnError, stdinError: raw.stdinError };
  assert.equal(raw.timedOut, false); assert.equal(raw.spawnError, false); assert.equal(raw.stdinError, false); assert.equal(raw.exitCode, 0); assert.equal(raw.overflow, false); assert.equal(raw.stderrBytes, 0);
  const result = JSON.parse(raw.bytes.toString()); assert.equal(result.poolError, false); assert.deepEqual(result.compiled, expected);
  receipt.result = result.result;
  assert.equal(result.result.status, 'PASS'); assert.equal(result.result.cleanup?.status, 'PASS');
  await ownership(state); receipt.status = 'PASS';
} catch (error) { receipt.error = error instanceof assert.AssertionError ? 'ASSERTION_FAILURE' : /^[A-Z_]{3,80}$/.test(error.message ?? '') ? error.message : 'REPOSITORY_SQL_CHECK_FAILED'; }
receipt.finishedAt = new Date().toISOString();
const output = path.join(ROOT, 'docs/pathfinder/evidence/batched-capture/repository-sql-' + Date.now() + '.json');
await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: receipt.status, file: path.relative(ROOT, output).replaceAll('\\', '/'), checks: receipt.result?.checks?.length, error: receipt.error }));
process.exitCode = receipt.status === 'PASS' ? 0 : 1;
