// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cableWorkflowQuerySchema, cableWorkflowQueryHashInput, parseCableWorkflowHttpQuery,
  parseCableWorkflowDetailHttpQuery, cableWorkflowDetailQueryHashInput, cableWorkflowRowMatchesSearch } from './pathfinderCableWorkflowQueries.js';
import { canonicalPurposeJson } from './pathfinderPurposePolicy.js';

const id = (n: number) => `bb600000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const barrierIntent = (drillThroughWalls = false) => {
  const scope = { projectId: id(1), modelVersionId: id(2), contentFingerprint: 'a'.repeat(64), selectionRevision: '3', captureFrameId: id(3), captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' as const };
  return { schemaVersion: 'wfc.pf.barrier-admission-intent.v1' as const, scope, expectedRegistryRevision: '4', expectedSnapshot: { snapshotId: id(4), scope, registryRevision: '4', contentSha256: 'c'.repeat(64), mode: 'explicit-empty' as const }, drillThroughWalls };
};

describe('bounded literal cable workflow queries', () => {
  it.each([false, true])('retains complete explicit barrier choice in native/HTTP list and detail query hashes (drill=%s)', drill => {
    const intent = barrierIntent(drill), wire = { barrierRouting: canonicalPurposeJson(intent) };
    const list = parseCableWorkflowHttpQuery(wire), detail = parseCableWorkflowDetailHttpQuery(wire);
    expect(list.barrierRouting).toEqual(intent); expect(detail.barrierRouting).toEqual(intent);
    expect(cableWorkflowQueryHashInput(list)).toEqual(cableWorkflowQueryHashInput(cableWorkflowQuerySchema.parse({ barrierRouting: intent })));
    expect(cableWorkflowQueryHashInput(list)).not.toEqual(cableWorkflowQueryHashInput(cableWorkflowQuerySchema.parse({})));
    expect(cableWorkflowDetailQueryHashInput(detail)).toHaveProperty('barrierRouting', intent);
  });
  it('binds changed scope, revision, snapshot and drilling rather than dropping the added query field', () => {
    const intent = barrierIntent(), original = cableWorkflowQueryHashInput(cableWorkflowQuerySchema.parse({ barrierRouting: intent }));
    const scope = { ...intent.scope, captureFrameSha256: 'd'.repeat(64) };
    const altered = [{ ...intent, drillThroughWalls: true }, { ...intent, scope, expectedSnapshot: { ...intent.expectedSnapshot, scope } },
      { ...intent, expectedRegistryRevision: '5', expectedSnapshot: { ...intent.expectedSnapshot, registryRevision: '5' } },
      { ...intent, expectedSnapshot: { ...intent.expectedSnapshot, contentSha256: 'e'.repeat(64) } }];
    for (const barrierRouting of altered) expect(cableWorkflowQueryHashInput(cableWorkflowQuerySchema.parse({ barrierRouting }))).not.toEqual(original);
  });
  it('refuses malformed/duplicated/oversized JSON intent and query arrays as schema errors', () => {
    const intent = barrierIntent(), json = JSON.stringify(intent);
    for (const barrierRouting of [json.replace('{', '{"schemaVersion":"duplicated",'), json.replace('"drillThroughWalls":false', '"drillThroughWalls":false,"drillThroughW\\u0061lls":false'),
      JSON.stringify({ ...intent, extra: true }), JSON.stringify({ ...intent, drillThroughWalls: undefined }), 'null', '[' + json + ']', '{', ' '.repeat(8193), [json], intent]) {
      for (const parse of [parseCableWorkflowHttpQuery, parseCableWorkflowDetailHttpQuery]) {
        try { parse({ barrierRouting }); expect.unreachable(); }
        catch (error) { expect(error).toHaveProperty('name', 'ZodError'); }
      }
    }
  });
  it('normalizes search only and shares exact defaults between HTTP and native clients', () => {
    expect(parseCableWorkflowHttpQuery({})).toEqual({ filter: 'needs-routing', search: '', limit: 100, secondaryDistanceMeters: 2, preferVerticalApproach: true });
    expect(parseCableWorkflowHttpQuery({ search: '  cafe\u0301_%\\  ', limit: '1', secondaryDistanceMeters: '2.5', preferVerticalApproach: 'false' }))
      .toEqual({ filter: 'needs-routing', search: 'café_%\\', limit: 1, secondaryDistanceMeters: 2.5, preferVerticalApproach: false });
  });
  it.each([{ limit: '0' }, { limit: '101' }, { limit: '01' }, { limit: 1 }, { limit: ['1'] },
    { secondaryDistanceMeters: 'Infinity' }, { secondaryDistanceMeters: '1e6' }, { secondaryDistanceMeters: '-1' },
    { secondaryDistanceMeters: '1000001' }, { preferVerticalApproach: '1' }, { search: 'x'.repeat(257) },
    { search: '\ud800' }, { search: 'x\n' }, { filter: 'excluded' }, { cursor: 'a=' }, { actorId: 'caller' }])('refuses malformed/extra query fields %j', value => {
    expect(() => parseCableWorkflowHttpQuery(value)).toThrow();
  });
  it('binds every normalized query input while keeping the cursor outside its hash', () => {
    const query = cableWorkflowQuerySchema.parse({}), input = cableWorkflowQueryHashInput(query);
    expect(cableWorkflowQueryHashInput({ ...query, cursor: 'YWJj' })).toEqual(input);
    for (const patch of [{ filter: 'all' as const }, { search: '%' }, { limit: 99 }, { secondaryDistanceMeters: 3 }, { preferVerticalApproach: false }])
      expect(cableWorkflowQueryHashInput({ ...query, ...patch })).not.toEqual(input);
    expect(cableWorkflowDetailQueryHashInput(parseCableWorkflowDetailHttpQuery({}))).toEqual({ schemaVersion: 'wfc.pf.cable-workflow-detail-query.v1', secondaryDistanceMeters: 2, preferVerticalApproach: true });
    expect(() => parseCableWorkflowDetailHttpQuery({ search: 'not a detail input' })).toThrow();
  });
  it('matches NFC and literal wildcard-looking text across each actual cable field', () => {
    const value = { cable: { tag: 'cafe\u0301_%\\', fromLocation: 'FROM-ONE', toLocation: 'TO-TWO' } };
    expect(cableWorkflowRowMatchesSearch(value, '  CAFÉ_%\\ ')).toBe(true);
    expect(cableWorkflowRowMatchesSearch(value, 'from-one')).toBe(true);
    expect(cableWorkflowRowMatchesSearch(value, 'to-two')).toBe(true);
    expect(cableWorkflowRowMatchesSearch(value, 'CAFÉ.*')).toBe(false);
    expect(cableWorkflowRowMatchesSearch({ cable: { tag: null, fromLocation: null, toLocation: null } }, '%')).toBe(false);
  });
});
