// @vitest-environment node
import type { PoolClient } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readHistoricalSavedPath } from './historicalSavedPath.js';
import { PathFinderError } from './errors.js';

const mocks = vi.hoisted(() => ({ written: vi.fn(), current: vi.fn(), frame: vi.fn() }));
vi.mock('./cableWorkflowProof.js', () => ({ createCableWorkflowProofReader: () => ({ writtenProposal: mocks.written }) }));
vi.mock('./endpointBindingRepository.js', () => ({ readCurrentEndpointBindingContext: mocks.current }));
vi.mock('./endpointBindingRequalification.js', () => ({ readEndpointPublicationFrame: mocks.frame }));
const id = (n: number) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
beforeEach(() => vi.resetAllMocks());
function fixture() {
  const cable = { id: id(2), tag: '-WG', fromLocation: 'FROM', toLocation: 'TO', cableWriteRevision: '4',
    routing: '/BC903/BC027-2', designLength: '18.00', installLength: null };
  const modelVersionId = id(3), contentFingerprint = 'a'.repeat(64), originalProjection = 'b'.repeat(64), currentProjection = 'c'.repeat(64);
  const source = { aggregate: { modelVersionId, contentFingerprint, artifactId: id(5), coordinateFrameId: id(6), geometryRevision: '1', projection: { sha256: originalProjection } },
    trace: { id: id(7) }, frameSha256: 'd'.repeat(64) };
  const target = { aggregate: { modelVersionId, contentFingerprint, artifactId: id(9), coordinateFrameId: id(10), geometryRevision: '2', projection: { sha256: currentProjection } },
    trace: { id: id(11) }, frameSha256: source.frameSha256 };
  const current = { modelVersionId, contentFingerprint, selectionRevision: '3', aggregateId: id(8), artifactId: target.aggregate.artifactId,
    captureFrameId: target.aggregate.coordinateFrameId, geometryRevision: '2', projectionSha256: currentProjection, traceId: target.trace.id };
  const dependencies = { schemaVersion: 'pathfinder.dependencies.v8', model: { id: modelVersionId, contentFingerprint },
    preparation: { aggregateId: id(4), captureFrameId: source.aggregate.coordinateFrameId, geometryRevision: '1', projectionSha256: originalProjection },
    artifact: { id: source.aggregate.artifactId, sha256: originalProjection }, barriers: { binding: { scope: { captureFrameSha256: source.frameSha256 } } } };
  const route = { success: true, routeText: cable.routing, segmentIds: ['dbid:44', 'cad:' + id(20), 'dbid:75', 'dbid:44'],
    pathPoints: [{ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 }, { x: 7, y: 8, z: 9 }] };
  mocks.written.mockResolvedValue({ verified: { dependencies, result: { route, design: { designLengthMeters: '18' } }, raw: { id: id(12) } } });
  mocks.current.mockResolvedValue(current);
  mocks.frame.mockImplementation(async (_client, _projectId, aggregateId) => aggregateId === id(4) ? source : target);
  const read = () => readHistoricalSavedPath({} as PoolClient, id(1), cable, () => {});
  return { cable, dependencies, route, current, target, source, read };
}
describe('historical geometry of the current saved cable write', () => {
  it('returns the original polyline including both terminal legs in a matching republished frame', async () => {
    const f = fixture();
    expect(await f.read()).toEqual({ projectId: id(1), cableId: id(2), cableWriteRevision: '4', routing: f.cable.routing,
      designLength: '18.00', proposalId: id(12), current: f.current, objectIds: ['dbid:44', 'cad:' + id(20), 'dbid:75'],
      points: [[1,2,3],[4,5,6],[7,8,9]] });
  });
  it('retains every recorded foreground identity without truncating or replacing it from current preparation', async () => {
    const f = fixture();
    f.route.segmentIds = Array.from({ length: 1000 }, (_, index) => 'dbid:' + (index + 1));
    const path = await f.read();
    expect(path?.objectIds).toEqual(f.route.segmentIds);
    expect(path?.points).toEqual([[1,2,3],[4,5,6],[7,8,9]]);
  });
  it.each(['too many', 'oversized identity'] as const)('declines %s foreground without returning a partial line', async kind => {
    const f = fixture();
    f.route.segmentIds = kind === 'too many'
      ? Array.from({ length: 200001 }, (_, index) => 'dbid:' + (index + 1)) : ['x'.repeat(257)];
    expect(await f.read()).toBeNull();
  });
  it.each(['missing receipt','other model','changed fingerprint','changed transform','wrong recorded frame','wrong artifact',
    'changed route','changed length','invalid point','no frame'] as const)('declines %s without returning a partial path', async kind => {
    const f = fixture();
    if (kind === 'missing receipt') mocks.written.mockResolvedValue(null);
    if (kind === 'other model') f.current.modelVersionId = id(99);
    if (kind === 'changed fingerprint') f.current.contentFingerprint = 'f'.repeat(64);
    if (kind === 'changed transform') f.target.frameSha256 = 'f'.repeat(64);
    if (kind === 'wrong recorded frame') f.dependencies.barriers.binding.scope.captureFrameSha256 = 'f'.repeat(64);
    if (kind === 'wrong artifact') f.current.artifactId = id(98);
    if (kind === 'changed route') f.cable.routing = '/OTHER';
    if (kind === 'changed length') f.cable.designLength = '20';
    if (kind === 'invalid point') f.route.pathPoints[1].x = Infinity;
    if (kind === 'no frame') mocks.frame.mockRejectedValue(new PathFinderError('ENDPOINT_REQUALIFICATION_UNAVAILABLE', 409));
    expect(await f.read()).toBeNull();
  });
});
