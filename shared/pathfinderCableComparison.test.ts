import { describe, expect, it } from 'vitest';
import { cableComparisonInputSchema, compareCableValues, compareOrderedRoutes, type CableComparisonInput } from './pathfinderCableComparison.js';

const id = (value: number) => `91000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
function input(): CableComparisonInput {
  const cable = { id: id(2), tag: 'C-1', fromLocation: 'Panel', toLocation: 'Motor', routing: '/A/B/A/SECONDARY',
    designLength: '9007199254740993.000000', installLength: '123.2500', cableWriteRevision: '9007199254740993' };
  return { projectId: id(1), cableId: id(2), current: { source: 'live-cable-read', contextSha256: 'a'.repeat(64), mto: 'Instrumentation', cable },
    proposal: { projectId: id(1), cableId: id(2), proposalId: id(3), proposalHash: 'b'.repeat(64), revisionResultHash: 'c'.repeat(64),
      cableWriteRevision: cable.cableWriteRevision, routing: '/A/A/B/SECONDARY', designLength: '9007199254740993.000001' },
    admissionBaseline: { admissionId: id(4), baselineHash: 'd'.repeat(64), cable: { ...cable, routing: '/HISTORICAL', designLength: '7', cableWriteRevision: '8' } } };
}
describe('exact current cable and ordered proposal comparison', () => {
  it('uses exact decimal subtraction without turning the admission baseline into the live current values', () => {
    const value = input(), result = compareCableValues(value);
    expect(result.state).toBe('current'); expect(result.length).toEqual({ state: 'changed', deltaMeters: '0.000001' });
    expect(result.input?.current.cable).toEqual(value.current.cable); expect(result.input?.admissionBaseline?.cable.routing).toBe('/HISTORICAL');
    expect(value.current.cable.installLength).toBe('123.2500'); expect(result.initialFill?.mode).toBe('manual-review');
  });
  it.each([[null, null], [' \t\n\u00a0\ufeff', null], ['', null]] as const)('classifies only actual both-empty values as display candidates: %j, %j', (routing, designLength) => {
    const value = input(); value.current.cable = { ...value.current.cable, routing, designLength };
    expect(compareCableValues(value).initialFill).toEqual({ mode: 'initial-fill-candidate', reasonCodes: [] });
  });
  it.each([[null, '0'], [null, ''], ['/EXISTING', null], ['/EXISTING', '0'], [' ', '5']] as const)('retains partial or defined values for manual review: %j, %j', (routing, designLength) => {
    const value = input(); value.current.cable = { ...value.current.cable, routing, designLength };
    expect(compareCableValues(value).initialFill?.mode).toBe('manual-review');
  });
  it.each(['MV', null, 'Unknown'] as const)('does not offer initial-fill eligibility for category %s', mto => {
    const value = input(); value.current = { ...value.current, mto, cable: { ...value.current.cable, routing: null, designLength: null } };
    expect(compareCableValues(value).initialFill?.mode).toBe(mto === 'MV' ? 'excluded' : 'blocked');
  });
  it.each(['', 'NaN', '1e3', ' 3 '])('preserves invalid or legacy decimal %j without inventing a delta or NULL', designLength => {
    const value = input(); value.current.cable.designLength = designLength; const result = compareCableValues(value);
    expect(result.length).toEqual({ state: 'invalid', deltaMeters: null }); expect(result.input?.current.cable.designLength).toBe(designLength);
    expect(result.initialFill?.mode).toBe('manual-review');
  });
  it('distinguishes missing length, unchanged numeric value and signed negative delta', () => {
    const value = input(); value.current.cable.designLength = null; expect(compareCableValues(value).length).toEqual({ state: 'missing', deltaMeters: null });
    value.current.cable.designLength = '7.000'; value.proposal.designLength = '7'; expect(compareCableValues(value).length).toEqual({ state: 'unchanged', deltaMeters: '0' });
    value.proposal.designLength = '3.25'; expect(compareCableValues(value).length?.deltaMeters).toBe('-3.75');
  });
  it('marks a changed live cable revision stale even if the old values look blank', () => {
    const value = input(); value.current.cable = { ...value.current.cable, routing: null, designLength: null, cableWriteRevision: '9007199254740994' };
    expect(compareCableValues(value)).toMatchObject({ state: 'stale', reasonCodes: ['CABLE_WRITE_REVISION_CHANGED'] });
  });
  it('refuses missing values and mismatched project/cable identities without exposing a derived comparison', () => {
    const value = input();
    for (const candidate of [{ ...value, current: undefined }, { ...value, current: { ...value.current, cable: { ...value.current.cable, designLength: undefined } } },
      { ...value, proposal: { ...value.proposal, projectId: id(99) } }, { ...value, proposal: { ...value.proposal, cableId: id(99) } },
      { ...value, admissionBaseline: { ...value.admissionBaseline!, cable: { ...value.current.cable, id: id(99) } } }]) {
      expect(cableComparisonInputSchema.safeParse(candidate).success).toBe(false);
      expect(compareCableValues(candidate)).toMatchObject({ state: 'unavailable', input: null, length: null, initialFill: null });
    }
  });
  it('retains repeated token occurrences and SECONDARY when aligning a reordered route', () => {
    const before = '/A/B/A/SECONDARY', after = '/A/A/B/SECONDARY', result = compareOrderedRoutes(before, after);
    expect(result.before).toBe(before); expect(result.after).toBe(after);
    expect(result.beforeOccurrences.map(value => value.text)).toEqual(['A', 'B', 'A', 'SECONDARY']);
    expect(result.afterOccurrences.map(value => value.text)).toEqual(['A', 'A', 'B', 'SECONDARY']);
    expect(result).toMatchObject({ state: 'changed', added: [], removed: [], reordered: [{ text: 'B', beforeIndex: 1, afterIndex: 2 }] });
  });
  it('keeps added and removed repeated occurrences distinct instead of using sets', () => {
    expect(compareOrderedRoutes('/A/A/SECONDARY', '/A/B/SECONDARY/SECONDARY')).toMatchObject({ state: 'changed',
      removed: [{ text: 'A', index: 1 }], added: [{ text: 'B', index: 1 }, { text: 'SECONDARY', index: 3 }], reordered: [] });
  });
  it('distinguishes exact unchanged, formatting changes, missing routes and case changes', () => {
    expect(compareOrderedRoutes('/A/A', '/A/A').state).toBe('unchanged');
    expect(compareOrderedRoutes(' /A / A ', '/A/A').state).toBe('format-only');
    expect(compareOrderedRoutes(null, '/A').state).toBe('missing');
    expect(compareOrderedRoutes('/a', '/A')).toMatchObject({ state: 'changed', added: [{ text: 'A', index: 0 }], removed: [{ text: 'a', index: 0 }] });
  });
  it('bounds alignment work and retains every raw character for the exact fallback', () => {
    const before = '/A'.repeat(1100), after = '/B'.repeat(1100), result = compareOrderedRoutes(before, after);
    expect(result).toMatchObject({ state: 'not-compared', reason: 'SEQUENCE_WORK_LIMIT', before, after, added: [], removed: [], reordered: [] });
    expect(result.beforeOccurrences).toHaveLength(1100); expect(result.afterOccurrences).toHaveLength(1100);
    expect(compareOrderedRoutes('/A'.repeat(4001), '/B')).toMatchObject({ state: 'not-compared', reason: 'ROUTE_LIMIT' });
  });
  it('is deterministic and does not mutate its caller data', () => {
    const value = input(), copy = structuredClone(value); expect(compareCableValues(value)).toEqual(compareCableValues(value)); expect(value).toEqual(copy);
  });
});
