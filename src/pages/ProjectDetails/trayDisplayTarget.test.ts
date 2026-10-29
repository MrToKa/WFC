// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { PreparationDiscovery, PreparationScope } from '../../../shared/pathfinderPreparation';
import { preparationFixture } from '@/test/preparationFixtures';
import { trayDisplayTarget } from './trayDisplayTarget';

function fixture() {
  const { context, session } = preparationFixture(), trayId = context.trays[0].projectTrayId;
  const discovery: PreparationDiscovery = {
    schemaVersion: 'wfc.pf.discovery-report.v1', modelVersionId: context.scope.modelVersionId,
    contentFingerprint: context.scope.contentFingerprint, selectionRevision: context.scope.selectionRevision,
    matchingPolicyVersion: 'wfc.pf.project-exact-candidates.v1', complete: true, propertyScan: null,
    objects: [], trays: [{ projectTrayId: trayId, candidateRootObjectIds: ['dbid:72'] }], endpointCandidates: [],
  };
  const assignment = (roots = ['dbid:55'], scope: PreparationScope = context.scope) => ({
    id: 'manual-assignment', projectTrayId: trayId, mode: 'roots' as const, rootObjectIds: roots,
    reason: 'Physical model assignment', actorId: 'admin', createdAt: '2026-10-27T00:00:00Z', scope: { ...scope },
  });
  return { trayId, context, plan: session.plan, discovery, assignment };
}

describe('tray display targets', () => {
  it('prefers a multi-root draft, preserves order and leaves every input unchanged', () => {
    const input = fixture();
    input.context.resolutions = [input.assignment()];
    const draftRoots = ['dbid:58', 'dbid:55'];
    const before = JSON.stringify({ ...input, draftRoots });
    expect(trayDisplayTarget({ ...input, draftRoots })).toEqual({ objectIds: [58, 55], source: 'draft', message: null });
    expect(JSON.stringify({ ...input, draftRoots })).toBe(before);
  });
  it('retains an explicitly empty draft instead of falling back to saved or automatic objects', () => {
    const input = fixture(); input.context.resolutions = [input.assignment()];
    expect(trayDisplayTarget({ ...input, draftRoots: [] })).toMatchObject({ objectIds: [], source: 'draft', message: expect.stringContaining('draft has no model objects') });
  });
  it('prefers an assignment to frozen plan roots and automatic candidates', () => {
    const input = fixture(); input.context.resolutions = [input.assignment()];
    expect(trayDisplayTarget(input)).toEqual({ objectIds: [55], source: 'assignment', message: null });
  });
  it('allows inspecting A120 assigned to the same model after policy and catalog changes', () => {
    const input = fixture(); input.context.trays[0].rawName = 'A120';
    input.context.resolutions = [input.assignment(['dbid:426517'])];
    input.context.scope = { ...input.context.scope, catalogRevision: '331', routingContentSha256: 'd'.repeat(64),
      routingPolicyRevision: '2', routingPolicySha256: 'e'.repeat(64), resolutionRevision: '9', locationRegistryRevision: '12' };
    expect(trayDisplayTarget(input)).toEqual({ objectIds: [426517], source: 'assignment', message: null });
  });
  it.each(['modelVersionId', 'contentFingerprint', 'selectionRevision'] as const)('ignores saved assignments from another %s', key => {
    const input = fixture();
    input.context.resolutions = [input.assignment(['dbid:426517'], { ...input.context.scope, [key]: 'other' })];
    expect(trayDisplayTarget({ ...input, plan: null, discovery: null })).toMatchObject({ objectIds: [], source: null });
  });
  it('uses same-model frozen plan roots before automatic candidates', () => {
    const input = fixture(); input.plan.requestedScope.trays[0].orderedRootObjectIds = ['dbid:81', 'dbid:82'];
    expect(trayDisplayTarget(input)).toEqual({ objectIds: [81, 82], source: 'plan', message: null });
  });
  it.each(['projectId', 'modelVersionId', 'contentFingerprint', 'selectionRevision'] as const)('ignores frozen roots from another %s', key => {
    const input = fixture();
    const plan = { ...input.plan, [key]: 'other' };
    expect(trayDisplayTarget({ ...input, plan })).toEqual({ objectIds: [72], source: 'candidate', message: null });
  });
  it('shows every ambiguous candidate instead of silently choosing the first', () => {
    const input = fixture(); input.discovery.trays[0].candidateRootObjectIds = ['dbid:91', 'dbid:92', 'dbid:93'];
    expect(trayDisplayTarget({ ...input, plan: null })).toEqual({ objectIds: [91, 92, 93], source: 'candidate', message: null });
  });
  it.each(['modelVersionId', 'contentFingerprint', 'selectionRevision'] as const)('ignores candidates from another %s', key => {
    const input = fixture();
    expect(trayDisplayTarget({ ...input, plan: null, discovery: { ...input.discovery, [key]: 'other' } }))
      .toMatchObject({ objectIds: [], source: null, message: expect.stringContaining('current model') });
  });
  it('permits displaying an excluded tray using its known model objects', () => {
    const input = fixture(); input.context.trays[0].policyState = 'excluded';
    input.context.resolutions = [{ ...input.assignment([]), mode: 'exclude' }];
    expect(trayDisplayTarget({ ...input, plan: null })).toEqual({ objectIds: [72], source: 'candidate', message: null });
  });
  it('does not display a deleted or foreign tray even when a draft supplies model IDs', () => {
    const input = fixture();
    expect(trayDisplayTarget({ ...input, trayId: 'other', draftRoots: ['dbid:55'] }))
      .toMatchObject({ objectIds: [], source: null, message: expect.stringContaining('current project') });
  });
  it('reports when no source identifies a model object', () => {
    const input = fixture(); input.discovery.trays[0].candidateRootObjectIds = [];
    expect(trayDisplayTarget({ ...input, plan: null })).toMatchObject({ objectIds: [], source: null, message: expect.stringContaining('Discover candidates') });
  });
  it.each(['dbid:0', 'dbid:01', 'dbid:-1', 'dbid:2147483648', 'dbid:1.5', 'dbid:1e3', 'dbid:2 ', ' dbid:2', 'dbid:2\n', 'dbid:2\r\n', 'dbid:2\u2028', 'dbid:2\u2029', '2'])
    ('rejects the complete target if any identifier is invalid: %s', invalid => {
      const input = fixture();
      expect(trayDisplayTarget({ ...input, draftRoots: ['dbid:55', invalid] }))
        .toMatchObject({ objectIds: [], source: 'draft', message: expect.stringContaining('invalid model object identifiers') });
    });
  it('rejects duplicate IDs and does not fall back after an invalid higher-priority target', () => {
    const input = fixture(); input.context.resolutions = [input.assignment(['dbid:55', 'dbid:55'])];
    expect(trayDisplayTarget(input)).toMatchObject({ objectIds: [], source: 'assignment', message: expect.stringContaining('invalid') });
  });
  it('accepts 512 valid roots and the largest supported ID, and refuses 513 without truncating', () => {
    const input = fixture(), roots = Array.from({ length: 512 }, (_, index) => `dbid:${index + 1}`);
    roots[511] = 'dbid:2147483647';
    expect(trayDisplayTarget({ ...input, draftRoots: roots }).objectIds).toHaveLength(512);
    expect(trayDisplayTarget({ ...input, draftRoots: [...roots, 'dbid:513'] }))
      .toMatchObject({ objectIds: [], source: 'draft', message: expect.stringContaining('more than 512') });
  });
});
