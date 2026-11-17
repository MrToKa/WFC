// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { obstacleReportSchema } from '../../shared/pathfinderObstacleReport.js';
import { clearRouteObstacleRemarks, exactObstacleRemarksTransition, routeObstacleRemarks } from './obstacleRemarks.js';
import { automaticPairCapacityClearTransition } from './capacityClearWrite.js';
import { continuesAutomaticSnapshot } from './automaticPairSnapshot.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const obstacleParent = (dbId = 123) => ({ selectionId: id(dbId), dbId, objectId: `dbid:${dbId}`, externalId: null, name: 'Wall',
  kind: 'wall' as const, identityBasis: 'version-local-only' as const, inclusion: 'own-and-all-descendant-fragments' as const });
const result = (status: 'complete' | 'partial' | 'unavailable' = 'complete', crossed = [id(123)]) => ({ status: 'calculated', route: { success: true },
  barriers: { obstacleReport: { status, crossedParentSelectionIds: crossed, blockingParentSelectionIds: [], checkedSegments: status === 'complete' ? 2 : 0,
    totalSegments: 2, reasonCode: 'ROUTE_OBSTACLE_REPORT', selectedParents: [obstacleParent()] } } });

describe('exact saved-route obstacle Remarks', () => {
  it('preserves user text, numbers crossed obstacles and updates without duplicate managed lines', () => {
    const original = 'User instruction\r\nKeep slack.\n';
    const once = routeObstacleRemarks(original, result());
    expect(once).toBe(`${original}\n[PathFinder obstacles] Crosses obstacles: #123.`);
    expect(routeObstacleRemarks(once, result())).toBe(once);
    expect(routeObstacleRemarks(once, result('complete', []))).toBe(original);
  });
  it('preserves a marker mentioned inside a user sentence', () => {
    const original = 'My note mentions [PathFinder obstacles] this is manual text.';
    expect(routeObstacleRemarks(original, result())).toContain(original);
  });
  it('removes an old managed line between CRLF user notes without leaving an orphan carriage return', () => {
    const original = 'User\r\n[PathFinder obstacles] Crosses obstacles: #1.\r\nNext';
    expect(routeObstacleRemarks(original, result('complete', []))).toBe('User\r\nNext');
    const updated = routeObstacleRemarks(original, result());
    expect(routeObstacleRemarks(updated, result())).toBe(updated);
  });
  it.each(['partial', 'unavailable'] as const)('never claims an empty %s report establishes no crossing', status => {
    expect(routeObstacleRemarks(null, result(status, []))).toContain('Crossing check incomplete');
  });
  it('leaves remarks unchanged for a historical calculation or a failed unsaved route', () => {
    expect(routeObstacleRemarks('Keep', {})).toBe('Keep');
    expect(routeObstacleRemarks('Keep', { ...result(), status: 'no_path' })).toBe('Keep');
  });
  it('requires exactly the generated Remarks transition', () => {
    const before = { remarks: 'Keep' }, after = { remarks: routeObstacleRemarks('Keep', result()) };
    expect(exactObstacleRemarksTransition(before, after, result())).toBe(true);
    expect(exactObstacleRemarksTransition(before, { remarks: 'Unexpected replacement' }, result())).toBe(false);
    expect(exactObstacleRemarksTransition(before, after)).toBe(false);
  });
  it('withdraws stale crossing notes when an automatic route is cleared and preserves manual notes', () => {
    const before = { id: id(1), project_id: id(2), cable_write_revision: '1', routing: '/A', design_length: '5', install_length: null,
      remarks: routeObstacleRemarks('User instruction', result()) };
    const after = { ...before, cable_write_revision: '2', routing: null, design_length: null, remarks: clearRouteObstacleRemarks(before.remarks) };
    expect(after.remarks).toBe('User instruction');
    expect(automaticPairCapacityClearTransition(id(2), id(1), before, after)).toBe(true);
    expect(automaticPairCapacityClearTransition(id(2), id(1), before, { ...after, remarks: before.remarks })).toBe(false);
    expect(automaticPairCapacityClearTransition(id(2), id(1), before, { ...after, remarks: 'Other' })).toBe(false);
  });
  it('preserves old automatic receipt lineage across the nullable Remarks migration without ignoring actual note changes', () => {
    const previous = { routing: '/A', design_length: '5' }, time = new Date().toISOString();
    expect(continuesAutomaticSnapshot(previous, { ...previous, remarks: null }, time)).toBe(true);
    expect(continuesAutomaticSnapshot(previous, { ...previous, remarks: 'Manual edit' }, time)).toBe(false);
    expect(continuesAutomaticSnapshot({ ...previous, remarks: 'Manual edit' }, { ...previous, remarks: null }, time)).toBe(false);
  });
  it('refuses overflow without dropping user notes or silently truncating obstacle numbers', () => {
    expect(() => routeObstacleRemarks('x'.repeat(32767), result())).toThrow(/exceed/);
  });
  it('rejects missing original parent identities and false complete segment counts', () => {
    const report = result().barriers.obstacleReport;
    expect(obstacleReportSchema.safeParse({ ...report, selectedParents: [] }).success).toBe(false);
    expect(obstacleReportSchema.safeParse({ ...report, checkedSegments: 1 }).success).toBe(false);
  });
});
