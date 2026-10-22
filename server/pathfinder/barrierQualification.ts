import { BARRIER_LIMITS, barrierCanonicalJson, barrierCaptureSchema, type BarrierCapture } from '../../shared/pathfinderBarriers.js';
import { MIXED_BARRIER_COLLISION_VERSION, MIXED_BARRIER_POLICY, MIXED_BARRIER_RUNTIME_PROFILE, MIXED_BARRIER_VERIFIER_VERSION,
  mixedBarrierSnapshotSchema, mixedBarrierSnapshotHashInput, mixedBarrierVerifierEvidenceSchema,
  type MixedBarrierSnapshot, type MixedBarrierVerifierEvidence } from '../../shared/pathfinderBarrierMixed.js';
import { barrierBytesHash, encodeBarrierJson } from './barrierStorage.js';
import { PathFinderError } from './errors.js';

const same = (left: unknown, right: unknown) => barrierCanonicalJson(left) === barrierCanonicalJson(right);
const digest = (value: unknown) => barrierBytesHash(Buffer.from(barrierCanonicalJson(value)));
const fail = (): never => { throw new PathFinderError('BARRIER_QUALIFICATION_BINDING_INVALID', 409,
  'The qualified original barrier evidence does not match its retained publication. Calculate from the current verified set.'); };

/** Integrity expectation, not geometric qualification. The protected caller MUST
 * first authenticate the immutable manifest/capture bytes and current scope.
 * This function cannot make caller-supplied/rehashed manifests authoritative.
 * It performs no collision, topology, SDK, frame or engineering acceptance. */
export function deriveMixedBarrierQualification(rawManifest: MixedBarrierSnapshot, rawCapture: BarrierCapture | null,
  drillThroughWalls: boolean): MixedBarrierVerifierEvidence | null {
  if (typeof drillThroughWalls !== 'boolean') return fail();
  const manifest = mixedBarrierSnapshotSchema.safeParse(rawManifest);
  if (!manifest.success || digest(mixedBarrierSnapshotHashInput(manifest.data)) !== manifest.data.contentSha256) return fail();
  const value = manifest.data;
  if (value.geometry.mode === 'explicit-empty') {
    if (rawCapture !== null) return fail();
    return null;
  }
  if (drillThroughWalls) return null;
  const capture = barrierCaptureSchema.safeParse(rawCapture);
  if (!capture.success || !value.capture || capture.data.captureId !== value.capture.captureId
    || !same(capture.data.scope, value.scope) || !same(capture.data.selectedParents, value.selectedParents)
    || capture.data.observation.state !== 'reported-complete'
    || capture.data.fragments.length !== value.geometry.fragments.length) return fail();
  const byFragment = new Map(capture.data.fragments.map(fragment => [fragment.source.fragmentId, fragment]));
  for (const fragment of value.geometry.fragments) {
    const source = byFragment.get(fragment.source.fragmentId);
    if (!source || !same(source.source, fragment.source) || !same(source.bounds, fragment.bounds)
      || source.verticesMetres.length !== fragment.vertices || source.triangleIndices.length / 3 !== fragment.triangles) return fail();
    const mesh = encodeBarrierJson({ verticesMetres: source.verticesMetres, triangleIndices: source.triangleIndices }, BARRIER_LIMITS.meshBlobBytes);
    if (mesh.length !== fragment.mesh.bytes || barrierBytesHash(mesh) !== fragment.mesh.sha256) return fail();
  }
  // Match the independently pinned C# producer's magnitude initial value and
  // exact binary64 product order. ALL original vertices count, including unused.
  let magnitude = 1, vertexCount = 0, triangleCount = 0;
  for (const fragment of capture.data.fragments) {
    vertexCount += fragment.verticesMetres.length; triangleCount += fragment.triangleIndices.length / 3;
    for (const point of fragment.verticesMetres) magnitude = Math.max(magnitude, Math.abs(point[0]), Math.abs(point[1]), Math.abs(point[2]));
  }
  const numericToleranceMetres = Math.max(MIXED_BARRIER_RUNTIME_PROFILE.qualification.numericToleranceMetres, 64 * Number.EPSILON * magnitude);
  const bits = new DataView(new ArrayBuffer(8)); bits.setFloat64(0, numericToleranceMetres, true);
  // The pure receipt domain is distinct from the protected publication's
  // verificationSha256. Never compare or overwrite those different digests.
  const verificationSha256 = barrierBytesHash(Buffer.from(MIXED_BARRIER_VERIFIER_VERSION + '\n' + MIXED_BARRIER_POLICY + '\n'
    + MIXED_BARRIER_COLLISION_VERSION + '\n' + value.capture.payloadSha256 + '\n' + value.geometry.verification.originalGeometrySha256
    + '\n' + bits.getBigInt64(0, true).toString(), 'utf8'));
  const members = value.geometry.verification.componentMemberships;
  return mixedBarrierVerifierEvidenceSchema.parse({ captureId: capture.data.captureId, scope: value.scope,
    originalSurfaceComponents: members.filter(member => member.kind === 'original-surface').length,
    qualifiedClosedSolidComponents: members.filter(member => member.kind === 'qualified-closed-solid').length,
    fragmentCount: capture.data.fragments.length, vertexCount, triangleCount,
    originalGeometrySha256: value.geometry.verification.originalGeometrySha256, verificationSha256, numericToleranceMetres,
    componentMemberships: members, inputSchemaVersion: 'wfc.pf.barrier-capture.v1', policyVersion: MIXED_BARRIER_POLICY,
    coverage: 'provided-fragments-only', geometryProvenance: 'capture-bound-provided-original-triangles', sdkCoverageVerified: false,
    sdkSourceBytesVerified: false, currentFrameVerified: false, engineeringAccepted: false, ownTerminalExemptionsSupported: false, authority: 'none' });
}
