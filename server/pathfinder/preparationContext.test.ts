import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
const mocks = vi.hoisted(() => ({ catalog: vi.fn(), routing: vi.fn() }));
vi.mock('./catalog.js', () => ({ readRoutingCatalog: mocks.catalog }));
vi.mock('./purposePolicy.js', () => ({ readRoutingPolicyScope: mocks.routing }));
import { readPreparationContext, buildPreparationPlan, preparationDigest } from './preparationPlans.js';
import { preparationContextSchema, preparationPlanHashInput, type PreparationCreate } from '../../shared/pathfinderPreparation.js';
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let endpointRows: { name: string }[], currentModel: { state: string; health: string; content_fingerprint: string } | null;
let detailRows: Array<{ id: string; tray_type: unknown; width_mm: unknown; height_mm: unknown }>;
const query = vi.fn(async (sql: string, _params?: unknown[]) => {
  if (sql.startsWith('SELECT s.active_model_version_id')) return { rows: [{ active_model_version_id: id(2), selection_revision: '1', content_fingerprint: 'a'.repeat(64), state: 'ready', health: 'healthy' }] };
  if (sql.startsWith('SELECT state,health,content_fingerprint')) return { rows: currentModel ? [currentModel] : [] };
  if (sql.startsWith('INSERT INTO pf_project_preparations')) return { rows: [] };
  if (sql.startsWith('SELECT geometry_revision')) return { rows: [{ geometry_revision: '0', resolution_revision: '0', current_aggregate_id: null, current_artifact_id: null }] };
  if (sql.startsWith('SELECT registry_revision')) return { rows: [{ revision: '4' }] };
  if (sql.startsWith('SELECT r.purpose_key')) return { rows: [{ purpose_key: 'LV', allowed_categories: ['LV'] }] };
  if (sql.startsWith('/* preparation-tray-details */')) return { rows: detailRows };
  if (sql.startsWith('SELECT DISTINCT value')) return { rows: endpointRows };
  if (sql.startsWith('SELECT resolution FROM')) return { rows: [] };
  throw Error('Unhandled mocked SQL: ' + sql);
});
beforeEach(() => { vi.clearAllMocks(); endpointRows = [{ name: ' Equipment ' }]; currentModel = { state: 'ready', health: 'healthy', content_fingerprint: 'a'.repeat(64) }; detailRows = [{ id: id(10), tray_type: 'Ladder', width_mm: '300.5', height_mm: '60' }]; mocks.catalog.mockResolvedValue({ catalogRevision: '2', routingContentSha256: 'b'.repeat(64), rows: [{ projectTrayId: id(10), rawName: '/B001', rawPurpose: 'LV', purposeKey: 'LV' }], diagnostics: [] }); mocks.routing.mockResolvedValue({ catalogRevision: '2', routingContentSha256: 'b'.repeat(64), routingPolicyRevision: '3', routingPolicySha256: 'c'.repeat(64) }); });
describe('routing-only current preparation context from mocked SQL', () => {
  it('holds model selection and version facts FOR SHARE and preserves only routing dependencies', async () => { const context = await readPreparationContext({ query } as unknown as PoolClient, id(1)); expect(query.mock.calls.some(([sql]) => sql.includes('FOR SHARE OF s'))).toBe(true); expect(query.mock.calls.some(([sql]) => sql.startsWith('SELECT state,health,content_fingerprint') && sql.endsWith('FOR SHARE'))).toBe(true); expect(context.endpointNames).toEqual(['Equipment']); expect(context.scope).not.toHaveProperty('drawingInputRevision'); expect(query.mock.calls.some(([sql]) => sql.includes('pf_catalog_snapshots'))).toBe(false); });
  it.each(['missing', 'health', 'fingerprint'] as const)('refuses %s model-version change between selection read and version lock', async kind => { if (kind === 'missing') currentModel = null; else if (kind === 'health') currentModel!.health = 'unavailable'; else currentModel!.content_fingerprint = 'e'.repeat(64); await expect(readPreparationContext({ query } as unknown as PoolClient, id(1))).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' }); });
  it('refuses a potentially truncated 4097 raw-row prefix before trim/NFC collapse', async () => { endpointRows = Array.from({ length: 4097 }, (_v, n) => ({ name: 'Equipment' + ' '.repeat(n) })); await expect(readPreparationContext({ query } as unknown as PoolClient, id(1))).rejects.toMatchObject({ code: 'PREPARATION_ENDPOINT_LIMIT', status: 413 }); });
  it('retains invalid legacy catalog names/purposes as visible diagnostics without authorizing routing', async () => { mocks.catalog.mockResolvedValue({ catalogRevision: '2', routingContentSha256: 'b'.repeat(64), rows: [{ projectTrayId: id(10), rawName: 'x'.repeat(600), rawPurpose: 'bad\nvalue', purposeKey: 'bad\nvalue' }], diagnostics: [{ code: 'INVALID_TRAY_PURPOSE', projectTrayIds: [id(10)], message: 'Synthetic invalid legacy purpose' }] }); const context = await readPreparationContext({ query } as unknown as PoolClient, id(1)); expect(context.trays[0].policyState).toBe('invalid'); expect(context.trays[0].rawName).toHaveLength(600); expect(context.trays[0].allowedCategories).toEqual([]); });
  it('loads all current Type and dimension facts in one bounded project read and joins by UUID rather than name or position', async () => {
    mocks.catalog.mockResolvedValue({ catalogRevision: '2', routingContentSha256: 'b'.repeat(64), rows: [10, 11].map(n => ({ projectTrayId: id(n), rawName: '/B001', rawPurpose: 'LV', purposeKey: 'LV' })), diagnostics: [] });
    detailRows = [{ id: id(11), tray_type: ' Perforated tray ', width_mm: '150', height_mm: '40.25' },
      { id: id(10), tray_type: 'Ladder', width_mm: '300.5', height_mm: '60' },
      { id: id(99), tray_type: 'Unrelated', width_mm: '999', height_mm: '999' }];
    const context = await readPreparationContext({ query } as unknown as PoolClient, id(1));
    expect(context.trays.map(tray => [tray.projectTrayId, tray.details])).toEqual([
      [id(10), { type: 'Ladder', widthMm: 300.5, heightMm: 60 }],
      [id(11), { type: 'Perforated tray', widthMm: 150, heightMm: 40.25 }],
    ]);
    const calls = query.mock.calls.filter(([sql]) => sql.startsWith('/* preparation-tray-details */'));
    expect(calls).toHaveLength(1); expect(calls[0][0]).toContain('WHERE project_id=$1 ORDER BY id LIMIT 100001'); expect(calls[0][1]).toEqual([id(1)]);
    expect(query.mock.calls.some(([sql]) => /pf_catalog_snapshots|material_trays|drawingFacts/.test(sql))).toBe(false);
  });
  it.each([undefined, null, '', '-1', 'NaN', 'Infinity', '12\n', Number.NaN, Number.POSITIVE_INFINITY, -1])('keeps malformed or missing presentation dimensions unavailable (%s)', async invalid => {
    detailRows = [{ id: id(10), tray_type: 'bad\u0000type', width_mm: invalid, height_mm: invalid }];
    const context = await readPreparationContext({ query } as unknown as PoolClient, id(1));
    expect(context.trays[0].details).toEqual({ type: null, widthMm: null, heightMm: null }); expect(context.trays[0].policyState).toBe('configured');
  });
  it('preserves valid zero dimensions and treats absent, oversized or malformed Type facts as unavailable', async () => {
    detailRows = [{ id: id(10), tray_type: 'x'.repeat(501), width_mm: 0, height_mm: '0.000' }];
    expect((await readPreparationContext({ query } as unknown as PoolClient, id(1))).trays[0].details).toEqual({ type: null, widthMm: 0, heightMm: 0 });
    detailRows = [];
    expect((await readPreparationContext({ query } as unknown as PoolClient, id(1))).trays[0].details).toEqual({ type: null, widthMm: null, heightMm: null });
  });
  it('reads presentation edits freshly without changing routing scope, frozen coverage or plan content hashes', async () => {
    endpointRows = [];
    const before = await readPreparationContext({ query } as unknown as PoolClient, id(1));
    const input: PreparationCreate = { schemaVersion: 'wfc.pf.preparation-create.v1', expected: before.scope, idempotencyKey: id(50),
      discovery: { schemaVersion: 'wfc.pf.discovery-report.v1', modelVersionId: before.scope.modelVersionId, selectionRevision: before.scope.selectionRevision,
        contentFingerprint: before.scope.contentFingerprint, matchingPolicyVersion: 'wfc.pf.project-exact-candidates.v1', complete: true, propertyScan: null,
        objects: [{ objectId: 'dbid:1', parentId: null, name: '/B001', hasGeometry: false, isPhysicalLeaf: false, orderIndex: 0 },
          { objectId: 'dbid:2', parentId: 'dbid:1', name: 'FTUBE', hasGeometry: true, isPhysicalLeaf: true, orderIndex: 1 }],
        trays: [{ projectTrayId: id(10), candidateRootObjectIds: ['dbid:1'] }], endpointCandidates: [] } };
    const beforePlan = buildPreparationPlan(before, input, id(51));
    detailRows = [{ id: id(10), tray_type: 'New tray type', width_mm: '600', height_mm: '100.125' }];
    const after = await readPreparationContext({ query } as unknown as PoolClient, id(1)), afterPlan = buildPreparationPlan(after, input, id(51));
    expect(after.trays[0].details).toEqual({ type: 'New tray type', widthMm: 600, heightMm: 100.125 });
    expect(after.scope).toEqual(before.scope); expect(afterPlan.requestedScope).toEqual(beforePlan.requestedScope);
    expect(afterPlan.requestedScope.trays[0]).not.toHaveProperty('details'); expect(afterPlan.diagnostics).toEqual([]);
    // Independent plans receive new part UUIDs. Compare the complete hash input
    // with those non-content IDs held constant, as for the same frozen plan.
    const samePartIds = { ...afterPlan, partPlan: afterPlan.partPlan.map((part, index) => ({ ...part, partId: beforePlan.partPlan[index].partId })) };
    expect(preparationDigest(preparationPlanHashInput(samePartIds))).toBe(beforePlan.orderedPlanSha256);
    expect(query.mock.calls.filter(([sql]) => sql.startsWith('/* preparation-tray-details */'))).toHaveLength(2);
    const legacy = { ...after, trays: after.trays.map(({ details: _details, ...tray }) => tray) };
    expect(preparationContextSchema.parse(legacy)).toEqual(legacy);
  });
});
