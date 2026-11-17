// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { buildPreparationPlan, preparationDigest } from '../pathfinder/preparationPlans.js';
import { projectRoutingCatalogRows } from '../pathfinder/catalog.js';
import { catalogRoutingHashInput } from '../../shared/pathfinderPurposePolicy.js';
import { preparationContextSchema, preparationCreateSchema, preparationPlanHashInput } from '../../shared/pathfinderPreparation.js';
import { parseRoutingBindingQuery,readViewerRoutingBindings } from './routingBindings.js';
import { readCadOverlay, encodeCadOverlay } from '../pathfinder/cadOverlay.js';
import { PathFinderError } from '../pathfinder/errors.js';
vi.mock('../pathfinder/cadOverlay.js', async importOriginal => ({
  ...await importOriginal<typeof import('../pathfinder/cadOverlay.js')>(), readCadOverlay: vi.fn(async () => null),
}));

const id = (n: number) => `11000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture(options: { mappings?: number; roots?: number; longNames?: boolean } = {}) {
  const mappings = options.mappings ?? 1, roots = options.roots ?? 1, projectId = id(1), modelVersionId = id(2);
  const source: Array<{ id: string; name: string; purpose: string }> = [];
  const objects: Array<{ objectId: string; parentId: string | null; name: string; hasGeometry: boolean; isPhysicalLeaf: boolean; orderIndex: number }> =
    [{ objectId: 'dbid:1', parentId: null, name: 'Plant', hasGeometry: false, isPhysicalLeaf: false, orderIndex: 0 }];
  const decisions: any[] = [], trays: any[] = [], discovered: any[] = [];
  const scope = { modelVersionId, contentFingerprint: 'a'.repeat(64), selectionRevision: '1', catalogRevision: '1', routingContentSha256: 'b'.repeat(64), routingPolicyRevision: '1', routingPolicySha256: 'c'.repeat(64), locationRegistryRevision: '0', resolutionRevision: '1' };
  let objectId = 2;
  for (let n = 0; n <= mappings; n++) {
    const explicit = n < mappings, name = options.longNames ? '/A' + String(n).padStart(3, '0') + 'X'.repeat(195) : explicit ? '/A' + (105 + n) : '/B001';
    const projectTrayId = id(100 + n), rootIds: string[] = [];
    source.push({ id: projectTrayId, name, purpose: 'LV' });
    for (let r = 0; r < (explicit ? roots : 1); r++) {
      const root = objectId++, leaf = objectId++; rootIds.push('dbid:' + root);
      objects.push({ objectId: 'dbid:' + root, parentId: 'dbid:1', name: explicit ? name + 'x' + r : name, hasGeometry: false, isPhysicalLeaf: false, orderIndex: root - 1 },
        { objectId: 'dbid:' + leaf, parentId: 'dbid:' + root, name: 'STRAIGHT', hasGeometry: true, isPhysicalLeaf: true, orderIndex: leaf - 1 });
    }
    trays.push({ projectTrayId, rawName: name, purposeKey: 'LV', routeName: name, allowedCategories: ['LV'], policyState: 'configured', diagnosticCodes: [] });
    discovered.push({ projectTrayId, candidateRootObjectIds: explicit ? [] : rootIds });
    if (explicit) decisions.push({ id: id(1000 + n), projectTrayId, mode: 'roots', rootObjectIds: rootIds, reason: 'PRIVATE physical ownership reason', actorId: id(10), createdAt: '2026-10-20T00:00:00Z', scope });
  }
  const catalog = projectRoutingCatalogRows(source);
  scope.routingContentSha256 = preparationDigest(catalogRoutingHashInput(projectId, catalog.rows, catalog.diagnostics));
  const context = preparationContextSchema.parse({ schemaVersion: 'wfc.pf.preparation-context.v1', projectId, scope, trays, endpointNames: [], resolutions: decisions, diagnostics: [], currentAggregate: null });
  const input = preparationCreateSchema.parse({ schemaVersion: 'wfc.pf.preparation-create.v1', expected: scope, idempotencyKey: id(9), discovery: {
    schemaVersion: 'wfc.pf.discovery-report.v1', modelVersionId, contentFingerprint: scope.contentFingerprint, selectionRevision: '1', matchingPolicyVersion: 'wfc.pf.project-exact-candidates.v2', complete: true,
    propertyScan: null, objects, trays: discovered, endpointCandidates: [],
  } });
  const plan = buildPreparationPlan(context, input, id(20)), physical = plan.requestedScope.orderedPhysicalLeafIds.length;
  const aggregate: any = { ...scope, schemaVersion: 'wfc.pf.geometry-aggregate.v1', id: id(21), projectId, sessionId: plan.id, artifactId: id(22), geometryRevision: '1', sourceLocationRegistryRevision: '0', locationRegistryRevision: '1',
    coordinateFrameId: plan.coordinateFrameId, orderedPlanSha256: plan.orderedPlanSha256, orderedScopeSha256: plan.requestedScope.scopeSha256,
    partReferences: plan.partPlan.map(part => ({ partId: part.partId, partIndex: part.partIndex, payloadSha256: 'e'.repeat(64) })),
    projection: { schemaVersion: 'pathfinder.model.snapshot.v1', payloadRef: id(22), sha256: 'd'.repeat(64), bytes: 100 },
    traceIndex: { schemaVersion: 'wfc.pf.preparation-trace-index.v1', payloadRef: id(23), sha256: 'f'.repeat(64), bytes: 100 },
    counts: { objects: objects.length, physicalLeaves: physical, fragments: physical, vertices: physical * 3, triangles: physical }, requestedScopeComplete: true, wholePlantGeometry: false,
    engineVersion: 'fixture', rulesVersion: 'fixture', diagnostics: [], engineeringAccepted: false, nativeParity: 'not-performed', publishedAt: '2026-10-20T00:00:00Z' };
  const row: any = { active_model_version_id: modelVersionId, selection_revision: '1', content_fingerprint: scope.contentFingerprint,
    current_aggregate_id: aggregate.id, current_artifact_id: aggregate.artifactId, geometry_revision: '1', resolution_revision: '1', catalog_revision: '1', routing_policy_revision: '1',
    aggregate_id: aggregate.id, aggregate_project_id: projectId, aggregate_model_id: modelVersionId, session_id: plan.id, artifact_id: aggregate.artifactId, aggregate_geometry_revision: '1', manifest: aggregate,
    manifest_oversize: false, plan_oversize: false, session_state: 'published', published_aggregate_id: aggregate.id, plan, artifact_model_id: modelVersionId,
    snapshot_sha256: aggregate.projection.sha256, snapshot_bytes: '100', producer_version: 'pathfinder.catalog-preparation.v1',
    routing_scope: { catalogRevision: scope.catalogRevision, routingContentSha256: scope.routingContentSha256, routingPolicyRevision: scope.routingPolicyRevision, routingPolicySha256: scope.routingPolicySha256 }, publication_proof: true };
  const parts = plan.partPlan.map(part => ({ part_id: part.partId, part_index: part.partIndex, plan_sha256: plan.orderedPlanSha256, payload_sha256: 'e'.repeat(64) }));
  const policy = { catalog_revision: '1', routing_policy_revision: '1' }, preparation = { current_aggregate_id: aggregate.id, current_artifact_id: aggregate.artifactId, geometry_revision: '1', resolution_revision: '1' };
  const query = vi.fn(async (sql: string,params?:unknown[]) => {
    if (sql.includes('viewer-routing-bindings:publication')) return { rows: [row] };
    if (sql.includes('viewer-routing-bindings:catalog')) return { rows: source };
    if (sql.includes('viewer-routing-bindings:parts')) return { rows: parts };
    if (sql.includes('viewer-routing-bindings:decisions')) return { rows: decisions.filter(resolution=>(params?.[1] as string[]).includes(resolution.id)).map(resolution => ({ resolution })) };
    if (sql.includes('viewer-routing-bindings:policy-fence')) return { rows: [policy] };
    if (sql.includes('viewer-routing-bindings:preparation-fence')) return { rows: [preparation] };
    throw new Error('Unexpected query');
  });
  const rehash = () => { const { scopeSha256: _old, ...scopeInput } = plan.requestedScope; plan.requestedScope.scopeSha256 = preparationDigest(scopeInput); plan.orderedPlanSha256 = preparationDigest(preparationPlanHashInput(plan)); aggregate.orderedPlanSha256 = plan.orderedPlanSha256; aggregate.orderedScopeSha256 = plan.requestedScope.scopeSha256; for (const part of parts) part.plan_sha256 = plan.orderedPlanSha256; };
  return { client: { query } as unknown as PoolClient, query, row, plan, aggregate, parts, source, decisions, policy, preparation, rehash,
    input: { projectId, modelVersionId, contentFingerprint: scope.contentFingerprint } };
}

describe('ordinary Viewer published routing bindings', () => {
  const cad = (f: ReturnType<typeof fixture>) => encodeCadOverlay({ schemaVersion: 'wfc.pf.cad-overlay-payload.v3',
    projectId: f.input.projectId, modelVersionId: f.input.modelVersionId, baseSnapshotSha256: f.aggregate.projection.sha256,
    segments: [{ id: `cad:${id(901)}`, name: '/BC027-2', allowedCategoryMask: 4,
      pointsMetres: [[4.61,68.54,19.33],[4.61,74.54,19.33]],
      ports: [{ pointMetres: [4.61,68.54,19.33], outward:[0,-1,0],u:[1,0,0],v:[0,0,1],widthMetres:.3,heightMetres:.06 }] },
    { id: `cad:${id(902)}`, name: '/BC027-1', allowedCategoryMask: 4,
      pointsMetres: [[4.61,74.54,19.33],[4.61,75,19.33],[5,75,19.33]],
      ports: [{ pointMetres: [4.61,74.54,19.33], outward:[0,-1,0],u:[1,0,0],v:[0,0,1],widthMetres:.3,heightMetres:.06 }] }] });
  it('projects exact current CAD centerlines beside SDK mappings after validated additive catalog changes', async () => {
    const f = fixture(); f.source.push({ id:id(903),name:'BC027-2',purpose:'LV' },{id:id(904),name:'BC027-1',purpose:'LV'});
    f.row.catalog_revision = f.policy.catalog_revision = '2';
    vi.mocked(readCadOverlay).mockResolvedValueOnce(cad(f));
    const result = await readViewerRoutingBindings(f.client, f.input);
    expect(result.schemaVersion).toBe('wfc.viewer.routing-bindings.v2');
    expect(result.bindings).toHaveLength(1); expect(result.cadBindings?.map(value=>value.routeName)).toEqual(['/BC027-2','/BC027-1']);
    expect(result.cadBindings?.find(value=>value.routeName==='/BC027-1')?.paths[0].pointsMetres).toEqual([[4.61,74.54,19.33],[4.61,75,19.33],[5,75,19.33]]);
    expect(readCadOverlay).toHaveBeenLastCalledWith(f.client,f.input.projectId,f.aggregate.artifactId,f.aggregate.projection.sha256,
      f.input.modelVersionId,f.row.routing_scope,{...f.row.routing_scope,catalogRevision:'2'},{lock:false});
    expect(f.query.mock.calls.every(([sql])=>! /\b(?:INSERT|UPDATE|DELETE)\b/i.test(sql))).toBe(true);
  });
  it('returns only requested CAD names and never reveals their private publications or masks', async () => {
    const f = fixture(); f.source.push({id:id(903),name:'BC027-2',purpose:'LV'},{id:id(904),name:'BC027-1',purpose:'LV'});
    vi.mocked(readCadOverlay).mockResolvedValueOnce(cad(f));
    const result = await readViewerRoutingBindings(f.client,{...f.input,routeCodes:['BC027-2']});
    expect(result.cadBindings).toHaveLength(1); expect(result.cadBindings?.[0].routeName).toBe('/BC027-2');
    expect(JSON.stringify(result)).not.toMatch(/payloadBase64|allowedCategoryMask|baseSnapshotSha256|cad:/);
  });
  it('withdrawn CAD paths disappear on the next read while validated base mappings survive', async () => {
    const f = fixture(); f.row.catalog_revision = f.policy.catalog_revision = '2';
    vi.mocked(readCadOverlay).mockResolvedValueOnce('retired-base-proof');
    const result = await readViewerRoutingBindings(f.client,f.input);
    expect(result.schemaVersion).toBe('wfc.viewer.routing-bindings.v1'); expect(result.cadBindings).toBeUndefined();
    expect(result.bindings).toHaveLength(1);
  });
  it('refuses ambiguous native project names instead of treating several tray rows as one CAD route',async()=>{
    const f=fixture();f.source.push({id:id(903),name:'BC027-2',purpose:'LV'},{id:id(904),name:'BC027-2',purpose:'LV'});
    vi.mocked(readCadOverlay).mockResolvedValueOnce(cad(f));
    await expect(readViewerRoutingBindings(f.client,{...f.input,routeCodes:['BC027-2']})).rejects.toMatchObject({code:'ROUTING_BINDINGS_INVALID'});
  });
  it('refuses changed CAD publication provenance instead of claiming it is missing model geometry', async () => {
    const f = fixture(); vi.mocked(readCadOverlay).mockRejectedValueOnce(new PathFinderError('CAD_ROUTE_BASE_CHANGED',409));
    await expect(readViewerRoutingBindings(f.client,f.input)).rejects.toMatchObject({code:'ROUTING_BINDINGS_INVALID'});
  });
  it('returns exact requested bindings from a larger project without weakening publication proof or response bounds',async()=>{
    const f=fixture({mappings:129});
    const result=await readViewerRoutingBindings(f.client,{...f.input,routeCodes:['A105']});
    expect(result.bindings.map(binding=>binding.routeName)).toEqual(['/A105']);
    expect(f.query.mock.calls.some(([sql])=>sql.includes('viewer-routing-bindings:parts'))).toBe(true);
    expect(f.query.mock.calls.some(([sql])=>sql.includes('viewer-routing-bindings:policy-fence'))).toBe(true);
    const unknown=fixture({mappings:129});expect((await readViewerRoutingBindings(unknown.client,{...unknown.input,routeCodes:['A1050','A,B']})).bindings).toEqual([]);
    const broken=fixture({mappings:129});broken.parts[0].payload_sha256='0'.repeat(64);
    await expect(readViewerRoutingBindings(broken.client,{...broken.input,routeCodes:['A105']})).rejects.toMatchObject({code:'ROUTING_BINDINGS_INVALID'});
  });
  it('preserves root and byte caps for the requested subset instead of truncating it',async()=>{
    const f=fixture({roots:513});await expect(readViewerRoutingBindings(f.client,{...f.input,routeCodes:['A105']})).rejects.toMatchObject({code:'ROUTING_BINDINGS_LIMIT'});
  });
  it('parses one bounded canonical JSON route-code query without splitting commas or accepting overrides',()=>{
    const base='/viewer/routing-bindings';expect(parseRoutingBindingQuery(base)).toBeUndefined();
    expect(parseRoutingBindingQuery(base+'?'+new URLSearchParams({routeCodes:JSON.stringify(['A105','A,B'])}))).toEqual(['A105','A,B']);
    for(const value of ['',JSON.stringify([]),JSON.stringify(['a105']),JSON.stringify(['/A105']),JSON.stringify(['A105','A105']),JSON.stringify(['SECONDARY']),JSON.stringify(Array.from({length:101},(_,i)=>'A'+i)),JSON.stringify({rootIds:['dbid:1']})])
      expect(()=>parseRoutingBindingQuery(base+'?'+new URLSearchParams({routeCodes:value}))).toThrow();
    expect(()=>parseRoutingBindingQuery(base+'?routeCodes=%5B%22A105%22%5D&routeCodes=%5B%22A106%22%5D')).toThrow();
    expect(()=>parseRoutingBindingQuery(base+'?routeCodes=%5B%22A105%22%5D&domain=x')).toThrow();
    expect(()=>parseRoutingBindingQuery(base+'?routeCodes='+encodeURIComponent(JSON.stringify(['A'.repeat(9000)])))).toThrow();
  });
  it('projects only explicit immutable ownership and preserves the project route without fuzzy suffix changes', async () => {
    const f = fixture(), result = await readViewerRoutingBindings(f.client, f.input);
    expect(result).toEqual({ schemaVersion: 'wfc.viewer.routing-bindings.v1', modelVersionId: f.input.modelVersionId, contentFingerprint: f.input.contentFingerprint, selectionRevision: '1', aggregateId: f.aggregate.id,
      bindings: [{ routeName: '/A105', rootObjectIds: ['dbid:2'] }] });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|actorId|reason|plan|purpose|location|A105x/);
    expect(f.query.mock.calls.every(([sql]) => !/\b(?:INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b/i.test(sql))).toBe(true);
  });
  it('retains audited disjoint multiple roots as one logical route', async () => {
    const f = fixture({ roots: 3 }); expect((await readViewerRoutingBindings(f.client, f.input)).bindings).toEqual([{ routeName: '/A105', rootObjectIds: ['dbid:2', 'dbid:4', 'dbid:6'] }]);
  });
  it('retains valid tray ownership when endpoint registry revisions advance before preparation', async () => {
    const f = fixture();
    f.plan.locationRegistryRevision = '2756'; f.aggregate.sourceLocationRegistryRevision = '2756'; f.aggregate.locationRegistryRevision = '2757';
    f.decisions[0].scope = { ...f.decisions[0].scope, locationRegistryRevision: '2750', resolutionRevision: '0' }; f.rehash();
    expect((await readViewerRoutingBindings(f.client, f.input)).bindings).toEqual([{ routeName: '/A105', rootObjectIds: ['dbid:2'] }]);
  });
  it.each(['modelVersionId', 'contentFingerprint', 'selectionRevision', 'catalogRevision', 'routingContentSha256', 'routingPolicyRevision', 'routingPolicySha256'] as const)(
    'rejects a tray ownership decision with changed %s despite an older endpoint registry revision', async key => {
      const f = fixture();
      f.plan.locationRegistryRevision = '2756'; f.aggregate.sourceLocationRegistryRevision = '2756'; f.aggregate.locationRegistryRevision = '2757'; f.rehash();
      f.decisions[0].scope = { ...f.decisions[0].scope, locationRegistryRevision: '2750',
        [key]: key === 'modelVersionId' ? id(99) : key.endsWith('Sha256') || key === 'contentFingerprint' ? '0'.repeat(64) : '99' };
      await expect(readViewerRoutingBindings(f.client, f.input)).rejects.toMatchObject({ code: 'ROUTING_BINDINGS_INVALID' });
    });
  it('returns an explicit empty projection when there is no current publication', async () => {
    const f = fixture(); f.row.current_aggregate_id = null;
    expect(await readViewerRoutingBindings(f.client, f.input)).toMatchObject({ aggregateId: null, bindings: [], selectionRevision: '1' }); expect(f.query).toHaveBeenCalledTimes(1);
  });
  it.each(['catalog_revision', 'routing_policy_revision', 'resolution_revision'])('does not carry mappings through stale %s', async key => {
    const f = fixture(); f.row[key] = '2'; expect(await readViewerRoutingBindings(f.client, f.input)).toMatchObject({ aggregateId: null, bindings: [] });
  });
  it('does not carry a previous model or selection publication into the live model', async () => {
    for (const key of ['modelVersionId', 'selectionRevision', 'contentFingerprint']) { const f = fixture(); f.aggregate[key] = key === 'modelVersionId' ? id(99) : key === 'contentFingerprint' ? '0'.repeat(64) : '0'; expect(await readViewerRoutingBindings(f.client, f.input)).toMatchObject({ aggregateId: null, bindings: [] }); }
  });
  it('checks live catalog content independently of its revision counter', async () => {
    const f = fixture(); f.source[0].name = '/A106'; expect(await readViewerRoutingBindings(f.client, f.input)).toMatchObject({ aggregateId: null, bindings: [] });
  });
  it.each(['publication_proof', 'published_aggregate_id', 'snapshot_sha256', 'producer_version'])('rejects corrupt immutable publication proof %s', async key => {
    const f = fixture(); f.row[key] = key === 'publication_proof' ? false : 'corrupt'; await expect(readViewerRoutingBindings(f.client, f.input)).rejects.toMatchObject({ code: 'ROUTING_BINDINGS_INVALID', status: 409 });
  });
  it('rejects a tampered plan, immutable part or ownership event', async () => {
    const plan = fixture(); plan.plan.objectManifest[1].name = 'changed'; await expect(readViewerRoutingBindings(plan.client, plan.input)).rejects.toMatchObject({ code: 'ROUTING_BINDINGS_INVALID' });
    const part = fixture(); part.parts[0].payload_sha256 = '0'.repeat(64); await expect(readViewerRoutingBindings(part.client, part.input)).rejects.toMatchObject({ code: 'ROUTING_BINDINGS_INVALID' });
    const decision = fixture(); decision.decisions[0].rootObjectIds = ['dbid:4']; await expect(readViewerRoutingBindings(decision.client, decision.input)).rejects.toMatchObject({ code: 'ROUTING_BINDINGS_INVALID' });
  });
  it('rejects global roots, absent roots and overlapping physical ownership', async () => {
    for (const root of ['dbid:1', 'dbid:999999', 'dbid:4']) { const f = fixture(); f.plan.requestedScope.trays[0].orderedRootObjectIds = [root]; f.rehash(); await expect(readViewerRoutingBindings(f.client, f.input)).rejects.toMatchObject({ code: 'ROUTING_BINDINGS_INVALID' }); }
  });
  it('rejects duplicate normalized project routing keys', async () => {
    const f = fixture(); f.plan.requestedScope.trays[1].routeName = '/a105'; f.rehash(); await expect(readViewerRoutingBindings(f.client, f.input)).rejects.toMatchObject({ code: 'ROUTING_BINDINGS_INVALID' });
  });
  it.each([{ mappings: 129 }, { roots: 513 }, { mappings: 128, longNames: true }])('refuses the complete projection over a bound, without truncating %j', async options => {
    const f = fixture(options); await expect(readViewerRoutingBindings(f.client, f.input)).rejects.toMatchObject({ code: 'ROUTING_BINDINGS_LIMIT', status: 413 });
  });
  it('fences a concurrent current aggregate or policy change before returning mappings', async () => {
    const policy = fixture(); policy.policy.catalog_revision = '2'; expect(await readViewerRoutingBindings(policy.client, policy.input)).toMatchObject({ aggregateId: null, bindings: [] });
    const aggregate = fixture(); aggregate.preparation.current_aggregate_id = id(99); expect(await readViewerRoutingBindings(aggregate.client, aggregate.input)).toMatchObject({ aggregateId: null, bindings: [] });
  });
});
