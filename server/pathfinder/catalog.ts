import { createHash,randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { catalogSchema,catalogManifestSchema,catalogPageSchema,catalogContentHashInput,catalogManifestHashInput,catalogRoutingHashInput,canonicalPurposeJson,normalizeCatalogKey,purposeKeySchema,policyUuidSchema,PURPOSE_POLICY_LIMITS,type CatalogEnvelope,type CatalogRow,type CatalogDiagnostic,type CatalogManifest,type CatalogPage,type RoutingCatalogScope } from '../../shared/pathfinderPurposePolicy.js';
import { readPurposePolicyState } from './policySchema.js';
import { PathFinderError } from './errors.js';

export type CatalogSourceTray={id:string;name:string;purpose:string|null;tray_type:string|null;width_mm:string|null;height_mm:string|null;length_mm:string|null;include_grounding_cable:boolean;grounding_cable_type_id:string|null;use_trefoil_clamps:boolean;trefoil_clamp_spacing_mm:string|null};
type Facts={table:string;rows:{rowText:string}[]}[];
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const hash=(value:unknown)=>digest(canonicalPurposeJson(value));
const fail=(code:string,status=409):never=>{throw new PathFinderError(code,status);};
const control=/[\u0000-\u001f\u007f-\u009f]/u;
const complete=(pattern:RegExp,value:string)=>pattern.exec(value)?.[0]===value;
const validDecimal=(value:string|null)=>value===null||value.length<=100&&complete(/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/,value);

/** Full-source audit data stays private; this pure projection never grants model completeness. */
export function projectCatalogRows(source:CatalogSourceTray[]):{rows:CatalogRow[];diagnostics:CatalogDiagnostic[]} {
  if(source.length>PURPOSE_POLICY_LIMITS.catalogRows)fail('CATALOG_ROW_LIMIT',413);
  const ordered=[...source].sort((a,b)=>compare(a.id,b.id)),ids=new Set<string>(),diagnostics:CatalogDiagnostic[]=[];
  const names=new Map<string,string[]>(),purposes=new Map<string,{ids:string[];raw:Set<string>}>();
  const rows=ordered.map(tray=>{
    if(!policyUuidSchema.safeParse(tray.id).success||ids.has(tray.id)||typeof tray.name!=='string'||tray.purpose!==null&&typeof tray.purpose!=='string')fail('CATALOG_SOURCE_INVALID');ids.add(tray.id);
    if(tray.name.length>PURPOSE_POLICY_LIMITS.rawText||(tray.purpose?.length??0)>PURPOSE_POLICY_LIMITS.rawText)fail('CATALOG_TEXT_LIMIT',413);
    const nameKey=normalizeCatalogKey(tray.name),purposeKey=tray.purpose===null?null:normalizeCatalogKey(tray.purpose)||null;
    const add=(code:string,message:string)=>diagnostics.push({code,projectTrayIds:[tray.id],message});
    if(!nameKey||tray.name.length>200||control.test(tray.name))add('INVALID_TRAY_NAME','The tray name exceeds the authoring contract or contains control characters.');
    if(purposeKey===null)add('MISSING_TRAY_PURPOSE','The tray has no configured purpose.');
    else if(!purposeKeySchema.safeParse(purposeKey).success||control.test(tray.purpose!))add('INVALID_TRAY_PURPOSE','The tray purpose is outside the authoring contract.');
    const nameGroup=names.get(nameKey)??[];nameGroup.push(tray.id);names.set(nameKey,nameGroup);
    if(purposeKey!==null){const group=purposes.get(purposeKey)??{ids:[],raw:new Set<string>()};group.ids.push(tray.id);group.raw.add(tray.purpose!);purposes.set(purposeKey,group);}
    const dimension=(value:string|null):string|null=>{if(validDecimal(value))return value;add('INVALID_DIMENSION','A tray dimension or declared length is invalid; its raw value is retained in the private proof.');return null;};
    return {projectTrayId:tray.id,rawName:tray.name,nameKey,rawPurpose:tray.purpose,purposeKey,dimensionsMm:{width:dimension(tray.width_mm),height:dimension(tray.height_mm),declaredLength:dimension(tray.length_mm)}};
  });
  if(purposes.size>PURPOSE_POLICY_LIMITS.purposes)fail('CATALOG_PURPOSE_LIMIT',413);
  for(const [name,group]of [...names].sort(([a],[b])=>compare(a,b)))if(group.length>1)diagnostics.push({code:'TRAY_NAME_COLLISION',projectTrayIds:group,message:'Multiple project trays share the same case-sensitive normalized name.'});
  for(const [purpose,group]of [...purposes].sort(([a],[b])=>compare(a,b)))if(group.raw.size>1)diagnostics.push({code:'PURPOSE_NORMALIZATION_COLLISION',projectTrayIds:group.ids,message:'Distinct raw purpose spellings share the same normalized key.'});
  diagnostics.sort((a,b)=>compare(a.code,b.code)||compare(a.projectTrayIds.join(','),b.projectTrayIds.join(',')));
  if(diagnostics.length>PURPOSE_POLICY_LIMITS.catalogRows)fail('CATALOG_DIAGNOSTIC_LIMIT',413);
  return {rows,diagnostics};
}

async function sourceTrays(client:PoolClient,projectId:string):Promise<CatalogSourceTray[]> {
  const result=await client.query<CatalogSourceTray>(`SELECT id::text,name,purpose,tray_type,width_mm::text,height_mm::text,length_mm::text,include_grounding_cable,grounding_cable_type_id::text,use_trefoil_clamps,trefoil_clamp_spacing_mm::text FROM trays WHERE project_id=$1 ORDER BY id LIMIT 100001`,[projectId]);
  if(result.rows.length>PURPOSE_POLICY_LIMITS.catalogRows)fail('CATALOG_ROW_LIMIT',413);return result.rows;
}
/** State-row locking is required: normal READ COMMITTED queries could otherwise mix a revision and newer rows. */
export async function readRoutingCatalogScope(client:PoolClient,projectId:string):Promise<RoutingCatalogScope> {
  const state=await readPurposePolicyState(client,projectId,{lock:true}),projection=projectCatalogRows(await sourceTrays(client,projectId));
  return {catalogRevision:state.catalogRevision,routingContentSha256:hash(catalogRoutingHashInput(projectId,projection.rows,projection.diagnostics))};
}

const projectFactTables=['cable_types','cables','project_support_distances','project_tray_purpose_templates','project_files'] as const;
const globalFactTables=['material_cable_types','material_trays','material_supports','material_load_curves','material_load_curve_points','material_cable_type_standard_materials','material_tray_standard_materials','material_support_standard_materials','material_cable_installation_materials','material_cable_installation_standard_materials','template_files','template_file_versions'] as const;
async function drawingFacts(client:PoolClient,projectId:string):Promise<Facts> {
  const facts:Facts=[];let count=0,bytes=0;
  const take=async(table:string,sql:string,params:unknown[]=[])=>{const values=(await client.query<{rowText:string}>(sql,params)).rows;count+=values.length;for(const value of values){if(typeof value.rowText!=='string')fail('CATALOG_FACT_PROOF_INVALID');bytes+=Buffer.byteLength(value.rowText);}if(values.length>100000||count>200000||bytes>PURPOSE_POLICY_LIMITS.responseBytes)fail('CATALOG_FACT_LIMIT',413);facts.push({table,rows:values});};
  await take('project-drawing-settings',`SELECT jsonb_build_object('support_distance',support_distance::text,'support_weight',support_weight::text,'tray_load_safety_factor',tray_load_safety_factor::text,'cable_layout_settings',cable_layout_settings::text)::text AS "rowText" FROM projects WHERE id=$1`,[projectId]);
  for(const table of projectFactTables)await take(table,`SELECT (to_jsonb(t)-ARRAY['created_at','updated_at','change_log'])::text AS "rowText" FROM ${table} t WHERE project_id=$1 ORDER BY ${table==='project_support_distances'?'tray_type':table==='project_tray_purpose_templates'?'tray_purpose':'id'} LIMIT 100001`,[projectId]);
  await take('cable_type_default_materials',`SELECT (to_jsonb(t)-ARRAY['created_at','updated_at','change_log'])::text AS "rowText" FROM cable_type_default_materials t WHERE cable_type_id IN(SELECT id FROM cable_types WHERE project_id=$1) ORDER BY id LIMIT 100001`,[projectId]);
  await take('project_file_versions',`SELECT (to_jsonb(t)-ARRAY['created_at','updated_at','change_log'])::text AS "rowText" FROM project_file_versions t WHERE project_file_id IN(SELECT id FROM project_files WHERE project_id=$1) ORDER BY id LIMIT 100001`,[projectId]);
  for(const table of globalFactTables)await take(table,`SELECT (to_jsonb(t)-ARRAY['created_at','updated_at','change_log'])::text AS "rowText" FROM ${table} t ORDER BY id LIMIT 100001`);
  return facts;
}
export function buildCatalogProof(projectId:string,catalogRevision:string,drawingInputRevision:string,source:CatalogSourceTray[],facts:Facts,{snapshotId=randomUUID(),recordedAt=new Date().toISOString()}:{snapshotId?:string;recordedAt?:string}={}) {
  const projection=projectCatalogRows(source);
  // This is a separately versioned current LOCAL proof. It is never the frozen R1 original copy.
  const sourceProjectionText=canonicalPurposeJson({schemaVersion:'pathfinder.local-catalog-source.v1',projectId,trays:[...source].sort((a,b)=>compare(a.id,b.id)),drawingInputRevision,drawingFacts:facts});
  const dependencyFactsText=canonicalPurposeJson({schemaVersion:'pathfinder.catalog-dependency-facts.v1',projectId,drawingInputRevision,trays:[...source].sort((a,b)=>compare(a.id,b.id)),facts});
  const routingProjectionText=canonicalPurposeJson(catalogRoutingHashInput(projectId,projection.rows,projection.diagnostics));
  const partial:CatalogEnvelope={schemaVersion:'pathfinder.project-tray-catalog.v1',projectId,catalogRevision,normalizationVersion:'nfc-trim-case-sensitive-v1',snapshotId,sourceProjectionSha256:digest(sourceProjectionText),dependencyFactsSha256:digest(dependencyFactsText),routingContentSha256:digest(routingProjectionText),contentSha256:'0'.repeat(64),recordedAt,rowCount:projection.rows.length,...projection};
  const fullHashInputText=canonicalPurposeJson(catalogContentHashInput(partial)),catalog=catalogSchema.parse({...partial,contentSha256:digest(fullHashInputText)});
  if([sourceProjectionText,dependencyFactsText,routingProjectionText,fullHashInputText,canonicalPurposeJson(catalog)].some(value=>Buffer.byteLength(value)>PURPOSE_POLICY_LIMITS.responseBytes))fail('CATALOG_PROOF_LIMIT',413);
  return {catalog,sourceProjectionText,dependencyFactsText,routingProjectionText,fullHashInputText};
}
type Stored={id:string;catalog_revision:string;drawing_input_revision:string;public_catalog:unknown;source_projection_text:string;dependency_facts_text:string;routing_projection_text:string;full_hash_input_text:string;content_sha256:string};
function verifyStored(row:Stored):CatalogEnvelope {
  const parsed=catalogSchema.safeParse(row.public_catalog);const catalog=parsed.success?parsed.data:fail('CATALOG_PROOF_INTEGRITY');
  if(catalog.snapshotId!==row.id||catalog.catalogRevision!==row.catalog_revision)fail('CATALOG_PROOF_BINDING');
  if(catalog.contentSha256!==row.content_sha256||digest(row.source_projection_text)!==catalog.sourceProjectionSha256||digest(row.dependency_facts_text)!==catalog.dependencyFactsSha256||digest(row.routing_projection_text)!==catalog.routingContentSha256||digest(row.full_hash_input_text)!==catalog.contentSha256||row.full_hash_input_text!==canonicalPurposeJson(catalogContentHashInput(catalog))||row.routing_projection_text!==canonicalPurposeJson(catalogRoutingHashInput(catalog.projectId,catalog.rows,catalog.diagnostics)))fail('CATALOG_PROOF_INTEGRITY');
  return catalog;
}
/** Caller owns an authenticated transaction. Cache/proof writes share its state-row fence. */
export async function readCatalog(client:PoolClient,projectId:string):Promise<CatalogEnvelope> {
  const state=await readPurposePolicyState(client,projectId,{lock:true});
  const previous=(await client.query<Stored>('SELECT id::text,catalog_revision::text,drawing_input_revision::text,public_catalog,source_projection_text,dependency_facts_text,routing_projection_text,full_hash_input_text,content_sha256 FROM pf_catalog_snapshots WHERE project_id=$1 AND catalog_revision=$2 AND drawing_input_revision=$3 ORDER BY created_at DESC,id DESC LIMIT 1',[projectId,state.catalogRevision,state.drawingInputRevision])).rows[0];
  if(previous){const catalog=verifyStored(previous);if(catalog.projectId!==projectId||catalog.catalogRevision!==state.catalogRevision)fail('CATALOG_PROOF_BINDING');return catalog;}
  const proof=buildCatalogProof(projectId,state.catalogRevision,state.drawingInputRevision,await sourceTrays(client,projectId),await drawingFacts(client,projectId));
  await client.query(`INSERT INTO pf_catalog_snapshots(id,project_id,catalog_revision,drawing_input_revision,content_sha256,public_catalog,source_projection_text,dependency_facts_text,routing_projection_text,full_hash_input_text) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10)`,[proof.catalog.snapshotId,projectId,state.catalogRevision,state.drawingInputRevision,proof.catalog.contentSha256,JSON.stringify(proof.catalog),proof.sourceProjectionText,proof.dependencyFactsText,proof.routingProjectionText,proof.fullHashInputText]);return proof.catalog;
}
export async function readCatalogManifest(client:PoolClient,projectId:string):Promise<CatalogManifest> {
  const full=await readCatalog(client,projectId),{rows:_rows,...catalog}=full;
  const manifest:CatalogManifest={schemaVersion:'pathfinder.catalog-manifest.v1',catalog,pageSize:1000,pageCount:Math.ceil(full.rowCount/1000),manifestSha256:'0'.repeat(64)};
  return catalogManifestSchema.parse({...manifest,manifestSha256:hash(catalogManifestHashInput(manifest))});
}
export async function readCatalogPage(client:PoolClient,projectId:string,snapshotId:string,pageIndex:number):Promise<CatalogPage> {
  if(!policyUuidSchema.safeParse(snapshotId).success||!Number.isSafeInteger(pageIndex)||pageIndex<0||pageIndex>99)fail('CATALOG_PAGE_INVALID',400);
  const row=(await client.query<Stored>('SELECT id::text,catalog_revision::text,drawing_input_revision::text,public_catalog,source_projection_text,dependency_facts_text,routing_projection_text,full_hash_input_text,content_sha256 FROM pf_catalog_snapshots WHERE project_id=$1 AND id=$2',[projectId,snapshotId])).rows[0];if(!row)fail('CATALOG_SNAPSHOT_NOT_FOUND',404);
  const full=verifyStored(row);if(full.projectId!==projectId||full.snapshotId!==snapshotId)fail('CATALOG_PROOF_BINDING');if(pageIndex>=Math.ceil(full.rowCount/1000))fail('CATALOG_PAGE_INVALID',404);
  return catalogPageSchema.parse({schemaVersion:'pathfinder.catalog-page.v1',projectId,snapshotId,contentSha256:full.contentSha256,pageIndex,rowCount:full.rowCount,rows:full.rows.slice(pageIndex*1000,(pageIndex+1)*1000),complete:(pageIndex+1)*1000>=full.rowCount});
}
