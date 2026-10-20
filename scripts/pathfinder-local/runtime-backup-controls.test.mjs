import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import os from 'node:os';
import { createHash } from 'node:crypto';
import {artifactAudit,databaseDumpHelperConfiguration,assertDatabaseDumpHelperMounts,ROOT,backup,restore,validateInventoryProvider,
  captureInventoryWithProvider,validateRestoreInventoryProvider,validateBackupInventoryContract,contained} from './runtime-lib.mjs';

const imageId='sha256:'+'a'.repeat(64),state={owner:'ab6bca4b-bb14-4fc2-bb75-bb10bb089b20',project:'wfc-pathfinder-local-abcdef123456',images:{api:'sha256:'+'b'.repeat(64)}},postgres={image:imageId};
const image=(volumes={'/var/lib/postgresql':{}})=>({Id:imageId,Os:'linux',Config:{Volumes:volumes}});
const spec=(directory='/owned/backup',volumes)=>databaseDumpHelperConfiguration(state,postgres,directory,image(volumes));
function actualFor(value,directory='/owned/backup'){
  return{HostConfig:{Mounts:structuredClone(value.config.HostConfig.Mounts)},Mounts:[{Type:'bind',Source:directory,Destination:'/backup',RW:false},...value.targets.map(Destination=>({Type:'tmpfs',Source:'',Destination,RW:false}))]};
}

test('artifact audit uses the exact root inventory command and read-only volume and returns unchanged proof',async()=>{
  const calls=[],proof=Object.freeze({status:'PASS',files:[],totalBytes:0,sha256:'c'.repeat(64)});
  const docker={async run(...args){calls.push(args);return proof;}};
  assert.equal(await artifactAudit(state,{docker}),proof);assert.equal(calls.length,1);
  assert.deepEqual(calls[0],[state.images.api,{cmd:['node','scripts/pathfinder-local/container-ops.mjs','inventory','/source'],mounts:[{Type:'volume',Source:state.project+'_pathfinder',Target:'/source',ReadOnly:true}],user:'0',labels:{'wfc.pathfinder.owner':state.owner,'wfc.pathfinder.project':state.project,'wfc.pathfinder.isolated':'true'}}]);
});
for(const result of [{status:'FAIL',code:'PF_ARTIFACT_AUDIT_FAILED'},{status:'DEFERRED'},{status:'pass'},undefined,null])test('failed or absent artifact proof refuses immediately: '+String(result?.status),async()=>{
  let calls=0;await assert.rejects(artifactAudit(state,{docker:{async run(){calls++;return result;}}}),error=>error.code==='PF_ARTIFACT_AUDIT_FAILED');assert.equal(calls,1);
});
test('artifact transport refusal remains the original failure',async()=>{
  const original=Object.assign(Error('synthetic transport refusal'),{code:'DOCKER_SCOPE_CLEANUP_UNCONFIRMED'});
  await assert.rejects(artifactAudit(state,{docker:{async run(){throw original;}}}),error=>error===original);
});
for(const targets of [['/var/lib/postgresql'],['/var/lib/postgresql/data'],['/var/lib/postgresql','/var/lib/postgresql/data']])test('TOC helper shadows all closed PostgreSQL image volume paths: '+targets.join(','),()=>{
  const volumes=Object.fromEntries(targets.map(target=>[target,{}])),before=structuredClone(volumes),value=spec('/owned/backup',volumes),h=value.config.HostConfig;
  assert.deepEqual(volumes,before);assert.deepEqual(value.targets,[...targets].sort());
  assert.equal(value.config.Image,imageId);assert.deepEqual(value.config.Entrypoint,['pg_restore']);assert.deepEqual(value.config.Cmd,['--list','/backup/database.dump']);assert.equal(h.ReadonlyRootfs,true);assert.equal(h.NetworkMode,'none');assert.deepEqual(h.CapDrop,['ALL']);assert.deepEqual(h.SecurityOpt,['no-new-privileges:true']);assert.equal(h.CapAdd,undefined);
  assert.deepEqual(h.Mounts,[{Type:'bind',Source:'/owned/backup',Target:'/backup',ReadOnly:true},...value.targets.map(Target=>({Type:'tmpfs',Target,ReadOnly:true,TmpfsOptions:{SizeBytes:1048576,Mode:0o755}}))]);
  assertDatabaseDumpHelperMounts(actualFor(value),'/owned/backup',value.targets);
});
for(const volumes of [undefined,null,[],{}, {'/':{}},{'/var/lib/postgresql/':{}},{'/var/lib/postgresql/data/..':{}},{'/var/lib/postgresql-other':{}},{'/var/lib/postgresql':null},{'/var/lib/postgresql':[]},{'/var/lib/postgresql':{unexpected:true}},{'/var/lib/postgresql':{},'/foreign':{}}])test('unexpected image volume declaration refuses before helper construction: '+JSON.stringify(volumes),()=>{
  const value={Id:imageId,Os:'linux',Config:{Volumes:volumes}};
  assert.throws(()=>databaseDumpHelperConfiguration(state,postgres,'/owned/backup',value),error=>error.code==='PF_BACKUP_POSTGRES_IMAGE_VOLUMES');
});
for(const patch of [{Id:'sha256:'+'f'.repeat(64)},{Os:'windows'}])test('TOC image identity/platform cannot be substituted: '+Object.keys(patch)[0],()=>{
  assert.throws(()=>databaseDumpHelperConfiguration(state,postgres,'/owned/backup',{...image(),...patch}),error=>error.code==='PF_BACKUP_POSTGRES_IMAGE_VOLUMES');
});
test('effective TOC mount proof accepts only the exact Windows Docker Desktop translation',()=>{
  const directory='C:\\Users\\Synthetic\\owned-backup',value=spec(directory);
  assertDatabaseDumpHelperMounts(actualFor(value,directory),directory,value.targets);
  assertDatabaseDumpHelperMounts(actualFor(value,'/run/desktop/mnt/host/c/Users/Synthetic/owned-backup'),directory,value.targets);
  for(const source of ['/run/desktop/mnt/host/c/Users/Synthetic/owned-backup-other','/run/desktop/mnt/host/d/Users/Synthetic/owned-backup','/run/desktop/mnt/host/c/users/Synthetic/owned-backup'])assert.throws(()=>assertDatabaseDumpHelperMounts(actualFor(value,source),directory,value.targets),error=>error.code==='PF_BACKUP_DUMP_HELPER_MOUNTS');
});
const alterations=[
  ['anonymous image volume',v=>{v.Mounts[1]={Type:'volume',Name:'synthetic-anonymous',Source:'/var/lib/docker/volumes/synthetic',Destination:'/var/lib/postgresql',RW:true};}],
  ['extra anonymous volume',v=>{v.Mounts.push({Type:'volume',Name:'unexpected',Destination:'/extra',RW:true});}],
  ['writable backup',v=>{v.Mounts[0].RW=true;}],
  ['wrong backup directory',v=>{v.Mounts[0].Source='/foreign/backup';}],
  ['writable PostgreSQL tmpfs',v=>{v.Mounts[1].RW=true;}],
  ['missing effective boolean',v=>{delete v.Mounts[1].RW;}],
  ['wrong tmpfs destination',v=>{v.Mounts[1].Destination='/foreign';}],
  ['tmpfs with foreign source',v=>{v.Mounts[1].Source='/foreign';}],
  ['unbounded tmpfs size',v=>{delete v.HostConfig.Mounts[1].TmpfsOptions.SizeBytes;}],
  ['wrong tmpfs mode',v=>{v.HostConfig.Mounts[1].TmpfsOptions.Mode=0o777;}],
  ['writable configured mount',v=>{v.HostConfig.Mounts[1].ReadOnly=false;}],
  ['missing configured mount',v=>{v.HostConfig.Mounts.splice(1,1);}],
];
for(const[title,alter]of alterations)test('TOC helper refuses '+title+' before starting',()=>{
  const value=spec(),actual=actualFor(value);alter(actual);
  assert.throws(()=>assertDatabaseDumpHelperMounts(actual,'/owned/backup',value.targets),error=>error.code==='PF_BACKUP_DUMP_HELPER_MOUNTS');
});
test('forged missing, duplicate or unknown declared target set cannot authorize effective mounts',()=>{
  const value=spec(),actual=actualFor(value);
  for(const targets of [[],['/var/lib/postgresql','/var/lib/postgresql'],['/foreign']])assert.throws(()=>assertDatabaseDumpHelperMounts(actual,'/owned/backup',targets),error=>error.code==='PF_BACKUP_DUMP_HELPER_MOUNTS');
});

// Execute the actual exported restore body in a closed VM with every external
// collaborator mocked. This changes no runtime, archive, filesystem or Docker
// state and does not claim that a mocked fencing proof qualifies a real restore.
const runtimeSource = await fs.readFile(new URL('./runtime-lib.mjs', import.meta.url), 'utf8');
const restoreSource = runtimeSource.slice(runtimeSource.indexOf('export async function restore(')).replace(/^export /, '');
assert.ok(restoreSource.startsWith('async function restore('));
function restoreHarness({ observerError = null, validationError = null, startError = null, version = 1, captureError = null } = {}) {
  const calls = [], saved = [], target = { runtime: path.resolve('synthetic-u8-target'), owner: '10000000-0000-4000-8000-000000000001',
    project: 'wfc-pathfinder-local-abcdef123456', port: 5192, images: {}, status: 'initialized' };
  const inventory = { businessSha256: 'a'.repeat(64), registrySha256: 'b'.repeat(64) }, artifacts = { sha256: 'c'.repeat(64) };
  const manifest = { schemaVersion: version, ...(version === 2 ? { inventoryModule: { path: 'losslessInventory.mjs', sha256: 'a'.repeat(64), bytes: 24 } } : {}),
    backupId: '10000000-0000-4000-8000-000000000002', inventory, artifacts,
    images: ['api', 'web', 'postgres', 'minio'].map((role, at) => ({ role, id: 'sha256:' + String(at + 1).repeat(64), archive: role + '-image.tar' })),
    files: ['minio', 'staging', 'pathfinder'].map(role => ({ path: role + '.wfcops', sha256: 'd'.repeat(64) })) };
  const failure = code => { throw Object.assign(new Error(code), { code }); };
  const sandbox = {
    path, ROOT: path.resolve('synthetic-repository'), Date, JSON, Object, Buffer,
    fail: failure, digest: () => 'e'.repeat(64), randomBytes: bytes => Buffer.alloc(bytes, 7),
    requireColdObserver: observer => { calls.push('check-observer'); if (observer !== undefined && typeof observer !== 'function') failure('PF_COLD_OBSERVER_INVALID'); },
    validateInventoryProvider: async provider => { calls.push('check-provider'); return provider ?? null; },
    validateRestoreInventoryProvider: (manifest, provider) => { calls.push('check-restore-provider'); return validateRestoreInventoryProvider(manifest, provider); },
    verifyBackup: async () => { calls.push('verify-backup'); return { directory: path.resolve('synthetic-backup'), manifest }; },
    assertCanonicalPath: async () => { calls.push('check-path'); },
    fs: { readFile: async () => Buffer.from(JSON.stringify({ format: 'WFC-PF-LOCAL-PRIVATE', schemaVersion: 1, backupId: manifest.backupId,
      settings: { producer: { key: 'historical-private-control' }, jwtSecret: 'historical-jwt' } })),
      writeFile: async filename => { calls.push(['write-private', filename]); } },
    init: async input => { calls.push(['init', input]); return target; },
    ownership: async (_state, input) => { calls.push(['ownership', input ?? null]); return { containers: [{ role: 'postgres', id: 'synthetic-pg' }] }; },
    freePort: async port => { calls.push(['free-port', port]); },
    jsonCommand: async args => { calls.push(['image-check', args]); return [{}]; },
    writeEnv: async (_state, settings) => { calls.push(['write-env', settings]); },
    save: async value => { saved.push(structuredClone(value)); calls.push(['save', value.status]); },
    configuration: async () => { calls.push('configuration'); },
    composeArgs: () => ['compose', '--project-name', target.project],
    command: async args => { calls.push(['command', args]); return Buffer.alloc(0); },
    createDocker: async () => ({ request: async (...args) => { calls.push(['docker-request', args]); } }),
    labels: () => ({ 'wfc.pathfinder.owner': target.owner }), mount: (...values) => values,
    helper: async (_state, args) => { calls.push(['helper', args]); return { status: 'PASS' }; },
    waitStorage: async () => { calls.push('wait-storage'); },
    operation: async (_state, name) => { calls.push(['operation', name]); return name === 'inventory' ? inventory : { status: 'PASS' }; },
    runtimeInventory: async (provider, phase) => {
      if (!provider) { calls.push(['operation', 'inventory']); return inventory; }
      calls.push(['provider-capture', phase]); if (captureError) throw captureError; return inventory;
    },
    artifactAudit: async () => { calls.push('artifact-audit'); return artifacts; },
    validateRestoredInventory: () => { calls.push('validate-before-fence'); if (validationError) throw validationError; },
    validateRestoreFencing: () => { calls.push('validate-fencing'); return { status: 'PASS' }; },
    writePrivateJson: async () => { calls.push('private-demo'); },
    observeColdRuntime: async (observer, phase) => { calls.push(phase); if (observerError && phase === 'restore-after-fence') throw observerError;
      if (observer) await observer(Object.freeze({ phase })); },
    start: async () => { calls.push('start-api-web'); if (startError) throw startError; target.status = 'running'; },
    sleep: async () => { throw new Error('No retry should be needed by this synthetic fixture.'); },
  };
  return { restore: new vm.Script('(' + restoreSource + ')', { filename: 'actual-runtime-restore-isolated.mjs' }).runInNewContext(sandbox), calls, saved, target };
}
test('activate:false verifies the actual restore sequence and leaves API/web unstarted in saved verified quarantine', async () => {
  const fixture = restoreHarness(), observerCalls = [];
  const result = await fixture.restore({ backup: 'synthetic', privateConfig: 'synthetic.private.json', runtime: fixture.target.runtime, port: 5192,
    activate: false, observeCold: async value => { observerCalls.push(value.phase); await Promise.resolve(); } });
  assert.equal(result.status, 'PASS'); assert.equal(result.activated, false); assert.equal(fixture.target.status, 'verified-quarantine');
  assert.deepEqual(observerCalls, ['restore-before-fence', 'restore-after-fence']); assert.equal(fixture.calls.includes('start-api-web'), false);
  assert.deepEqual(fixture.saved.map(value => value.status), ['quarantine', 'verified-quarantine']);
  const commands = fixture.calls.filter(value => Array.isArray(value) && value[0] === 'command').map(value => value[1]);
  assert.ok(commands.some(args => args.includes('start') && args.slice(-2).join() === 'postgres,minio'));
  assert.equal(commands.some(args => args.includes('up') || args.includes('api') || args.includes('web')), false);
  assert.ok(fixture.calls.indexOf('validate-before-fence') < fixture.calls.indexOf('restore-before-fence'));
  assert.ok(fixture.calls.indexOf('validate-fencing') < fixture.calls.indexOf('restore-after-fence'));
  const settings = fixture.calls.find(value => Array.isArray(value) && value[0] === 'write-env')[1];
  assert.equal(settings.producer, undefined); assert.notEqual(settings.jwtSecret, 'historical-jwt');
});
for (const activate of [undefined, true]) test('historical activation remains unchanged for ' + String(activate), async () => {
  const fixture = restoreHarness(), options = { backup: 'synthetic', privateConfig: 'synthetic.private.json', runtime: fixture.target.runtime, port: 5192 };
  if (activate !== undefined) options.activate = activate;
  const result = await fixture.restore(options);
  assert.equal(result.status, 'PASS'); assert.equal(Object.hasOwn(result, 'activated'), false); assert.equal(fixture.target.status, 'running');
  assert.equal(fixture.calls.filter(value => value === 'start-api-web').length, 1);
  assert.ok(fixture.calls.indexOf('restore-after-fence') < fixture.calls.indexOf('start-api-web'));
});
for (const activate of [null, 0, 1, '', 'false', 'true', {}, [], new Boolean(false)]) test('invalid activation refuses before any collaborator: ' + String(activate), async () => {
  const fixture = restoreHarness(); await assert.rejects(() => fixture.restore({ activate }), error => error.code === 'PF_RESTORE_ACTIVATION_INVALID');
  assert.deepEqual(fixture.calls, []); assert.deepEqual(fixture.saved, []);
});
test('cold restore never marks observer refusal successful or activates API/web', async () => {
  const refusal = Object.assign(Error('synthetic observer refusal'), { code: 'SYNTHETIC_OBSERVER_REFUSED' }), fixture = restoreHarness({ observerError: refusal });
  await assert.rejects(() => fixture.restore({ backup: 'synthetic', privateConfig: 'synthetic.private.json', activate: false }), error => error === refusal);
  assert.equal(fixture.target.status, 'failed-quarantine'); assert.equal(fixture.calls.includes('start-api-web'), false);
  assert.equal(fixture.saved.at(-1).status, 'failed-quarantine');
});
test('activate:false retains all existing restoration and fencing acceptance gates', async () => {
  const refusal = Error('synthetic inventory mismatch'), fixture = restoreHarness({ validationError: refusal });
  await assert.rejects(() => fixture.restore({ backup: 'synthetic', privateConfig: 'synthetic.private.json', activate: false }), error => error === refusal);
  assert.equal(fixture.target.status, 'failed-quarantine'); assert.equal(fixture.calls.includes('restore-before-fence'), false);
  assert.equal(fixture.calls.includes('validate-fencing'), false); assert.equal(fixture.calls.includes('start-api-web'), false);
});
test('historical activation failure still quarantines rather than yielding a false restore PASS', async () => {
  const refusal = Error('synthetic startup refusal'), fixture = restoreHarness({ startError: refusal });
  await assert.rejects(() => fixture.restore({ backup: 'synthetic', privateConfig: 'synthetic.private.json' }), error => error === refusal);
  assert.equal(fixture.target.status, 'failed-quarantine'); assert.equal(fixture.saved.at(-1).status, 'failed-quarantine');
});

const digestCanonical = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
function canonicalJson(value) { return value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value)
  ? '[' + value.map(canonicalJson).join(',') + ']' : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}'; }
function syntheticV2(sha256 = 'a'.repeat(64)) {
  const tables = ['pf_proposals', 'viewer_login_bindings', 'viewer_resource_sessions'].map(table => ({ table, rows: table === 'pf_proposals' ? 1034 : 0,
    sha256: table === 'pf_proposals' ? 'c'.repeat(64) : digestCanonical([]), transientSessions: table !== 'pf_proposals',
    hashBasis: table === 'pf_proposals' ? 'postgresql-jsonb-text-framed.v1' : 'legacy-canonical-json-array.v1' }));
  return { schemaVersion: 2, command: 'inventory', status: 'PASS', algorithm: 'wfc.pf.raw-table-legacy-fence.v1', moduleSha256: sha256, tables,
    businessSha256: digestCanonical(tables.filter(row => !row.transientSessions)), registrySha256: digestCanonical([]) };
}
function v2Manifest() {
  const inventoryModule = { path: 'losslessInventory.mjs', bytes: 24, sha256: 'a'.repeat(64) };
  return { schemaVersion: 2, profile: 'cold-pg-minio-staging-pathfinder-v2', inventory: syntheticV2(), inventoryModule,
    files: [...Array.from({ length: 8 }, (_, index) => ({ path: 'synthetic-' + index, bytes: 1, sha256: 'c'.repeat(64) })), { ...inventoryModule }] };
}
test('V2 manifest is an explicit nine-member profile with the qualified helper embedded', () => {
  assert.equal(validateBackupInventoryContract(v2Manifest()), true);
  assert.equal(validateBackupInventoryContract({ schemaVersion: 1, profile: 'cold-pg-minio-staging-pathfinder-v1', files: Array(8).fill({}) }), false);
});
for (const change of ['profile', 'version', 'missing-member', 'extra-member', 'missing-helper', 'bad-helper-hash', 'bad-helper-path', 'bad-helper-size',
  'extra-helper-field', 'module-envelope-mismatch', 'file-pin-mismatch', 'legacy-envelope'])
  test('V2 member/algorithm pin refuses ' + change, () => {
    const manifest = v2Manifest();
    if (change === 'profile') manifest.profile = 'cold-pg-minio-staging-pathfinder-v1';
    if (change === 'version') manifest.schemaVersion = 3;
    if (change === 'missing-member') manifest.files.pop();
    if (change === 'extra-member') manifest.files.push({ path: 'unclaimed' });
    if (change === 'missing-helper') delete manifest.inventoryModule;
    if (change === 'bad-helper-hash') manifest.inventoryModule.sha256 = 'not-sha';
    if (change === 'bad-helper-path') manifest.inventoryModule.path = '../other.mjs';
    if (change === 'bad-helper-size') manifest.inventoryModule.bytes = 2 * 1024 ** 2 + 1;
    if (change === 'extra-helper-field') manifest.inventoryModule.executable = true;
    if (change === 'module-envelope-mismatch') manifest.inventory.moduleSha256 = 'b'.repeat(64);
    if (change === 'file-pin-mismatch') manifest.files.at(-1).bytes++;
    if (change === 'legacy-envelope') manifest.inventory.schemaVersion = 1;
    assert.throws(() => validateBackupInventoryContract(manifest));
  });
test('a legacy profile cannot silently acquire a V2 provider or reserved embedded helper', () => {
  assert.throws(() => validateRestoreInventoryProvider({ schemaVersion: 1 }, { sha256: 'a'.repeat(64) }), { code: 'PF_LEGACY_BACKUP_PROVIDER_REFUSED' });
  assert.throws(() => validateBackupInventoryContract({ schemaVersion: 1, profile: 'cold-pg-minio-staging-pathfinder-v1', files: Array(8).fill({}), inventoryModule: {} }));
});
for (const provider of [undefined, null, {}, { bytes: 25, sha256: 'a'.repeat(64) }, { bytes: 24, sha256: 'b'.repeat(64) }])
  test('V2 restore refuses absent/substituted provider before target initialization: ' + String(provider?.sha256), async () => {
    const fixture = restoreHarness({ version: 2 });
    await assert.rejects(fixture.restore({ backup: 'synthetic', privateConfig: 'synthetic.private.json', activate: false, inventoryProvider: provider }),
      { code: 'PF_RESTORE_INVENTORY_PROVIDER_REQUIRED' });
    assert.equal(fixture.calls.some(value => Array.isArray(value) && value[0] === 'init'), false); assert.deepEqual(fixture.saved, []);
  });
test('V2 actual restore body uses only the explicit provider for both inventory phases and retains API-off ordering', async () => {
  const fixture = restoreHarness({ version: 2 }), provider = { sha256: 'a'.repeat(64), bytes: 24 };
  const result = await fixture.restore({ backup: 'synthetic', privateConfig: 'synthetic.private.json', activate: false, inventoryProvider: provider });
  assert.equal(result.activated, false);
  assert.deepEqual(fixture.calls.filter(value => Array.isArray(value) && value[0] === 'provider-capture').map(value => value[1]), ['restore-before-fence', 'restore-after-fence']);
  assert.equal(fixture.calls.some(value => Array.isArray(value) && value[0] === 'operation' && value[1] === 'inventory'), false);
  assert.ok(fixture.calls.indexOf('check-restore-provider') < fixture.calls.findIndex(value => Array.isArray(value) && value[0] === 'init'));
  assert.equal(fixture.calls.includes('start-api-web'), false);
});
test('V2 provider refusal quarantines target and never starts API/web or attempts fencing', async () => {
  const refusal = Object.assign(Error('synthetic invalid V2 inventory'), { code: 'PF_INVENTORY_PROVIDER_RESULT_INVALID' });
  const fixture = restoreHarness({ version: 2, captureError: refusal });
  await assert.rejects(fixture.restore({ backup: 'synthetic', privateConfig: 'synthetic.private.json', activate: false,
    inventoryProvider: { sha256: 'a'.repeat(64), bytes: 24 } }), error => error === refusal);
  assert.equal(fixture.target.status, 'failed-quarantine'); assert.equal(fixture.calls.includes('validate-fencing'), false); assert.equal(fixture.calls.includes('start-api-web'), false);
});
for (const provider of [null, {}, [], 'provider', { modulePath: 'relative.mjs', sha256: 'a'.repeat(64), capture() {} },
  { modulePath: path.resolve('synthetic.mjs'), sha256: 'bad-hash', capture() {} }])
  test('invalid provider fails actual backup/restore functions before any filesystem/runtime collaborators', async () => {
    await assert.rejects(backup(null, 'unused', 'unused', { inventoryProvider: provider }), { code: 'PF_INVENTORY_PROVIDER_INVALID' });
    await assert.rejects(restore({ inventoryProvider: provider }), { code: 'PF_INVENTORY_PROVIDER_INVALID' });
  });
test('qualified provider module and returned V2 scope are SHA-bound and detached from subsequent callback mutation', async () => {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'wfc-pf-provider-unit-'))), modulePath = path.join(directory, 'qualified.mjs');
  const raw = 'export const syntheticInventoryUnit = true;\n', sha256 = createHash('sha256').update(raw).digest('hex');
  const scope = { ...state, format: 'WFC-PF-LOCAL', schemaVersion: 1, root: ROOT, runtime: path.join(ROOT, 'pathfinder-engine/.scratch/synthetic-provider-unit'),
    port: 5192, envSha256: 'f'.repeat(64), tags: { api: 'wfc-pathfinder-api:ab6bca4bbb14-unit', web: 'wfc-pathfinder-web:ab6bca4bbb14-unit' } };
  try {
    await fs.writeFile(modulePath, raw, { flag: 'wx' }); let observed, value = syntheticV2(sha256), calls = 0;
    const provider = await validateInventoryProvider({ modulePath, sha256, capture: async observation => { calls++; observed = observation; return value; } });
    assert.equal(Object.isFrozen(provider), true); assert.equal(provider.bytes, Buffer.byteLength(raw));
    const accepted = await captureInventoryWithProvider(provider, 'backup-before-audit', scope, '10000000-0000-4000-8000-000000000002');
    assert.equal(Object.isFrozen(observed), true); assert.deepEqual(Object.keys(observed).sort(), ['apiImage', 'backupId', 'moduleSha256', 'owner', 'phase', 'port', 'project', 'runtime']);
    assert.equal(observed.moduleSha256, sha256); assert.equal(observed.owner, scope.owner); assert.equal(calls, 1);
    value.tables[0].rows = 7; assert.equal(accepted.tables[0].rows, 1034);
    value = syntheticV2('e'.repeat(64)); await assert.rejects(captureInventoryWithProvider(provider, 'restore-before-fence', scope, observed.backupId), { code: 'PF_INVENTORY_PROVIDER_RESULT_INVALID' });
    value = { schemaVersion: 1, command: 'inventory', status: 'PASS', tables: [], businessSha256: digestCanonical([]), registrySha256: digestCanonical([]) };
    await assert.rejects(captureInventoryWithProvider(provider, 'restore-after-fence', scope, observed.backupId), { code: 'PF_INVENTORY_PROVIDER_RESULT_INVALID' });
    await fs.writeFile(modulePath, raw + '// changed\n');
    await assert.rejects(validateInventoryProvider({ modulePath, sha256, capture() {} }), { code: 'PF_INVENTORY_PROVIDER_MODULE_CHANGED' });
    const captured = calls; await assert.rejects(captureInventoryWithProvider(provider, 'backup-after-audit', scope, observed.backupId), { code: 'PF_INVENTORY_PROVIDER_MODULE_CHANGED' }); assert.equal(calls, captured);
  } finally { await fs.unlink(modulePath); await fs.rmdir(directory); }
});

// Actual backup function body, closed collaborators only. This proves ordering
// and version dispatch, not a database capture or a real archive qualification.
const backupSource = runtimeSource.slice(runtimeSource.indexOf('export async function backup('), runtimeSource.indexOf('/** Pure version/member boundary;'))
  .replace(/^export /, '');
function backupHarness({ providerRefusal = null } = {}) {
  const calls = [], rawModule = Buffer.from('// synthetic qualified module\n'), moduleSha = createHash('sha256').update(rawModule).digest('hex');
  const provider = { modulePath: path.resolve('synthetic-qualified.mjs'), sha256: moduleSha, bytes: rawModule.length, capture() {} };
  const scope = { owner: state.owner, project: state.project, runtime: path.resolve('synthetic-source'), images: state.images };
  const resources = { containers: ['api', 'web', 'postgres', 'minio'].map((role, at) => ({ role, id: 'synthetic-' + role, image: 'sha256:' + String(at + 1).repeat(64), running: true })) };
  const legacy = { businessSha256: 'a'.repeat(64), registrySha256: 'b'.repeat(64) }; let manifest;
  const sandbox = {
    path, JSON, Object, Buffer, Date, requireColdObserver() {}, validateInventoryProvider: async value => { calls.push('check-provider'); return value ? provider : null; },
    contained, ROOT, fail: code => { throw Object.assign(Error(code), { code }); },
    ownership: async () => resources, createDocker: async () => ({}), safeNew: async () => { calls.push('new-backup'); },
    assertCanonicalPath: async () => {}, readSettings: async () => ({}), randomUUID: () => '10000000-0000-4000-8000-000000000002',
    fs: { readFile: async () => rawModule, writeFile: async (filename, value) => {
      calls.push(['write', path.basename(filename)]); if (path.basename(filename) === 'manifest.json') manifest = JSON.parse(value);
    } }, digest: bytes => createHash('sha256').update(bytes).digest('hex'),
    hashFile: async filename => path.basename(filename) === 'losslessInventory.mjs' ? { bytes: rawModule.length, sha256: moduleSha } : { bytes: 12, sha256: 'd'.repeat(64) },
    writePrivateJson: async () => { calls.push('private-companion'); }, boundedStop: async (_docker, item) => { calls.push(['stop', item.role]); },
    command: async args => { calls.push(['command', ...args.slice(0, 3)]); return Buffer.from(args.includes('psql') ? '0' : ''); },
    runtimeInventory: async (value, phase) => { calls.push(['inventory', phase, Boolean(value)]); if (providerRefusal) throw providerRefusal;
      return value ? syntheticV2(moduleSha) : legacy;
    },
    operation: async (_state, name) => { calls.push(['operation', name]); return { status: 'PASS' }; },
    artifactAudit: async () => ({ status: 'PASS', sha256: 'e'.repeat(64) }),
    validateRestoredInventory: () => { calls.push('exact-v2-pre-post-audit'); },
    observeColdRuntime: async (_observer, phase) => { calls.push(phase); }, verifyDatabaseDump: async () => ({ status: 'PASS' }),
    helper: async (_state, args) => { calls.push(['helper', args]); return { status: 'PASS', sha256: 'f'.repeat(64) }; }, mount: (...values) => values,
    jsonCommand: async () => [{ Os: 'linux', Architecture: 'amd64' }], verifyImageArchive: async () => {},
    resume: async () => { calls.push('resume-original'); },
    verifyBackup: async () => { calls.push('verify-backup'); validateBackupInventoryContract(manifest); return { status: 'PASS', manifest }; },
  };
  return { backup: new vm.Script('(' + backupSource + ')', { filename: 'actual-runtime-backup-isolated.mjs' }).runInNewContext(sandbox), calls, scope, provider,
    target: path.join(ROOT, 'pathfinder-engine/.scratch/synthetic-new-backup'), companion: path.join(ROOT, 'pathfinder-engine/.scratch/synthetic-companion.private.json') };
}
for (const version of [1, 2]) test('actual backup body preserves V' + version + ' dispatch and cold ordering with the exact member count', async () => {
  const fixture = backupHarness(), result = await fixture.backup(fixture.scope, fixture.target, fixture.companion,
    version === 2 ? { inventoryProvider: fixture.provider } : {});
  assert.equal(result.status, 'PASS'); assert.equal(result.manifest.schemaVersion, version); assert.equal(result.manifest.files.length, version === 2 ? 9 : 8);
  assert.deepEqual(fixture.calls.filter(value => Array.isArray(value) && value[0] === 'inventory').map(value => value.slice(1)),
    [['backup-before-audit', version === 2], ['backup-after-audit', version === 2]]);
  assert.ok(fixture.calls.findIndex(value => Array.isArray(value) && value[0] === 'stop' && value[1] === 'api') <
    fixture.calls.findIndex(value => Array.isArray(value) && value[0] === 'inventory'));
  assert.ok(fixture.calls.indexOf('backup-before-dump') < fixture.calls.findIndex(value => Array.isArray(value) && value[0] === 'command' && value[1] === 'exec' && value[3] === 'pg_dump'));
  assert.equal(fixture.calls.filter(value => value === 'resume-original').length, 2);
  if (version === 2) {
    assert.ok(fixture.calls.findIndex(value => Array.isArray(value) && value[0] === 'write' && value[1] === 'losslessInventory.mjs') < fixture.calls.findIndex(value => Array.isArray(value) && value[0] === 'stop'));
    assert.equal(fixture.calls.includes('exact-v2-pre-post-audit'), true);
  } else { assert.equal(Object.hasOwn(result.manifest, 'inventoryModule'), false); assert.equal(fixture.calls.includes('exact-v2-pre-post-audit'), false); }
});
test('actual V2 backup body resumes source after invalid capture without dumping, archiving or writing completion', async () => {
  const refusal = Object.assign(Error('synthetic invalid envelope'), { code: 'PF_INVENTORY_PROVIDER_RESULT_INVALID' }), fixture = backupHarness({ providerRefusal: refusal });
  await assert.rejects(fixture.backup(fixture.scope, fixture.target, fixture.companion, { inventoryProvider: fixture.provider }), error => error === refusal);
  assert.equal(fixture.calls.filter(value => value === 'resume-original').length, 1);
  assert.equal(fixture.calls.some(value => Array.isArray(value) && value[0] === 'command' && (value.includes('pg_dump') || value.includes('save'))), false);
  assert.equal(fixture.calls.some(value => Array.isArray(value) && value[0] === 'write' && ['manifest.json', 'complete.json'].includes(value[1])), false);
});
