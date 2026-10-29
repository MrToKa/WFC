// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { buildPreparationPlan, equalPreparationScope, preparationDigest } from './preparationPlans.js';
import { preparationContextSchema, preparationCreateSchema, preparationPlanSchema, preparationPlanHashInput, type PreparationContext, type PreparationCreate } from '../../shared/pathfinderPreparation.js';
import { LEGACY_PREPARATION_CAPACITY_PROFILE, LARGE_PREPARATION_CAPACITY_PROFILE, type PreparationCapacityProfile } from '../../shared/pathfinderCapacity.js';
import { collectPreparationDiscovery } from '../../shared/collectPreparationDiscovery.js';
import { PREPARATION_MATCHING_POLICY } from '../../viewer-runtime/preparation-input.mjs';

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const object = (n: number, parent: number | null, name: string, geometry = false) => ({ objectId: 'dbid:' + n, parentId: parent === null ? null : 'dbid:' + parent, name, hasGeometry: geometry, isPhysicalLeaf: geometry, orderIndex: n });
export function preparationFixture() {
  const context: PreparationContext = preparationContextSchema.parse({ schemaVersion: 'wfc.pf.preparation-context.v1', projectId: id(1), scope: { modelVersionId: id(2), contentFingerprint: 'a'.repeat(64), selectionRevision: '1', catalogRevision: '2', routingContentSha256: 'b'.repeat(64), routingPolicyRevision: '3', routingPolicySha256: 'c'.repeat(64), locationRegistryRevision: '4', resolutionRevision: '0' }, trays: [{ projectTrayId: id(10), rawName: '/B001', purposeKey: 'LV', routeName: '/B001', allowedCategories: ['LV'], policyState: 'configured', diagnosticCodes: [] }], endpointNames: [], resolutions: [], diagnostics: [], currentAggregate: null });
  const input: PreparationCreate = preparationCreateSchema.parse({ schemaVersion: 'wfc.pf.preparation-create.v1', expected: context.scope, idempotencyKey: id(3), discovery: { schemaVersion: 'wfc.pf.discovery-report.v1', modelVersionId: id(2), contentFingerprint: 'a'.repeat(64), selectionRevision: '1', matchingPolicyVersion: 'wfc.pf.project-exact-candidates.v1', complete: true, propertyScan: null, objects: [object(1, null, 'Plant'), object(2, 1, '/B001'), object(3, 2, 'Part')], trays: [{ projectTrayId: id(10), candidateRootObjectIds: ['dbid:2'] }], endpointCandidates: [] } });
  input.discovery.objects[2].hasGeometry = true; input.discovery.objects[2].isPhysicalLeaf = true;
  return { context, input };
}
describe('server-owned routing preparation plan', () => {
  it('explicit tray-only discovery freezes complete tray coverage without claiming endpoint discovery', async () => {
    const { context, input } = preparationFixture(); context.endpointNames = ['Equipment'];
    const visibilityScope = { schemaVersion: 'wfc.pf.sdk-display-visibility.v1' as const, basis: 'sdk-display-before-pf-appearance' as const, contentSha256: 'd'.repeat(64) };
    const discover = vi.fn(async (request: Parameters<Parameters<typeof collectPreparationDiscovery>[1]['discover']>[0]) => {
      if (request.mode !== 'names' && request.mode !== 'subtree') throw Error('Unexpected endpoint search in tray-only discovery');
      const source = request.mode === 'names' ? [input.discovery.objects[1]] : input.discovery.objects;
      return { schemaVersion: request.schemaVersion, mode: request.mode, names: request.names, rootObjectId: request.rootObjectId, cursor: request.cursor,
        matchingPolicyVersion: PREPARATION_MATCHING_POLICY, visibilityScope, indexedObjectCount: 3,
        propertyScan: null, nextCursor: null, complete: true,
        objects: source.map(value => ({ ...value, objectId: Number(value.objectId.slice(5)), parentId: value.parentId === null ? null : Number(value.parentId.slice(5)),
          orderIndex: value.orderIndex - 1, matchedNames: request.mode === 'names' ? request.names : [] })) };
    });
    const discovery = await collectPreparationDiscovery(context, { discover, assertCurrent: vi.fn() }, undefined, { skipEquipment: true });
    const plan = buildPreparationPlan(context, { ...input, discovery });
    expect(plan.diagnostics).toEqual([]);
    expect(plan.requestedScope).toMatchObject({ scopeKind: 'server-requested-project-routing-only', endpointScope: {
      schemaVersion: 'wfc.pf.endpoint-discovery-scope.v1', mode: 'not-requested' }, endpointNames: ['Equipment'], endpointEvidence: [], orderedEquipmentObjectIds: [], orderedPhysicalLeafIds: ['dbid:3'] });
    expect(plan.partPlan.every(part => part.equipmentObjectIds.length === 0 && part.equipmentNames.length === 0)).toBe(true);
    expect(preparationPlanSchema.parse(plan)).toEqual(plan);
  });
  it('defaults to legacy capacity and hashes a separately constructed larger frozen profile without changing geometry or scope', () => {
    const { context, input } = preparationFixture();
    const legacy = buildPreparationPlan(context, input, id(50));
    const large = buildPreparationPlan(context, input, id(50), LARGE_PREPARATION_CAPACITY_PROFILE);
    expect(legacy.limitsProfile).toBe(LEGACY_PREPARATION_CAPACITY_PROFILE);
    expect(large.limitsProfile).toBe(LARGE_PREPARATION_CAPACITY_PROFILE);
    expect(large.orderedPlanSha256).not.toBe(legacy.orderedPlanSha256);
    expect(preparationDigest(preparationPlanHashInput({ ...legacy, limitsProfile: LARGE_PREPARATION_CAPACITY_PROFILE }))).not.toBe(legacy.orderedPlanSha256);
    expect(large.requestedScope).toEqual(legacy.requestedScope);
    expect(large.partPlan).toEqual(legacy.partPlan.map((part, index) => ({ ...part, partId: large.partPlan[index].partId })));
    expect(large.objectManifest).toEqual(legacy.objectManifest);
    expect(large.objectOrder).toEqual(legacy.objectOrder);
    expect(legacy.orderedPlanSha256).toBe(preparationDigest(preparationPlanHashInput(legacy)));
    expect(large.orderedPlanSha256).toBe(preparationDigest(preparationPlanHashInput(large)));
  });
  it('rejects unknown server profiles and never accepts profile selection in a create request', () => {
    const { context, input } = preparationFixture();
    expect(() => buildPreparationPlan(context, input, id(50), 'unlimited' as PreparationCapacityProfile)).toThrow();
    expect(preparationCreateSchema.safeParse({ ...input, limitsProfile: LARGE_PREPARATION_CAPACITY_PROFILE }).success).toBe(false);
    const plan = buildPreparationPlan(context, input);
    for (const profile of [undefined, 'unlimited']) expect(preparationPlanSchema.safeParse({ ...plan, limitsProfile: profile }).success).toBe(false);
  });
  it('retains historical exact-name policy evidence and hashes the explicit adapter policy separately', () => {
    const { context, input } = preparationFixture();
    const legacy = buildPreparationPlan(context, input, id(50));
    input.discovery.matchingPolicyVersion = 'wfc.pf.project-exact-candidates.v2';
    const current = buildPreparationPlan(context, input, id(50));
    expect(legacy.matchingPolicyVersion).toBe('wfc.pf.project-exact-candidates.v1');
    expect(current.matchingPolicyVersion).toBe('wfc.pf.project-exact-candidates.v2');
    expect(current.orderedPlanSha256).not.toBe(legacy.orderedPlanSha256);
    expect(preparationPlanSchema.parse(legacy)).toEqual(legacy);
    expect(preparationPlanSchema.safeParse({ ...current, matchingPolicyVersion: 'unknown' }).success).toBe(false);
  });
  it('freezes v3 SDK display scope in both plan and scope hashes without inserting it into historical contracts', () => {
    const {context,input}=preparationFixture(),historical=buildPreparationPlan(context,input,id(50));
    expect(historical.requestedScope).not.toHaveProperty('endpointVisibility');
    const visibilityScope={schemaVersion:'wfc.pf.sdk-display-visibility.v1' as const,basis:'sdk-display-before-pf-appearance' as const,contentSha256:'d'.repeat(64)};
    input.discovery.matchingPolicyVersion='wfc.pf.project-exact-candidates.v3';
    expect(preparationCreateSchema.safeParse(input).success).toBe(false);
    input.discovery.visibilityScope=visibilityScope;
    const parsed=preparationCreateSchema.parse(input),plan=buildPreparationPlan(context,parsed,id(50));
    expect(plan.requestedScope.endpointVisibility).toEqual(visibilityScope);
    expect(plan.requestedScope.scopeSha256).not.toBe(historical.requestedScope.scopeSha256);
    expect(plan.orderedPlanSha256).not.toBe(historical.orderedPlanSha256);
    expect(preparationPlanSchema.safeParse({...plan,requestedScope:{...plan.requestedScope,endpointVisibility:undefined}}).success).toBe(false);
    parsed.discovery.matchingPolicyVersion='wfc.pf.project-exact-candidates.v2';
    expect(preparationCreateSchema.safeParse(parsed).success).toBe(false);
  });
  it('freezes exact scope, server category masks, ancestry and a verifiable plan hash', () => {
    const { context, input } = preparationFixture(), plan = buildPreparationPlan(context, input, id(4));
    expect(preparationPlanSchema.parse(plan)).toEqual(plan);
    expect(plan.diagnostics).toEqual([]); expect(plan.requestedScope.orderedPhysicalLeafIds).toEqual(['dbid:3']);
    expect(plan.partPlan[0].objects).toEqual([{ objectId: 3, rootObjectId: 2, projectTrayId: id(10), routeName: '/B001', shapeName: 'Part', allowedCategories: ['LV'] }]);
    expect(plan.partPlan[0].ancestorObjectIds).toEqual(['dbid:1', 'dbid:2']); expect(plan.orderedPlanSha256).toBe(preparationDigest(preparationPlanHashInput(plan)));
  });
  it.each(['selectionRevision', 'catalogRevision', 'routingPolicyRevision', 'locationRegistryRevision', 'resolutionRevision'] as const)('rejects stale %s', key => { const { context, input } = preparationFixture(); input.expected[key] = '999'; expect(() => buildPreparationPlan(context, input)).toThrowError(expect.objectContaining({ code: 'PREPARATION_SCOPE_STALE' })); });
  it('cannot let a drawing-only fact enter the strict plan or scope hash', () => { const { context, input } = preparationFixture(); const plan = buildPreparationPlan(context, input); expect(preparationPlanSchema.safeParse({ ...plan, drawingInputRevision: '8' }).success).toBe(false); expect(equalPreparationScope(context.scope, { ...context.scope })).toBe(true); });
  it.each(['unconfigured', 'invalid'] as const)('records %s without inventing an allowed routing leaf', policyState => { const { context, input } = preparationFixture(); context.trays[0].policyState = policyState; context.trays[0].allowedCategories = []; const plan = buildPreparationPlan(context, input); expect(plan.partPlan).toHaveLength(0); expect(plan.diagnostics.length).toBeGreaterThan(0); });
  it('retains an explicit excluded purpose without capturing its geometry', () => { const { context, input } = preparationFixture(); context.trays[0].policyState = 'excluded'; context.trays[0].allowedCategories = []; const plan = buildPreparationPlan(context, input); expect(plan.requestedScope.excludedProjectTrayIds).toEqual([id(10)]); expect(plan.requestedScope.orderedPhysicalLeafIds).toEqual([]); });
  it.each([{ roots: [] }, { roots: ['dbid:2', 'dbid:4'] }])('missing/ambiguous roots are explicit blockers (%j)', ({ roots }) => { const { context, input } = preparationFixture(); input.discovery.objects.push(object(4, 1, '/B001')); input.discovery.trays[0].candidateRootObjectIds = roots; expect(buildPreparationPlan(context, input).diagnostics.some(d => d.code === (roots.length ? 'TRAY_ROOT_AMBIGUOUS' : 'TRAY_ROOT_MISSING'))).toBe(true); });
  it.each(['TRAY_ROOT_MISSING', 'TRAY_ROOT_AMBIGUOUS'] as const)('opt-in skip records %s without capturing or assigning the omitted tray', reason => {
    const { context, input } = preparationFixture(), before = structuredClone(context);
    context.trays.push({ ...context.trays[0], projectTrayId: id(11), rawName: '/B002', routeName: '/B002' });
    input.discovery.objects.push(object(4, 1, '/B002'), object(5, 1, '/B002'), object(6, 4, 'Other leaf', true));
    input.discovery.trays.push({ projectTrayId: id(11), candidateRootObjectIds: reason === 'TRAY_ROOT_MISSING' ? [] : ['dbid:4', 'dbid:5'] });
    const strict = buildPreparationPlan(context, input);
    expect(strict.diagnostics.map(value => value.code)).toContain(reason);
    expect(strict.requestedScope).not.toHaveProperty('unresolvedTrayPolicy');
    expect(strict.requestedScope).not.toHaveProperty('skippedTrays');
    const plan = buildPreparationPlan(context, { ...input, unresolvedTrayPolicy: 'skip' });
    expect(plan.diagnostics).toEqual([]);
    expect(plan.requestedScope).toMatchObject({ unresolvedTrayPolicy: 'skip', skippedTrays: [{ projectTrayId: id(11), reason }], excludedProjectTrayIds: [id(11)], orderedPhysicalLeafIds: ['dbid:3'] });
    expect(plan.requestedScope.trays.map(tray => tray.projectTrayId)).toEqual([id(10)]);
    expect(plan.partPlan.flatMap(part => part.physicalLeafIds)).toEqual(['dbid:3']);
    expect(context.resolutions).toEqual(before.resolutions);
    expect(plan.requestedScope.scopeSha256).not.toBe(strict.requestedScope.scopeSha256);
    const { scopeSha256, ...scopeBody } = plan.requestedScope;
    expect(scopeSha256).toBe(preparationDigest(scopeBody));
    expect(plan.orderedPlanSha256).toBe(preparationDigest(preparationPlanHashInput(plan)));
    expect(preparationPlanSchema.parse(plan)).toEqual(plan);
  });
  it('records skip mode even when every tray resolves and rejects caller-supplied omission evidence', () => {
    const { context, input } = preparationFixture();
    const plan = buildPreparationPlan(context, { ...input, unresolvedTrayPolicy: 'skip' });
    expect(plan.requestedScope).toMatchObject({ unresolvedTrayPolicy: 'skip', skippedTrays: [], excludedProjectTrayIds: [] });
    expect(preparationCreateSchema.safeParse({ ...input, unresolvedTrayPolicy: 'skip' }).success).toBe(true);
    for (const extra of [{ unresolvedTrayPolicy: 'ignore' }, { skippedTrays: [] }, { excludedProjectTrayIds: [id(10)] }])
      expect(preparationCreateSchema.safeParse({ ...input, ...extra }).success).toBe(false);
    const skipped = { projectTrayId: id(10), reason: 'TRAY_ROOT_MISSING' };
    for (const replacement of [
      { ...plan.requestedScope, skippedTrays: undefined },
      { ...plan.requestedScope, unresolvedTrayPolicy: undefined },
      { ...plan.requestedScope, skippedTrays: [skipped] },
      { ...plan.requestedScope, excludedProjectTrayIds: [id(10)], skippedTrays: [skipped] },
      { ...plan.requestedScope, trays: [], excludedProjectTrayIds: [id(10)], skippedTrays: [skipped, skipped] },
    ]) expect(preparationPlanSchema.safeParse({ ...plan, requestedScope: replacement }).success).toBe(false);
  });
  it.each([{ candidates: [] }, { candidates: ['dbid:2', 'dbid:4'] }])('never skips a current manual assignment when automatic candidates are $candidates', ({ candidates }) => {
    const { context, input } = preparationFixture();
    input.discovery.objects.push(object(4, 1, '/B001'));
    input.discovery.trays[0].candidateRootObjectIds = candidates;
    context.resolutions.push({ id: id(8), projectTrayId: id(10), mode: 'roots', rootObjectIds: ['dbid:2'], reason: 'Confirmed physical root', actorId: id(9), createdAt: '2026-01-01T00:00:00.000Z', scope: { ...context.scope } });
    const plan = buildPreparationPlan(context, { ...input, unresolvedTrayPolicy: 'skip' });
    expect(plan.diagnostics).toEqual([]);
    expect(plan.requestedScope.skippedTrays).toEqual([]);
    expect(plan.requestedScope.trays[0]).toMatchObject({ ownershipDecisionId: id(8), orderedRootObjectIds: ['dbid:2'] });
    context.resolutions[0].rootObjectIds = ['dbid:99'];
    expect(() => buildPreparationPlan(context, { ...input, unresolvedTrayPolicy: 'skip' })).toThrowError(expect.objectContaining({ code: 'PREPARATION_RESOLUTION_OBJECT_MISSING' }));
  });
  it.each(['unconfigured', 'invalid'] as const)('does not treat %s routing permissions as a skipped automatic match', policyState => {
    const { context, input } = preparationFixture();
    context.trays[0].policyState = policyState;
    input.discovery.trays[0].candidateRootObjectIds = [];
    const plan = buildPreparationPlan(context, { ...input, unresolvedTrayPolicy: 'skip' });
    expect(plan.requestedScope.excludedProjectTrayIds).toEqual([]);
    expect(plan.requestedScope.skippedTrays).toEqual([]);
    expect(plan.diagnostics.map(value => value.code)).toContain(policyState === 'unconfigured' ? 'PURPOSE_UNCONFIGURED' : 'TRAY_POLICY_INVALID');
  });
  it('keeps geometry, malformed-candidate and leaf-ownership blockers in skip mode', () => {
    const { context, input } = preparationFixture(), skipping = { ...input, unresolvedTrayPolicy: 'skip' as const };
    input.discovery.objects[1].hasGeometry = true;
    expect(buildPreparationPlan(context, skipping).diagnostics.map(value => value.code)).toContain('NON_LEAF_ROUTING_GEOMETRY');
    input.discovery.objects[1].hasGeometry = false;
    input.discovery.objects[2].hasGeometry = false;
    expect(buildPreparationPlan(context, skipping).diagnostics.map(value => value.code)).toContain('TRAY_GEOMETRY_MISSING');
    input.discovery.objects[2].hasGeometry = true;
    input.discovery.objects[1].name = '/B001-extra';
    expect(() => buildPreparationPlan(context, skipping)).toThrowError(expect.objectContaining({ code: 'PREPARATION_EXACT_CANDIDATE_INVALID' }));
    input.discovery.objects[1].name = '/B001';
    context.trays.push({ ...context.trays[0], projectTrayId: id(11) });
    input.discovery.trays.push({ projectTrayId: id(11), candidateRootObjectIds: ['dbid:2'] });
    expect(() => buildPreparationPlan(context, skipping)).toThrowError(expect.objectContaining({ code: 'PREPARATION_LEAF_OWNERSHIP_CONFLICT' }));
  });
  it('keeps an all-skipped network unusable with an actionable zero-geometry diagnostic', () => {
    const { context, input } = preparationFixture(); input.discovery.trays[0].candidateRootObjectIds = [];
    const plan = buildPreparationPlan(context, { ...input, unresolvedTrayPolicy: 'skip' });
    expect(plan.requestedScope.skippedTrays).toEqual([{ projectTrayId: id(10), reason: 'TRAY_ROOT_MISSING' }]);
    expect(plan.partPlan).toEqual([]);
    expect(plan.diagnostics).toEqual([expect.objectContaining({ code: 'NO_AUTHORIZED_ROUTING_GEOMETRY', message: expect.stringContaining('at least one configured tray') })]);
  });
  it('rejects a candidate with merely a substring match', () => { const { context, input } = preparationFixture(); input.discovery.objects[1].name = '/B001-extra'; expect(() => buildPreparationPlan(context, input)).toThrowError(expect.objectContaining({ code: 'PREPARATION_EXACT_CANDIDATE_INVALID' })); });
  it('accepts exact authoritative slash-code when the project raw name is unprefixed, preserving case and punctuation', () => { const { context, input } = preparationFixture(); context.trays[0].rawName = 'B001'; expect(buildPreparationPlan(context, input).diagnostics).toEqual([]); input.discovery.objects[1].name = '/b001'; expect(() => buildPreparationPlan(context, input)).toThrowError(expect.objectContaining({ code: 'PREPARATION_EXACT_CANDIDATE_INVALID' })); input.discovery.objects[1].name = '/B001-extra'; expect(() => buildPreparationPlan(context, input)).toThrowError(expect.objectContaining({ code: 'PREPARATION_EXACT_CANDIDATE_INVALID' })); });
  it('keeps both exact raw and slash-code roots ambiguous instead of selecting the first', () => { const { context, input } = preparationFixture(); context.trays[0].rawName = 'B001'; input.discovery.objects.push(object(4, 1, 'B001')); input.discovery.trays[0].candidateRootObjectIds = ['dbid:2', 'dbid:4']; expect(buildPreparationPlan(context, input).diagnostics.some(d => d.code === 'TRAY_ROOT_AMBIGUOUS')).toBe(true); });
  it('accepts audited multiple roots but never unions conflicting physical leaf permissions', () => {
    const { context, input } = preparationFixture(); input.discovery.objects.push(object(4, 1, '/B001'), object(5, 4, 'Other', true));
    context.resolutions.push({ id: id(8), projectTrayId: id(10), mode: 'roots', rootObjectIds: ['dbid:2', 'dbid:4'], reason: 'Synthetic multi-root proof', actorId: id(9), createdAt: '2026-01-01T00:00:00.000Z', scope: context.scope });
    expect(buildPreparationPlan(context, input).requestedScope.orderedPhysicalLeafIds).toEqual(['dbid:3', 'dbid:5']);
    context.trays.push({ ...context.trays[0], projectTrayId: id(11) }); input.discovery.trays.push({ projectTrayId: id(11), candidateRootObjectIds: ['dbid:2'] });
    expect(() => buildPreparationPlan(context, input)).toThrowError(expect.objectContaining({ code: 'PREPARATION_LEAF_OWNERSHIP_CONFLICT' }));
  });
  it.each([['unique automatic match', ['dbid:2']], ['missing automatic match', []]] as const)(
    'uses only differently named manual roots instead of a %s', (_description, candidates) => {
      const { context, input } = preparationFixture();
      input.discovery.trays[0].candidateRootObjectIds = [...candidates];
      input.discovery.objects.push(object(4, 1, 'Different physical tray name'), object(5, 4, 'STRAIGHT', true));
      context.resolutions.push({ id: id(8), projectTrayId: id(10), mode: 'roots', rootObjectIds: ['dbid:4'],
        reason: 'Use the explicitly assigned physical objects', actorId: id(9), createdAt: '2026-01-01T00:00:00.000Z', scope: context.scope });
      const plan = buildPreparationPlan(context, input);
      expect(plan.diagnostics).toEqual([]);
      expect(plan.requestedScope.trays[0]).toMatchObject({ routeName: '/B001', ownershipDecisionId: id(8), orderedRootObjectIds: ['dbid:4'] });
      expect(plan.requestedScope.orderedPhysicalLeafIds).toEqual(['dbid:5']);
      expect(plan.partPlan.flatMap(part => part.objects).map(value => value.rootObjectId)).toEqual([4]);
    },
  );
  it('does not revive an old resolution after a routing catalog ABA', () => { const { context, input } = preparationFixture(); context.resolutions.push({ id: id(8), projectTrayId: id(10), mode: 'exclude', rootObjectIds: [], reason: 'Old exclusion', actorId: id(9), createdAt: '2026-01-01T00:00:00.000Z', scope: { ...context.scope, catalogRevision: '1' } }); expect(buildPreparationPlan(context, input).requestedScope.excludedProjectTrayIds).toEqual([]); });
  it('rechecks and uses differently named assigned tray objects after only cable locations change', () => {
    const { context, input } = preparationFixture();
    input.discovery.trays[0].candidateRootObjectIds = [];
    input.discovery.objects[1].name = '/B001x';
    context.resolutions.push({ id: id(8), projectTrayId: id(10), mode: 'roots', rootObjectIds: ['dbid:2'],
      reason: 'Explicit physical tray assignment', actorId: id(9), createdAt: '2026-01-01T00:00:00.000Z',
      scope: { ...context.scope, locationRegistryRevision: '1', resolutionRevision: '0' } });
    context.scope.resolutionRevision = '8'; input.expected = { ...context.scope };
    const plan = buildPreparationPlan(context, input);
    expect(plan.diagnostics).toEqual([]);
    expect(plan.requestedScope.trays[0].orderedRootObjectIds).toEqual(['dbid:2']);
    expect(plan.requestedScope.orderedPhysicalLeafIds).toEqual(['dbid:3']);
    expect(plan.locationRegistryRevision).toBe(context.scope.locationRegistryRevision);
    input.discovery.objects = input.discovery.objects.filter(value => value.objectId === 'dbid:1');
    expect(() => buildPreparationPlan(context, input)).toThrowError(expect.objectContaining({ code: 'PREPARATION_RESOLUTION_OBJECT_MISSING' }));
  });
  it.each(['modelVersionId', 'contentFingerprint', 'selectionRevision', 'catalogRevision', 'routingContentSha256', 'routingPolicyRevision', 'routingPolicySha256'] as const)(
    'requires assignment verification after %s changes without asserting a tray geometry change', key => {
      const { context, input } = preparationFixture();
      input.discovery.trays[0].candidateRootObjectIds = [];
      const saved = { ...context.scope };
      saved[key] = key === 'modelVersionId' ? id(70) : key.endsWith('Sha256') || key === 'contentFingerprint' ? 'f'.repeat(64) : '999';
      context.resolutions.push({ id: id(8), projectTrayId: id(10), mode: 'roots', rootObjectIds: ['dbid:2'],
        reason: 'Assignment from a different preparation', actorId: id(9), createdAt: '2026-01-01T00:00:00.000Z', scope: saved });
      const plan = buildPreparationPlan(context, input);
      expect(plan.requestedScope.trays).toEqual([]);
      expect(plan.diagnostics.some(value => value.code === 'TRAY_ROOT_MISSING')).toBe(true);
    },
  );
  it.each(['missing-parent', 'cycle'] as const)('rejects %s hierarchy', kind => { const { context, input } = preparationFixture(); input.discovery.objects[0].parentId = kind === 'cycle' ? 'dbid:3' : 'dbid:99'; expect(() => buildPreparationPlan(context, input)).toThrowError(expect.objectContaining({ code: 'PREPARATION_HIERARCHY_INVALID' })); });
  it('flags own geometry on a non-leaf rather than silently omitting it', () => { const { context, input } = preparationFixture(); input.discovery.objects[1].hasGeometry = true; expect(buildPreparationPlan(context, input).diagnostics.some(d => d.code === 'NON_LEAF_ROUTING_GEOMETRY')).toBe(true); });
  it('preserves the nearest original fitting keyword inside the selected route root only', () => { const { context, input } = preparationFixture(); input.discovery.objects[0].name = 'ELBOW outside route'; input.discovery.objects[2].parentId = 'dbid:4'; input.discovery.objects.push(object(4, 2, 'BEND original name')); expect(buildPreparationPlan(context, input).partPlan[0].objects[0].shapeName).toBe('BEND original name'); input.discovery.objects[3].name = 'ordinary hierarchy'; expect(buildPreparationPlan(context, input).partPlan[0].objects[0].shapeName).toBe('Part'); input.discovery.objects[2].name = 'STRAIGHT mesh'; expect(buildPreparationPlan(context, input).partPlan[0].objects[0].shapeName).toBe('STRAIGHT mesh'); });
  it('splits a single huge subtree by actual leaves, retaining stable order and closure', () => { const { context, input } = preparationFixture(); input.discovery.objects = input.discovery.objects.slice(0, 2); for (let n = 3; n < 1028; n++) input.discovery.objects.push(object(n, 2, 'Leaf ' + n, true)); const plan = buildPreparationPlan(context, input); expect(plan.partPlan).toHaveLength(3); expect(plan.partPlan.every(p => p.objects.length <= 512)).toBe(true); expect(plan.partPlan.reduce((n,p)=>n+p.objects.length,0)).toBe(1025); expect(plan.partPlan.flatMap(p => p.physicalLeafIds)).toEqual(plan.requestedScope.orderedPhysicalLeafIds); });
  it('captures all known endpoint candidates and records missing/ambiguous without fabricating bindings', () => {
    const { context, input } = preparationFixture(); context.endpointNames = ['Absent', 'Equipment']; input.discovery.objects.push(object(4, 1, 'Equipment', true), object(5, 1, 'Equipment', true)); input.discovery.endpointCandidates = [{ name: 'Absent', objectIds: [] }, { name: 'Equipment', objectIds: ['dbid:4', 'dbid:5'] }]; input.discovery.propertyScan = { indexedObjectCount: 5, attemptedObjectCount: 5, returnedObjectCount: 5, omittedObjectCount: 0, complete: true };
    const plan = buildPreparationPlan(context, input); expect(plan.diagnostics).toEqual([]); expect(plan.requestedScope.endpointEvidence.map(e => e.status)).toEqual(['missing', 'ambiguous']); expect(plan.requestedScope.orderedEquipmentObjectIds).toEqual(['dbid:4', 'dbid:5']);
  });
  it('incomplete endpoint property evidence never becomes complete requested scope', () => { const { context, input } = preparationFixture(); context.endpointNames = ['Equipment']; input.discovery.endpointCandidates = [{ name: 'Equipment', objectIds: [] }]; expect(buildPreparationPlan(context, input).diagnostics.some(d => d.code === 'ENDPOINT_DISCOVERY_INCOMPLETE')).toBe(true); });
  it('keeps a valid legacy full scope unchanged and hashes explicit tray-only intent separately', () => {
    const { context, input } = preparationFixture(), full = buildPreparationPlan(context, input);
    expect(full.requestedScope.scopeKind).toBe('server-requested-project-routing-and-endpoints');
    expect(Object.hasOwn(full.requestedScope, 'endpointScope')).toBe(false);
    expect(preparationPlanSchema.parse(full)).toEqual(full);
    const endpointScope = { schemaVersion: 'wfc.pf.endpoint-discovery-scope.v1' as const, mode: 'not-requested' as const };
    const trayOnly = buildPreparationPlan(context, { ...input, discovery: { ...input.discovery, endpointScope } });
    expect(trayOnly.diagnostics).toEqual([]); expect(trayOnly.requestedScope.scopeSha256).not.toBe(full.requestedScope.scopeSha256);
    for (const requestedScope of [
      { ...trayOnly.requestedScope, endpointScope: undefined },
      { ...trayOnly.requestedScope, scopeKind: 'server-requested-project-routing-and-endpoints' },
      { ...trayOnly.requestedScope, endpointNames: ['Equipment'], endpointEvidence: [{ name: 'Equipment', candidateObjectIds: [], status: 'missing' }] },
      { ...trayOnly.requestedScope, orderedEquipmentObjectIds: ['dbid:1'] },
    ]) expect(preparationPlanSchema.safeParse({ ...trayOnly, requestedScope }).success).toBe(false);
    expect(preparationPlanSchema.safeParse({ ...trayOnly, partPlan: trayOnly.partPlan.map(part => ({ ...part, equipmentNames: ['Equipment'] })) }).success).toBe(false);
  });
  it.each(['missing-scan', 'partial-name-set', 'foreign-name'] as const)('unmarked full endpoint discovery still blocks %s', reason => {
    const { context, input } = preparationFixture(); context.endpointNames = ['Equipment', 'Other'];
    input.discovery.endpointCandidates = reason === 'foreign-name' ? [{ name: 'Wrong', objectIds: [] }, { name: 'Other', objectIds: [] }]
      : reason === 'partial-name-set' ? [{ name: 'Equipment', objectIds: [] }] : context.endpointNames.map(name => ({ name, objectIds: [] }));
    if (reason !== 'missing-scan') input.discovery.propertyScan = { indexedObjectCount: 3, attemptedObjectCount: 3, returnedObjectCount: 3, omittedObjectCount: 0, complete: true };
    expect(buildPreparationPlan(context, input).diagnostics.some(diagnostic => diagnostic.code === 'ENDPOINT_DISCOVERY_INCOMPLETE')).toBe(true);
  });
  it('rejects endpoint evidence attached to a tray-only marker before planning', () => {
    const { context, input } = preparationFixture(); input.discovery.endpointScope = { schemaVersion: 'wfc.pf.endpoint-discovery-scope.v1', mode: 'not-requested' };
    input.discovery.endpointCandidates = [{ name: 'Equipment', objectIds: [] }];
    expect(() => buildPreparationPlan(context, input)).toThrowError(expect.objectContaining({ code: 'PREPARATION_DISCOVERY_ENDPOINT_SCOPE' }));
  });
  it('partitions long metadata before the protected 64KiB capture-command bound', () => { const { context, input } = preparationFixture(); input.discovery.objects = input.discovery.objects.slice(0, 2); for (let n = 3; n < 300; n++) input.discovery.objects.push(object(n, 2, 'X'.repeat(1500), true)); const plan = buildPreparationPlan(context, input); expect(plan.partPlan.length).toBeGreaterThan(1); expect(plan.partPlan.every(p => p.objects.length < 512 && Buffer.byteLength(JSON.stringify(p.objects)) < 62 * 1024)).toBe(true); });
  it('refuses a monotonic planning time-budget breach instead of holding the project indefinitely', () => { const { context, input } = preparationFixture(); const clock = vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(5001); try { expect(() => buildPreparationPlan(context, input)).toThrowError(expect.objectContaining({ code: 'PREPARATION_PLAN_WORK_LIMIT', status: 413 })); } finally { clock.mockRestore(); } });
});
