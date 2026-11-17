import { describe, expect, it } from 'vitest';
import { createObstacleNavigation, parseObstacleNavigation } from './pathFinderObstacleNavigation';
import type { BarrierModelScope } from '../../../shared/pathfinderBarriers';

const id = (n: number) => `bc700000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope: BarrierModelScope = { projectId: id(1), modelVersionId: id(2), contentFingerprint: 'a'.repeat(64), selectionRevision: '3',
  captureFrameId: id(3), captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' };
describe('scoped obstacle navigation', () => {
  it('carries the recorded scope and a fresh request identity on every click', () => {
    const first = createObstacleNavigation(scope, 18), second = createObstacleNavigation(scope, 18);
    expect(first.to).toBe(`/projects/${scope.projectId}?tab=pathfinder`);
    expect(parseObstacleNavigation(first.state, scope.projectId)).toEqual({ ...scope, dbId: 18, requestId: first.state.pathfinderObstacle.requestId });
    expect(first.state.pathfinderObstacle.requestId).not.toBe(second.state.pathfinderObstacle.requestId);
  });
  it.each([0, -1, 1.2, 2147483648, NaN])('refuses invalid object number %s', value => {
    expect(() => createObstacleNavigation(scope, value)).toThrow();
  });
  it('refuses another project, missing scope, and extra payload keys', () => {
    const target = createObstacleNavigation(scope, 18);
    expect(parseObstacleNavigation(target.state, id(99))).toBeNull();
    expect(parseObstacleNavigation({ pathfinderObstacle: { dbId: 18 } }, scope.projectId)).toBeNull();
    expect(parseObstacleNavigation({ pathfinderObstacle: { ...target.state.pathfinderObstacle, trusted: true } }, scope.projectId)).toBeNull();
    expect(parseObstacleNavigation({ ...target.state, extra: true }, scope.projectId)).toBeNull();
  });
});
