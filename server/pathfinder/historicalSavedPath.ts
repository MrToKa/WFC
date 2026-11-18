import type { PoolClient } from 'pg';
import type { CableWorkflowRow } from '../../shared/pathfinderCableWorkflow.js';
import { canonicalDecimalString } from '../../shared/pathfinderLengthLedger.js';
import { historicalSavedPathSchema, type HistoricalSavedPath } from '../../shared/pathfinderHistoricalSavedPath.js';
import { createCableWorkflowProofReader } from './cableWorkflowProof.js';
import { readCurrentEndpointBindingContext } from './endpointBindingRepository.js';
import { readEndpointPublicationFrame } from './endpointBindingRequalification.js';
import { PathFinderError } from './errors.js';

/** On-demand, receipt-backed historical geometry. Has no dependency on whether
 * the current From/To are calculable and carries no calculation or write grant. */
export async function readHistoricalSavedPath(client: PoolClient, projectId: string, cable: CableWorkflowRow['cable'],
  check: () => void): Promise<HistoricalSavedPath | null> {
  if (!cable.routing?.trim() || cable.designLength === null) return null;
  const written = await createCableWorkflowProofReader(client, projectId, check).writtenProposal(cable);
  check();
  if (!written) return null;
  const { dependencies, result, raw } = written.verified;
  if (!('preparation' in dependencies) || !result.route?.success || result.route.routeText !== cable.routing || !result.design
    || canonicalDecimalString(result.design.designLengthMeters) !== canonicalDecimalString(cable.designLength)) return null;
  const current = await readCurrentEndpointBindingContext(client, projectId); check();
  if (!current?.traceId || dependencies.model.id !== current.modelVersionId || dependencies.model.contentFingerprint !== current.contentFingerprint) return null;

  const captured = dependencies.preparation;
  try {
    const source = await readEndpointPublicationFrame(client, projectId, captured.aggregateId); check();
    const target = captured.aggregateId === current.aggregateId ? source : await readEndpointPublicationFrame(client, projectId, current.aggregateId); check();
    if (source.aggregate.modelVersionId !== current.modelVersionId || target.aggregate.modelVersionId !== current.modelVersionId
      || source.aggregate.contentFingerprint !== current.contentFingerprint || target.aggregate.contentFingerprint !== current.contentFingerprint
      || source.aggregate.artifactId !== dependencies.artifact.id || source.aggregate.projection.sha256 !== dependencies.artifact.sha256
      || source.aggregate.projection.sha256 !== captured.projectionSha256 || source.aggregate.geometryRevision !== captured.geometryRevision
      || source.aggregate.coordinateFrameId !== captured.captureFrameId || target.aggregate.artifactId !== current.artifactId
      || target.aggregate.projection.sha256 !== current.projectionSha256 || target.aggregate.geometryRevision !== current.geometryRevision
      || target.aggregate.coordinateFrameId !== current.captureFrameId || target.trace.id !== current.traceId
      || source.frameSha256 !== target.frameSha256 || dependencies.schemaVersion === 'pathfinder.dependencies.v8'
        && dependencies.barriers.binding.scope.captureFrameSha256 !== source.frameSha256) return null;
  } catch (error) {
    if (error instanceof PathFinderError && error.code === 'ENDPOINT_REQUALIFICATION_UNAVAILABLE') return null;
    throw error;
  }
  const path = historicalSavedPathSchema.safeParse({ projectId, cableId: cable.id, cableWriteRevision: cable.cableWriteRevision,
    routing: cable.routing, designLength: cable.designLength, proposalId: raw.id, current,
    points: result.route.pathPoints.map(point => [point.x, point.y, point.z]) });
  return path.success ? path.data : null;
}
