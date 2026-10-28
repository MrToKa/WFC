import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { captureOfflineSeed, canonicalSha256, networkAttachmentIdentity, sourceWitness, validateIntent } from './offline-seed.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HELPER = 'sha256:a0eca379f4467ffa6567b1ef4a829e0c18b006fd73faaf3472beecfb8d8879f5';
const id = index => index.toString(16).padStart(64, '0');
const hash = value => createHash('sha256').update(value).digest('hex');
const clone = value => structuredClone(value);
const running = item => item.State.Running || item.State.Restarting;
const sourceMount = (type, name, destination) => ({ Type: type, ...(type === 'volume' ? {Name: name} : {}), Source: type === 'volume' ? '/var/lib/docker/volumes/' + name + '/_data' : name,
  Destination: destination, RW: true, Propagation: 'rprivate' });
function containers() {
  return ['api', 'web', 'postgres', 'minio'].map((role, index) => ({ Id: id(index + 1), Name: '/' + ({api:'wfc-app-backend-1',web:'wfc-app-frontend-1',postgres:'wfc_app',minio:'wfc-minio'})[role],
    Image: 'sha256:' + id(index + 11), State: { Running: role !== 'postgres', Restarting: role === 'api', ExitCode: role === 'postgres' ? 0 : 1, OOMKilled: false },
    Config: { Env: role === 'api' ? ['DATABASE_URL=postgresql://private-user:private-pass@host.docker.internal:5434/wfc_app', 'MINIO_ENDPOINT=host.docker.internal', 'MINIO_PORT=9000', 'WFC_MODEL_IMPORT_ROOT=/var/lib/wfc/model-imports'] : [],
      Labels: role === 'api' || role === 'web' ? {'com.docker.compose.project':'wfc-app','com.docker.compose.service':role === 'api' ? 'backend' : 'frontend'} : {}, Cmd: ['original-' + role] },
    HostConfig: { RestartPolicy: {Name:'unless-stopped'}, PortBindings: role === 'web' ? {'80/tcp':[{HostIp:'127.0.0.1',HostPort:'5180'}]}
      : role === 'postgres' ? {'5432/tcp':[{HostIp:'0.0.0.0',HostPort:'5434'}]} : role === 'minio' ? {'9000/tcp':[{HostIp:'0.0.0.0',HostPort:'9000'}]} : {} },
    Mounts: role === 'api' ? [sourceMount('volume','main-staging','/var/lib/wfc/model-imports')] : role === 'postgres' ? [sourceMount('volume','main-anonymous-pg','/var/lib/postgresql')]
      : role === 'minio' ? [sourceMount('bind','C:/source/main/.data/minio','/data')] : [],
    NetworkSettings: {Networks:{application:{NetworkID:id(80)}}} }));
}
function intentFor(all, operationId = randomUUID(), privateCompanion = path.join(ROOT, '.preparer-work', 'unused-private.json')) {
  return { schemaVersion:'wfc.preparer.offline-seed-intent.v1', operationId,
    source:{port:5180,composeProject:'wfc-app',roles:Object.fromEntries(['api','web','postgres','minio'].map((role,index) => [role,{id:all[index].Id,image:all[index].Image,
      configSha256:canonicalSha256(all[index].Config),hostConfigSha256:canonicalSha256(all[index].HostConfig),mountsSha256:canonicalSha256(all[index].Mounts),
      networksSha256:canonicalSha256(networkAttachmentIdentity(all[index]))}])),
      database:{host:'host.docker.internal',port:5434,name:'wfc_app'},minio:{host:'host.docker.internal',port:9000},stagingDestination:'/var/lib/wfc/model-imports'},
    helperImage:HELPER, privateCompanion, excluded:{containerIds:[id(200)],volumeNames:['pf-data'],bindPaths:['C:/source/PF/pathfinder-engine/.scratch']} };
}

test('canonical pins ignore object insertion order but retain secret/config/array changes', () => {
  assert.equal(canonicalSha256({b:[1,2],a:'credential'}), canonicalSha256({a:'credential',b:[1,2]}));
  assert.notEqual(canonicalSha256({a:'credential'}), canonicalSha256({a:'rotated'}));
  assert.notEqual(canonicalSha256([1,2]), canonicalSha256([2,1]));
});
test('strict intent refuses wrong source, extra keys, helper fallback and PF overlap', () => {
  const input=intentFor(containers()); assert.equal(validateIntent(input),input);
  for (const mutate of [v=>v.source.port=5191,v=>v.source.database.port=5432,v=>v.source.roles.api.extra=true,v=>v.helperImage='tag:latest',v=>v.excluded.containerIds.push(v.source.roles.api.id)]) {
    const value=clone(input);mutate(value);assert.throws(()=>validateIntent(value));
  }
});
test('running or restarting original PostgreSQL always refuses', () => {
  for (const state of [{Running:true,Restarting:false},{Running:false,Restarting:true}]) {
    const all=containers(),intent=intentFor(all);Object.assign(all[2].State,state);
    assert.throws(()=>sourceWitness(intent,all),{code:'SP1_POSTGRES_MUST_REMAIN_STOPPED'});
  }
});
test('unknown active bind ancestor, same volume, database or storage client refuses', () => {
  const original=containers(),intent=intentFor(original);
  for (const foreign of [
    {Mounts:[sourceMount('bind','C:/source/main/.data','/foreign')]},
    {Mounts:[sourceMount('volume','main-anonymous-pg','/foreign')]},
    {Config:{Env:['DATABASE_URL=postgres://u:p@host.docker.internal:5434/wfc_app']}},
    {Config:{Env:['MINIO_ENDPOINT=host.docker.internal','MINIO_PORT=9000']}}
  ]) { const all=clone(original);all.push({Id:id(99),State:{Running:true},Config:{Env:[]},Mounts:[],...foreign});
    assert.throws(()=>sourceWitness(intent,all)); }
});
test('source config, mount, labels, endpoint and excluded-resource drift fail closed', () => {
  for (const mutate of [a=>a[0].Config.Env.push('EXTRA=changed'),a=>a[2].Mounts[0].Name='different',a=>a[0].Config.Labels['com.docker.compose.project']='wfc-pathfinder-local',a=>a[1].HostConfig.PortBindings['80/tcp'][0].HostIp='0.0.0.0']) {
    const all=containers(),intent=intentFor(all);mutate(all);assert.throws(()=>sourceWitness(intent,all),{code:'SP1_SOURCE_CAS_CHANGED'});
  }
  const all=containers(),intent=intentFor(all);intent.excluded.bindPaths.push('C:/source/main');
  assert.throws(()=>sourceWitness(intent,all),{code:'SP1_EXCLUDED_SOURCE'});
});
test('attachment CAS detects added, detached and changed network configuration, allowing only endpoint allocation observations',()=>{
  const all=containers(),intent=intentFor(all),observations=clone(all);
  Object.assign(observations[0].NetworkSettings.Networks.application,{EndpointID:id(90),IPAddress:'172.20.0.7',Gateway:'172.20.0.1',MacAddress:'02:42:ac:14:00:07',IPPrefixLen:16});
  assert.doesNotThrow(()=>sourceWitness(intent,observations));
  for(const mutate of [a=>a.extra={NetworkID:id(81)},a=>delete a.application,a=>a.application.NetworkID=id(81),a=>a.application.DriverOpts={changed:'yes'},a=>a.application.Aliases=['foreign']]) {
    const value=clone(all);mutate(value[0].NetworkSettings.Networks);assert.throws(()=>sourceWitness(intent,value));
  }
});

async function fixture(t, { failCapture, failResume, changeOnExport, abortOnCapture, restartDuringFinalCapture, changeNetworkOnExport, staleStoppedNetwork, staleActiveNetwork } = {}) {
  const parent=await fs.realpath(path.join(ROOT,'.preparer-work')),operationId=randomUUID();
  const inputs=path.join(parent,'sp1-seed-test-input-'+operationId);await fs.mkdir(inputs,{mode:0o700});
  const operationDirectory=path.join(parent,'sp1-offline-seed-'+operationId),all=containers();
  if(staleStoppedNetwork)all[2].NetworkSettings.Networks={bridge:{NetworkID:id(81)}};
  if(staleActiveNetwork)all[0].NetworkSettings.Networks={bridge:{NetworkID:id(81)}};
  const intent=intentFor(all,operationId,path.join(inputs,'companion.private.json'));
  const intentPath=path.join(inputs,'intent.private.json'),raw=JSON.stringify(intent);await fs.writeFile(intentPath,raw,{flag:'wx',mode:0o600});
  const events=[],controller=new AbortController();let captures=0,exports=0;
  const docker={
    async containers(){events.push({kind:'inspect-all'});return clone(all);},
    async inspect(identifier){return clone(all.find(item=>item.Id===identifier));},
    async inspectImage(image){return{Id:image,Os:'linux',Architecture:'amd64',Size:1024};},
    async request(method,url){assert.equal(method,'GET');if(url.startsWith('/volumes/'))return{Name:decodeURIComponent(url.slice(9)),Driver:'local',Labels:{},Options:{},Scope:'local'};
      if(url==='/networks/'+id(81))throw Object.assign(Error('absent network'),{code:'TEST_ABSENT_NETWORK',statusCode:404,definitive:true});
      if(url==='/networks/bridge')return{Id:id(82),Name:'bridge',Internal:false,Driver:'bridge',Labels:{},IPAM:{Config:[]},Containers:{}};
      if(url==='/networks/'+id(80))return{Id:id(80),Name:'application',Internal:false,Driver:'bridge',Labels:{},IPAM:{Config:[{Subnet:'172.20.0.0/16',Gateway:'172.20.0.1'}]},
        Status:{IPAM:{Subnets:{'172.20.0.0/16':{IPsInUse:all.filter(running).length,DynamicIPsAvailable:65535-all.filter(running).length}}}},Containers:{}};
      throw Error('Unexpected request');},
    async stop(identifier){events.push({kind:'stop',id:identifier});const item=all.find(item=>item.Id===identifier);item.State.Running=false;item.State.Restarting=false;},
    async start(identifier){events.push({kind:'start',id:identifier});assert.notEqual(identifier,intent.source.roles.postgres.id);
      if(failResume&&identifier===intent.source.roles.minio.id)throw Object.assign(Error('resume'),{code:'TEST_RESUME_FAILURE'});
      const item=all.find(item=>item.Id===identifier);item.State.Running=true;item.State.Restarting=false;},
    async command(args){assert.deepEqual(args.slice(0,3),['image','save','--output']);events.push({kind:'export',id:args[4]});
      await fs.writeFile(args[3],Buffer.from('synthetic image envelope '+args[4]),{flag:'wx'});exports++;
      if(changeOnExport&&exports===1)all[0].Config.Env.push('DRIFT=yes');
      if(changeNetworkOnExport&&exports===1)changeNetworkOnExport(all[0].NetworkSettings.Networks);return Buffer.alloc(0);},
    async run(image,options){assert.equal(image,HELPER);events.push({kind:'helper',options:clone(options)});const cmd=options.cmd,verb=cmd[2];
      if(verb==='measure')return{status:'PASS',totalBytes:128};
      const target=options.mounts.find(m=>m.Target==='/backup'),filename=path.join(target.Source,path.basename(cmd[verb==='capture'?4:3]));
      if(verb==='capture') {captures++;assert.ok(all.every(item=>!running(item)),'every source role must be cold');
        if(abortOnCapture){controller.abort();throw Object.assign(Error('abort'),{code:'TEST_ABORT'});}
        if(failCapture&&captures===2)throw Object.assign(Error('capture'),{code:'TEST_CAPTURE_FAILURE'});
        const bytes=Buffer.from('synthetic physical bytes '+path.basename(filename));await fs.writeFile(filename,bytes,{flag:'wx'});
        if(restartDuringFinalCapture&&captures===3)all[3].State.Running=true;
        return{status:'PASS',sha256:hash(bytes),bytes:bytes.length,members:2,files:1,totalBytes:bytes.length};}
      assert.equal(verb,'verify');return{status:'PASS',sha256:hash(await fs.readFile(filename))};}
  };
  t.after(async()=>{const lock=path.join(parent,'test-main5180-offline-seed.lock');try{const value=JSON.parse(await fs.readFile(lock,'utf8'));
      if(value.operationId===operationId)await fs.unlink(lock);}catch(error){if(error.code!=='ENOENT')throw error;}
    await fs.rm(operationDirectory,{recursive:true,force:true});await fs.rm(inputs,{recursive:true,force:true});});
  return{all,intent,events,docker,controller,operationDirectory,args:{intentPath,intentSha256:hash(raw),operationDirectory},
    options:{docker,signal:controller.signal,imageArchiveVerifier:async()=>({status:'PASS'})}};
}

test('cold seed captures all three stores, no PG start, exact prior active states and explicit test-only proof',async t=>{
  const f=await fixture(t),result=await captureOfflineSeed(f.args,f.options);
  assert.equal(result.status,'PASS');assert.equal(result.qualification,'NOT_RUN');assert.equal(result.releasableBackup,false);
  assert.equal(result.verifierMode,'injected-test-only');assert.equal(result.productionSeed,false);
  assert.deepEqual(result.archives.map(item=>item.role),['postgres','minio','staging']);assert.equal(result.images.length,5);
  assert.deepEqual(f.all.map(running),[true,true,false,true]);
  assert.deepEqual(f.events.filter(item=>item.kind==='stop').map(item=>item.id),[id(2),id(1),id(4)]);
  assert.deepEqual(f.events.filter(item=>item.kind==='start').map(item=>item.id),[id(4),id(1),id(2)]);
  for(const {options} of f.events.filter(item=>item.kind==='helper')) {assert.equal(options.network,'none');assert.equal(options.env,undefined);
    for(const mount of options.mounts.filter(item=>item.Target==='/source'))assert.equal(mount.ReadOnly,true);}
  const complete=JSON.parse(await fs.readFile(path.join(f.operationDirectory,'complete.private.json'),'utf8'));
  assert.equal(complete.productionSeed,false);assert.equal(complete.qualification,'NOT_RUN');assert.ok(complete.seed.sha256);
  assert.equal(complete.schemaVersion,'wfc.preparer.offline-seed-complete.v2');assert.equal(complete.sourceLockReleased,false);
  assert.equal(complete.sourceLockRelease.state,'pending');assert.equal(result.sourceLockReleased,true);
  assert.equal(result.sourceLockRelease.state,'confirmed');
  assert.equal(result.sourceLockRelease.terminal.sha256,hash(await fs.readFile(path.join(f.operationDirectory,'complete.private.json'))));
  assert.equal(result.sourceLockRelease.archivedLock.path,complete.sourceLockRelease.archivedPath);
  assert.equal(result.sourceLockRelease.archivedLock.sha256,complete.sourceLockRelease.source.sha256);
  const archived=JSON.parse(await fs.readFile(complete.sourceLockRelease.archivedPath,'utf8'));
  assert.equal(archived.operationId,f.intent.operationId);assert.equal(archived.schemaVersion,'wfc.preparer.offline-seed-source-lock.v1');
  await assert.rejects(fs.stat(path.join(ROOT,'.preparer-work/test-main5180-offline-seed.lock')),{code:'ENOENT'});
});

test('a terminal marker write failure retains the exact source lock and never releases an unmarked seed',async t=>{
  const f=await fixture(t),phases=[];
  const options={...f.options,testFinalizationObserver:async phase=>{phases.push(phase);
    if(phase==='before-complete')await fs.mkdir(path.join(f.operationDirectory,'complete.private.json'));}};
  await assert.rejects(captureOfflineSeed(f.args,options),{code:'EEXIST'});
  assert.deepEqual(phases,['before-complete']);assert.deepEqual(f.all.map(running),[true,true,false,true]);
  assert.equal((await fs.stat(path.join(f.operationDirectory,'complete.private.json'))).isDirectory(),true);
  const lock=JSON.parse(await fs.readFile(path.join(ROOT,'.preparer-work/test-main5180-offline-seed.lock'),'utf8'));
  assert.equal(lock.operationId,f.intent.operationId);
  await assert.rejects(fs.stat(path.join(f.operationDirectory,'source-lock-released.private.json')),{code:'ENOENT'});
  const failure=JSON.parse(await fs.readFile(path.join(f.operationDirectory,'finalization-failure.private.json'),'utf8'));
  assert.equal(failure.sourceLockState,'retained');assert.equal(failure.terminal,null);
  const seed=JSON.parse(await fs.readFile(path.join(f.operationDirectory,'seed.private.json'),'utf8'));
  assert.equal(seed.finalizationMode,'injected-test-only');assert.equal(seed.productionSeed,false);
  const count=f.events.length;await assert.rejects(captureOfflineSeed(f.args,options),{code:'EEXIST'});assert.equal(f.events.length,count);
});

test('a failed atomic lock rename keeps durable pending completion and the exact source lock without replaying source actions',async t=>{
  const f=await fixture(t),rename=fs.rename,sourceLock=path.join(ROOT,'.preparer-work/test-main5180-offline-seed.lock');let sourceActions;
  const options={...f.options,testFinalizationObserver:phase=>{if(phase==='before-lock-release')sourceActions=f.events.length;}};
  fs.rename=async(from,to)=>{if(path.resolve(from)===path.resolve(sourceLock))throw Object.assign(Error('Injected rename failure'),{code:'TEST_RENAME_FAILURE'});return rename(from,to);};
  try {await assert.rejects(captureOfflineSeed(f.args,options),{code:'SP1_SOURCE_LOCK_RELEASE_UNCONFIRMED'});}
  finally {fs.rename=rename;}
  assert.equal(f.events.length,sourceActions);assert.deepEqual(f.all.map(running),[true,true,false,true]);
  const complete=JSON.parse(await fs.readFile(path.join(f.operationDirectory,'complete.private.json'),'utf8'));
  assert.equal(complete.sourceLockReleased,false);assert.equal(complete.sourceLockRelease.state,'pending');
  assert.equal(hash(await fs.readFile(sourceLock)),complete.sourceLockRelease.source.sha256);
  await assert.rejects(fs.stat(complete.sourceLockRelease.archivedPath),{code:'ENOENT'});
  const failure=JSON.parse(await fs.readFile(path.join(f.operationDirectory,'finalization-failure.private.json'),'utf8'));
  assert.equal(failure.code,'SP1_SOURCE_LOCK_RELEASE_UNCONFIRMED');assert.equal(failure.causeCode,'TEST_RENAME_FAILURE');assert.equal(failure.sourceLockState,'unconfirmed');
  const count=f.events.length;await assert.rejects(captureOfflineSeed(f.args,options),{code:'EEXIST'});assert.equal(f.events.length,count);
});

test('a fault after rename leaves durable completion and its exact archived lock but never claims release confirmation',async t=>{
  const f=await fixture(t);let sourceActions;
  const options={...f.options,testFinalizationObserver:phase=>{if(phase==='after-lock-release'){
    sourceActions=f.events.length;throw Object.assign(Error('Injected lost release acknowledgement'),{code:'TEST_RELEASE_ACK'});}}};
  await assert.rejects(captureOfflineSeed(f.args,options),{code:'SP1_SOURCE_LOCK_RELEASE_UNCONFIRMED'});
  assert.equal(f.events.length,sourceActions);assert.deepEqual(f.all.map(running),[true,true,false,true]);
  const complete=JSON.parse(await fs.readFile(path.join(f.operationDirectory,'complete.private.json'),'utf8'));
  assert.equal(complete.sourceLockReleased,false);assert.equal(complete.sourceLockRelease.state,'pending');
  const archived=await fs.readFile(complete.sourceLockRelease.archivedPath);
  assert.equal(hash(archived),complete.sourceLockRelease.source.sha256);assert.equal(JSON.parse(archived).operationId,f.intent.operationId);
  await assert.rejects(fs.stat(path.join(ROOT,'.preparer-work/test-main5180-offline-seed.lock')),{code:'ENOENT'});
  const failure=JSON.parse(await fs.readFile(path.join(f.operationDirectory,'finalization-failure.private.json'),'utf8'));
  assert.equal(failure.code,'SP1_SOURCE_LOCK_RELEASE_UNCONFIRMED');assert.equal(failure.sourceLockState,'unconfirmed');
  assert.equal(failure.terminal.sha256,hash(await fs.readFile(path.join(f.operationDirectory,'complete.private.json'))));
  const count=f.events.length;await assert.rejects(captureOfflineSeed(f.args,options),{code:'EEXIST'});assert.equal(f.events.length,count);
});
test('partial capture restores source, retains sticky failure and refuses same-attempt retry',async t=>{
  const f=await fixture(t,{failCapture:true});await assert.rejects(captureOfflineSeed(f.args,f.options),{code:'TEST_CAPTURE_FAILURE'});
  assert.deepEqual(f.all.map(running),[true,true,false,true]);assert.equal(JSON.parse(await fs.readFile(path.join(f.operationDirectory,'failure.private.json'),'utf8')).status,'FAIL');
  await assert.rejects(fs.stat(path.join(f.operationDirectory,'complete.private.json')),{code:'ENOENT'});
  const count=f.events.length;await assert.rejects(captureOfflineSeed(f.args,f.options),{code:'EEXIST'});assert.equal(f.events.length,count);
});
test('source config drift after export prevents stops or unsafe resume and never completes',async t=>{
  const f=await fixture(t,{changeOnExport:true});await assert.rejects(captureOfflineSeed(f.args,f.options));
  assert.equal(f.events.filter(item=>item.kind==='stop'||item.kind==='start').length,0);
  await assert.rejects(fs.stat(path.join(f.operationDirectory,'complete.private.json')),{code:'ENOENT'});
});
test('network attachment change after intent admission refuses cold capture and unsafe resume',async t=>{
  const f=await fixture(t,{changeNetworkOnExport:networks=>networks.extra={NetworkID:id(81)}});await assert.rejects(captureOfflineSeed(f.args,f.options));
  assert.equal(f.events.filter(item=>item.kind==='stop'||item.kind==='start').length,0);
  await assert.rejects(fs.stat(path.join(f.operationDirectory,'complete.private.json')),{code:'ENOENT'});
});
test('resume failure retains failure rather than completing physical seed',async t=>{
  const f=await fixture(t,{failResume:true});await assert.rejects(captureOfflineSeed(f.args,f.options),{code:'SP1_SOURCE_RESUME_FAILED'});
  assert.equal(running(f.all[2]),false);assert.equal(running(f.all[3]),false);
  await assert.rejects(fs.stat(path.join(f.operationDirectory,'complete.private.json')),{code:'ENOENT'});
});
test('capture cancellation cannot suppress independently bounded source restoration',async t=>{
  const f=await fixture(t,{abortOnCapture:true});await assert.rejects(captureOfflineSeed(f.args,f.options));
  assert.deepEqual(f.all.map(running),[true,true,false,true]);assert.ok(f.events.some(item=>item.kind==='start'&&item.id===id(4)));
  await assert.rejects(fs.stat(path.join(f.operationDirectory,'complete.private.json')),{code:'ENOENT'});
});
test('a source restart during the final archive cannot be called a complete cold seed',async t=>{
  const f=await fixture(t,{restartDuringFinalCapture:true});await assert.rejects(captureOfflineSeed(f.args,f.options),{code:'SP1_SOURCE_NOT_COLD'});
  assert.deepEqual(f.all.map(running),[true,true,false,true]);
  await assert.rejects(fs.stat(path.join(f.operationDirectory,'complete.private.json')),{code:'ENOENT'});
});
test('changed approved intent and operation path fail before Docker or source mutation',async t=>{
  const f=await fixture(t);await assert.rejects(captureOfflineSeed({...f.args,intentSha256:'0'.repeat(64)},f.options),{code:'SP1_INTENT_HASH_CHANGED'});
  await assert.rejects(captureOfflineSeed({...f.args,operationDirectory:path.join(f.operationDirectory,'child')},f.options),{code:'SP1_OPERATION_DIRECTORY_INVALID'});
  assert.equal(f.events.length,0);
});
test('a retained source-wide lock blocks a different operation before any Docker action',async t=>{
  const first=await fixture(t,{failCapture:true});await assert.rejects(captureOfflineSeed(first.args,first.options));
  const second=await fixture(t);await assert.rejects(captureOfflineSeed(second.args,second.options),{code:'EEXIST'});
  assert.equal(second.events.length,0);
  const lock=JSON.parse(await fs.readFile(path.join(ROOT,'.preparer-work/test-main5180-offline-seed.lock'),'utf8'));
  assert.equal(lock.operationId,first.intent.operationId);
});
test('running source PG refuses capture with no stop, start, export or archive calls',async t=>{
  const f=await fixture(t);f.all[2].State.Running=true;
  await assert.rejects(captureOfflineSeed(f.args,f.options),{code:'SP1_POSTGRES_MUST_REMAIN_STOPPED'});
  assert.ok(f.events.every(item=>item.kind==='inspect-all'));
  await assert.rejects(fs.stat(path.join(f.operationDirectory,'complete.private.json')),{code:'ENOENT'});
});

test('stopped daemon-era network attachment is retained separately from the freshly resolved named network',async t=>{
  const f=await fixture(t,{staleStoppedNetwork:true});const result=await captureOfflineSeed(f.args,f.options);
  assert.equal(result.status,'PASS');const before=JSON.parse(await fs.readFile(path.join(f.operationDirectory,'source-before.private.json')));
  const resolved=before.resources.networks.find(item=>item.staleAttachment);
  assert.equal(resolved.Id,id(82));assert.deepEqual(resolved.staleAttachment,{id:id(81),name:'bridge',roles:['postgres']});
});
test('missing active network attachment cannot be reinterpreted by name',async t=>{
  const f=await fixture(t,{staleActiveNetwork:true});await assert.rejects(captureOfflineSeed(f.args,f.options));
  assert.equal(f.events.some(item=>['stop','start','export','helper'].includes(item.kind)),false);
});
