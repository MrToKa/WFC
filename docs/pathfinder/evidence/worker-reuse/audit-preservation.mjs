// Read-only source5190 preservation audit. Run only after the coordinator releases
// the final window. No login, jobs, lifecycle operations or original DB queries.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const PROJECT_ID = '105913f0-7ee4-45f2-bfd8-2c01f9be9f2a';
const HELPER = '/app/server/dist/server/pathfinder/lookupAudit.js';
const BASELINES = [
  ['docs/pathfinder/evidence/capacity/final-preservation-1792325162813.json', 'a88eec49c3fafd2e5f1517e40d679525c6fd36e22f6bbe49afc547de0bcfdb00'],
  ['docs/pathfinder/evidence/pf2-capacity/input-provenance-1792324304556.json', '1e8a290d483f8baed2672cadf36adfe9f0ae30018d85a09419a03d220be1ad6f'],
];
const CATEGORIES = ['settings', 'selection', 'registry', 'planningArtifacts', 'locations', 'aliases', 'bindings', 'modelObjects', 'cables', 'proposals', 'reviews', 'applies'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
const require = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code }); };
const same = (a, b) => canonical(a) === canonical(b);
function command(exe, args, maximum = 16 * 1024 ** 2) {
  try { return execFileSync(exe, args, { encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: maximum, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }); }
  catch { throw Object.assign(new Error('READ_ONLY_COMMAND_FAILED'), { code: 'READ_ONLY_COMMAND_FAILED', operation: exe === 'docker' ? args[0] : exe }); }
}
function regularOwnedFile(filename, maximum = 8 * 1024 ** 2) {
  const absolute = path.resolve(filename), relative = path.relative(ROOT, absolute);
  require(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'LOCAL_INPUT_OUTSIDE_WORKTREE');
  let current = ROOT;
  for (const segment of relative.split(path.sep)) { current = path.join(current, segment); require(!fs.lstatSync(current).isSymbolicLink(), 'LOCAL_INPUT_LINK_REFUSED'); }
  const stat = fs.lstatSync(absolute); require(stat.isFile() && stat.size > 0 && stat.size <= maximum, 'LOCAL_INPUT_SIZE_OR_KIND');
  return { path: absolute, bytes: stat.size, sha256: sha(fs.readFileSync(absolute)) };
}
function jsonFile(relative, expected) {
  const checked = regularOwnedFile(path.join(ROOT, relative)); require(checked.sha256 === expected, 'BASELINE_HASH_CHANGED');
  return { checked, value: JSON.parse(fs.readFileSync(checked.path, 'utf8')) };
}
function inspect(ids) {
  require(ids.length && ids.every(id => /^[a-f0-9]{64}$/.test(id)), 'CONTAINER_ID_INVALID');
  const values = JSON.parse(command('docker', ['inspect', ...ids])); require(Array.isArray(values) && values.length === ids.length, 'CONTAINER_INSPECT_INCOMPLETE'); return values;
}
const publicContainer = value => ({ id: value.Id, name: value.Name, image: value.Image, running: value.State.Running,
  startedAt: value.State.StartedAt, composeProject: value.Config.Labels?.['com.docker.compose.project'] ?? null,
  owner: value.Config.Labels?.['wfc.pathfinder.owner'] ?? null });
function sourceGuard(values, source, baseline) {
  require(source.project === 'wfc-pathfinder-local' && source.port === 5190 && /^[a-f0-9-]{36}$/.test(source.owner), 'SOURCE_BASELINE_IDENTITY');
  const api = values.find(value => value.Id === source.apiId), postgres = values.find(value => value.Id === source.postgresId);
  require(api && postgres, 'SOURCE_CONTAINERS_MISSING');
  for (const value of [api, postgres]) {
    const labels = value.Config.Labels ?? {};
    require(value.State.Running && labels['wfc.pathfinder.owner'] === source.owner && labels['wfc.pathfinder.project'] === source.project
      && labels['wfc.pathfinder.isolated'] === 'true' && labels['com.docker.compose.project'] === source.project, 'SOURCE_OWNERSHIP_REQUIRED');
    require(same(publicContainer(value), baseline.find(item => item.id === value.Id)), 'SOURCE_IDENTITY_CHANGED');
  }
  require(api.Image === source.apiImage, 'SOURCE_API_IMAGE_CHANGED');
  const env = new Map((api.Config.Env ?? []).map(entry => { const at = entry.indexOf('='); return [entry.slice(0, at), entry.slice(at + 1)]; }));
  require(env.get('PF_LOCAL_DEMO') === 'true' && env.get('PF_ROOT') === '/var/lib/wfc/pathfinder', 'SOURCE_RUNTIME_SCOPE_CHANGED');
  let database;
  try { database = new URL(env.get('DATABASE_URL')); } catch { require(false, 'SOURCE_DATABASE_CONFIG_INVALID'); }
  require(database.protocol === 'postgresql:' && database.hostname === 'postgres' && (database.port || '5432') === '5432'
    && database.pathname === '/wfc_pathfinder_local', 'SOURCE_DATABASE_CONFIG_INVALID');
  const shared = Object.entries(postgres.NetworkSettings.Networks ?? {}).filter(([name, network]) => api.NetworkSettings.Networks?.[name]
    && api.NetworkSettings.Networks[name].NetworkID === network.NetworkID && (network.Aliases ?? []).includes('postgres'));
  require(shared.length === 1 && shared[0][1].IPAddress, 'SOURCE_DATABASE_NETWORK_IDENTITY');
  const apiPublished = Object.values(api.NetworkSettings.Ports ?? {}).some(value => value?.length), pgPublished = Object.values(postgres.NetworkSettings.Ports ?? {}).some(value => value?.length);
  require(!apiPublished && !pgPublished, 'SOURCE_PRIVATE_DATABASE_REQUIRED');
  return { api, postgres, databaseAddress: shared[0][1].IPAddress, database: { host: database.hostname, port: 5432, name: 'wfc_pathfinder_local' } };
}
// This script runs only fixed reads inside an already verified own API container.
// Neither paths nor code come from request data or private credentials.
const INPUT_READ = `import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const read=(p,max)=>{let current='/';for(const part of p.split('/').filter(Boolean)){current=path.join(current,part);if(fs.lstatSync(current).isSymbolicLink())throw Error('Link refused');}const s=fs.lstatSync(p);if(!s.isFile()||s.size<1||s.size>max)throw Error('Read budget');const b=fs.readFileSync(p);return{path:p,bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex')};};
console.log(JSON.stringify({helper:read('${HELPER}',1048576),snapshot:read('/var/lib/wfc/pathfinder/snapshots/75c61dc7-d456-45b0-9052-2a0822240350.json',268435456)}));`;

const receipt = { schemaVersion: 'pathfinder.worker-reuse.preservation.v1', recordedAtUtc: new Date().toISOString(), status: 'FAIL',
  repository: { root: ROOT }, baselines: [], source: null, checks: [], workflow: { status: 'NOT_RUN' }, containers: { status: 'NOT_RUN' },
  snapshot: { status: 'NOT_RUN' }, deniedDirectories: [],
  isolationVerifier: { status: 'NOT_RUN_BY_THIS_SCRIPT', path: 'pathfinder-engine/verify-isolation.mjs', instruction: 'Coordinator runs existing verifier separately once after final release; frozen PF-0 generators must not be run.' },
  operationScope: { docker: 'inspect/list and fixed read-only exec only', database: 'Existing compiled lookupAudit uses REPEATABLE READ READ ONLY against verified own5190 PG',
    authMutations: 0, jobsCreated: 0, applyOperations: 0, lifecycleOperations: 0, healthRequests: 0, cleanupActions: 0 },
  limitations: ['No original database-content audit is claimed.', 'Additional isolated qualification/restore containers are allowed; all18 baseline IDs/images/start times must stay exact.',
    'Mount array enumeration order is not a container identity field and is not compared.', 'Denied directories receive existence-only lstat; no contents, removal, movement, archive or parent operation.'] };
const record = (name, pass, details) => receipt.checks.push({ name, status: pass ? 'PASS' : 'FAIL', details });
let target;
try {
  require(process.argv.length === 2, 'NO_ARGUMENTS_SUPPORTED');
  require(fs.lstatSync(ROOT).isDirectory() && !fs.lstatSync(ROOT).isSymbolicLink(), 'WORKTREE_DIRECTORY_REQUIRED');
  require(fs.lstatSync(HERE).isDirectory() && !fs.lstatSync(HERE).isSymbolicLink(), 'RECEIPT_DIRECTORY_REQUIRED');
  receipt.sourceScript = regularOwnedFile(fileURLToPath(import.meta.url));
  receipt.repository.branch = command('git', ['-C', ROOT, 'branch', '--show-current']).trim();
  receipt.repository.head = command('git', ['-C', ROOT, 'rev-parse', 'HEAD']).trim();
  const bound = BASELINES.map(([file, expected]) => jsonFile(file, expected)); receipt.baselines = bound.map(item => item.checked);
  const baseline = bound[0].value, input = bound[1].value;
  require(baseline.status === 'PASS' && input.status === 'PASS' && same(baseline.source, input.source), 'BASELINE_SOURCE_MISMATCH');
  require(baseline.containers.before.length === 18 && baseline.deniedDirectories.length === 6, 'BASELINE_COUNTS_INVALID');
  require(input.preservation.workflowUnchanged && Object.keys(input.preservation.workflowBefore).length === 12, 'WORKFLOW_BASELINE_INVALID');
  const expected = baseline.containers.before, before = inspect(expected.map(item => item.id));
  // Crucially complete both ownership/identity and database-destination checks
  // before executing even the existing read-only compiled query helper.
  const source = sourceGuard(before, input.source, expected);
  receipt.source = { ...input.source, database: source.database, api: publicContainer(source.api), postgres: publicContainer(source.postgres) };
  receipt.auditHelperSource = regularOwnedFile(path.join(ROOT, 'server/pathfinder/lookupAudit.ts'));
  require(receipt.auditHelperSource.sha256 === '8fb1f532824ceec4cb50dc68738eafd788b56ecfdcb860f901218345121c8896', 'AUDIT_HELPER_SOURCE_CHANGED');
  const inputsBefore = JSON.parse(command('docker', ['exec', source.api.Id, 'node', '--input-type=module', '-e', INPUT_READ], 65536));
  receipt.snapshot = { source: inputsBefore.snapshot, copied: regularOwnedFile(input.snapshot.path, 268435456),
    manifest: regularOwnedFile(input.privateManifest), reference: regularOwnedFile(input.privateReference) };
  record('source-snapshot-unchanged', inputsBefore.snapshot.sha256 === input.snapshot.sha256 && inputsBefore.snapshot.bytes === input.snapshot.bytes);
  record('copied-snapshot-unchanged', receipt.snapshot.copied.sha256 === input.snapshot.sha256 && receipt.snapshot.copied.bytes === input.snapshot.bytes);
  record('manifest-unchanged', receipt.snapshot.manifest.sha256 === input.manifestSha256);
  record('reference-unchanged', receipt.snapshot.reference.sha256 === input.referenceSha256);
  receipt.compiledAuditHelper = inputsBefore.helper;
  const output = command('docker', ['exec', '-e', 'PGOPTIONS=-c default_transaction_read_only=on', source.api.Id, 'node', HELPER, PROJECT_ID], 262144);
  const audit = JSON.parse(output); require(audit.schemaVersion === 'pathfinder.lookup.audit.v1' && audit.projectId === PROJECT_ID
    && audit.database?.database === 'wfc_pathfinder_local' && audit.database.port === 5432
    && audit.database.address?.split('/')[0] === source.databaseAddress, 'READ_ONLY_AUDIT_DATABASE_IDENTITY');
  require(same(Object.keys(audit.planningArtifactsAndWorkflow).sort(), [...CATEGORIES].sort()), 'AUDIT_CATEGORY_SET_INVALID');
  const comparison = CATEGORIES.map(category => ({ category, before: input.preservation.workflowBefore[category], after: audit.planningArtifactsAndWorkflow[category],
    unchanged: same(input.preservation.workflowBefore[category], audit.planningArtifactsAndWorkflow[category]) }));
  receipt.workflow = { status: comparison.every(item => item.unchanged) ? 'PASS' : 'FAIL', categories: comparison.length, comparison,
    registryRevision: audit.registryRevision, latestPlanningArtifact: audit.latestPlanningArtifact, selectedProject: PROJECT_ID, database: audit.database,
    rawAuditOutputSha256: sha(Buffer.from(output)) };
  record('all12-workflow-hashes-counts-unchanged', comparison.every(item => item.unchanged));
  record('active-current-planning-artifact-unchanged', same(audit.latestPlanningArtifact, baseline.snapshot.latestPlanningArtifact)
    && audit.registryRevision === input.snapshot.registryRevision);
  const inputsAfter = JSON.parse(command('docker', ['exec', source.api.Id, 'node', '--input-type=module', '-e', INPUT_READ], 65536));
  record('compiled-helper-and-source-snapshot-stable-across-audit', same(inputsBefore, inputsAfter));
  const after = inspect(expected.map(item => item.id)), finalSource = sourceGuard(after, input.source, expected);
  require(finalSource.databaseAddress === source.databaseAddress, 'SOURCE_DATABASE_NETWORK_CHANGED');
  const actual = after.map(publicContainer), containerComparison = expected.map(item => ({ id: item.id, name: item.name,
    before: item, after: actual.find(value => value.id === item.id), unchanged: same(item, actual.find(value => value.id === item.id)) }));
  const currentIds = command('docker', ['ps', '-aq', '--no-trunc']).trim().split(/\r?\n/).filter(Boolean);
  const additionalIds = currentIds.filter(id => !expected.some(item => item.id === id));
  const additional = additionalIds.length ? inspect(additionalIds) : [];
  const additionalOwned = additional.every(value => value.Config.Labels?.['wfc.pathfinder.isolated'] === 'true'
    && /^[a-f0-9-]{36}$/.test(value.Config.Labels?.['wfc.pathfinder.owner'] ?? '')
    && /^wfc-pathfinder-local-[a-z0-9-]+$/.test(value.Config.Labels?.['wfc.pathfinder.project'] ?? ''));
  receipt.containers = { status: containerComparison.every(item => item.unchanged) ? 'PASS' : 'FAIL', baselineCount: expected.length,
    originalCount: expected.filter(item => item.composeProject !== input.source.project).length, ownCount: expected.filter(item => item.composeProject === input.source.project).length,
    currentCount: currentIds.length, additionalIds, additional: additional.map(publicContainer), comparison: containerComparison };
  record('additional-containers-owned-and-isolated', additionalOwned);
  record('all18-baseline-container-identities-unchanged', containerComparison.every(item => item.unchanged));
  record('original13-container-identities-unchanged', containerComparison.filter(item => item.before.composeProject !== input.source.project).every(item => item.unchanged));
  record('own5-container-identities-unchanged', containerComparison.filter(item => item.before.composeProject === input.source.project).every(item => item.unchanged));
  receipt.deniedDirectories = baseline.deniedDirectories.map(item => {
    const relative = path.relative(ROOT, item.path); require(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'DENIED_PATH_OUTSIDE_WORKTREE');
    try { const stat = fs.lstatSync(item.path); return { path: item.path, exists: true, isDirectory: stat.isDirectory(), check: 'existence-only lstat; no contents or mutation' }; }
    catch (error) { if (error.code !== 'ENOENT') throw error; return { path: item.path, exists: false, isDirectory: false, check: 'existence-only lstat' }; }
  });
  record('all6-denied-directories-retained', receipt.deniedDirectories.every(item => item.exists && item.isDirectory));
  receipt.status = receipt.checks.every(item => item.status === 'PASS') ? 'PASS' : 'FAIL';
} catch (error) {
  receipt.error = { code: /^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : 'PRESERVATION_AUDIT_FAILED', operation: error.operation ?? null };
}
try {
  target = path.join(HERE, 'preservation-' + Date.now() + '-' + randomUUID().slice(0, 8) + '.json');
  fs.writeFileSync(target, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ status: receipt.status, receipt: target, checks: receipt.checks.length, failed: receipt.checks.filter(item => item.status === 'FAIL').length }));
} catch { console.error('PRESERVATION_RECEIPT_WRITE_FAILED'); process.exitCode = 2; }
if (receipt.status !== 'PASS') process.exitCode ||= 1;
