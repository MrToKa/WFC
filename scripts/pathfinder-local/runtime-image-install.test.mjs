import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {prepareRuntimeImageInstall,imageInstallDigest} from './runtime-image-install.mjs';
function fixture() {
  const root=path.resolve('/isolated'),sha=c=>'sha256:'+c.repeat(64),env='PF_API_IMAGE='+sha('a')+'\nPF_WEB_IMAGE='+sha('b')+'\nPF_JWT_SECRET=private\nPF_PRODUCER_CONTROL_KEY=private\nPF_PREPARATION_CAPACITY_PROFILE=trial\n';
  const source={owner:'8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46',project:'wfc-pathfinder-local-0cba87606e9b',port:5191,
    runtime:path.join(root,'pathfinder-engine/.scratch/batched-capture-runtime-20261018-1600'),images:{api:sha('a'),web:sha('b')},envSha256:imageInstallDigest(env),tags:{api:'old-api',web:'old-web'},unknown:{retain:true}};
  const candidate={owner:'11111111-1111-4111-8111-111111111111',project:'wfc-pathfinder-local-111111111111',port:5192,
    runtime:path.join(root,'pathfinder-engine/.scratch/barrier-delivery-22222222-2222-4222-8222-222222222222/restore-5192'),images:{api:sha('c'),web:sha('d')},envSha256:imageInstallDigest('candidate')};
  const sourceStateBytes=Buffer.from(JSON.stringify(source)),candidateStateBytes=Buffer.from(JSON.stringify(candidate));
  return {root,source,candidate,sourceStateBytes,candidateStateBytes,sourceEnvBytes:Buffer.from(env),candidateEnvBytes:Buffer.from('candidate'),
    options:{expectedStateSha256:imageInstallDigest(sourceStateBytes),expectedEnvSha256:imageInstallDigest(env),images:{...candidate.images},
      candidate:Object.fromEntries(['owner','project','runtime','port'].map(k=>[k,candidate[k]])),operationId:'22222222-2222-4222-8222-222222222222',
      expectedCandidateStateSha256:imageInstallDigest(candidateStateBytes),expectedCandidateEnvSha256:imageInstallDigest('candidate')},
    resources:{containers:['api','web'].map(role=>({role,running:false,image:source.images[role]}))},
    inspectedImages:['api','web'].map(role=>({Id:candidate.images[role],Config:{Labels:{'wfc.pathfinder.owner':candidate.owner,'wfc.pathfinder.project':candidate.project}}}))};
}
test('qualified image plan changes only both image fields and env hash, preserving private config and unknown state',()=>{
  const f=fixture(),before=structuredClone(f.source),r=prepareRuntimeImageInstall(f);
  assert.deepEqual(f.source,before);assert.deepEqual(r.state,{...before,images:f.options.images,envSha256:imageInstallDigest(r.envBytes)});
  assert.equal(r.envBytes.toString(),f.sourceEnvBytes.toString().replaceAll(f.source.images.api,f.options.images.api).replaceAll(f.source.images.web,f.options.images.web));
  assert.deepEqual(JSON.parse(r.stateBytes),r.state);
});
for(const key of ['expectedStateSha256','expectedEnvSha256','expectedCandidateStateSha256','expectedCandidateEnvSha256'])test('requires exact CAS '+key,()=>{
  const f=fixture();f.options[key]='f'.repeat(64);assert.throws(()=>prepareRuntimeImageInstall(f),{code:'PF_IMAGE_INSTALL_CAS_CHANGED'});
});
for(const key of ['owner','project','runtime','port'])test('refuses foreign or original source '+key,()=>{
  const f=fixture();f.source[key]=key==='port'?5180:'foreign';assert.throws(()=>prepareRuntimeImageInstall(f),{code:'PF_IMAGE_INSTALL_EXACT_SOURCE_REQUIRED'});
});
test('stopped source api and web, old exact images and both candidate labels are mandatory',()=>{
  for(const mutation of [f=>f.resources.containers[0].running=true,f=>f.resources.containers.pop(),f=>f.resources.containers[1].image='other',
    f=>f.inspectedImages[0].Config.Labels['wfc.pathfinder.owner']='other',f=>f.inspectedImages[1].Config.Labels['wfc.pathfinder.project']='other']){
    const f=fixture();mutation(f);assert.throws(()=>prepareRuntimeImageInstall(f));
  }
});
test('candidate identity, image role set, immutable IDs and no extra options',()=>{
  for(const mutation of [f=>f.options.candidate.port=5191,f=>f.options.candidate.owner='other',f=>f.options.images.api='latest',
    f=>f.options.images.web=f.options.images.api,f=>f.options.extra=true,f=>delete f.options.expectedCandidateEnvSha256]){
    const f=fixture();mutation(f);assert.throws(()=>prepareRuntimeImageInstall(f));
  }
});
test('changed source state cannot be hidden behind unchanged byte pin',()=>{
  const f=fixture();f.source.unknown.retain=false;assert.throws(()=>prepareRuntimeImageInstall(f),{code:'PF_IMAGE_INSTALL_STATE_CHANGED'});
});
test('operation-linked target is mandatory and unrelated source image metadata is retained',()=>{
  const bad=fixture();bad.candidate.runtime=bad.options.candidate.runtime=bad.candidate.runtime.replace('22222222-2222','33333333-3333');
  assert.throws(()=>prepareRuntimeImageInstall(bad),{code:'PF_IMAGE_INSTALL_CANDIDATE_REQUIRED'});
  const f=fixture();f.source.images.unrelated='preserve';f.sourceStateBytes=Buffer.from(JSON.stringify(f.source));f.options.expectedStateSha256=imageInstallDigest(f.sourceStateBytes);
  assert.equal(prepareRuntimeImageInstall(f).state.images.unrelated,'preserve');
});
test('duplicate or mismatching env keys refuse without secret text',()=>{
  for(const env of ['PF_API_IMAGE=other\nPF_WEB_IMAGE='+fixture().source.images.web+'\n',fixture().sourceEnvBytes.toString()+'PF_API_IMAGE=duplicate\n']){
    const f=fixture();f.sourceEnvBytes=Buffer.from(env);f.options.expectedEnvSha256=imageInstallDigest(env);f.source.envSha256=f.options.expectedEnvSha256;
    f.sourceStateBytes=Buffer.from(JSON.stringify(f.source));f.options.expectedStateSha256=imageInstallDigest(f.sourceStateBytes);
    assert.throws(()=>prepareRuntimeImageInstall(f),e=>e.code==='PF_IMAGE_INSTALL_ENV_IMAGE_CHANGED'&&!e.message.includes('private'));
  }
});
