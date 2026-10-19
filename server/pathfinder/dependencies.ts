import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { PathFinderError } from './errors.js';
import { normalizeLocation } from './matching.js';
import { activeModel, latestArtifact } from './repository.js';
import type { DependencySnapshot, EngineOptions, CurrentDependencySnapshot } from './jobContracts.js';
import { projectRoutingSettings } from './settings.js';
import { requirePreparedRoutingScope } from './routingScope.js';
import { readCurrentEndpointBindingContext, readEndpointBindingScope } from './endpointBindingRepository.js';
import { endpointCalculationPoint, isAutomaticEndpointCalculationPoint, type CurrentEndpointCalculationPoint } from './endpointCalculationProvenance.js';
import { readAutomaticEndpointCandidates } from './automaticEndpointCandidates.js';
import { readComparisonDependency } from './revisionComparisonRepository.js';
import { calculationEngineIdentity } from './calculationEngineIdentity.js';
import type { EndpointCurrentScope } from '../../shared/pathfinderEndpointBindings.js';
export {requireCurrentLogin} from './auth.js';

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const row = value as Record<string,unknown>;
  return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(row[key])}`).join(',')}}`;
}
export const hash = (value:unknown):string => createHash('sha256').update(canonicalJson(value)).digest('hex');
export function geometryHash(dependencies: DependencySnapshot): string {
  // Explicitly select engineering inputs. Full catalog snapshots, private copy
  // evidence and drawing revisions must never become transitive PF dependencies.
  const {schemaVersion,projectId,cableId,cableInputs,model,artifact,options,from,to,engineVersion,routing} = dependencies;
  return hash({schemaVersion,projectId,cableId,cableInputs,model,artifact,options,from,to,engineVersion,
    ...(dependencies.schemaVersion !== 'pathfinder.dependencies.v2' ? {preparation: dependencies.preparation} : {}),
    ...(['pathfinder.dependencies.v4','pathfinder.dependencies.v5','pathfinder.dependencies.v6'].includes(dependencies.schemaVersion) ? {comparison: (dependencies as CurrentDependencySnapshot).comparison} : {}),
    ...(['pathfinder.dependencies.v5','pathfinder.dependencies.v6'].includes(dependencies.schemaVersion) ? {engineIdentity: (dependencies as CurrentDependencySnapshot).engineIdentity} : {}),
    routing:routing && {catalogRevision:routing.catalogRevision,routingContentSha256:routing.routingContentSha256,
      routingPolicyRevision:routing.routingPolicyRevision,routingPolicySha256:routing.routingPolicySha256}});
}
type Row = Record<string,any>;
export type CollectedDependencies = {dependencies:DependencySnapshot|null;status:string;message:string;cable:Row};
export type CommonCalculationInputs = Pick<CurrentDependencySnapshot, 'projectId'|'routing'|'model'|'artifact'|'settings'|'options'|'registryRevision'|'preparation'|'comparison'|'engineVersion'|'engineIdentity'>;
export type CommonCalculationCollection = {status:'ready';inputs:CommonCalculationInputs;bindingContext:EndpointCurrentScope}
  | {status:string;inputs:null;message:string;bindingContext:null};

/** One shared, coherent read for an entire admission; caller owns project/authority locks. */
export async function collectCommonCalculationInputs(client: PoolClient, projectId: string, options: EngineOptions, lockInputs = false,
  identity?: CurrentDependencySnapshot['engineIdentity']): Promise<CommonCalculationCollection> {
  const blocked = (status:string,message:string):CommonCalculationCollection => ({inputs:null,status,message,bindingContext:null});
  const model = await activeModel(client,projectId);
  if (!model.active_model_version_id) return blocked('model_required','Select an active model in Project Details.');
  if (model.state !== 'ready' || model.health !== 'healthy') return blocked('model_unavailable','The active model is unavailable.');
  if (lockInputs) {
    const selection = (await client.query<Row>('SELECT active_model_version_id,selection_revision::text FROM project_model_selections WHERE project_id=$1 FOR SHARE',[projectId])).rows[0];
    const locked = (await client.query<Row>('SELECT state,health,content_fingerprint FROM model_versions WHERE project_id=$1 AND id=$2 FOR SHARE',[projectId,model.active_model_version_id])).rows[0];
    if (!selection || selection.active_model_version_id !== model.active_model_version_id || selection.selection_revision !== model.selection_revision || !locked || locked.state !== 'ready' || locked.health !== 'healthy' || locked.content_fingerprint !== model.content_fingerprint)
      return blocked('model_unavailable','The active model changed or became unavailable.');
  }
  const artifact = await latestArtifact(client,projectId,model.active_model_version_id);
  if (!artifact || artifact.content_fingerprint !== model.content_fingerprint) return blocked('model_index_required','Prepare a computational snapshot for the active model.');
  if (lockInputs) await client.query('SELECT id FROM pf_artifacts WHERE project_id=$1 AND id=$2 FOR SHARE',[projectId,artifact.id]);
  let routing;
  try { routing = await requirePreparedRoutingScope(client,projectId,artifact.id); }
  catch (error) {
    if (error instanceof PathFinderError && error.code === 'ROUTING_PREPARATION_REQUIRED')
      return blocked('routing_preparation_required',error.message);
    throw error;
  }
  const bindingContext = await readCurrentEndpointBindingContext(client, projectId);
  if (!bindingContext || bindingContext.modelVersionId !== model.active_model_version_id ||
      bindingContext.selectionRevision !== model.selection_revision || bindingContext.artifactId !== artifact.id ||
      bindingContext.projectionSha256 !== artifact.snapshot_sha256)
    return blocked('endpoint_preparation_required', 'Publish the current project preparation before confirming shared endpoint bindings.');
  const comparison = await readComparisonDependency(client, {projectId, currentAggregateId: bindingContext.aggregateId,
    currentModelVersionId: bindingContext.modelVersionId});
  if (comparison.readiness === 'pending') return blocked('comparison_required', 'Complete the requested revision comparison before calculating against this prepared model.');
  const currentSettings=await projectRoutingSettings(client,projectId,options);
  if (!currentSettings.settings.endConnectionLength || !currentSettings.settings.additionalBendingPercent) return blocked('settings_required','Set the project allowances in Project Details.');
  const registry = (await client.query<Row>('SELECT registry_revision::text FROM pf_project_state WHERE project_id=$1 FOR SHARE',[projectId])).rows[0];
  let engineIdentity:CurrentDependencySnapshot['engineIdentity'];
  try {engineIdentity=identity??await calculationEngineIdentity();}
  catch(error){if(error instanceof PathFinderError)return blocked('engine_required',error.message);throw error;}
  return {status:'ready',bindingContext,inputs:{projectId,routing,comparison:comparison.scope,
    preparation:{aggregateId:bindingContext.aggregateId,geometryRevision:bindingContext.geometryRevision,captureFrameId:bindingContext.captureFrameId,projectionSha256:bindingContext.projectionSha256},
    registryRevision:registry.registry_revision,model:{id:model.active_model_version_id,selectionRevision:model.selection_revision,contentFingerprint:model.content_fingerprint},
    artifact:{id:artifact.id,sha256:artifact.snapshot_sha256},settings:currentSettings.settings,options:currentSettings.options,
    engineVersion:'pathfinder-45c24bf5-pf1-modelrunner-v1',engineIdentity}};
}

export function freezeCableDependencies(common:CommonCalculationInputs,cable:Row,
  from:CurrentEndpointCalculationPoint|null,to:CurrentEndpointCalculationPoint|null):CollectedDependencies {
  const blocked=(status:string,message:string):CollectedDependencies=>({dependencies:null,status,message,cable});
  if(!['MV','LV','Control','Instrumentation'].includes(cable.mto))return blocked('category_required','Resolve the cable category before calculation.');
  if(!from||!to)return blocked('locations_required',`Resolve ${!from&&!to?'From and To':!from?'From':'To'} locations. Missing, ambiguous or stale locations cannot be calculated.`);
  const base = {...common,cableId:cable.id,cableWriteRevision:cable.cable_write_revision,
    cableInputs:{fromLocation:cable.from_location,toLocation:cable.to_location,mto:cable.mto,cableTypeId:cable.cable_type_id}};
  if (isAutomaticEndpointCalculationPoint(from) || isAutomaticEndpointCalculationPoint(to))
    return {status:'ready',message:'Ready for proposal calculation using approximate automatic equipment anchors. Manual review remains required.',cable,
      dependencies:{...base,schemaVersion:'pathfinder.dependencies.v6',from,to}};
  return {status:'ready',message:'Ready for calculation.',cable,dependencies:{...base,schemaVersion:'pathfinder.dependencies.v5',from,to}};
}

export async function collectDependencies(client: PoolClient, projectId: string, cableId: string, options: EngineOptions, lockCable = false,
  identity?:CurrentDependencySnapshot['engineIdentity']): Promise<CollectedDependencies> {
  const cable = (await client.query<Row>(`SELECT id,from_location,to_location,mto,cable_type_id,cable_write_revision::text,routing,design_length,install_length
    FROM cables WHERE project_id=$1 AND id=$2 ${lockCable ? 'FOR UPDATE' : ''}`,[projectId,cableId])).rows[0];
  if(!cable)throw new PathFinderError('CABLE_NOT_FOUND',404);
  const common=await collectCommonCalculationInputs(client,projectId,options,lockCable,identity);
  if(common.inputs===null)return {dependencies:null,status:common.status,message:common.message,cable};
  const {bindingContext}=common;
  const automatic = new Map<string, Promise<CurrentEndpointCalculationPoint|null>>();
  const endpoint = async (name:string|null):Promise<CurrentEndpointCalculationPoint|null> => {
    if (!name || !normalizeLocation(name)) return null;
    const result = await client.query<Row>(`SELECT l.id FROM pf_location_aliases a JOIN pf_locations l ON l.project_id=a.project_id AND l.id=a.location_id
      WHERE a.project_id=$1 AND a.normalized_alias=$2 FOR SHARE OF l,a`,[projectId,normalizeLocation(name)]);
    const value = result.rows[0];
    if (result.rows.length !== 1) return null;
    const scope = await readEndpointBindingScope(client, {projectId, locationId: value.id,
      modelVersionId: bindingContext.modelVersionId, aggregateId: bindingContext.aggregateId,
      projectionSha256: bindingContext.projectionSha256, captureFrameId: bindingContext.captureFrameId});
    if (scope.status === 'confirmed') return scope.binding.artifactId === common.inputs!.artifact.id ? endpointCalculationPoint(scope.binding) : null;
    // Existing stale/unsupported saved points require explicit resolution. A
    // model candidate may fill only an otherwise unbound shared location.
    if (scope.status !== 'missing') return null;
    if (!automatic.has(value.id)) automatic.set(value.id, readAutomaticEndpointCandidates(client,
      {projectId,current:bindingContext,locationIds:[value.id]}).then(values => values.get(value.id)?.point ?? null));
    return automatic.get(value.id)!;
  };
  const from = await endpoint(cable.from_location),to = await endpoint(cable.to_location);
  return freezeCableDependencies(common.inputs,cable,from,to);
}

/** Route reuse is narrower than matching geometry: only changed S/E/P with every other frozen authority equal. */
export function verifiedDesignOnlyChange(current:DependencySnapshot,previous:DependencySnapshot):boolean {
  if(!['pathfinder.dependencies.v5','pathfinder.dependencies.v6'].includes(current.schemaVersion)||current.schemaVersion!==previous.schemaVersion)return false;
  const {settings:a,...left}=current,{settings:b,...right}=previous;
  return hash(left)===hash(right)&&a.connectionGap===b.connectionGap
    && [a.secondaryTrayLength,a.endConnectionLength,a.additionalBendingPercent].some((value,n)=>value!==[b.secondaryTrayLength,b.endConnectionLength,b.additionalBendingPercent][n]);
}
export async function hasSyntheticProof(client: PoolClient, dependencies: DependencySnapshot): Promise<boolean> {
  if (process.env.PF_LOCAL_DEMO !== 'true') return false;
  const proof = await client.query(`SELECT p.fixture_id FROM pf_synthetic_proofs p JOIN pf_synthetic_projects s ON s.project_id=p.project_id AND s.fixture_id=p.fixture_id
    WHERE p.project_id=$1 AND p.artifact_id=$2 AND p.snapshot_sha256=$3 AND p.fixture_id='pf-local-straight-v1' FOR SHARE OF p,s`,[dependencies.projectId,dependencies.artifact.id,dependencies.artifact.sha256]);
  return proof.rows.length === 1;
}
