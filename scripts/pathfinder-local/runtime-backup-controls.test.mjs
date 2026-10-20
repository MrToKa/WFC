import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {artifactAudit,databaseDumpHelperConfiguration,assertDatabaseDumpHelperMounts} from './runtime-lib.mjs';

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
function restoreHarness({ observerError = null, validationError = null, startError = null } = {}) {
  const calls = [], saved = [], target = { runtime: path.resolve('synthetic-u8-target'), owner: '10000000-0000-4000-8000-000000000001',
    project: 'wfc-pathfinder-local-abcdef123456', port: 5192, images: {}, status: 'initialized' };
  const inventory = { businessSha256: 'a'.repeat(64), registrySha256: 'b'.repeat(64) }, artifacts = { sha256: 'c'.repeat(64) };
  const manifest = { backupId: '10000000-0000-4000-8000-000000000002', inventory, artifacts,
    images: ['api', 'web', 'postgres', 'minio'].map((role, at) => ({ role, id: 'sha256:' + String(at + 1).repeat(64), archive: role + '-image.tar' })),
    files: ['minio', 'staging', 'pathfinder'].map(role => ({ path: role + '.wfcops', sha256: 'd'.repeat(64) })) };
  const failure = code => { throw Object.assign(new Error(code), { code }); };
  const sandbox = {
    path, ROOT: path.resolve('synthetic-repository'), Date, JSON, Object, Buffer,
    fail: failure, digest: () => 'e'.repeat(64), randomBytes: bytes => Buffer.alloc(bytes, 7),
    requireColdObserver: observer => { calls.push('check-observer'); if (observer !== undefined && typeof observer !== 'function') failure('PF_COLD_OBSERVER_INVALID'); },
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
