import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
const mocks = vi.hoisted(() => ({ catalog: vi.fn(), routing: vi.fn() }));
vi.mock('./catalog.js', () => ({ readRoutingCatalog: mocks.catalog }));
vi.mock('./purposePolicy.js', () => ({ readRoutingPolicyScope: mocks.routing }));
import { readPreparationContext } from './preparationPlans.js';
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let endpointRows: { name: string }[], currentModel: { state: string; health: string; content_fingerprint: string } | null;
const query = vi.fn(async (sql: string) => {
  if (sql.startsWith('SELECT s.active_model_version_id')) return { rows: [{ active_model_version_id: id(2), selection_revision: '1', content_fingerprint: 'a'.repeat(64), state: 'ready', health: 'healthy' }] };
  if (sql.startsWith('SELECT state,health,content_fingerprint')) return { rows: currentModel ? [currentModel] : [] };
  if (sql.startsWith('INSERT INTO pf_project_preparations')) return { rows: [] };
  if (sql.startsWith('SELECT geometry_revision')) return { rows: [{ geometry_revision: '0', resolution_revision: '0', current_aggregate_id: null, current_artifact_id: null }] };
  if (sql.startsWith('SELECT registry_revision')) return { rows: [{ revision: '4' }] };
  if (sql.startsWith('SELECT r.purpose_key')) return { rows: [{ purpose_key: 'LV', allowed_categories: ['LV'] }] };
  if (sql.startsWith('SELECT DISTINCT value')) return { rows: endpointRows };
  if (sql.startsWith('SELECT resolution FROM')) return { rows: [] };
  throw Error('Unhandled mocked SQL: ' + sql);
});
beforeEach(() => { vi.clearAllMocks(); endpointRows = [{ name: ' Equipment ' }]; currentModel = { state: 'ready', health: 'healthy', content_fingerprint: 'a'.repeat(64) }; mocks.catalog.mockResolvedValue({ catalogRevision: '2', routingContentSha256: 'b'.repeat(64), rows: [{ projectTrayId: id(10), rawName: '/B001', rawPurpose: 'LV', purposeKey: 'LV' }], diagnostics: [] }); mocks.routing.mockResolvedValue({ catalogRevision: '2', routingContentSha256: 'b'.repeat(64), routingPolicyRevision: '3', routingPolicySha256: 'c'.repeat(64) }); });
describe('routing-only current preparation context from mocked SQL', () => {
  it('holds model selection and version facts FOR SHARE and preserves only routing dependencies', async () => { const context = await readPreparationContext({ query } as unknown as PoolClient, id(1)); expect(query.mock.calls.some(([sql]) => sql.includes('FOR SHARE OF s'))).toBe(true); expect(query.mock.calls.some(([sql]) => sql.startsWith('SELECT state,health,content_fingerprint') && sql.endsWith('FOR SHARE'))).toBe(true); expect(context.endpointNames).toEqual(['Equipment']); expect(context.scope).not.toHaveProperty('drawingInputRevision'); expect(query.mock.calls.some(([sql]) => sql.includes('pf_catalog_snapshots'))).toBe(false); });
  it.each(['missing', 'health', 'fingerprint'] as const)('refuses %s model-version change between selection read and version lock', async kind => { if (kind === 'missing') currentModel = null; else if (kind === 'health') currentModel!.health = 'unavailable'; else currentModel!.content_fingerprint = 'e'.repeat(64); await expect(readPreparationContext({ query } as unknown as PoolClient, id(1))).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' }); });
  it('refuses a potentially truncated 4097 raw-row prefix before trim/NFC collapse', async () => { endpointRows = Array.from({ length: 4097 }, (_v, n) => ({ name: 'Equipment' + ' '.repeat(n) })); await expect(readPreparationContext({ query } as unknown as PoolClient, id(1))).rejects.toMatchObject({ code: 'PREPARATION_ENDPOINT_LIMIT', status: 413 }); });
  it('retains invalid legacy catalog names/purposes as visible diagnostics without authorizing routing', async () => { mocks.catalog.mockResolvedValue({ catalogRevision: '2', routingContentSha256: 'b'.repeat(64), rows: [{ projectTrayId: id(10), rawName: 'x'.repeat(600), rawPurpose: 'bad\nvalue', purposeKey: 'bad\nvalue' }], diagnostics: [{ code: 'INVALID_TRAY_PURPOSE', projectTrayIds: [id(10)], message: 'Synthetic invalid legacy purpose' }] }); const context = await readPreparationContext({ query } as unknown as PoolClient, id(1)); expect(context.trays[0].policyState).toBe('invalid'); expect(context.trays[0].rawName).toHaveLength(600); expect(context.trays[0].allowedCategories).toEqual([]); });
});
