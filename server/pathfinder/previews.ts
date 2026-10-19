import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { point, revision, uuid } from './contracts.js';
import { principalTransaction } from './auth.js';
import { PathFinderError } from './errors.js';
import { collectLookupDependencies } from './lookups.js';
import { normalizeLocation } from './matching.js';
import { defaultOptions, type EngineOptions, type EngineResponse, type JobPrincipal, type ProjectSettings } from './jobContracts.js';
import { engineProjectSettings, projectRoutingSettings } from './settings.js';
import { hash } from './dependencies.js';
import { jobDto } from './jobs.js';
import { requirePreparedRoutingScope, type RoutingScope } from './routingScope.js';
import { readCurrentEndpointBindingContext, readEndpointBindingScope } from './endpointBindingRepository.js';
import { endpointCalculationPoint, type EndpointCalculationPoint, type EndpointCalculationPreparation } from './endpointCalculationProvenance.js';
import type { EndpointCurrentScope } from '../../shared/pathfinderEndpointBindings.js';
import { readComparisonDependency } from './revisionComparisonRepository.js';
import type { ComparisonCalculationScope } from './comparisonCalculationProvenance.js';

const name = z.string().trim().max(500).regex(/^[^\u0000-\u001f\u007f-\u009f]*$/u);
export const previewEndpointSchema = z.object({ name, point: point.optional() }).strict().refine(value=>Boolean(value.name || value.point),'Enter an endpoint name or choose an explicit point.');
export const previewSchema = z.object({
  from: previewEndpointSchema, to: previewEndpointSchema, category: z.enum(['MV','LV','Control','Instrumentation']), reverse: z.boolean(),
  artifactId: uuid, expectedSelectionRevision: revision, expectedSettingsRevision: revision, expectedRegistryRevision: revision,
  secondaryDistanceMeters: z.number().finite().min(0).max(1_000_000).optional(), preferVerticalApproach: z.boolean().optional(),
}).strict();
export type PreviewInput = z.infer<typeof previewSchema>;
type Endpoint = {name:string;point:[number,number,number];source:'manual-world-point'|'shared-location'|'equipment-bottom-aabb';objectId:string|null;locationId:string|null;bindingRevision:string|null; binding: EndpointCalculationPoint | null};
export type PreviewDependencies = {
  schemaVersion:'pathfinder.preview.dependencies.v4';comparison:ComparisonCalculationScope;preparation:EndpointCalculationPreparation;routing:RoutingScope;projectId:string;modelVersionId:string;selectionRevision:string;contentFingerprint:string;
  artifactId:string;snapshotSha256:string;registryRevision:string;settings:ProjectSettings;options:EngineOptions;
  input:PreviewInput;from:Endpoint;to:Endpoint;engineVersion:'pathfinder-45c24bf5-pf1-modelrunner-v1';
};
type Row=Record<string,any>;

/** Explicit points are transient. Named endpoints reuse confirmed project aliases or exact prepared model anchors. */
async function resolveEndpoint(client:PoolClient,projectId:string,current:EndpointCurrentScope,input:PreviewInput['from']):Promise<Endpoint> {
  const artifactId = current.artifactId;
  if (input.point) return {name:input.name,point:input.point,source:'manual-world-point',objectId:null,locationId:null,bindingRevision:null,binding:null};
  const aliases=(await client.query<Row>(`SELECT l.id FROM pf_location_aliases a
    JOIN pf_locations l ON l.project_id=a.project_id AND l.id=a.location_id
    WHERE a.project_id=$1 AND a.normalized_alias=$2 FOR SHARE OF l,a`,[projectId,normalizeLocation(input.name)])).rows;
  if (aliases.length) {
    const resolved = aliases.length === 1 ? await readEndpointBindingScope(client, {projectId, locationId: aliases[0].id,
      modelVersionId: current.modelVersionId, aggregateId: current.aggregateId, projectionSha256: current.projectionSha256,
      captureFrameId: current.captureFrameId}) : null;
    if (resolved?.status !== 'confirmed')
      throw new PathFinderError('PREVIEW_LOCATION_STALE',409,`Resolve the shared location ${input.name} for the active model before calculating.`);
    const binding = endpointCalculationPoint(resolved.binding);
    return {name:input.name,point:binding.point,source:'shared-location',objectId:null,locationId:binding.locationId,bindingRevision:binding.bindingRevision,binding};
  }
  const objects=(await client.query<Row>(`SELECT object_id,anchor FROM pf_model_objects WHERE project_id=$1 AND artifact_id=$2
    AND geometry_role='object' AND visibility<>'hidden' AND match_names ? $3 ORDER BY object_id LIMIT 2`,[projectId,artifactId,normalizeLocation(input.name)])).rows;
  if (objects.length!==1) throw new PathFinderError(objects.length ? 'PREVIEW_LOCATION_AMBIGUOUS' : 'PREVIEW_LOCATION_MISSING',409,
    `${objects.length ? 'Multiple prepared objects match' : 'No prepared object matches'} ${input.name}. Choose a model point or save a shared location.`);
  return {name:input.name,point:point.parse(objects[0].anchor),source:'equipment-bottom-aabb',objectId:objects[0].object_id,locationId:null,bindingRevision:null,binding:null};
}

/** The same project lock as normal PF work protects authority and all mutable dependencies until commit. */
export async function collectPreviewDependencies(client:PoolClient,projectId:string,input:PreviewInput):Promise<PreviewDependencies> {
  const requested={...defaultOptions,secondaryDistanceMeters:input.secondaryDistanceMeters ?? defaultOptions.secondaryDistanceMeters,
    preferVerticalApproach:input.preferVerticalApproach ?? defaultOptions.preferVerticalApproach};
  const model=await collectLookupDependencies(client,projectId,{routeText:'',reverse:input.reverse,options:requested,artifactId:input.artifactId,expectedSelectionRevision:input.expectedSelectionRevision,planningOnly:true});
  const routing=await requirePreparedRoutingScope(client,projectId,model.artifactId);
  const bindingContext = await readCurrentEndpointBindingContext(client, projectId);
  if (!bindingContext || bindingContext.modelVersionId !== model.modelVersionId || bindingContext.selectionRevision !== model.selectionRevision ||
    bindingContext.artifactId !== model.artifactId || bindingContext.projectionSha256 !== model.snapshotSha256)
    throw new PathFinderError('ENDPOINT_PREPARATION_REQUIRED',409,'Publish the current project preparation before calculating.');
  const comparison=await readComparisonDependency(client,{projectId,currentAggregateId:bindingContext.aggregateId,currentModelVersionId:bindingContext.modelVersionId});
  if(comparison.readiness==='pending') throw new PathFinderError('REVISION_COMPARISON_PENDING',409,'Complete the requested revision comparison before calculating against this prepared model.');
  const registry=(await client.query<{registry_revision:string}>('SELECT registry_revision::text FROM pf_project_state WHERE project_id=$1 FOR SHARE',[projectId])).rows[0];
  if (!registry || registry.registry_revision!==input.expectedRegistryRevision) throw new PathFinderError('REGISTRY_CONFLICT',409,'The shared location registry changed. Refresh before calculating.');
  const current=await projectRoutingSettings(client,projectId,requested);
  if (current.settings.revision!==input.expectedSettingsRevision) throw new PathFinderError('PROJECT_SETTINGS_CONFLICT',409,'Project Details changed. Refresh before calculating.');
  const from=await resolveEndpoint(client,projectId,bindingContext,input.from);
  const to=await resolveEndpoint(client,projectId,bindingContext,input.to);
  return {schemaVersion:'pathfinder.preview.dependencies.v4',comparison:comparison.scope,preparation:{aggregateId:bindingContext.aggregateId,geometryRevision:bindingContext.geometryRevision,
    captureFrameId:bindingContext.captureFrameId,projectionSha256:bindingContext.projectionSha256},routing,projectId,modelVersionId:model.modelVersionId,selectionRevision:model.selectionRevision,
    contentFingerprint:model.contentFingerprint,artifactId:model.artifactId,snapshotSha256:model.snapshotSha256,registryRevision:registry.registry_revision,
    settings:current.settings,options:current.options,input,from,to,engineVersion:'pathfinder-45c24bf5-pf1-modelrunner-v1'};
}

/** Reverse is performed by the unchanged C# core after calculation, preserving its tie and reversal semantics. */
export function previewEngineRequest(dependencies:PreviewDependencies,requestId:string,timeoutMilliseconds:number) {
  return {schemaVersion:'pathfinder.model.runner.v1',requestId,operation:'calculate',projectId:dependencies.projectId,
    modelVersionId:dependencies.modelVersionId,snapshotId:dependencies.artifactId,snapshotSha256:dependencies.snapshotSha256,timeoutMilliseconds,
    category:dependencies.input.category,from:{x:dependencies.from.point[0],y:dependencies.from.point[1],z:dependencies.from.point[2]},
    to:{x:dependencies.to.point[0],y:dependencies.to.point[1],z:dependencies.to.point[2]},reverse:dependencies.input.reverse,
    options:dependencies.options,projectSettings:engineProjectSettings(dependencies.settings)};
}

export function previewResultDto(response:EngineResponse,dependencies:PreviewDependencies,stale:boolean) {
  const route=response.route;
  return {status:response.status,message:response.message,prepared:response.prepared ?? null,effectiveCategory:response.effectiveCategory ?? null,
    engineeringAccepted:false,acceptanceScope:'standalone-preview',canApply:false,stale,settings:dependencies.settings,
    from:dependencies.input.reverse ? dependencies.to : dependencies.from,to:dependencies.input.reverse ? dependencies.from : dependencies.to,
    design:response.design ?? null,route:route ? {...route,pathPoints:undefined,points:route.pathPoints.map(value=>[value.x,value.y,value.z]),objectIds:[...new Set(route.segmentIds)]} : null};
}

export function createPathFinderPreviews(pool:Pool) {
  return {
    async create(projectId:string,who:JobPrincipal,input:PreviewInput) {
      return principalTransaction(pool,projectId,who,async client=>{
        const dependencies=await collectPreviewDependencies(client,projectId,input),requestHash=hash({kind:'preview',dependencies});
        const existing=(await client.query<Row>(`SELECT id FROM pf_jobs WHERE project_id=$1 AND requested_by=$2 AND login_id=$3 AND request_hash=$4
          AND kind='preview' AND state IN ('queued','running') ORDER BY created_at DESC LIMIT 1`,[projectId,who.userId,who.loginId,requestHash])).rows[0];
        if (existing) return {jobId:existing.id,duplicate:true};
        const jobId=randomUUID();
        await client.query(`INSERT INTO pf_jobs(id,project_id,requested_by,login_id,login_expires_at,state,total,options,timeout_ms,request_hash,kind,diagnostic_input)
          VALUES($1,$2,$3,$4,$5,'queued',1,$6,60000,$7,'preview',$8)`,[jobId,projectId,who.userId,who.loginId,new Date(who.loginExpiresAt),dependencies.options,requestHash,dependencies]);
        return {jobId,duplicate:false};
      });
    },
    async get(projectId:string,who:JobPrincipal,jobId:string) {
      return principalTransaction(pool,projectId,who,async client=>{
        const job=(await client.query<Row>("SELECT * FROM pf_jobs WHERE project_id=$1 AND id=$2 AND kind='preview'",[projectId,jobId])).rows[0];
        if (!job) throw new PathFinderError('PREVIEW_NOT_FOUND',404);
        const stored=(await client.query<Row>('SELECT * FROM pf_lookup_results WHERE project_id=$1 AND job_id=$2',[projectId,jobId])).rows[0];
        const dependencies=job.diagnostic_input as PreviewDependencies;let stale=Boolean(stored?.stale_at_completion);
        if (stored) {try {stale ||= hash(await collectPreviewDependencies(client,projectId,dependencies.input))!==hash(stored.dependencies);} catch {stale=true;}}
        return {...jobDto(job),kind:'preview',input:dependencies.input,result:stored ? previewResultDto(stored.result,dependencies,stale) : null};
      });
    },
  };
}
