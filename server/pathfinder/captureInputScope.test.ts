// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { captureInputScopeSchema, snapshotSchema } from './contracts.js';

function scope() {
  return { schemaVersion: 'wfc.capture.input.v1' as const, equipmentNameCount: 1527, chunkCount: 6, inputUtf8Bytes: 85000,
    scopeSha256: 'a'.repeat(64), equipmentNamesSha256: 'b'.repeat(64),
    propertyScan: { indexedObjectCount: 438155, attemptedObjectCount: 438155, returnedObjectCount: 438154, omittedObjectCount: 1, complete: false } };
}
function snapshot() {
  const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return { schemaVersion: 'pathfinder.model.snapshot.v1', model: { projectId: 'project', modelVersionId: 'model', contentSha256: 'c'.repeat(64) },
    capture: { adapterVersion: 'wfc.protected-selected-capture.v1', sourceKind: 'converted', inventoryComplete: false, geometryComplete: false,
      unitsVerified: false, transformsVerified: false, planningVisibilityKnown: false, sourceLinkVerified: false, evidenceSha256: ['a'.repeat(64)], inputScope: scope() },
    coordinates: { vertexFrame: 'canonical-world-metres', sourceUnits: 'metres', metresPerSourceUnit: 1, sourceToWorldMetres: matrix, globalOffsetMetres: [0, 0, 0], displayToWorldMetres: matrix },
    objects: [{ id: 'dbid:1', parentId: null, name: 'Object', geometryRole: 'object', leafToRootNames: ['Object'], properties: [], nativeHidden: null,
      planningExcluded: false, categoryAssignmentSource: 'unassigned', allowedCategories: [], bounds: { minimum: [0, 0, 0], maximum: [1, 1, 1] }, fragments: [] }] };
}
describe('durable selected-capture input provenance', () => {
  it('roundtrips a large requested scope with an honest omitted SDK row', () => {
    const parsed = snapshotSchema.parse(JSON.parse(JSON.stringify(snapshot())));
    expect(parsed.capture.inputScope).toEqual(scope());
    expect(parsed.capture.inputScope?.propertyScan.complete).toBe(false);
    expect(parsed.capture.inventoryComplete).toBe(false);
  });
  it('keeps historical snapshots without a scope descriptor compatible', () => {
    const value: Record<string, unknown> = snapshot(); delete (value.capture as Record<string, unknown>).inputScope;
    expect(snapshotSchema.safeParse(value).success).toBe(true);
  });
  it('accepts no requested equipment with selected-object reads without claiming a full scan', () => {
    const value = scope(); value.equipmentNameCount = 0; value.chunkCount = 0;
    value.propertyScan = { indexedObjectCount: 100, attemptedObjectCount: 3, returnedObjectCount: 3, omittedObjectCount: 0, complete: false };
    expect(captureInputScopeSchema.safeParse(value).success).toBe(true);
  });
  it('reports complete SDK row coverage only with nonempty names and no omitted inventory IDs', () => {
    const value = scope(); value.propertyScan.returnedObjectCount++; value.propertyScan.omittedObjectCount = 0; value.propertyScan.complete = true;
    expect(captureInputScopeSchema.safeParse(value).success).toBe(true);
    value.equipmentNameCount = 0; value.chunkCount = 0;
    expect(captureInputScopeSchema.safeParse(value).success).toBe(false);
  });
  it.each([
    ['overlarge name input', (v: ReturnType<typeof scope>) => { v.equipmentNameCount = 4097; }],
    ['overlarge chunk input', v => { v.chunkCount = 17; }],
    ['insufficient chunks', v => { v.chunkCount = 5; }],
    ['empty chunk contradiction', v => { v.chunkCount = 0; }],
    ['too many chunks for names', v => { v.equipmentNameCount = 1; v.chunkCount = 2; }],
    ['overlarge canonical input', v => { v.inputUtf8Bytes = 1024 * 1024 + 1; }],
    ['bad scope hash', v => { v.scopeSha256 = 'invalid'; }],
    ['bad names hash', v => { v.equipmentNamesSha256 = 'A'.repeat(64); }],
    ['returned beyond attempted', v => { v.propertyScan.returnedObjectCount = v.propertyScan.attemptedObjectCount + 1; }],
    ['attempted beyond inventory', v => { v.propertyScan.attemptedObjectCount++; }],
    ['omission arithmetic mismatch', v => { v.propertyScan.omittedObjectCount = 0; }],
    ['false scan completion', v => { v.propertyScan.complete = true; }],
  ] as [string, (v: ReturnType<typeof scope>) => void][])('refuses %s', (_label, mutate) => {
    const value = scope(); mutate(value); expect(captureInputScopeSchema.safeParse(value).success).toBe(false);
  });
  it('refuses transport-only null scan metadata and unknown proof fields', () => {
    expect(captureInputScopeSchema.safeParse({ ...scope(), propertyScan: null }).success).toBe(false);
    expect(captureInputScopeSchema.safeParse({ ...scope(), nativeParity: true }).success).toBe(false);
  });
  it('does not allow input provenance to change native/completeness/lookup claims', () => {
    for (const flag of ['inventoryComplete', 'geometryComplete', 'unitsVerified', 'transformsVerified', 'planningVisibilityKnown', 'sourceLinkVerified']) {
      const value = snapshot(); Object.assign(value.capture, { [flag]: true }); expect(snapshotSchema.safeParse(value).success).toBe(false);
    }
    expect(snapshotSchema.safeParse({ ...snapshot(), capture: { ...snapshot().capture, lookupRouteCodes: ['/BC001'] } }).success).toBe(false);
    expect(snapshotSchema.safeParse({ ...snapshot(), capture: { ...snapshot().capture, sourceKind: 'native' } }).success).toBe(false);
  });
});
