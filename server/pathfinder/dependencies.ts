import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { PathFinderError } from './errors.js';
import { normalizeLocation } from './matching.js';
import { activeModel, latestArtifact } from './repository.js';
import { optionsSchema, type DependencySnapshot, type EngineOptions, type CurrentDependencySnapshot, type AutomaticDependencySnapshot, type ScopedDependencySnapshot, type BarrierDependencySnapshot } from './jobContracts.js';
import { projectRoutingSettings } from './settings.js';
import { requirePreparedRoutingScope } from './routingScope.js';
import { readCurrentEndpointBindingContext, readEndpointBindingScope } from './endpointBindingRepository.js';
import { endpointCalculationPoint, isAutomaticEndpointCalculationPoint, scopedEndpointResolutionSchema, type CurrentEndpointCalculationPoint } from './endpointCalculationProvenance.js';
import { readAutomaticEndpointCandidates } from './automaticEndpointCandidates.js';
import { readComparisonDependency } from './revisionComparisonRepository.js';
import { calculationEngineIdentity, barrierCalculationEngineIdentity, mixedBarrierCalculationEngineIdentity } from './calculationEngineIdentity.js';
import { type CalculationEngineIdentity, type EngineIdentity } from '../../shared/pathfinderEngineIdentity.js';
import { verifySupportedBarrierEngineIdentity as verifyBarrierEngineIdentity,
  type AnyBarrierEngineIdentity as BarrierEngineIdentity, type AnyBarrierRuntimeContext as BarrierRuntimeContext } from '../../shared/pathfinderBarrierSupported.js';
import { collectBarrierCalculationState, collectBarrierCalculationScope } from './barrierCalculationScope.js';
import type { MixedBarrierVerifierEvidence } from '../../shared/pathfinderBarrierMixed.js';
import type { EndpointCurrentScope } from '../../shared/pathfinderEndpointBindings.js';
import { cablePurposeSchema, cablePurposeRoutingSchema, normalizeCablePurpose, type CablePurposeRouting } from '../../shared/routingCablePurposes.js';
import { normalizeCatalogKey, routingCatalogDiagnostics, routingRuleSchema } from '../../shared/pathfinderPurposePolicy.js';
import { readRoutingCatalog } from './catalog.js';
import { readProjectCablePurposes } from './purposePolicy.js';
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
    ...(dependencies.settings.trayCapacity?{trayCapacity:dependencies.settings.trayCapacity}:{}),
    ...(dependencies.settings.routingBalance?{routingBalance:dependencies.settings.routingBalance}:{}),
    ...(dependencies.schemaVersion !== 'pathfinder.dependencies.v2' ? {preparation: dependencies.preparation} : {}),
    ...(['pathfinder.dependencies.v4','pathfinder.dependencies.v5','pathfinder.dependencies.v6','pathfinder.dependencies.v7','pathfinder.dependencies.v8'].includes(dependencies.schemaVersion) ? {comparison: (dependencies as CurrentDependencySnapshot).comparison} : {}),
    ...(['pathfinder.dependencies.v5','pathfinder.dependencies.v6','pathfinder.dependencies.v7','pathfinder.dependencies.v8'].includes(dependencies.schemaVersion) ? {engineIdentity: (dependencies as CurrentDependencySnapshot).engineIdentity} : {}),
    ...(dependencies.schemaVersion === 'pathfinder.dependencies.v7' || dependencies.schemaVersion === 'pathfinder.dependencies.v8' ? {endpointResolution: dependencies.endpointResolution} : {}),
    ...(dependencies.schemaVersion === 'pathfinder.dependencies.v8' ? {barriers: dependencies.barriers,
      ...(Object.hasOwn(dependencies,'barrierQualification')?{barrierQualification:dependencies.barrierQualification}:{})} : {}),
    ...('cablePurposeRouting' in dependencies && dependencies.cablePurposeRouting ? {cablePurposeRouting:dependencies.cablePurposeRouting} : {}),
    routing:routing && {catalogRevision:routing.catalogRevision,routingContentSha256:routing.routingContentSha256,
      routingPolicyRevision:routing.routingPolicyRevision,routingPolicySha256:routing.routingPolicySha256}});
}
type Row = Record<string,any>;
export type CollectedDependencies = {dependencies:DependencySnapshot|null;status:string;message:string;cable:Row};
export type CommonCalculationInputs = Pick<CurrentDependencySnapshot, 'projectId'|'routing'|'model'|'artifact'|'settings'|'options'|'registryRevision'|'preparation'|'comparison'|'engineVersion'|'engineIdentity'>;
type CommonInputsWithIdentity<I extends CalculationEngineIdentity> = Omit<CommonCalculationInputs, 'engineIdentity'> & { engineIdentity: I };
type CommonCollectionWithIdentity<I extends CalculationEngineIdentity> = {status:'ready';inputs:CommonInputsWithIdentity<I>;bindingContext:EndpointCurrentScope}
  | {status:string;inputs:null;message:string;bindingContext:null};
export type CommonCalculationCollection = CommonCollectionWithIdentity<EngineIdentity>;
export type BarrierCommonCalculationInputs = CommonInputsWithIdentity<BarrierEngineIdentity> & {
  barriers: BarrierRuntimeContext; barrierQualification?:MixedBarrierVerifierEvidence|null };
export type BarrierCommonCalculationCollection = {status:'ready';inputs:BarrierCommonCalculationInputs;bindingContext:EndpointCurrentScope}
  | {status:string;inputs:null;message:string;bindingContext:null};
const barrierAdmissionFailure = (): never => { throw new PathFinderError('BARRIER_ADMISSION_REQUIRED', 409, 'A fresh calculation requires its exact registered barrier scope and explicit drilling choice.'); };

/** One shared, coherent read for an entire admission; caller owns project/authority locks. */
async function collectCommonInputs<I extends CalculationEngineIdentity>(client: PoolClient, projectId: string, options: EngineOptions, lockInputs: boolean,
  readIdentity: () => Promise<I>): Promise<CommonCollectionWithIdentity<I>> {
  const blocked = (status:string,message:string):CommonCollectionWithIdentity<I> => ({inputs:null,status,message,bindingContext:null});
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
  let engineIdentity:I;
  try {engineIdentity=await readIdentity();}
  catch(error){if(error instanceof PathFinderError)return blocked('engine_required',error.message);throw error;}
  return {status:'ready',bindingContext,inputs:{projectId,routing,comparison:comparison.scope,
    preparation:{aggregateId:bindingContext.aggregateId,geometryRevision:bindingContext.geometryRevision,captureFrameId:bindingContext.captureFrameId,projectionSha256:bindingContext.projectionSha256},
    registryRevision:registry.registry_revision,model:{id:model.active_model_version_id,selectionRevision:model.selection_revision,contentFingerprint:model.content_fingerprint},
    artifact:{id:artifact.id,sha256:artifact.snapshot_sha256},settings:currentSettings.settings,options:currentSettings.options,
    engineVersion:'pathfinder-45c24bf5-pf1-modelrunner-v1',engineIdentity}};
}

/** Retained v2-v7 projections keep their original four-module identity and have
 * no barrier fields, including an explicitly absent optional request field. */
export async function collectCommonCalculationInputs(client: PoolClient, projectId: string, options: EngineOptions, lockInputs = false,
  identity?: EngineIdentity): Promise<CommonCalculationCollection> {
  if (options.barrierRouting !== undefined) return barrierAdmissionFailure();
  const { barrierRouting: _absent, ...legacy } = options;
  return collectCommonInputs(client, projectId, legacy, lockInputs, async () => identity ?? await calculationEngineIdentity());
}

/** One authority/storage read per whole v8 admission, never per cable. */
export async function collectBarrierCommonCalculationInputs(client: PoolClient, projectId: string, requested: EngineOptions, lockInputs = false,
  identity?: BarrierEngineIdentity, bounds: {signal?:AbortSignal;deadline?:number} = {}): Promise<BarrierCommonCalculationCollection> {
  const options = optionsSchema.parse(requested);
  if (!options.barrierRouting) return barrierAdmissionFailure();
  const mixed = options.barrierRouting.schemaVersion === 'wfc.pf.barrier-admission-intent.v2';
  bounds.signal?.throwIfAborted();
  const common = await collectCommonInputs(client, projectId, options, lockInputs, async () => {
    const value = identity ?? await (mixed ? mixedBarrierCalculationEngineIdentity() : barrierCalculationEngineIdentity());
    if ((value.schemaVersion === 'wfc.pf.engine-identity.v3') !== mixed
      || !verifyBarrierEngineIdentity(value, text => createHash('sha256').update(text).digest('hex')))
      throw new PathFinderError('BARRIER_ENGINE_IDENTITY_REQUIRED', 503, 'The barrier-aware calculation implementation is unavailable.');
    return value;
  });
  if (common.inputs === null) return common;
  const { context: barriers, qualification } = mixed ? await collectBarrierCalculationState(client, projectId, options.barrierRouting, bounds)
    : { context: await collectBarrierCalculationScope(client, projectId, options.barrierRouting, bounds), qualification: null };
  const scope = barriers.binding.scope;
  if (scope.modelVersionId !== common.inputs.model.id || scope.contentFingerprint !== common.inputs.model.contentFingerprint
    || scope.selectionRevision !== common.inputs.model.selectionRevision || scope.captureFrameId !== common.inputs.preparation.captureFrameId)
    throw new PathFinderError('BARRIER_CALCULATION_SCOPE_CHANGED', 409, 'The barrier scope and prepared routing frame differ. Prepare and calculate again.');
  return { ...common, inputs: { ...common.inputs, barriers, ...(mixed ? { barrierQualification: qualification } : {}) } };
}

/** Database metadata only, for the private already-verified computation service.
 * This grants no geometry/currentness authority without its service-owned token. */
export async function collectBarrierCommonMetadata(client: PoolClient, projectId: string, options: EngineOptions,
  identity: BarrierEngineIdentity): Promise<CommonCollectionWithIdentity<BarrierEngineIdentity>> {
  return collectCommonInputs(client, projectId, options, true, async () => identity);
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

/** A new canonical body, never a field-ignoring comparison of retained v5/v6 hashes. */
export function freezeScopedCableDependencies(common:CommonCalculationInputs,cable:Row,
  from:CurrentEndpointCalculationPoint|null,to:CurrentEndpointCalculationPoint|null):CollectedDependencies {
  const legacy = freezeCableDependencies(common,cable,from,to);
  if (!legacy.dependencies) return legacy;
  const {registryRevision:_registry,schemaVersion:_version,...body} = legacy.dependencies as CurrentDependencySnapshot | AutomaticDependencySnapshot;
  const endpointResolution = scopedEndpointResolutionSchema.safeParse({schemaVersion:'pathfinder.endpoint-resolution.v1',matchingPolicy:'nfc-trim-uppercase-v1',
    from:{logicalKey:typeof cable.from_location === 'string'?normalizeLocation(cable.from_location):'',locationId:from!.locationId},
    to:{logicalKey:typeof cable.to_location === 'string'?normalizeLocation(cable.to_location):'',locationId:to!.locationId}});
  if (!endpointResolution.success) return {dependencies:null,status:'locations_required',message:'Resolve exact logical From and To names before calculating.',cable};
  const dependencies:ScopedDependencySnapshot = {...body,schemaVersion:'pathfinder.dependencies.v7',from:from!,to:to!,endpointResolution:endpointResolution.data};
  return {...legacy,dependencies};
}

export function freezeBarrierCableDependencies(common:BarrierCommonCalculationInputs,cable:Row,
  from:CurrentEndpointCalculationPoint|null,to:CurrentEndpointCalculationPoint|null):CollectedDependencies {
  const blocked=(status:string,message:string):CollectedDependencies=>({dependencies:null,status,message,cable});
  if (cable.mto === 'MV') return blocked('category_required','MV cables are excluded from Path Finder calculations.');
  if (!['LV','Control','Instrumentation'].includes(cable.mto)) return blocked('category_required','Resolve the cable category before calculation.');
  if (!from || !to) return blocked('locations_required',`Resolve ${!from&&!to?'From and To':!from?'From':'To'} locations. Missing, ambiguous or stale locations cannot be calculated.`);
  const endpointResolution = scopedEndpointResolutionSchema.safeParse({schemaVersion:'pathfinder.endpoint-resolution.v1',matchingPolicy:'nfc-trim-uppercase-v1',
    from:{logicalKey:typeof cable.from_location==='string'?normalizeLocation(cable.from_location):'',locationId:from.locationId},
    to:{logicalKey:typeof cable.to_location==='string'?normalizeLocation(cable.to_location):'',locationId:to.locationId}});
  if (!endpointResolution.success) return blocked('locations_required','Resolve exact logical From and To names before calculating.');
  const mixed = common.barriers.schemaVersion === 'wfc.pf.barrier-runtime.v2';
  if (!common.options.barrierRouting || (common.options.barrierRouting.schemaVersion === 'wfc.pf.barrier-admission-intent.v2') !== mixed
    || common.engineIdentity.schemaVersion !== (mixed ? 'wfc.pf.engine-identity.v3' : 'wfc.pf.engine-identity.v2')) return barrierAdmissionFailure();
  const {registryRevision:_audit,...body} = common;
  const dependencies:BarrierDependencySnapshot = {...body,schemaVersion:'pathfinder.dependencies.v8',cableId:cable.id,cableWriteRevision:cable.cable_write_revision,
    cableInputs:{fromLocation:cable.from_location,toLocation:cable.to_location,mto:cable.mto,cableTypeId:cable.cable_type_id},
    from,to,endpointResolution:endpointResolution.data};
  return {status:'ready',message:isAutomaticEndpointCalculationPoint(from)||isAutomaticEndpointCalculationPoint(to)
    ?'Ready for barrier-aware proposal calculation using approximate automatic equipment anchors.':'Ready for barrier-aware calculation.',cable,dependencies};
}

/** Legacy versions retain their exact current v5/v6 projection, including registry. */
export function freezeCableDependenciesForVersion(common:CommonCalculationInputs|BarrierCommonCalculationInputs,cable:Row,
  from:CurrentEndpointCalculationPoint|null,to:CurrentEndpointCalculationPoint|null,retainedVersion:DependencySnapshot['schemaVersion']):CollectedDependencies {
  if (retainedVersion === 'pathfinder.dependencies.v8') {
    if (!('barriers' in common)) return barrierAdmissionFailure();
    return freezeBarrierCableDependencies(common,cable,from,to);
  }
  if ('barriers' in common || common.options.barrierRouting !== undefined || !['pathfinder.dependencies.v2','pathfinder.dependencies.v3','pathfinder.dependencies.v4','pathfinder.dependencies.v5','pathfinder.dependencies.v6','pathfinder.dependencies.v7'].includes(retainedVersion))
    return barrierAdmissionFailure();
  return retainedVersion === 'pathfinder.dependencies.v7' ? freezeScopedCableDependencies(common,cable,from,to) : freezeCableDependencies(common,cable,from,to);
}

type ReadCommonCollection = CommonCalculationCollection | BarrierCommonCalculationCollection;
type ReadCommon = (options: EngineOptions, retainedVersion: DependencySnapshot['schemaVersion']) => Promise<ReadCommonCollection>;
const collectProjectionCommon = (client: PoolClient, projectId: string, options: EngineOptions, lockCable: boolean,
  identity: CalculationEngineIdentity | undefined, retainedVersion: DependencySnapshot['schemaVersion']): Promise<ReadCommonCollection> =>
  retainedVersion === 'pathfinder.dependencies.v8'
    ? collectBarrierCommonCalculationInputs(client, projectId, options, lockCable, identity as BarrierEngineIdentity | undefined)
    : collectCommonCalculationInputs(client, projectId, options, lockCable, identity as EngineIdentity | undefined);

/** The cable's type Purpose is independent of its MTO engine class. */
export async function readCablePurposeRouting(client: PoolClient, projectId: string, rawPurpose: unknown): Promise<CablePurposeRouting | null> {
  if (typeof rawPurpose !== 'string') return null;
  const purpose = normalizeCablePurpose(rawPurpose);
  if (!cablePurposeSchema.safeParse(purpose).success) return null;
  return (await createCablePurposeRoutingReader(client, projectId))(purpose);
}

/** Read after the common routing-state lock. Cable-type writers update that
 * state in their AFTER trigger, so a pre-lock Purpose can already be obsolete.
 * Do not row-lock cable_types here: its writers hold the type row first. */
export async function readLinkedCableTypePurposes(client: PoolClient, projectId: string, cables: readonly Row[]): Promise<Map<string, unknown>> {
  const purposes = new Map<string, unknown>();
  for (let at = 0; at < cables.length; at += 250) {
    const chunk = cables.slice(at, at + 250), expected = new Map(chunk.map(cable => [cable.id, cable]));
    const rows = (await client.query<Row>(`/* cable-purpose:locked-scope-types */ SELECT c.id,c.cable_type_id,c.cable_write_revision::text,
      CASE WHEN octet_length(ct.purpose)<=2000 THEN ct.purpose ELSE NULL END AS cable_type_purpose
      FROM cables c LEFT JOIN cable_types ct ON ct.project_id=c.project_id AND ct.id=c.cable_type_id
      WHERE c.project_id=$1 AND c.id=ANY($2::uuid[]) ORDER BY c.id`, [projectId, [...expected.keys()]])).rows;
    if (rows.length !== expected.size) throw new PathFinderError('CABLE_INPUT_CONFLICT', 409, 'The cable inputs changed. Refresh before calculating.');
    for (const row of rows) {
      const cable = expected.get(row.id);
      if (!cable || purposes.has(row.id) || cable.cable_type_id !== row.cable_type_id || cable.cable_write_revision !== row.cable_write_revision)
        throw new PathFinderError('CABLE_INPUT_CONFLICT', 409, 'The cable inputs changed. Refresh before calculating.');
      purposes.set(row.id, row.cable_type_purpose);
    }
  }
  return purposes;
}

/** One catalog/policy observation serves the complete admitted cable batch. */
export async function createCablePurposeRoutingReader(client: PoolClient, projectId: string): Promise<(rawPurpose:unknown)=>CablePurposeRouting|null> {
  const catalog = await readRoutingCatalog(client, projectId);
  const availablePurposes=new Set((await readProjectCablePurposes(client,projectId)).cablePurposes);
  const rules = (await client.query<{purpose_key:string;allowed_categories:unknown}>(`SELECT r.purpose_key,r.allowed_categories FROM pf_routing_purpose_rules r
    JOIN pf_catalog_purpose_incarnations i ON i.project_id=r.project_id AND i.purpose_key=r.purpose_key AND i.incarnation_id=r.purpose_incarnation_id
    WHERE r.project_id=$1 AND i.active AND i.row_count>0 ORDER BY r.purpose_key COLLATE "C"`, [projectId])).rows
    .map(row => routingRuleSchema.parse({purposeKey:row.purpose_key,allowedCategories:row.allowed_categories}));
  const blocked = new Set(routingCatalogDiagnostics(catalog.diagnostics).flatMap(diagnostic => diagnostic.projectTrayIds));
  const allowed = new Map<string,Set<string>>(), rulesByPurpose = new Map(rules.map(rule => [rule.purposeKey,rule.allowedCategories]));
  const codeOwners = new Map<string,number>();
  for (const tray of catalog.rows) {
    const code = '/' + normalizeCatalogKey(tray.rawName).replace(/^\/+|\/+$/g, '').trim().toUpperCase();
    codeOwners.set(code, (codeOwners.get(code) ?? 0) + 1);
    if (blocked.has(tray.projectTrayId) || tray.purposeKey === null || tray.rawName.length > 256
      || !/^\/[A-Z0-9][A-Z0-9_.-]*$/.test(code) || code === '/SECONDARY') continue;
    for (const purpose of rulesByPurpose.get(tray.purposeKey) ?? []) {
      const codes=allowed.get(purpose) ?? new Set<string>(); codes.add(code); allowed.set(purpose,codes);
    }
  }
  const resolved = new Map([...allowed].map(([purpose,codes])=>[purpose,
    [...codes].filter(code => codeOwners.get(code) === 1).sort()]));
  const cache=new Map<string,CablePurposeRouting|null>();
  return rawPurpose => {
    if (typeof rawPurpose !== 'string') return null;
    const purpose=normalizeCablePurpose(rawPurpose),allowedRouteCodes=resolved.get(purpose);
    if(cache.has(purpose))return cache.get(purpose)!;
    const value=availablePurposes.has(purpose) && cablePurposeSchema.safeParse(purpose).success && allowedRouteCodes?.length
      ? cablePurposeRoutingSchema.parse({purpose,allowedRouteCodes}) : null;
    cache.set(purpose,value);return value;
  };
}

async function collectWithProjection(client: PoolClient, projectId: string, cableId: string, options: EngineOptions, lockCable: boolean,
  identity:CalculationEngineIdentity|undefined,retainedVersion:DependencySnapshot['schemaVersion'], readCommon?: ReadCommon): Promise<CollectedDependencies> {
  const cable = (await client.query<Row>(`SELECT id,from_location,to_location,mto,cable_type_id,cable_write_revision::text,routing,design_length,install_length
    FROM cables WHERE project_id=$1 AND id=$2 ${lockCable ? 'FOR UPDATE' : ''}`,[projectId,cableId])).rows[0];
  if(!cable)throw new PathFinderError('CABLE_NOT_FOUND',404);
  const protectedIdentity = options.barrierRouting?.schemaVersion === 'wfc.pf.barrier-admission-intent.v2' ? 'wfc.pf.engine-identity.v3' : 'wfc.pf.engine-identity.v2';
  if (retainedVersion === 'pathfinder.dependencies.v8' ? identity && identity.schemaVersion !== protectedIdentity : identity && identity.schemaVersion !== 'wfc.pf.engine-identity.v1')
    return barrierAdmissionFailure();
  const common = await (readCommon ? readCommon(options, retainedVersion)
    : collectProjectionCommon(client, projectId, options, lockCable, identity, retainedVersion));
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
  const frozen = freezeCableDependenciesForVersion(common.inputs,cable,from,to,retainedVersion);
  if (!frozen.dependencies || !['pathfinder.dependencies.v7','pathfinder.dependencies.v8'].includes(retainedVersion)) return frozen;
  const purposes = await readLinkedCableTypePurposes(client, projectId, [cable]);
  const cablePurposeRouting = await readCablePurposeRouting(client, projectId, purposes.get(cable.id));
  if (!cablePurposeRouting) return {dependencies:null,status:'category_required',message:'Choose a Cable types Purpose and allow it on at least one valid project tray purpose before calculating.',cable};
  return {...frozen,dependencies:{...frozen.dependencies,cablePurposeRouting} as ScopedDependencySnapshot | BarrierDependencySnapshot};
}

/** Existing admission/currentness callers remain byte-for-byte legacy by default. */
export async function collectDependencies(client: PoolClient, projectId: string, cableId: string, options: EngineOptions, lockCable = false,
  identity?:CurrentDependencySnapshot['engineIdentity']): Promise<CollectedDependencies> {
  return collectWithProjection(client,projectId,cableId,options,lockCable,identity,'pathfinder.dependencies.v5');
}

/** Choose by the retained immutable version, never by current UI or global settings. */
export async function collectDependenciesForVersion(client: PoolClient, projectId: string, cableId: string, options: EngineOptions,
  retainedVersion:DependencySnapshot['schemaVersion'],lockCable = false,identity?:CalculationEngineIdentity):Promise<CollectedDependencies> {
  return collectWithProjection(client,projectId,cableId,options,lockCable,identity,retainedVersion);
}

/** Internal projection primitive. The verified-common service alone supplies
 * the exact previously checked geometry; endpoints/cable rows are still live. */
export async function collectDependenciesWithVerifiedCommon(client: PoolClient, projectId: string, cableId: string,
  options: EngineOptions, common: BarrierCommonCalculationCollection, lockCable = true): Promise<CollectedDependencies> {
  return collectWithProjection(client, projectId, cableId, options, lockCable,
    common.inputs?.engineIdentity, 'pathfinder.dependencies.v8', async () => common);
}

export type TransactionDependencyReadCollector = (cableId: string, options: EngineOptions,
  retainedVersion: DependencySnapshot['schemaVersion']) => Promise<CollectedDependencies>;

/** Create only inside one read operation holding the project/authority locks.
 * Reuse verified common geometry within that transaction; every cable and both
 * endpoint bindings are still read independently. Never retain this closure
 * across transactions or use it after a write. Refusals stay refusals. */
export function createTransactionDependencyReadCollector(client: PoolClient, projectId: string): TransactionDependencyReadCollector {
  const common = new Map<string, Promise<ReadCommonCollection>>();
  const readCommon: ReadCommon = (options, retainedVersion) => {
    const key = canonicalJson({ projectId, options, retainedVersion });
    if (!common.has(key)) common.set(key, collectProjectionCommon(client, projectId, options, false, undefined, retainedVersion));
    return common.get(key)!;
  };
  return (cableId, options, retainedVersion) => collectWithProjection(client, projectId, cableId, options, false, undefined, retainedVersion, readCommon);
}

/** Route reuse is narrower than matching geometry: only changed S/E/P with every other frozen authority equal. */
export function verifiedDesignOnlyChange(current:DependencySnapshot,previous:DependencySnapshot):boolean {
  if(current.settings.trayCapacity||previous.settings.trayCapacity||current.settings.routingBalance||previous.settings.routingBalance)return false;
  if (current.schemaVersion === 'pathfinder.dependencies.v8' || previous.schemaVersion === 'pathfinder.dependencies.v8') return false;
  if(!['pathfinder.dependencies.v5','pathfinder.dependencies.v6','pathfinder.dependencies.v7'].includes(current.schemaVersion)||current.schemaVersion!==previous.schemaVersion)return false;
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
