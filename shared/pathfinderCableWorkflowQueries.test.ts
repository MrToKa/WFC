// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cableWorkflowQuerySchema, cableWorkflowQueryHashInput, parseCableWorkflowHttpQuery,
  parseCableWorkflowDetailHttpQuery, cableWorkflowDetailQueryHashInput, cableWorkflowRowMatchesSearch } from './pathfinderCableWorkflowQueries.js';

describe('bounded literal cable workflow queries', () => {
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
