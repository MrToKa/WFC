import { describe, expect, it } from 'vitest';
import { obstacleReportSchema, type ObstacleReport } from './pathfinderObstacleReport';

const id = (n: number) => `b7000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function report(): ObstacleReport {
  return {
    status: 'complete', crossedParentSelectionIds: [id(1)], blockingParentSelectionIds: [id(2)],
    checkedSegments: 3, totalSegments: 3, reasonCode: 'OBSTACLE_OBSERVATION_COMPLETE',
    selectedParents: [
      { selectionId: id(1), dbId: 18, objectId: 'dbid:18', name: 'Floor slab', kind: 'floor', externalId: 'floor-18',
        identityBasis: 'version-local-only', inclusion: 'own-and-all-descendant-fragments' },
      { selectionId: id(2), dbId: 42, objectId: 'dbid:42', name: 'Wall', kind: 'wall', externalId: null,
        identityBasis: 'version-local-only', inclusion: 'own-and-all-descendant-fragments' },
    ],
  };
}

describe('captured obstacle report contract', () => {
  it('retains complete captured identities for crossings and rejected candidates', () => {
    const value = report();
    expect(obstacleReportSchema.parse(value)).toEqual(value);
  });

  it.each(['crossedParentSelectionIds', 'blockingParentSelectionIds'] as const)(
    'rejects an unknown captured parent in %s', field => {
      expect(obstacleReportSchema.safeParse({ ...report(), [field]: [id(99)] }).success).toBe(false);
    },
  );

  it.each(['dbId', 'selectionId'] as const)('rejects duplicate parent %s', field => {
    const value = report();
    if (field === 'dbId') {
      value.selectedParents[1].dbId = value.selectedParents[0].dbId;
      value.selectedParents[1].objectId = value.selectedParents[0].objectId;
    } else {
      value.selectedParents[1].selectionId = value.selectedParents[0].selectionId;
      value.blockingParentSelectionIds = [value.selectedParents[0].selectionId];
    }
    expect(obstacleReportSchema.safeParse(value).success).toBe(false);
  });

  it.each(['crossedParentSelectionIds', 'blockingParentSelectionIds'] as const)(
    'rejects duplicate observations in %s', field => {
      const value = report(), observed = value[field][0];
      expect(obstacleReportSchema.safeParse({ ...value, [field]: [observed, observed] }).success).toBe(false);
    },
  );

  it('accepts detected crossings with a partial segment check but requires complete checks to close', () => {
    const value = { ...report(), checkedSegments: 1 };
    expect(obstacleReportSchema.safeParse({ ...value, status: 'partial' }).success).toBe(true);
    expect(obstacleReportSchema.safeParse(value).success).toBe(false);
    expect(obstacleReportSchema.safeParse({ ...value, status: 'partial', checkedSegments: 4 }).success).toBe(false);
  });

  it('accepts unavailable observations without claiming checked segments', () => {
    expect(obstacleReportSchema.safeParse({ ...report(), status: 'unavailable', checkedSegments: 0,
      crossedParentSelectionIds: [], blockingParentSelectionIds: [], selectedParents: [] }).success).toBe(true);
  });

  it('rejects undeclared report and captured-parent fields', () => {
    expect(obstacleReportSchema.safeParse({ ...report(), engineeringAccepted: true }).success).toBe(false);
    const value = report();
    expect(obstacleReportSchema.safeParse({ ...value, selectedParents: [
      { ...value.selectedParents[0], displayNumber: 1 }, value.selectedParents[1],
    ] }).success).toBe(false);
  });
});
