// @vitest-environment node
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { preparationContextSchema, type PreparationAggregate, type PreparationCreate, type PreparationContext } from '../../shared/pathfinderPreparation.js';
import { syntheticStraightSnapshot } from './syntheticFixture.js';
const read = vi.hoisted(() => vi.fn());
vi.mock('./preparationStorage.js', () => ({ readPreparationBlob: read }));
import { buildPreparationPlan } from './preparationPlans.js';
import { loadTrayAssignmentCarryover, TRAY_CARRYOVER_LIMITS } from './trayAssignmentCarryover.js';
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const guid = '7586ffbb-1d0a-5942-b687-06884123c866';
function fixture(count = 1) {
  const context: PreparationContext = { schemaVersion: 'wfc.pf.preparation-context.v1', projectId: id(1),
    scope: { modelVersionId: id(2), contentFingerprint: 'a'.repeat(64), selectionRevision: '1', catalogRevision: '2', routingContentSha256: 'b'.repeat(64), routingPolicyRevision: '3', routingPolicySha256: 'c'.repeat(64), locationRegistryRevision: '4', resolutionRevision: '0' },
    trays: [], endpointNames: [], resolutions: [], diagnostics: [], currentAggregate: null };
  for (let n = 0; n < count; n++) {
    context.trays.push({ projectTrayId: id(10 + n), rawName: `B00${n + 1}`, routeName: `/B00${n + 1}`, purposeKey: 'LV', allowedCategories: ['LV'], policyState: 'configured', diagnosticCodes: [] });
    context.resolutions.push({ id: id(20 + n), projectTrayId: id(10 + n), mode: 'roots', rootObjectIds: [`dbid:${3 + n}`], reason: 'Assigned selected solid', actorId: id(90), createdAt: '2026-11-09T10:00:00.000Z', scope: { ...context.scope } });
  }
  const input: PreparationCreate = { schemaVersion: 'wfc.pf.preparation-create.v1', expected: context.scope, idempotencyKey: id(4), discovery: { schemaVersion: 'wfc.pf.discovery-report.v1', ...context.scope, matchingPolicyVersion: 'wfc.pf.project-exact-candidates.v1', complete: true, propertyScan: null,
    objects: context.resolutions.map((resolution, n) => ({ objectId: resolution.rootObjectIds[0], parentId: null, name: '3D Solid', hasGeometry: true, isPhysicalLeaf: true, orderIndex: n })),
    trays: context.trays.map(tray => ({ projectTrayId: tray.projectTrayId, candidateRootObjectIds: [] })), endpointCandidates: [] } };
  const plan = buildPreparationPlan(context, input, id(5));
  const snapshot = syntheticStraightSnapshot(id(1), id(2), 'a'.repeat(64));
  snapshot.objects = context.resolutions.map((resolution, n) => ({ ...structuredClone(snapshot.objects[0]), id: resolution.rootObjectIds[0], dbId: 3 + n,
    externalId: `external-${n}`, name: '3D Solid', leafToRootNames: ['3D Solid'], properties: [{ category: 'Item', name: 'GUID', value: n ? id(70 + n) : guid }, { category: 'Item', name: 'Source File', value: '01-50_MSR_Kabeltassen.dwg' }] }));
  let bytes = Buffer.from(JSON.stringify(snapshot));
  const aggregate: PreparationAggregate = { ...context.scope, schemaVersion: 'wfc.pf.geometry-aggregate.v1', id: id(6), projectId: id(1), sessionId: plan.id, artifactId: id(7), geometryRevision: '1', sourceLocationRegistryRevision: context.scope.locationRegistryRevision,
    coordinateFrameId: plan.coordinateFrameId, orderedPlanSha256: plan.orderedPlanSha256, orderedScopeSha256: plan.requestedScope.scopeSha256,
    partReferences: plan.partPlan.map(part => ({ partId: part.partId, partIndex: part.partIndex, payloadSha256: 'd'.repeat(64) })),
    projection: { schemaVersion: 'pathfinder.model.snapshot.v1', payloadRef: id(7), sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length },
    traceIndex: { schemaVersion: 'wfc.pf.preparation-trace-index.v1', payloadRef: id(8), sha256: 'd'.repeat(64), bytes: 20 },
    counts: { objects: count, physicalLeaves: count, fragments: count, vertices: count * 3, triangles: count }, requestedScopeComplete: true, wholePlantGeometry: false, engineVersion: 'test', rulesVersion: 'test', diagnostics: [], engineeringAccepted: false, nativeParity: 'not-performed', publishedAt: '2026-11-09T10:01:00.000Z' };
  const rows: Array<{ plan: unknown; manifest: unknown }> = [{ plan, manifest: aggregate }];
  const query = vi.fn(async (_sql: string, params: unknown[]) => ({ rows: rows.slice(Number(params[4]), Number(params[4]) + 1) }));
  const cache = new Map();
  read.mockImplementation(async () => bytes);
  const current = { ...context.scope, modelVersionId: id(99), contentFingerprint: 'e'.repeat(64), selectionRevision: '2' };
  return { context, plan, aggregate, snapshot, current, rows, query, cache, load: () => loadTrayAssignmentCarryover({ query } as unknown as PoolClient, id(1), current, context.resolutions, cache),
    updateBytes() { bytes = Buffer.from(JSON.stringify(snapshot)); aggregate.projection.bytes = bytes.length; aggregate.projection.sha256 = createHash('sha256').update(bytes).digest('hex'); } };
}
beforeEach(() => vi.clearAllMocks());
describe('historical tray assignment identity hints', () => {
  it('recovers the existing manually assigned solid identity from the verified prior capture without carrying geometry', async () => {
    const f = fixture(), result = await f.load();
    expect(result).toEqual([{ resolutionId: id(20), projectTrayId: id(10), sourceModelVersionId: id(2), roots: [{ objectId: 'dbid:3', identity: { externalId: 'external-0', guid, sourceFile: '01-50_MSR_Kabeltassen.dwg' } }] }]);
    expect(read).toHaveBeenCalledExactlyOnceWith(id(1), id(5), f.aggregate.projection, TRAY_CARRYOVER_LIMITS.projectionBytes);
    expect(f.query.mock.calls).toHaveLength(1); expect(result[0].roots[0]).not.toHaveProperty('bounds');
    expect(preparationContextSchema.parse({ ...f.context, scope: f.current, trayAssignmentCarryover: result }).trayAssignmentCarryover).toEqual(result);
  });
  it('loads a shared source projection once for several assigned trays', async () => { const f = fixture(2); expect(await f.load()).toHaveLength(2); expect(read).toHaveBeenCalledOnce(); });
  it('reuses only immutable extracted identities across successive tray renewals without retaining geometry', async () => {
    const f = fixture(2), first = await f.load(); first[0].roots[0].identity.guid = null;
    f.context.resolutions.pop();
    expect((await f.load())[0].roots[0].identity.guid).toBe(guid); expect(read).toHaveBeenCalledOnce();
    const metadata = JSON.stringify([...f.cache.values()].map(value => [...value]));
    expect(metadata).not.toContain('vertices'); expect(metadata).not.toContain('fragments');
  });
  it('uses newest verified evidence even when a project has more historical sessions than the scan bound', async () => {
    const f = fixture(); f.rows.push(...Array.from({ length: 130 }, () => ({ plan: {}, manifest: {} })));
    expect(await f.load()).toHaveLength(1); expect(f.query).toHaveBeenCalledOnce(); expect(read).toHaveBeenCalledOnce();
  });
  it('leaves only unmatched older assignments unresolved after the bounded sequential historical scan', async () => {
    const f = fixture(), valid = f.rows[0]; f.rows.splice(0, 1, ...Array.from({ length: TRAY_CARRYOVER_LIMITS.sessionsPerScope }, () => ({ plan: {}, manifest: {} })), valid);
    expect(await f.load()).toEqual([]); expect(f.query).toHaveBeenCalledTimes(TRAY_CARRYOVER_LIMITS.sessionsPerScope); expect(read).not.toHaveBeenCalled();
  });
  it.each(['ownership', 'roots', 'scope', 'plan-hash', 'tenant'] as const)('does not infer identities from mismatching historical %s', async kind => {
    const f = fixture();
    if (kind === 'ownership') f.context.resolutions[0].id = id(91);
    if (kind === 'roots') f.context.resolutions[0].rootObjectIds = ['dbid:9'];
    if (kind === 'scope') f.aggregate.selectionRevision = '8';
    if (kind === 'plan-hash') f.plan.orderedPlanSha256 = f.aggregate.orderedPlanSha256 = 'f'.repeat(64);
    if (kind === 'tenant') f.aggregate.projectId = id(88);
    expect(await f.load()).toEqual([]); expect(read).not.toHaveBeenCalled();
  });
  it('keeps unavailable and oversized history local to those assignments', async () => {
    const f = fixture(); read.mockRejectedValueOnce(Error('checksum mismatch'));
    expect(await f.load()).toEqual([]);
    f.aggregate.projection.bytes = TRAY_CARRYOVER_LIMITS.projectionBytes + 1;
    expect(await f.load()).toEqual([]); expect(read).toHaveBeenCalledOnce();
  });
  it.each(['wrong-model', 'missing-root', 'no-stable-identity', 'duplicate-object'] as const)('omits %s historical snapshots', async kind => {
    const f = fixture();
    if (kind === 'wrong-model') f.snapshot.model.modelVersionId = id(80);
    if (kind === 'missing-root') f.snapshot.objects[0].id = 'dbid:98';
    if (kind === 'no-stable-identity') { f.snapshot.objects[0].properties = []; f.snapshot.objects[0].externalId = null; }
    if (kind === 'duplicate-object') f.snapshot.objects.push(structuredClone(f.snapshot.objects[0]));
    f.updateBytes(); expect(await f.load()).toEqual([]);
  });
  it('does not load historical model blobs for current-model assignments or exclusions', async () => {
    const f = fixture(); Object.assign(f.current, f.context.scope);
    expect(await f.load()).toEqual([]); expect(f.query).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  });
  it('normalizes GUID braces/case and retains external identity when GUID properties conflict', async () => {
    const f = fixture(); f.snapshot.objects[0].properties[0].value = `{${guid.toUpperCase()}}`; f.updateBytes();
    expect((await f.load())[0].roots[0].identity.guid).toBe(guid);
    f.snapshot.objects[0].properties.push({ category: 'Other', name: 'GUID', value: id(89) }); f.updateBytes();
    expect((await f.load())[0].roots[0].identity).toEqual({ externalId: 'external-0', guid: null, sourceFile: '01-50_MSR_Kabeltassen.dwg' });
  });
  it('omits oversized identity properties rather than emitting a hint the model lookup cannot accept', async () => {
    const f = fixture(); f.snapshot.objects[0].properties[1].value = 'x'.repeat(1025); f.updateBytes();
    expect(await f.load()).toEqual([]);
  });
  it.each([['Global ID', 'Source_File_Name'], ['IFC.GUID', 'Quelldatei']])('recognizes stable property aliases %s and %s', async (guidName, sourceName) => {
    const f = fixture(); f.snapshot.objects[0].properties[0].name = guidName; f.snapshot.objects[0].properties[1].name = sourceName; f.updateBytes();
    expect((await f.load())[0].roots[0].identity).toEqual({ externalId: 'external-0', guid, sourceFile: '01-50_MSR_Kabeltassen.dwg' });
  });
  it('preserves exact SDK external IDs without trimming or Unicode normalization', async () => {
    const f = fixture(); f.snapshot.objects[0].externalId = ' e\u0301 '; f.updateBytes();
    expect((await f.load())[0].roots[0].identity.externalId).toBe(' e\u0301 ');
  });
  it.each(['invalid\nexternal', 'x'.repeat(1025)])('does not emit unsupported external identity text', async externalId => {
    const f = fixture(); f.snapshot.objects[0].externalId = externalId; f.updateBytes();
    const result = await f.load();
    if (externalId.length > 1024) expect(result).toEqual([]); // The historical snapshot itself violates its strict contract.
    else expect(result[0].roots[0].identity).toMatchObject({ externalId: null, guid });
  });
  it.each(['unique-external', 'duplicate-external', 'no-external'] as const)('never uses an ambiguous source GUID as fallback (%s)', async kind => {
    const f = fixture(), duplicate = structuredClone(f.snapshot.objects[0]); duplicate.id = 'dbid:42'; duplicate.dbId = 42;
    if (kind === 'unique-external') duplicate.externalId = 'different-external';
    if (kind === 'no-external') f.snapshot.objects[0].externalId = duplicate.externalId = null;
    f.snapshot.objects.push(duplicate); f.updateBytes();
    const result = await f.load();
    if (kind === 'unique-external') expect(result[0].roots[0].identity).toEqual({ externalId: 'external-0', guid: null, sourceFile: '01-50_MSR_Kabeltassen.dwg' });
    else expect(result).toEqual([]);
  });
  it('permits a source-scoped GUID repeated in another source file while requiring external IDs to be unique', async () => {
    const f = fixture(), duplicate = structuredClone(f.snapshot.objects[0]); duplicate.id = 'dbid:42'; duplicate.dbId = 42;
    duplicate.properties[1].value = 'different.dwg'; f.snapshot.objects.push(duplicate); f.updateBytes();
    expect((await f.load())[0].roots[0].identity).toEqual({ externalId: null, guid, sourceFile: '01-50_MSR_Kabeltassen.dwg' });
  });
});
