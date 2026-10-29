import { describe, expect, it } from 'vitest';
import { canonicalPurposeJson } from './pathfinderPurposePolicy.js';
import { sealedCableItemApplicabilitySchema, sealedCableItemApplicabilityV1Schema, sealedCableItemApplicabilityV2Schema } from './pathfinderItemApplicability.js';

const id = (n: number) => `af600000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const old = { schemaVersion: 'wfc.pf.sealed-cable-applicability.v1' as const, dependencyVersion: 'pathfinder.dependencies.v7' as const,
  projectId: id(1), jobId: id(2), cableId: id(3), proposalId: id(4), dependencyHash: 'a'.repeat(64), scope: 'sealed-cable-item' as const };
const current = { ...old, schemaVersion: 'wfc.pf.sealed-cable-applicability.v2' as const, dependencyVersion: 'pathfinder.dependencies.v8' as const };

describe('separate immutable per-cable applicability versions', () => {
  it('preserves the exact historical v1 body and canonical bytes while reading v2 distinctly', () => {
    expect(sealedCableItemApplicabilityV1Schema.parse(old)).toEqual(old);
    expect(canonicalPurposeJson(sealedCableItemApplicabilitySchema.parse(old))).toBe(canonicalPurposeJson(old));
    expect(sealedCableItemApplicabilityV2Schema.parse(current)).toEqual(current);
    expect(sealedCableItemApplicabilitySchema.parse(current)).toEqual(current);
  });
  it.each([{ ...old, dependencyVersion: 'pathfinder.dependencies.v8' }, { ...current, dependencyVersion: 'pathfinder.dependencies.v7' },
    { ...current, engineeringAccepted: true }, { ...current, scope: 'whole-project' }, { ...current, dependencyHash: 'A'.repeat(64) },
    { ...current, actorId: id(5) }, { ...current, projectId: id(1) + '\n' }])('refuses a mixed version or widened approval %j', value => {
    expect(sealedCableItemApplicabilitySchema.safeParse(value).success).toBe(false);
  });
});
