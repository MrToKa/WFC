import type { PathFinderPreview, PathFinderProposal, PathFinderState } from '@/api/pathfinder';
import { fetchEndpointBinding } from '@/api/pathfinderEndpointBindings';
import { fetchGeometryObjectRevision } from '@/api/pathfinderGeometryTrace';
import { fetchCableEndpointContext, type CableEndpointContext } from '@/api/pathfinderCableEndpoints';
import { canonicalPurposeJson } from '../../../shared/pathfinderPurposePolicy';
import { cableEndpointConfirmedDisplaySelectionSchema } from '../../../shared/pathfinderCableEndpoints';

export const ENDPOINT_VISIBILITY_DEADLINE_MS = 10_000;
/** Live, already verified popup reads. This carries no Save or review authority. */
export type PathFinderEndpointForegroundContexts = {
  projectId: string; accountId: string; token: string; cableId: string;
  modelVersionId: string; selectionRevision: string; contentFingerprint: string; preparationKey: string;
  from: CableEndpointContext; to: CableEndpointContext;
};
type DisplayDependencies = NonNullable<PathFinderProposal['dependencies']>;
type PreparedDependencies = Exclude<DisplayDependencies, { schemaVersion: 'pathfinder.dependencies.v2' }>;
type BoundEndpoint = Exclude<PreparedDependencies['from'], { kind: string }>;
const dbId = (value: string): number | null => {
  if (!/^dbid:[1-9][0-9]*(?![\s\S])/.test(value)) return null;
  const id = Number(value.slice(5)); return Number.isInteger(id) && id <= 2147483647 ? id : null;
};
const samePoint = (left: readonly number[], right: readonly number[]) => left.length === 3 && right.length === 3 && left.every((value, index) => value === right[index]);
const uniqueIds = (values: readonly string[]) => [...new Set(values.filter(value => dbId(value) !== null))];

/** The existing protected bridge retains its exact 512-object budget. Never truncate a route to add equipment. */
export function computedPathObjectIds(routeIds: readonly string[], endpointIds: readonly string[]): number[] | null {
  const ids = uniqueIds([...routeIds, ...endpointIds]); return ids.length > 512 ? null : ids.map(value => dbId(value)!);
}

function legacyEndpointObjectId(state: PathFinderState, locationId: string, bindingRevision: string, point: readonly number[]): string | null {
  const matches = state.locations.filter(value => value.id === locationId), binding = matches.length === 1 ? matches[0].binding : null;
  return binding && binding.status === 'confirmed' && binding.modelVersionId === state.activeModel.modelVersionId
    && binding.revision === bindingRevision && samePoint(binding.point, point) && binding.objectId && dbId(binding.objectId) !== null ? binding.objectId : null;
}

/** Preview results already carry resolved version-local object IDs. Explicit coordinates do not imply an object. */
export function previewEndpointObjectIds(preview: PathFinderPreview, state: PathFinderState): string[] {
  const artifact = state.artifacts[0];
  if (preview.projectId !== state.projectId || preview.status !== 'complete' || !preview.result || preview.result.stale
    || !state.activeModel.modelVersionId || preview.input.expectedSelectionRevision !== state.activeModel.selectionRevision
    || !artifact || artifact.id !== preview.input.artifactId || artifact.modelVersionId !== state.activeModel.modelVersionId) return [];
  return uniqueIds([preview.result.from, preview.result.to].flatMap(endpoint => {
    if (endpoint.source === 'equipment-bottom-aabb') return endpoint.objectId ? [endpoint.objectId] : [];
    if (endpoint.source !== 'shared-location' || !endpoint.locationId || endpoint.bindingRevision === null) return [];
    const found = legacyEndpointObjectId(state, endpoint.locationId, endpoint.bindingRevision, endpoint.point); return found ? [found] : [];
  }));
}

async function digest(value: unknown): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalPurposeJson(value))))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function currentDisplayScope(proposal: PathFinderProposal, state: PathFinderState, access: { projectId: string; token: string }) {
  const evidence = proposal.dependencies, active = state.activeModel, artifact = state.artifacts[0];
  return Boolean(evidence && access.token && proposal.projectId === state.projectId && access.projectId === state.projectId
    && evidence.projectId === state.projectId && active.modelVersionId && evidence.model.id === active.modelVersionId
    && evidence.model.selectionRevision === active.selectionRevision && evidence.model.contentFingerprint === active.contentFingerprint
    && artifact && artifact.id === evidence.artifact.id && artifact.modelVersionId === active.modelVersionId
    && artifact.snapshotSha256 === evidence.artifact.sha256);
}

/** The same exact binding predicate serves HTTP reads and verified popup reads. */
function fixedWorldDisplayObjectId(proposal: PathFinderProposal, state: PathFinderState, evidence: PreparedDependencies,
  end: 'from' | 'to', endpoint: BoundEndpoint, context: CableEndpointContext): string | null {
  const active = state.activeModel, artifact = state.artifacts[0], preparation = evidence.preparation;
  const head = context.head, current = context.current, display = cableEndpointConfirmedDisplaySelectionSchema.safeParse(context.confirmedDisplaySelection);
  if (!context.canBind || context.projectId !== state.projectId || context.cableId !== proposal.cableId || context.end !== end
    || context.location?.id !== endpoint.locationId || context.location.revision !== endpoint.locationRevision
    || !current || current.modelVersionId !== active.modelVersionId || current.selectionRevision !== active.selectionRevision
    || current.contentFingerprint !== active.contentFingerprint || current.artifactId !== artifact.id
    || current.aggregateId !== preparation.aggregateId || current.captureFrameId !== preparation.captureFrameId
    || current.projectionSha256 !== preparation.projectionSha256
    || !head || head.id !== endpoint.bindingId || head.contentSha256 !== endpoint.bindingContentSha256
    || head.bindingRevision !== endpoint.bindingRevision || head.locationRevision !== endpoint.locationRevision
    || head.projectId !== state.projectId || head.locationId !== endpoint.locationId || head.status !== 'confirmed'
    || head.mode !== 'fixed-world' || head.sourceObject !== null || head.attachment !== null
    || head.modelVersionId !== active.modelVersionId || head.artifactId !== artifact.id || head.aggregateId !== preparation.aggregateId
    || head.captureFrameId !== preparation.captureFrameId || head.projectionSha256 !== preparation.projectionSha256
    || head.qualifiedProjectFrameId !== endpoint.qualifiedProjectFrameId || head.sourceDecisionId !== endpoint.migrationDecisionId
    || !samePoint(head.pointProjectMetres, endpoint.point) || !display.success
    || display.data.bindingId !== head.id || display.data.bindingContentSha256 !== head.contentSha256
    || canonicalPurposeJson(display.data.current) !== canonicalPurposeJson(current)
    || !samePoint(display.data.pointProjectMetres, endpoint.point)) return null;
  return `dbid:${display.data.sdkObjectId}`;
}

/** Reuse only exact fixed-world display identities; other bindings keep their geometry reader. */
export function proposalEndpointObjectIdsFromContexts(proposal: PathFinderProposal, state: PathFinderState,
  access: { projectId: string; token: string }, contexts: Pick<PathFinderEndpointForegroundContexts, 'from' | 'to'>): string[] {
  const evidence = proposal.dependencies;
  if (!currentDisplayScope(proposal, state, access) || !evidence || evidence.schemaVersion === 'pathfinder.dependencies.v2'
    || evidence.preparation.projectionSha256 !== evidence.artifact.sha256) return [];
  return uniqueIds((['from', 'to'] as const).flatMap(end => {
    const endpoint = evidence[end];
    if ('kind' in endpoint || endpoint.mode !== 'fixed-world' || endpoint.sourceObjectRevisionId !== null
      || endpoint.aggregateId !== evidence.preparation.aggregateId || endpoint.captureFrameId !== evidence.preparation.captureFrameId
      || endpoint.projectionSha256 !== evidence.preparation.projectionSha256) return [];
    const objectId = fixedWorldDisplayObjectId(proposal, state, evidence, end, endpoint, contexts[end]);
    return objectId ? [objectId] : [];
  }));
}

/** Resolve display foreground only. This never changes endpoints, calculations or approval. */
export async function proposalEndpointObjectIds(proposal: PathFinderProposal, state: PathFinderState,
  access: { projectId: string; token: string }, signal?: AbortSignal,
  contexts?: Pick<PathFinderEndpointForegroundContexts, 'from' | 'to'> | null): Promise<string[]> {
  signal?.throwIfAborted();
  const evidence = proposal.dependencies, active = state.activeModel, artifact = state.artifacts[0];
  // Cable-list writes can stale a proposal while its version-local endpoint
  // objects remain unchanged. Display uses the exact model/binding evidence
  // below; proposal staleness still controls Review/Apply separately.
  if (!evidence || !currentDisplayScope(proposal, state, access)) return [];
  if (evidence.schemaVersion === 'pathfinder.dependencies.v2') return uniqueIds([evidence.from, evidence.to].flatMap(endpoint => {
    const found = legacyEndpointObjectId(state, endpoint.locationId, endpoint.bindingRevision, endpoint.point); return found ? [found] : [];
  }));
  const preparation = evidence.preparation;
  if (preparation.projectionSha256 !== evidence.artifact.sha256) return [];
  const controller = new AbortController(), stop = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', stop, { once: true });
  const deadline = setTimeout(() => controller.abort(new DOMException('Endpoint display lookup timed out.', 'TimeoutError')), ENDPOINT_VISIBILITY_DEADLINE_MS);
  try {
    let failure: { error: unknown } | null = null;
    // From and To carry independent immutable evidence. Resolve both under the
    // same total deadline; a refusal aborts its peer and is never treated as an
    // absent endpoint or a successful route-only foreground.
    const reads = await Promise.allSettled((['from', 'to'] as const).map(async end => {
      const endpoint = evidence[end];
      try {
        signal?.throwIfAborted(); controller.signal.throwIfAborted();
        if (endpoint.aggregateId !== preparation.aggregateId || endpoint.captureFrameId !== preparation.captureFrameId
          || endpoint.projectionSha256 !== preparation.projectionSha256) return null;
        if ('kind' in endpoint) {
          if (endpoint.modelVersionId === active.modelVersionId && endpoint.artifactId === artifact.id && dbId(endpoint.sourceObjectId) !== null)
            return endpoint.sourceObjectId;
          return null;
        }
        // A successful explicit Assign may retain a version-local DISPLAY hint in
        // its command ledger, while its computational binding remains fixed-world.
        if (endpoint.mode === 'fixed-world' && endpoint.sourceObjectRevisionId === null && !controller.signal.aborted) {
          try {
            const knownObjectId = contexts && fixedWorldDisplayObjectId(proposal, state, evidence, end, endpoint, contexts[end]);
            if (knownObjectId) return knownObjectId;
            const context = await fetchCableEndpointContext(access.projectId, access.token, proposal.cableId, end, controller.signal);
            controller.signal.throwIfAborted(); signal?.throwIfAborted();
            return fixedWorldDisplayObjectId(proposal, state, evidence, end, endpoint, context);
          } catch (error) {
            signal?.throwIfAborted();
            // An unavailable read is not evidence that this endpoint has no
            // object. Let Show retain the existing view and offer a retry.
            throw error;
          }
        }
        // Manual coordinates alone never imply an equipment identity.
        if (!endpoint.sourceObjectRevisionId || controller.signal.aborted) return null;
        try {
          const context = await fetchEndpointBinding(access.projectId, access.token, endpoint.locationId, controller.signal);
          controller.signal.throwIfAborted(); signal?.throwIfAborted();
          const head = context.head, current = context.current;
          if (!context.readiness.calculationReady || context.projectId !== state.projectId || context.locationId !== endpoint.locationId
            || !current || current.modelVersionId !== active.modelVersionId || current.selectionRevision !== active.selectionRevision
            || current.contentFingerprint !== active.contentFingerprint || current.artifactId !== artifact.id
            || current.aggregateId !== preparation.aggregateId || current.captureFrameId !== preparation.captureFrameId
            || current.projectionSha256 !== preparation.projectionSha256
            || !head || head.id !== endpoint.bindingId || head.contentSha256 !== endpoint.bindingContentSha256
            || head.bindingRevision !== endpoint.bindingRevision || head.locationRevision !== endpoint.locationRevision
            || head.projectId !== state.projectId || head.locationId !== endpoint.locationId || head.status !== 'confirmed'
            || head.mode !== endpoint.mode || head.modelVersionId !== active.modelVersionId || head.artifactId !== artifact.id
            || head.aggregateId !== preparation.aggregateId || head.captureFrameId !== preparation.captureFrameId
            || head.projectionSha256 !== preparation.projectionSha256 || !samePoint(head.pointProjectMetres, endpoint.point)
            || head.qualifiedProjectFrameId !== endpoint.qualifiedProjectFrameId || head.sourceDecisionId !== endpoint.migrationDecisionId
            || !head.sourceObject || head.sourceObject.objectRevisionId !== endpoint.sourceObjectRevisionId
            || current.traceId !== null && head.sourceObject.traceId !== current.traceId) return null;
          const object = await fetchGeometryObjectRevision(access.projectId, access.token, head.sourceObject.traceId, head.sourceObject.objectRevisionId, controller.signal);
          controller.signal.throwIfAborted(); signal?.throwIfAborted();
          if (object.projectId !== state.projectId || object.modelVersionId !== active.modelVersionId || object.id !== head.sourceObject.objectRevisionId
            || object.traceId !== head.sourceObject.traceId || object.aggregateId !== preparation.aggregateId
            || object.coordinates.captureFrameId !== preparation.captureFrameId || object.provenance.projectionSha256 !== preparation.projectionSha256
            || object.provenance.contentFingerprint !== active.contentFingerprint || await digest(object) !== head.sourceObject.recordSha256) return null;
          controller.signal.throwIfAborted(); signal?.throwIfAborted();
          const id = dbId(object.identity.objectId);
          if (id !== null && (object.identity.dbId === null || object.identity.dbId === id)) return object.identity.objectId;
        } catch (error) {
          signal?.throwIfAborted();
          throw error;
        }
        return null;
      } catch (error) {
        failure ??= { error }; controller.abort(error); throw error;
      }
    }));
    signal?.throwIfAborted();
    if (failure) throw (failure as { error: unknown }).error;
    controller.signal.throwIfAborted();
    return uniqueIds(reads.flatMap(read => read.status === 'fulfilled' && read.value !== null ? [read.value] : []));
  } finally { clearTimeout(deadline); signal?.removeEventListener('abort', stop); }
}
