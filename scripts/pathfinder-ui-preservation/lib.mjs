import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const PROJECT_ID = '105913f0-7ee4-45f2-bfd8-2c01f9be9f2a';
export const MODEL_ID = '925c0fc0-6e36-4d47-b1ce-38b0beff5953';
export const fail = code => { throw Object.assign(Error(code), { code }); };
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}
export const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
export const bytesHash = value => createHash('sha256').update(value).digest('hex');
// These queries and their order deliberately match server/pathfinder/lookupAudit.ts.
export const statements = {
  settings:'SELECT id,connection_gap::text,secondary_tray_length::text,end_connection_length::text,additional_bending_percent::text,pf_settings_revision::text FROM projects WHERE id=$1',
  selection:'SELECT project_id,active_model_version_id,selection_revision::text FROM project_model_selections WHERE project_id=$1',
  registry:'SELECT project_id,registry_revision::text FROM pf_project_state WHERE project_id=$1',
  planningArtifacts:"SELECT * FROM pf_artifacts WHERE project_id=$1 AND purpose='planning' ORDER BY created_at,id LIMIT 20001",
  locations:'SELECT * FROM pf_locations WHERE project_id=$1 ORDER BY id LIMIT 20001',
  aliases:'SELECT * FROM pf_location_aliases WHERE project_id=$1 ORDER BY normalized_alias LIMIT 20001',
  bindings:'SELECT * FROM pf_location_bindings WHERE project_id=$1 ORDER BY location_id,model_version_id LIMIT 20001',
  modelObjects:'SELECT * FROM pf_model_objects WHERE project_id=$1 ORDER BY artifact_id,object_id LIMIT 20001',
  cables:'SELECT * FROM cables WHERE project_id=$1 ORDER BY id LIMIT 20001',
  proposals:'SELECT * FROM pf_proposals WHERE project_id=$1 ORDER BY id LIMIT 20001',
  reviews:'SELECT * FROM pf_reviews WHERE project_id=$1 ORDER BY id LIMIT 20001',
  applies:'SELECT * FROM pf_apply_receipts WHERE project_id=$1 ORDER BY id LIMIT 20001',
};
export const keys = { settings:['id'],selection:['project_id'],registry:['project_id'],planningArtifacts:['id'],locations:['id'],aliases:['normalized_alias'],bindings:['location_id','model_version_id'],modelObjects:['artifact_id','object_id'],cables:['id'],proposals:['id'],reviews:['id'],applies:['id'],jobs:['id'],items:['job_id','cable_id'],results:['job_id'],matches:['location_id','model_version_id'],events:['id'],models:['id'] };
const rowKey = (name,row) => canonical(keys[name].map(key => { if (!(key in row)) fail('UI_AUDIT_ROW_KEY'); return row[key]; }));
export function diffRows(name,before,after) {
  const index = rows => { const result = new Map(); for (const row of rows) { const key=rowKey(name,row); if(result.has(key)) fail('UI_AUDIT_DUPLICATE_KEY'); result.set(key,row); } return result; };
  const a=index(before),b=index(after),added=[],removed=[],changed=[];
  for(const [key,row] of a) if(!b.has(key)) removed.push({key,row}); else if(canonical(row)!==canonical(b.get(key))) {
    const other=b.get(key),columns=[...new Set([...Object.keys(row),...Object.keys(other)])].sort().filter(column=>canonical(row[column])!==canonical(other[column]));
    changed.push({key,columns,before:row,after:other});
  }
  for(const [key,row] of b) if(!a.has(key)) added.push({key,row});
  return {added,removed,changed};
}
export function diffSnapshots(before,after) {
  return Object.fromEntries(Object.keys(keys).map(name=>[name,diffRows(name,before.groups?.[name]??before.aux?.[name]??[],after.groups?.[name]??after.aux?.[name]??[])]));
}
export function targetGuard(state) {
  if(state.port!==5191 || !/^wfc-pathfinder-local-[a-f0-9]{12}$/.test(state.project??'') || !/^[a-f0-9-]{36}$/.test(state.owner??'') || state.restore?.backupId!=='3db9fa33-c10e-4646-82bc-fe99f3d8af35' || !state.restore.inventoriesEqual) fail('UI_AUDIT_OWN_EXTRA_TARGET_REQUIRED');
}
export async function exclusive(filename,bytes) {
  const handle=await fs.open(filename,'wx',0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  if(process.platform==='win32') await promisify(execFile)('icacls',[filename,'/inheritance:r','/grant:r',process.env.USERDOMAIN+'\\'+process.env.USERNAME+':(R,W)'],{windowsHide:true});
  const read=await fs.readFile(filename); if(!read.equals(Buffer.from(bytes))) fail('UI_AUDIT_WRITE_READBACK_FAILED');
  return {bytes:read.length,sha256:bytesHash(read)};
}
const same=(a,b)=>canonical(a)===canonical(b);
const normalized=value=>value.normalize('NFC').trim().toUpperCase();
function currentDependency(d,snapshot,cable,job) {
  const g=snapshot.groups,a=snapshot.aux,selection=g.selection[0],settings=g.settings[0],registry=g.registry[0],model=a.models.find(row=>row.id===selection.active_model_version_id);
  const artifact=g.planningArtifacts.find(row=>row.id===d.artifact?.id);
  if(!artifact || !model) return false;
  const latest=g.planningArtifacts.filter(row=>row.model_version_id===model.id).at(-1);
  const effectiveSettings={revision:settings.pf_settings_revision,connectionGap:settings.connection_gap,secondaryTrayLength:settings.secondary_tray_length,endConnectionLength:settings.end_connection_length,additionalBendingPercent:settings.additional_bending_percent};
  const endpoint=(name,actual)=>{
    const alias=g.aliases.find(row=>row.normalized_alias===normalized(name??''));
    const binding=g.bindings.find(row=>row.location_id===alias?.location_id && row.model_version_id===model.id);
    return Boolean(binding && (!binding.artifact_id || binding.artifact_id===artifact.id) && same(actual,{locationId:binding.location_id,bindingRevision:String(binding.revision),point:binding.point}));
  };
  return d.schemaVersion==='pathfinder.dependencies.v1' && d.engineVersion==='pathfinder-45c24bf5-pf1-modelrunner-v1' && d.projectId===PROJECT_ID && d.cableId===cable.id && d.cableWriteRevision===String(cable.cable_write_revision)
    && same(d.cableInputs,{fromLocation:cable.from_location,toLocation:cable.to_location,mto:cable.mto,cableTypeId:cable.cable_type_id})
    && same(d.model,{id:model.id,selectionRevision:selection.selection_revision,contentFingerprint:model.content_fingerprint})
    && model.id===MODEL_ID && model.state==='ready' && model.health==='healthy' && artifact.model_version_id===model.id&&artifact.id===latest?.id&&artifact.content_fingerprint===model.content_fingerprint
    && same(d.artifact,{id:artifact.id,sha256:artifact.snapshot_sha256}) && d.registryRevision===registry.registry_revision && same(d.settings,effectiveSettings)
    && same(d.options,job.options) && d.options.connectionToleranceMeters===Number(settings.connection_gap) && endpoint(cable.from_location,d.from) && endpoint(cable.to_location,d.to);
}
function currentPreview(d,snapshot,job) {
  if(!d) return false;
  const g=snapshot.groups,s=g.settings[0],selection=g.selection[0],model=snapshot.aux.models.find(row=>row.id===selection.active_model_version_id),artifact=g.planningArtifacts.find(row=>row.id===d.artifactId);
  const latest=g.planningArtifacts.filter(row=>row.model_version_id===MODEL_ID).at(-1);
  const endpoint=(name,value)=>{const alias=g.aliases.find(row=>row.normalized_alias===normalized(name)),binding=g.bindings.find(row=>row.location_id===alias?.location_id&&row.model_version_id===MODEL_ID);return Boolean(binding&&value?.name===name&&value.source==='shared-location'&&value.locationId===binding.location_id&&value.bindingRevision===String(binding.revision)&&value.objectId===binding.object_id&&same(value.point,binding.point)&&(!binding.artifact_id||binding.artifact_id===artifact?.id));};
  return d.schemaVersion==='pathfinder.preview.dependencies.v1'&&d.engineVersion==='pathfinder-45c24bf5-pf1-modelrunner-v1'&&d.projectId===PROJECT_ID&&d.modelVersionId===MODEL_ID&&d.selectionRevision===selection.selection_revision&&d.registryRevision===g.registry[0].registry_revision
    && model?.state==='ready'&&model.health==='healthy'&&d.contentFingerprint===model.content_fingerprint&&artifact?.model_version_id===MODEL_ID&&artifact.id===latest?.id&&artifact.content_fingerprint===d.contentFingerprint&&d.snapshotSha256===artifact.snapshot_sha256
    && same(d.settings,{revision:s.pf_settings_revision,connectionGap:s.connection_gap,secondaryTrayLength:s.secondary_tray_length,endConnectionLength:s.end_connection_length,additionalBendingPercent:s.additional_bending_percent})
    && same(d.options,job.options)&&d.options.connectionToleranceMeters===Number(s.connection_gap)&&d.input?.category==='Control'&&d.input.reverse===false
    && d.input.artifactId===d.artifactId&&d.input.expectedSelectionRevision===d.selectionRevision&&d.input.expectedSettingsRevision===d.settings.revision&&d.input.expectedRegistryRevision===d.registryRevision
    && d.input.secondaryDistanceMeters===d.options.secondaryDistanceMeters&&d.input.preferVerticalApproach===d.options.preferVerticalApproach
    && d.input.from?.name==='=PF-DEMO-NETWORK-START'&&d.input.to?.name==='=PF-DEMO-NETWORK-END'&&!d.input.from.point&&!d.input.to.point
    && endpoint(d.input.from.name,d.from)&&endpoint(d.input.to.name,d.to);
}
export function classify(before,after,diff,expectedActorFingerprint) {
  const checks=[],add=(name,okay,details={})=>checks.push({name,status:okay?'PASS':'FAIL',...details});
  for(const name of Object.keys(statements).filter(name=>name!=='proposals')) add('immutable '+name,!diff[name].added.length&&!diff[name].removed.length&&!diff[name].changed.length&&same(before.groups[name],after.groups[name]));
  add('existing proposals fully immutable',!diff.proposals.removed.length&&!diff.proposals.changed.length);
  for(const name of ['models','matches','events']) add('unchanged '+name,!diff[name].added.length&&!diff[name].removed.length&&!diff[name].changed.length);
  add('existing result rows immutable',!diff.results.removed.length&&!diff.results.changed.length);
  add('no job or item deletion',!diff.jobs.removed.length&&!diff.items.removed.length);
  for(const entry of diff.jobs.changed) {
    const allowed=['state','completed','cancel_requested','ownerFingerprint','lease_until','attempts','failure','updated_at','authority'];
    add('existing job transition '+entry.after.id,entry.columns.every(key=>allowed.includes(key)) && ['queued','running'].includes(entry.before.state) && entry.after.state==='complete' && entry.after.completed===entry.after.total && entry.after.cancel_requested===false,{columns:entry.columns});
  }
  for(const entry of diff.items.changed) add('existing item transition '+entry.after.job_id,entry.columns.every(key=>['state','status','message'].includes(key))&&['waiting','running'].includes(entry.before.state)&&entry.after.state==='complete'&&entry.after.status==='calculated',{columns:entry.columns});
  const newJobs=diff.jobs.added.map(entry=>entry.row),loginFingerprints=new Set(newJobs.map(job=>job.loginFingerprint));
  add('new jobs single ordinary UI login',loginFingerprints.size<=1);
  for(const job of newJobs) add('current authorized UI job '+job.id,['calculate','preview'].includes(job.kind)&&job.actorFingerprint===expectedActorFingerprint&&job.authority?.currentAdmin===true&&job.authority?.currentLogin===true&&job.state==='complete'&&job.completed===job.total&&!job.cancel_requested);
  for(const item of diff.items.added.map(entry=>entry.row)) {
    const job=newJobs.find(row=>row.id===item.job_id),cable=after.groups.cables.find(row=>row.id===item.cable_id),proposal=after.groups.proposals.find(row=>row.job_id===item.job_id&&row.cable_id===item.cable_id);
    add('new item belongs to new automatic job '+item.job_id+'/'+item.cable_id,Boolean(job?.kind==='calculate'&&cable&&proposal&&item.state==='complete'&&item.status==='calculated'&&same(item.dependencies,proposal.dependencies)&&currentDependency(item.dependencies,after,cable,job)));
  }
  for(const entry of diff.proposals.added) {
    const proposal=entry.row,job=after.aux.jobs.find(row=>row.id===proposal.job_id),item=after.aux.items.find(row=>row.job_id===proposal.job_id&&row.cable_id===proposal.cable_id),cable=after.groups.cables.find(row=>row.id===proposal.cable_id);
    const geometry={...proposal.dependencies};delete geometry.settings;delete geometry.cableWriteRevision;delete geometry.registryRevision;
    const okay=job && newJobs.some(row=>row.id===job.id)&&job.kind==='calculate'&&item?.state==='complete'&&item.status==='calculated'&&proposal.status==='calculated'&&same(item.dependencies,proposal.dependencies)&&cable&&currentDependency(proposal.dependencies,after,cable,job)
      && hash(proposal.dependencies)===proposal.dependency_hash&&hash(geometry)===proposal.geometry_hash&&hash({dependencies:proposal.dependencies,result:proposal.result})===proposal.proposal_hash
      && proposal.result.engineeringAccepted===false&&proposal.result.route?.success===true&&proposal.result.route.lengthMeters===35.30345579516123&&proposal.result.design?.designLengthMeters==='45';
    add('new proposal exact causal dependency '+proposal.id,Boolean(okay),{jobId:proposal.job_id,cableId:proposal.cable_id,calculationMode:proposal.result?.calculationMode});
  }
  for(const job of newJobs) {
    const items=after.aux.items.filter(row=>row.job_id===job.id),proposals=after.groups.proposals.filter(row=>row.job_id===job.id),results=after.aux.results.filter(row=>row.job_id===job.id);
    if(job.kind==='calculate') {
      const expected=hash({timeoutMilliseconds:job.timeout_ms,items:[...items].sort((a,b)=>{const ca=after.groups.cables.find(c=>c.id===a.cable_id),cb=after.groups.cables.find(c=>c.id===b.cable_id);return Number(ca.cable_id)-Number(cb.cable_id)||a.cable_id.localeCompare(b.cable_id);}).map(item=>({id:item.cable_id,dependencies:item.dependencies,status:'ready',cableWriteRevision:after.groups.cables.find(c=>c.id===item.cable_id)?.cable_write_revision}))});
      add('automatic job complete exact cable scope '+job.id,items.length===after.groups.cables.length&&proposals.length===items.length&&results.length===0&&items.length===job.total&&expected===job.request_hash,{cableIds:items.map(item=>item.cable_id)});
    } else add('preview has no cable item/proposal '+job.id,items.length===0&&proposals.length===0&&results.length===1&&job.total===1&&hash({kind:'preview',dependencies:job.diagnostic_input})===job.request_hash&&currentPreview(job.diagnostic_input,after,job));
  }
  for(const result of diff.results.added.map(entry=>entry.row)) {
    const job=newJobs.find(row=>row.id===result.job_id);
    add('new standalone preview result '+result.job_id,Boolean(job?.kind==='preview'&&same(result.dependencies,job.diagnostic_input)&&result.stale_at_completion===false&&result.result.status==='calculated'&&result.result.route?.lengthMeters===35.30345579516123&&result.result.route?.connectionGapCount===4&&result.result.route?.connectionGapLengthMeters===0.9840583861033791&&result.result.design?.designLengthMeters==='45'));
  }
  return {status:checks.every(check=>check.status==='PASS')?'PASS':'FAIL',checks,changes:Object.fromEntries(Object.entries(diff).map(([name,value])=>[name,{added:value.added.length,removed:value.removed.length,changed:value.changed.map(entry=>({key:entry.key,columns:entry.columns}))}]))};
}
export function phaseGate(phase,before,after,diff) {
  const clean=name=>!diff[name].added.length&&!diff[name].removed.length&&!diff[name].changed.length;
  const additions=name=>diff[name].added.length;
  const jobs=diff.jobs.added.map(entry=>entry.row);
  const noExistingJobChange=diff.jobs.changed.length===0&&diff.jobs.removed.length===0;
  const quiet=after.aux.jobs.every(job=>!['queued','running'].includes(job.state))&&after.aux.items.every(item=>!['waiting','running'].includes(item.state));
  if(phase==='A1')return quiet&&noExistingJobChange&&jobs.length===1&&jobs[0].kind==='calculate'&&additions('items')===after.groups.cables.length&&additions('proposals')===after.groups.cables.length&&clean('results');
  if(phase==='A2')return quiet&&noExistingJobChange&&jobs.length===1&&jobs[0].kind==='preview'&&additions('results')===1&&clean('items')&&clean('proposals');
  if(phase==='A3')return Object.keys(keys).every(clean);
  return false;
}
export function retirementGuard(disposition,receipt) {
  if(disposition?.decision!=='retire-owned-target' || disposition?.targetOwner!==receipt?.target?.owner || !receipt?.durable || receipt?.status!=='PASS' || !['A0','A1','A2','A3'].every(phase=>receipt.phases?.includes(phase))) fail('UI_AUDIT_RETIREMENT_NOT_AUTHORIZED');
}
export async function validatedCapture(filename,expectedPhase,current) {
  if(!filename.endsWith('.private.json'))fail('UI_AUDIT_CAPTURE_FILENAME');
  const bytes=await fs.readFile(filename),sidecar=filename.replace(/\.private\.json$/,'.receipt.json'),receipt=JSON.parse(await fs.readFile(sidecar,'utf8'));
  const raw=JSON.parse(bytes);
  if(receipt.phase!==expectedPhase||receipt.status!=='PASS'||receipt.durable!==true||receipt.raw?.file!==filename||receipt.raw.bytes!==bytes.length||receipt.raw.sha256!==bytesHash(bytes)||raw.capture?.phase!==expectedPhase)fail('UI_AUDIT_PHASE_CHAIN_INVALID');
  if(!same(raw.capture.target,current.capture.target)||!same(receipt.target,raw.capture.target)||!same(raw.moduleHashes,current.moduleHashes)||!same(receipt.source.modules,raw.moduleHashes))fail('UI_AUDIT_CAPTURE_BINDING_CHANGED');
  const earlier=Date.parse(raw.identity.captured_at),later=Date.parse(current.identity.captured_at);
  if(!Number.isFinite(earlier)||!Number.isFinite(later)||earlier>=later)fail('UI_AUDIT_PHASE_ORDER_INVALID');
  return raw;
}
