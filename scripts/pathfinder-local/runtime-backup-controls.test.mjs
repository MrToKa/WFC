import test from 'node:test';
import assert from 'node:assert/strict';
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
