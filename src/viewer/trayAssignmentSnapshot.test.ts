import { describe, expect, it } from 'vitest';
import type { PreparationContext } from '../../shared/pathfinderPreparation';
import { trayAssignmentSnapshot } from './trayAssignmentSnapshot';
const scope = { modelVersionId: 'model', selectionRevision: '2', contentFingerprint: 'a'.repeat(64) };
const context = () => ({ projectId: 'project', scope, trays: [{ projectTrayId: 'tray', rawName: 'B002' }],
  resolutions: [{ projectTrayId: 'tray', mode: 'roots', rootObjectIds: ['dbid:23'], scope }] }) as unknown as PreparationContext;
describe('confirmed source tray assignment display', () => {
  it('uses saved roots and the project tray name', () => {
    expect(trayAssignmentSnapshot(context(), scope)).toEqual([{ name: 'B002', objectIds: [23] }]);
  });
  it('omits exclusions, old model roots, removed trays and saved CAD geometry', () => {
    for (const mutate of [
      (value: PreparationContext) => { value.resolutions[0].mode = 'exclude'; },
      (value: PreparationContext) => { value.resolutions[0].scope = { ...value.resolutions[0].scope, selectionRevision: '1' }; },
      (value: PreparationContext) => { value.trays = []; },
      (value: PreparationContext) => { value.trays[0].geometrySource = 'published-cad-route'; },
    ]) { const value = context(); mutate(value); expect(trayAssignmentSnapshot(value, scope)).toEqual([]); }
    expect(trayAssignmentSnapshot(context(), { ...scope, modelVersionId: 'other' })).toEqual([]);
  });
  it('rejects malformed or oversized snapshots instead of truncating', () => {
    const value = context(); value.resolutions[0].rootObjectIds = ['dbid:23bad'];
    expect(() => trayAssignmentSnapshot(value, scope)).toThrow('Properties display limit');
    value.resolutions[0].rootObjectIds = Array.from({ length: 513 }, (_, index) => 'dbid:' + (index + 1));
    expect(() => trayAssignmentSnapshot(value, scope)).toThrow('Properties display limit');
  });
});
