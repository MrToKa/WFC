import type { PoolClient } from 'pg';
import type { CableEndpointContext } from '../../shared/pathfinderCableEndpoints.js';
import type { EndpointBinding, EndpointCurrentScope } from '../../shared/pathfinderEndpointBindings.js';
import { cableEndpointDisplayMatchesSourceGroup } from '../../shared/pathfinderCableEndpoints.js';
import { readCableEndpointDisplay } from './cableEndpointDisplay.js';
import { readEndpointPublicationFrame } from './endpointBindingRequalification.js';
import { endpointBindingHash } from './endpointBindingRepository.js';
import { PathFinderError } from './errors.js';

type Input = { projectId: string; head: EndpointBinding; location: NonNullable<CableEndpointContext['location']>; current: EndpointCurrentScope };
type Display = { sdkObjectId: number; sdkObjectIds?: number[]; name?: string };

/** A previous preparation of the identical model may supply a display object
 * before Calculate requalifies the fixed point. This read never replaces the head. */
export async function readReopenedFixedEndpointDisplay(client: PoolClient, input: Input, check: () => void): Promise<Display | null> {
  const { projectId, head, current, location } = input;
  const { contentSha256, ...body } = head;
  const matchedScope = head.centreFallbackEvidence?.current ?? head.autoMatchEvidence?.current;
  const previousSelection = head.sameModelReuse ? head.sameModelReuse.targetTraceId !== current.traceId
    : matchedScope && (matchedScope.selectionRevision !== current.selectionRevision || matchedScope.traceId !== current.traceId);
  if (head.projectId !== projectId || head.locationId !== location.id || head.locationRevision !== location.revision
    || head.status !== 'confirmed' || head.mode !== 'fixed-world' || head.sourceObject || head.attachment || head.sourceDecisionId
    || head.modelVersionId !== current.modelVersionId || (head.aggregateId === current.aggregateId && !previousSelection) || !current.traceId
    || endpointBindingHash(body) !== contentSha256) return null;

  // Both publications must attest to the actual transform and global offset.
  // Equal SDK numbers or an equal frame identifier alone cannot establish this.
  check();
  try {
    const sourceTraceId = head.sameModelReuse?.targetTraceId ?? matchedScope?.traceId ?? null;
    const source = await readEndpointPublicationFrame(client, projectId, head.aggregateId, sourceTraceId);
    check();
    const target = head.aggregateId === current.aggregateId && source.trace.id === current.traceId ? source
      : await readEndpointPublicationFrame(client, projectId, current.aggregateId, current.traceId);
    check();
    if (source.aggregate.modelVersionId !== current.modelVersionId || target.aggregate.modelVersionId !== current.modelVersionId
      || source.aggregate.contentFingerprint !== current.contentFingerprint || target.aggregate.contentFingerprint !== current.contentFingerprint
      || source.aggregate.artifactId !== head.artifactId || source.aggregate.coordinateFrameId !== head.captureFrameId
      || source.aggregate.projection.sha256 !== head.projectionSha256 || target.aggregate.artifactId !== current.artifactId
      || target.aggregate.coordinateFrameId !== current.captureFrameId || target.aggregate.projection.sha256 !== current.projectionSha256
      || target.aggregate.geometryRevision !== current.geometryRevision || target.trace.id !== current.traceId
      || source.frameSha256 !== target.frameSha256) return null;
    if (head.sameModelReuse && (head.sameModelReuse.targetTraceId !== source.trace.id
      || head.sameModelReuse.targetTraceContentSha256 !== source.trace.contentSha256
      || head.sameModelReuse.frameProjectionSha256 !== source.frameSha256
      || head.sameModelReuse.contentFingerprint !== current.contentFingerprint)) return null;

    const sourceScope: EndpointCurrentScope = { modelVersionId: head.modelVersionId, contentFingerprint: source.aggregate.contentFingerprint,
      aggregateId: head.aggregateId, artifactId: head.artifactId, captureFrameId: head.captureFrameId,
      geometryRevision: source.aggregate.geometryRevision, projectionSha256: head.projectionSha256, traceId: source.trace.id,
      selectionRevision: matchedScope?.selectionRevision ?? source.aggregate.selectionRevision };
    const saved = await readCableEndpointDisplay(client, { ...input, current: sourceScope }, check);
    check();
    if (!saved || saved.bindingId !== head.id || saved.bindingContentSha256 !== head.contentSha256
      || !saved.pointProjectMetres.every((value, axis) => value === head.pointProjectMetres[axis])
      || !cableEndpointDisplayMatchesSourceGroup(saved, head)) return null;
    return { sdkObjectId: saved.sdkObjectId, ...(saved.sdkObjectIds && {sdkObjectIds: saved.sdkObjectIds}),
      ...(saved.name && {name: saved.name}) };
  } catch (error) {
    if (error instanceof PathFinderError && error.code === 'ENDPOINT_REQUALIFICATION_UNAVAILABLE') return null;
    throw error;
  }
}
