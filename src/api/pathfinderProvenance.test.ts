import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parsePathFinderProposal } from './pathfinder';
import { ENGINE_IDENTITY_VERSION, ENGINE_IDENTITY_POLICY_VERSIONS, engineIdentityCanonicalBody } from '../../shared/pathfinderEngineIdentity';

function legacy() {
  return { id: '11111111-1111-4111-8111-111111111111', projectId: '22222222-2222-4222-8222-222222222222', jobId: '33333333-3333-4333-8333-333333333333', cableId: '44444444-4444-4444-8444-444444444444',
    status: 'calculated', proposalHash: 'a'.repeat(64), cableWriteRevision: '1', stale: false, synthetic: false, engineeringAccepted: false, acceptanceScope: 'manual-review', canApply: false, compatibilityIssue: null,
    message: 'Recorded result.', engineeringMessage: 'Review required.', design: null, route: null, routingPreferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true }, createdAt: '2026-10-19T00:00:00Z' };
}
function current() {
  const body = { schemaVersion: 'wfc.pf.engine-identity.v1' as const, version: ENGINE_IDENTITY_VERSION, runnerSha256: '1'.repeat(64), modelModuleSha256: '2'.repeat(64), coreModuleSha256: '3'.repeat(64), adapterModuleSha256: '4'.repeat(64), derivationSha256: '5'.repeat(64), policyVersions: { ...ENGINE_IDENTITY_POLICY_VERSIONS } };
  return { ...legacy(), schemaVersion: 'wfc.pf.proposal.v2', calculationMode: 'design', provenance: { dependencyVersion: 'pathfinder.dependencies.v5', dependencyHash: 'b'.repeat(64),
    engineIdentity: { ...body, contentSha256: createHash('sha256').update(engineIdentityCanonicalBody(body)).digest('hex') }, automatic: { generation: '9007199254740993', authorityEpoch: '3', current: false, reasonCode: 'AUTOMATIC_GENERATION_SUPERSEDED' } } };
}
describe('historical-compatible proposal provenance', () => {
  it('retains actual-shaped v2 engine identity and exact automatic generations without granting Apply', () => {
    const input = current(), parsed = parsePathFinderProposal(input);
    expect(parsed.provenance).toEqual(input.provenance); expect(parsed.calculationMode).toBe('design'); expect(parsed.schemaVersion).toBe('wfc.pf.proposal.v2');
    expect(parsed.canApply).toBe(false); expect(parsed.engineeringAccepted).toBe(false);
  });
  it('keeps historical results readable without inventing implementation evidence', () => {
    const parsed = parsePathFinderProposal(legacy()); expect(parsed.provenance).toBeUndefined(); expect(parsed.calculationMode).toBeUndefined();
    const f = current(); expect(parsePathFinderProposal({ ...f, provenance: { ...f.provenance, dependencyVersion: 'pathfinder.dependencies.v4', engineIdentity: null, automatic: null } }).provenance?.engineIdentity).toBeNull();
  });
  it('refuses malformed or incompatible implementation, automatic and calculation mode fields', () => {
    const f = current();
    for (const input of [
      { ...f, calculationMode: 'silently-reuse' },
      { ...f, provenance: { ...f.provenance, engineIdentity: null } },
      { ...f, provenance: { ...f.provenance, engineIdentity: { ...f.provenance.engineIdentity, runnerSha256: 'bad' } } },
      { ...f, provenance: { ...f.provenance, automatic: { ...f.provenance.automatic, generation: '7\n' } } },
      { ...f, provenance: { ...f.provenance, automatic: { ...f.provenance.automatic, loginId: 'not-public' } } },
    ]) expect(() => parsePathFinderProposal(input)).toThrow();
  });
});
