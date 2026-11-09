import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { modelLocationMatchCandidateSchema } from '../../shared/pathfinderModelLocationMatch.js';
import { groupModelLocationMatchCandidates } from './modelLocationMatchCandidates.js';

type Candidate = z.infer<typeof modelLocationMatchCandidateSchema>;
const identity = { guid: '7586ffbb-1d0a-5942-b687-06884123c866', sourceFile: '01-50_msr_kabeltassen.dwg' };
const candidate = (objectId: number, patch: Partial<Candidate> = {}): Candidate => ({ objectId, name: 'Physical source item',
  matchedNames: ['15-FT-4018'], bounds: { minimum: [1, 2, 3], maximum: [3, 4, 5] }, bottomCentre: [2, 3, 3], ...patch });

describe('source item endpoint candidate groups', () => {
  it('groups only complete source identities and derives the bottom centre from every member bound', () => {
    const values = [candidate(9, { objectIdentity: identity, bounds: { minimum: [2, 4, 1], maximum: [6, 8, 7] }, bottomCentre: [4, 6, 1] }),
      candidate(3, { objectIdentity: identity }), candidate(5, { objectIdentity: identity,
        bounds: { minimum: [0, 1, 2], maximum: [4, 6, 4] }, bottomCentre: [2, 3.5, 2] })];
    const before = structuredClone(values);
    expect(groupModelLocationMatchCandidates(values, ' 15-ft-4018 ')).toEqual([{ objectId: 3, name: 'Physical source item',
      bounds: { minimum: [0, 1, 1], maximum: [6, 8, 7] }, bottomCentre: [3, 4.5, 1], objectGroup: { ...identity, objectIds: [3, 5, 9] } }]);
    expect(values).toEqual(before);
  });
  it.each(['missing', 'guid', 'source'] as const)('does not merge different or %s source identities', kind => {
    const other = kind === 'missing' ? undefined : { ...identity, ...(kind === 'guid'
      ? { guid: '00000000-0000-4000-8000-000000000999' } : { sourceFile: 'other.dwg' }) };
    expect(groupModelLocationMatchCandidates([candidate(1, { objectIdentity: identity }), candidate(2, { objectIdentity: other })], '15-FT-4018')
      .map(value => value.objectId)).toEqual([1, 2]);
  });
  it('keeps a group unavailable when any matching member lacks bounds', () => {
    expect(groupModelLocationMatchCandidates([candidate(1, { objectIdentity: identity }), candidate(2, { objectIdentity: identity,
      bounds: null, bottomCentre: null })], '15-FT-4018')).toEqual([{ objectId: 1, name: 'Physical source item', bounds: null,
      bottomCentre: null, objectGroup: { ...identity, objectIds: [1, 2] } }]);
  });
  it('does not absorb unsupported root zero or a different requested name into a group', () => {
    expect(groupModelLocationMatchCandidates([candidate(0, { objectIdentity: identity }), candidate(1, { objectIdentity: identity }),
      candidate(2, { objectIdentity: identity, matchedNames: ['Other'] })], '15-FT-4018').map(value => value.objectId)).toEqual([0, 1]);
  });
  it('groups a source item containing the entire bounded raw scan without a per-item parts cap', () => {
    const groups = groupModelLocationMatchCandidates(Array.from({ length: 4096 }, (_, i) => candidate(i + 1, { objectIdentity: identity })), '15-FT-4018');
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ objectId: 1, bounds: { minimum: [1, 2, 3], maximum: [3, 4, 5] }, bottomCentre: [2, 3, 3] });
    expect(groups[0].objectGroup?.objectIds).toEqual(Array.from({ length: 4096 }, (_, i) => i + 1));
  });
});
