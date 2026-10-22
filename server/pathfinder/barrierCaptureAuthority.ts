import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { barrierCanonicalJson, type BarrierModelScope } from '../../shared/pathfinderBarriers.js';
import { barrierEnumerationHashInput, barrierFrameObservationHashInput, validateBarrierFrameObservation,
  type BarrierFrameObservation } from '../../viewer-runtime/barrier-capture.mjs';
import { barrierFrameProjectionHash, currentBarrierScope } from './barrierScope.js';
import { BarrierCaptureQualificationRefusal, type BarrierRegistryAdapters } from './barrierRegistryRepository.js';
import type { JobPrincipal } from './jobContracts.js';
import { PathFinderError } from './errors.js';
import { BarrierGeometryRefusal, runBarrierVerifier } from './barrierVerifier.js';

const hash = (value: unknown) => createHash('sha256').update(barrierCanonicalJson(value)).digest('hex');
const fail = (code: string): never => { throw new PathFinderError(code, 409, 'The protected barrier capture or its current model frame could not be confirmed.'); };
export type BarrierViewerContext = Readonly<{ sessionId: string; cookieSecret: string; who: JobPrincipal; frame: BarrierFrameObservation }>;

/** Same live human login, current model/load and HttpOnly viewer cookie. The
 * returned runtime observation is admin authoring input, not an independent
 * server-side re-enumeration of the converted SDK model. */
async function lockViewer(client: PoolClient, projectId: string, scope: BarrierModelScope, context: BarrierViewerContext): Promise<number> {
  const frame = context.frame;
  if (!validateBarrierFrameObservation(frame) || hash(barrierFrameObservationHashInput(frame)) !== frame.contentSha256
    || frame.projectId !== projectId || frame.modelVersionId !== scope.modelVersionId || frame.contentFingerprint !== scope.contentFingerprint
    || barrierFrameProjectionHash({ coordinateFrame: frame.coordinateFrame, displayToWorldMetres: frame.displayToWorldMetres,
      globalOffsetMetres: frame.globalOffsetMetres }) !== scope.captureFrameSha256) return fail('BARRIER_CAPTURE_FRAME_CHANGED');
  const secretHash = createHash('sha256').update(context.cookieSecret).digest('hex');
  const rows = (await client.query<{ expires_at: Date; absolute_expires_at: Date; selection_revision: number; revoked_at: Date | null }>(`/* barrier:viewer-context */
    SELECT expires_at,absolute_expires_at,selection_revision,revoked_at FROM viewer_resource_sessions
    WHERE id=$1 AND project_id=$2 AND model_version_id=$3 AND user_id=$4 AND login_id=$5 AND load_id=$6 AND secret_hash=$7
    FOR SHARE`, [context.sessionId, projectId, scope.modelVersionId, context.who.userId, context.who.loginId, frame.loadId, secretHash])).rows;
  const deadline = rows.length === 1 ? Math.min(new Date(rows[0].expires_at).getTime(), new Date(rows[0].absolute_expires_at).getTime(), context.who.loginExpiresAt) : NaN;
  if (rows.length !== 1 || rows[0].revoked_at || String(rows[0].selection_revision) !== scope.selectionRevision
    || !Number.isFinite(deadline) || deadline <= Date.now())
    return fail('BARRIER_CAPTURE_VIEWER_CHANGED');
  return deadline;
}

export function barrierCaptureAdapters(context?: BarrierViewerContext,
  execute: typeof runBarrierVerifier = runBarrierVerifier): BarrierRegistryAdapters {
  // Detach the bounded observation before the first await; caller mutation cannot
  // change the frame against which a later publication transaction is fenced.
  const frozen = context ? { ...context, who: { ...context.who }, frame: JSON.parse(JSON.stringify(context.frame)) as BarrierFrameObservation } : undefined;
  let viewerDeadline = 0;
  return {
    publicationFrameSha256() {
      if (!frozen || !validateBarrierFrameObservation(frozen.frame)
        || hash(barrierFrameObservationHashInput(frozen.frame)) !== frozen.frame.contentSha256) return fail('BARRIER_PROTECTED_CAPTURE_REQUIRED');
      return frozen.frame.contentSha256;
    },
    assertBeforeCommit() { if (frozen && (!Number.isFinite(viewerDeadline) || Date.now() >= viewerDeadline)) fail('BARRIER_CAPTURE_VIEWER_EXPIRED'); },
    async currentScope(client, projectId) {
      const scope = await currentBarrierScope(client, projectId);
      if (frozen) viewerDeadline = await lockViewer(client, projectId, scope, frozen);
      return scope;
    },
    async qualifyCapture(input, signal) {
      signal.throwIfAborted(); if (!frozen) return fail('BARRIER_PROTECTED_CAPTURE_REQUIRED');
      if (input.intent.createdBy !== frozen.who.userId || input.intent.loginId !== frozen.who.loginId) return fail('BARRIER_CAPTURE_PRINCIPAL_CHANGED');
      const capture = input.capture;
      if (capture.captureId !== input.intent.id || capture.observation.state !== 'reported-complete'
        || capture.observation.verification !== 'unverified' || capture.observation.unavailableFragmentIds.length !== 0
        || hash(barrierEnumerationHashInput(capture)) !== capture.observation.enumerationSha256
        || capture.fragments.some(fragment => hash(fragment.source.sourceToWorldMetres) !== fragment.source.transformSha256))
        return fail('BARRIER_CAPTURE_CLOSURE_INVALID');
      let executed: Awaited<ReturnType<typeof execute>>;
      try { executed = await execute(input.captureBytes, signal); }
      catch (error) {
        signal.throwIfAborted();
        if (error instanceof BarrierGeometryRefusal && error.captureSha256 === input.captureSha256)
          throw new BarrierCaptureQualificationRefusal(error.captureSha256, hash(barrierFrameObservationHashInput(frozen.frame)), error.implementationSha256);
        throw error;
      }
      signal.throwIfAborted(); const { result, implementationSha256 } = executed;
      const evidence = result.evidence;
      if (result.status !== 'geometry-qualified' || result.captureSha256 !== input.captureSha256 || !evidence
        || evidence.captureId !== capture.captureId || barrierCanonicalJson(evidence.scope) !== barrierCanonicalJson(capture.scope)
        || evidence.fragmentCount !== capture.fragments.length || evidence.vertexCount !== capture.fragments.reduce((sum, item) => sum + item.verticesMetres.length, 0)
        || evidence.triangleCount !== capture.fragments.reduce((sum, item) => sum + item.triangleIndices.length / 3, 0)
        || evidence.sdkCoverageVerified !== false) return fail('BARRIER_VERIFIER_CAPTURE_MISMATCH');
      return { producerVersion: 'wfc.pf.barrier-verifier.v1', computationalMeshes: evidence.computationalMeshes,
        verificationSha256: hash({ geometryVerificationSha256: evidence.verificationSha256, implementationSha256,
          frameObservation: frozen.frame, captureSha256: input.captureSha256, enumerationSha256: capture.observation.enumerationSha256,
          authority: 'current-admin-protected-runtime-observation', independentSdkReenumeration: false }) };
    },
  };
}
