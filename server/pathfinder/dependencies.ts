import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { PathFinderError } from './errors.js';
import { normalizeLocation } from './matching.js';
import { activeModel, latestArtifact } from './repository.js';
import type { DependencySnapshot, EngineOptions, CurrentDependencySnapshot } from './jobContracts.js';
import { projectRoutingSettings } from './settings.js';
import { requirePreparedRoutingScope } from './routingScope.js';
import { readCurrentEndpointBindingContext, readEndpointBindingScope } from './endpointBindingRepository.js';
import { endpointCalculationPoint } from './endpointCalculationProvenance.js';
import { readComparisonDependency } from './revisionComparisonRepository.js';
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
    ...(dependencies.schemaVersion === 'pathfinder.dependencies.v4' ? {comparison: dependencies.comparison} : {}),
    routing:routing && {catalogRevision:routing.catalogRevision,routingContentSha256:routing.routingContentSha256,
      routingPolicyRevision:routing.routingPolicyRevision,routingPolicySha256:routing.routingPolicySha256}});
}
type Row = Record<string,any>;
export type CollectedDependencies = {dependencies:DependencySnapshot|null;status:string;message:string;cable:Row};
export async function collectDependencies(client: PoolClient, projectId: string, cableId: string, options: EngineOptions, lockCable = false): Promise<CollectedDependencies> {
  const cable = (await client.query<Row>(`SELECT id,from_location,to_location,mto,cable_type_id,cable_write_revision::text,routing,design_length,install_length
    FROM cables WHERE project_id=$1 AND id=$2 ${lockCable ? 'FOR UPDATE' : ''}`,[projectId,cableId])).rows[0];
  if (!cable) throw new PathFinderError('CABLE_NOT_FOUND',404);
  const blocked = (status:string,message:string):CollectedDependencies => ({dependencies:null,status,message,cable});
  const model = await activeModel(client,projectId);
  if (!model.active_model_version_id) return blocked('model_required','Select an active model in Project Details.');
  if (model.state !== 'ready' || model.health !== 'healthy') return blocked('model_unavailable','The active model is unavailable.');
  if (lockCable) {
    const selection = (await client.query<Row>('SELECT active_model_version_id,selection_revision::text FROM project_model_selections WHERE project_id=$1 FOR SHARE',[projectId])).rows[0];
    const locked = (await client.query<Row>('SELECT state,health,content_fingerprint FROM model_versions WHERE project_id=$1 AND id=$2 FOR SHARE',[projectId,model.active_model_version_id])).rows[0];
    if (!selection || selection.active_model_version_id !== model.active_model_version_id || selection.selection_revision !== model.selection_revision || !locked || locked.state !== 'ready' || locked.health !== 'healthy' || locked.content_fingerprint !== model.content_fingerprint)
      return blocked('model_unavailable','The active model changed or became unavailable.');
  }
  const artifact = await latestArtifact(client,projectId,model.active_model_version_id);
  if (!artifact || artifact.content_fingerprint !== model.content_fingerprint) return blocked('model_index_required','Prepare a computational snapshot for the active model.');
  if (lockCable) await client.query('SELECT id FROM pf_artifacts WHERE project_id=$1 AND id=$2 FOR SHARE',[projectId,artifact.id]);
  let routing;
  try { routing = await requirePreparedRoutingScope(client,projectId,artifact.id); }
  catch (error) {
    if (error instanceof PathFinderError && error.code === 'ROUTING_PREPARATION_REQUIRED')
      return blocked('routing_preparation_required',error.message);
    throw error;
  }
  if (!['MV','LV','Control','Instrumentation'].includes(cable.mto)) return blocked('category_required','Resolve the cable category before calculation.');
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
  const endpoint = async (name:string|null):Promise<CurrentDependencySnapshot['from']|null> => {
    if (!name || !normalizeLocation(name)) return null;
    const result = await client.query<Row>(`SELECT l.id FROM pf_location_aliases a JOIN pf_locations l ON l.project_id=a.project_id AND l.id=a.location_id
      WHERE a.project_id=$1 AND a.normalized_alias=$2 FOR SHARE OF l,a`,[projectId,normalizeLocation(name)]);
    const value = result.rows[0];
    if (result.rows.length !== 1) return null;
    const scope = await readEndpointBindingScope(client, {projectId, locationId: value.id,
      modelVersionId: bindingContext.modelVersionId, aggregateId: bindingContext.aggregateId,
      projectionSha256: bindingContext.projectionSha256, captureFrameId: bindingContext.captureFrameId});
    if (scope.status !== 'confirmed') return null;
    return endpointCalculationPoint(scope.binding);
  };
  const from = await endpoint(cable.from_location),to = await endpoint(cable.to_location);
  if (!from || !to) return blocked('locations_required',`Resolve ${!from && !to ? 'From and To' : !from ? 'From' : 'To'} locations. Missing, ambiguous or stale locations cannot be calculated.`);
  return {status:'ready',message:'Ready for calculation.',cable,dependencies:{schemaVersion:'pathfinder.dependencies.v4',comparison:comparison.scope,routing,projectId,cableId,cableWriteRevision:cable.cable_write_revision,
    preparation:{aggregateId: bindingContext.aggregateId, geometryRevision: bindingContext.geometryRevision,
      captureFrameId: bindingContext.captureFrameId, projectionSha256: bindingContext.projectionSha256},
    cableInputs:{fromLocation:cable.from_location,toLocation:cable.to_location,mto:cable.mto,cableTypeId:cable.cable_type_id},registryRevision:registry.registry_revision,
    model:{id:model.active_model_version_id,selectionRevision:model.selection_revision,contentFingerprint:model.content_fingerprint},artifact:{id:artifact.id,sha256:artifact.snapshot_sha256},
    settings:currentSettings.settings,
    options:currentSettings.options,from,to,engineVersion:'pathfinder-45c24bf5-pf1-modelrunner-v1'}};
}
export async function hasSyntheticProof(client: PoolClient, dependencies: DependencySnapshot): Promise<boolean> {
  if (process.env.PF_LOCAL_DEMO !== 'true') return false;
  const proof = await client.query(`SELECT p.fixture_id FROM pf_synthetic_proofs p JOIN pf_synthetic_projects s ON s.project_id=p.project_id AND s.fixture_id=p.fixture_id
    WHERE p.project_id=$1 AND p.artifact_id=$2 AND p.snapshot_sha256=$3 AND p.fixture_id='pf-local-straight-v1' FOR SHARE OF p,s`,[dependencies.projectId,dependencies.artifact.id,dependencies.artifact.sha256]);
  return proof.rows.length === 1;
}
