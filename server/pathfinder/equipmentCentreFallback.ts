import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { endpointBindingSchema, type EndpointBinding, type EndpointCurrentScope } from '../../shared/pathfinderEndpointBindings.js';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy.js';
import { engineResponseSchema, type DependencySnapshot, type EngineResponse, type JobPrincipal } from './jobContracts.js';
import type { EngineInvocation } from './engineSession.js';
import { hash } from './dependencies.js';
import { appendEquipmentCentreFallbackInTransaction, readCurrentEndpointBindingContext, readEndpointBindingScope } from './endpointBindingRepository.js';
import { readMatchedLocationDisplay } from './modelLocationMatchDisplay.js';
import { requireBarrierWriteEvidence } from './barrierWrites.js';
import { PathFinderError } from './errors.js';

type Side = 'from' | 'to';
export type CentreFallbackCandidate = { side: Side; source: EndpointBinding; current: EndpointCurrentScope };
export type CentreFallbackProbe = { candidates: CentreFallbackCandidate[]; trialRequest: EngineInvocation;
  trialResult: EngineResponse; failedResult: EngineResponse; dependencySha256: string };
const same = (a: unknown, b: unknown) => canonicalPurposeJson(a) === canonicalPurposeJson(b);
export function blockedEquipmentSides(response: EngineResponse): Side[] {
  if (response.status !== 'no_path' || !('barriers' in response) || !response.barriers
    || response.barriers.context.binding.policy.drillThroughWalls || response.barriers.diagnostics.status !== 'blocked'
    || !response.barriers.diagnostics.searchComplete) return [];
  switch (response.barriers.diagnostics.reasonCode) {
    case 'FROM_ENDPOINT_IN_BARRIER': return ['from'];
    case 'TO_ENDPOINT_IN_BARRIER': return ['to'];
    case 'BOTH_ENDPOINTS_IN_BARRIER': return ['from', 'to'];
    default: return [];
  }
}
export function equipmentCentrePoint(source: EndpointBinding): [number, number, number] | null {
  const parsed = endpointBindingSchema.safeParse(source);
  if (!parsed.success || source.status !== 'confirmed' || source.mode !== 'fixed-world'
    || source.derivation !== 'matched-model-bottom-aabb.v1' || !source.autoMatchEvidence || source.centreFallbackEvidence) return null;
  const { contentSha256, ...body } = source;
  if (hash(body) !== contentSha256) return null;
  const bounds = source.autoMatchEvidence.bounds;
  const point = bounds.minimum.map((n, i) => (n + bounds.maximum[i]) / 2) as [number, number, number];
  return same(point, source.pointProjectMetres) ? null : point;
}
/** SELECT only; exact saved head, current scope and original matching command
 * must all verify before a synthetic point can be considered. */
export async function readEquipmentCentreCandidates(client: PoolClient, dependencies: DependencySnapshot,
  sides: Side[], signal: AbortSignal): Promise<CentreFallbackCandidate[]> {
  if (dependencies.schemaVersion !== 'pathfinder.dependencies.v8' || dependencies.barriers.binding.policy.drillThroughWalls) return [];
  const current = await readCurrentEndpointBindingContext(client, dependencies.projectId);
  if (!current) return [];
  const candidates: CentreFallbackCandidate[] = [];
  for (const side of sides) {
    signal.throwIfAborted(); const point = dependencies[side];
    if (!('bindingId' in point)) return [];
    const result = await readEndpointBindingScope(client, { projectId: dependencies.projectId, locationId: point.locationId,
      modelVersionId: dependencies.model.id, aggregateId: dependencies.preparation.aggregateId,
      projectionSha256: dependencies.preparation.projectionSha256, captureFrameId: dependencies.preparation.captureFrameId });
    if (result.status !== 'confirmed') return [];
    const source = result.binding;
    if (source.id !== point.bindingId || source.contentSha256 !== point.bindingContentSha256
      || source.locationRevision !== point.locationRevision || !same(source.pointProjectMetres, point.point) || !equipmentCentrePoint(source)) return [];
    const row = (await client.query<{ name: string }>('/* centre-fallback:location */ SELECT name FROM pf_locations WHERE project_id=$1 AND id=$2 AND revision=$3 FOR SHARE',
      [dependencies.projectId, source.locationId, source.locationRevision])).rows[0];
    if (!row || !await readMatchedLocationDisplay(client, { projectId: dependencies.projectId, current,
      location: { id: source.locationId, name: row.name, aliases: [], revision: source.locationRevision }, head: source }, () => signal.throwIfAborted())) return [];
    candidates.push({ side, source, current });
  }
  return candidates;
}
/** One full native trial, only at definitively blocked automatic endpoints. A
 * successful result remains a probe; it can never be published with old heads. */
export async function probeEquipmentCentreFallback(input: {
  dependencies: DependencySnapshot; failedResult: EngineResponse; candidates: CentreFallbackCandidate[];
  request: (dependencies: DependencySnapshot, requestId: string) => EngineInvocation;
  execute: (request: EngineInvocation, dependencies: DependencySnapshot) => Promise<{ request: EngineInvocation; response: EngineResponse }>;
  validate: (response: EngineResponse, dependencies: DependencySnapshot) => void; signal: AbortSignal;
}): Promise<CentreFallbackProbe | null> {
  const sides = blockedEquipmentSides(input.failedResult), deps = input.dependencies;
  if (deps.schemaVersion !== 'pathfinder.dependencies.v8' || !sides.length || input.candidates.length !== sides.length
    || new Set(input.candidates.map(c => c.side)).size !== sides.length || sides.some(side => !input.candidates.some(c => c.side === side))) return null;
  const trial = structuredClone(deps);
  for (const candidate of input.candidates) {
    const point = equipmentCentrePoint(candidate.source), admitted = deps[candidate.side];
    if (!point || !('bindingId' in admitted) || admitted.bindingId !== candidate.source.id
      || admitted.bindingContentSha256 !== candidate.source.contentSha256 || !same(admitted.point, candidate.source.pointProjectMetres)) return null;
    trial[candidate.side] = { ...trial[candidate.side], point };
  }
  input.signal.throwIfAborted();
  const request = input.request(trial, randomUUID());
  if(request.reverse===true)return null;
  const computed = await input.execute(request, trial);
  if(computed.request.reverse===true)return null;
  input.signal.throwIfAborted();
  const response = engineResponseSchema.parse(computed.response);
  if (response.requestId !== computed.request.requestId || response.status !== 'calculated' || !response.route?.success || !response.design) return null;
  input.validate(response, trial);
  const proof = requireBarrierWriteEvidence(trial, { ...response, calculationMode: 'calculate' });
  if (proof.drillThroughWalls || proof.status !== 'clear') return null;
  return { candidates: input.candidates, trialRequest: computed.request, trialResult: response,
    failedResult: input.failedResult, dependencySha256: hash(deps) };
}
/** Stable for a given old head and admitted failure, even after a lost ACK. */
export function equipmentCentreCommandId(sourceId: string, dependencySha256: string): string {
  const value = createHash('sha256').update(`wfc.pf.endpoint-centre-fallback.v1:${sourceId}:${dependencySha256}`).digest('hex');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-5${value.slice(13, 16)}-a${value.slice(17, 20)}-${value.slice(20, 32)}`;
}
export function equipmentCentreProofRecord(probe: CentreFallbackProbe) {
  const value = JSON.parse(JSON.stringify({ failedResult: probe.failedResult, trialRequest: probe.trialRequest, trialResult: probe.trialResult })) as Record<string,unknown>;
  if (Buffer.byteLength(canonicalPurposeJson(value)) > 900_000) throw new PathFinderError('ENDPOINT_CENTRE_PROOF_LIMIT', 413);
  return value;
}

/** Caller holds exact current input/finite-human-authority fences in the same
 * transaction. Both endpoints append atomically; expiry after writes rolls all
 * of them back, without rechecking the generation dirtied by our own mutation. */
export async function appendEquipmentCentreProbe(client:PoolClient,input:{projectId:string;jobId:string;cableId:string;principal:JobPrincipal;
  probe:CentreFallbackProbe;finiteDeadline:number;signal:AbortSignal}):Promise<void>{
  const check=()=>{input.signal.throwIfAborted();if(!Number.isFinite(input.finiteDeadline)||Date.now()>=input.finiteDeadline)
    throw new PathFinderError('AUTOMATIC_AUTHORITY_EXPIRED',409);};
  check();const {probe}=input,proofRecord=equipmentCentreProofRecord(probe),locations=new Set<string>();
  for(const candidate of probe.candidates){
    if(locations.has(candidate.source.locationId))continue;locations.add(candidate.source.locationId);
    await appendEquipmentCentreFallbackInTransaction(client,input.projectId,input.principal,{source:candidate.source,current:candidate.current,
      evidence:{schemaVersion:'wfc.pf.endpoint-centre-fallback.v1',sourceBindingId:candidate.source.id,sourceBindingSha256:candidate.source.contentSha256,
        current:candidate.current,commandId:equipmentCentreCommandId(candidate.source.id,probe.dependencySha256),actorId:input.principal.userId,
        sourceJobId:input.jobId,sourceCableId:input.cableId,sourceDependencySha256:probe.dependencySha256,side:candidate.side,
        failedRequestId:probe.failedResult.requestId,failedResultSha256:hash(probe.failedResult),trialRequestId:probe.trialResult.requestId,
        trialRequestSha256:hash(probe.trialRequest),trialResultSha256:hash(probe.trialResult),
        barrierProofSha256:hash('barriers' in probe.trialResult?probe.trialResult.barriers?.proof:null),
        policy:'blocked-automatic-bottom-to-same-bounds-centre.v1',approximate:true,engineeringAccepted:false,authority:'machine-derived-under-current-human-job'},proofRecord},input.signal);
    check();
  }
}
/** Retire in the source-append transaction. No old-generation authority check,
 * proposal publication or pause of the newly dirtied automatic schedule. */
export async function retireCentreSupersededJob(client:PoolClient,input:{projectId:string;jobId:string;ownerToken:string}):Promise<void>{
  await client.query(`/* centre-fallback:retire-items */ UPDATE pf_job_items SET state='blocked',status='stale',message='A verified equipment-centre assignment requires fresh calculation admission.'
    WHERE project_id=$1 AND job_id=$2 AND state IN('waiting','running')`,[input.projectId,input.jobId]);
  await client.query(`/* centre-fallback:retire-job */ UPDATE pf_jobs SET state='cancelled',completed=(SELECT count(*) FROM pf_job_items WHERE project_id=$1 AND job_id=$2),
    failure='Superseded by a verified equipment-centre assignment; automatic recalculation continues in the new generation.',
    owner_token=NULL,lease_until=NULL,updated_at=NOW() WHERE project_id=$1 AND id=$2 AND owner_token=$3`,[input.projectId,input.jobId,input.ownerToken]);
}
