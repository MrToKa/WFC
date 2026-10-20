// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { createCableWorkflowRepository } from './cableWorkflowRepository.js';
import { classifyCableWorkflow } from '../../shared/pathfinderCableWorkflow.js';
import { defaultOptions } from './jobContracts.js';
import { endpointBindingFixture } from '../../shared/pathfinderEndpointFixtures.js';

const mocks = vi.hoisted(() => ({ tx: vi.fn(), common: vi.fn(), heads: vi.fn(), automatic: vi.fn(), verified: vi.fn(), reviewable: vi.fn(), accepted: vi.fn() }));
vi.mock('./cableWorkflowRead.js', () => ({ cableWorkflowReadTransaction: mocks.tx }));
vi.mock('./dependencies.js', async original => ({ ...await original<typeof import('./dependencies.js')>(), collectCommonCalculationInputs: mocks.common,
  freezeCableDependencies: (common: object, cable: Record<string, unknown>) => ({ cable, status: 'ready', message: '', dependencies: { ...common, cableId: cable.id, cableWriteRevision: cable.cable_write_revision } }) }));
vi.mock('./endpointBindingRepository.js', () => ({ readCurrentEndpointBindingContext: vi.fn(async () => null), readNeededEndpointBindingHeads: mocks.heads }));
vi.mock('./automaticEndpointCandidates.js', () => ({ readAutomaticEndpointCandidates: mocks.automatic }));
vi.mock('./cableWorkflowProof.js', () => ({ createCableWorkflowProofReader: () => ({ verified: mocks.verified, reviewable: mocks.reviewable, accepted: mocks.accepted }) }));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const projectId = id(1), who = { userId: id(2), loginId: id(3), loginExpiresAt: Date.now() + 1000_000 };
function cable(n: number) { return { id: id(1000 + n), cable_type_id: id(4), mto: 'Control', cable_write_revision: '7', tag: `SYNTHETIC-${n}`,
  from_location: 'A', to_location: 'B', routing: null, design_length: null, install_length: '123', input_oversize: false }; }
function meta(n: number, patch: Record<string, unknown> = {}) { return { cable_id: id(1000 + n), admission_id: id(10), job_id: id(11), job_status: 'running',
  cancel_requested: false, item_state: 'waiting', item_status: 'ready', baseline_status: 'ready', proposal_id: null, proposal_hash: null, proposal_status: null, ...patch }; }
function common() { return { status: 'ready', bindingContext: { modelVersionId: id(5), selectionRevision: '1', artifactId: id(6), aggregateId: id(7),
  contentFingerprint: 'a'.repeat(64), captureFrameId: id(8), projectionSha256: 'b'.repeat(64), geometryRevision: '2', traceId: id(9) },
  inputs: { projectId, registryRevision: '1', model: { id: id(5), selectionRevision: '1', contentFingerprint: 'a'.repeat(64) },
    options: { ...defaultOptions, connectionToleranceMeters: 1 }, settings: { revision: '1' }, engineIdentity: { contentSha256: 'c'.repeat(64) } } }; }
function fixture(count = 1) {
  const state = { cables: Array.from({ length: count }, (_, n) => cable(n)), metadata: new Map<string, ReturnType<typeof meta>>(),
    admissionCount: 1, generation: '1', latest: id(10), aliases: true, common: common(), badScan: false, hasReceipt: false, allowReview: true };
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    if (sql.includes('cable-workflow:context')) return { rows: [{ active_model_version_id: id(5), selection_revision: '1', admission_count: state.admissionCount,
      context: { generation: state.generation, latest: state.latest } }] };
    if (sql.includes('cable-workflow:candidates')) {
      const after = values[1] as string | null, exact = values[2] as string | null;
      const found = state.cables.filter(value => value.mto !== 'MV' && (!after || value.id > after) && (!exact || value.id === exact)).slice(0, 201);
      return { rows: state.badScan && found.length ? [found[0], found[0]] : found };
    }
    if (sql.includes('cable-workflow:needed-locations')) return { rows: state.aliases ? [{ normalized_alias: 'A', id: id(20), name: 'A', revision: '1', has_legacy: false },
      { normalized_alias: 'B', id: id(21), name: 'B', revision: '1', has_legacy: false }] : [] };
    if (sql.includes('cable-workflow:latest-admissions')) return { rows: (values[1] as string[]).flatMap(cableId => state.metadata.has(cableId) ? [state.metadata.get(cableId)!] : []) };
    if (sql.includes('cable-workflow:accepted-identities')) return { rows: state.hasReceipt ? [{ cable_id: state.cables[0].id }] : [] };
    throw Error('Unexpected SQL in explicit mocked read-model protocol: ' + sql.slice(0, 80));
  });
  const client = { query } as unknown as PoolClient;
  mocks.tx.mockImplementation(async (_pool, _project, _who, operation) => operation(client, () => undefined));
  mocks.common.mockImplementation(async () => state.common);
  mocks.heads.mockImplementation(async () => new Map([20, 21].map(n => { const binding = { ...endpointBindingFixture(), projectId, locationId: id(n) }; return [id(n), { binding, ready: true }]; })));
  mocks.automatic.mockResolvedValue(new Map());
  mocks.verified.mockImplementation(async () => ({ dependencies: { options: state.common.inputs?.options ?? defaultOptions } }));
  mocks.reviewable.mockImplementation(async (_cable, _job, _proposal, current) => ({ currentness: current ? 'current' : 'changed', reviewable: !!current && state.allowReview, reasonCodes: [] }));
  mocks.accepted.mockResolvedValue(false);
  const repo = createCableWorkflowRepository({} as Pool, { cursorKey: Buffer.alloc(32, 42) });
  return { state, query, repo };
}
beforeEach(() => vi.clearAllMocks());

describe('bounded cable diagnostics, mocked SQL protocol and explicit proof/auth seams', () => {
  it('continues beyond200 checked nonmatches and finds the actual active cable on the next page', async () => {
    const f = fixture(201); for (let n = 0; n < 200; n++) f.state.metadata.set(id(1000 + n), meta(n, { item_state: 'blocked', item_status: 'locations_required' }));
    f.state.metadata.set(id(1200), meta(200));
    const first = await f.repo.page(projectId, who, { filter: 'calculating' });
    expect(first.rows).toEqual([]); expect(first.scannedCount).toBe(200); expect(first.nextCursor).not.toBeNull();
    const second = await f.repo.page(projectId, who, { filter: 'calculating', cursor: first.nextCursor });
    expect(second.rows.map(value => value.cable.id)).toEqual([id(1200)]); expect(second.nextCursor).toBeNull(); expect(second.scannedCount).toBe(1);
  });
  it('stops at the requested match without consuming a later match, including limit1', async () => {
    const f = fixture(3), first = await f.repo.page(projectId, who, { filter: 'all', limit: 1 });
    expect(first.scannedCount).toBe(1); expect(first.scannedThroughCableId).toBe(id(1000)); expect(first.rows).toHaveLength(1);
    const second = await f.repo.page(projectId, who, { filter: 'all', limit: 1, cursor: first.nextCursor });
    expect(second.rows[0].cable.id).toBe(id(1001));
  });
  it('uses exact literal Unicode matching without SQL wildcard interpretation', async () => {
    const f = fixture(3); f.state.cables[1].tag = 'cafe\u0301_%\\';
    const result = await f.repo.page(projectId, who, { filter: 'all', search: '  CAFÉ_%\\  ' });
    expect(result.rows.map(value => value.cable.id)).toEqual([id(1001)]); expect(result.scannedCount).toBe(3);
    expect(f.query.mock.calls.find(([sql]) => sql.includes('cable-workflow:candidates'))?.[0]).not.toMatch(/LIKE|ILIKE/);
  });
  it('rejects query/context/account cursor changes, excessive history and nonadvancing scan rows', async () => {
    const f = fixture(2), first = await f.repo.page(projectId, who, { filter: 'all', limit: 1 });
    await expect(f.repo.page(projectId, who, { filter: 'all', limit: 2, cursor: first.nextCursor })).rejects.toMatchObject({ code: 'WORKFLOW_CURSOR_INVALID' });
    f.state.admissionCount++; await expect(f.repo.page(projectId, who, { filter: 'all', limit: 1, cursor: first.nextCursor })).rejects.toMatchObject({ code: 'WORKFLOW_CURSOR_INVALID' });
    f.state.admissionCount = 10001; await expect(f.repo.page(projectId, who, {})).rejects.toMatchObject({ code: 'WORKFLOW_ADMISSION_LIMIT', status: 413 });
    f.state.admissionCount = 1; f.state.badScan = true; await expect(f.repo.page(projectId, who, {})).rejects.toMatchObject({ code: 'WORKFLOW_SCAN_INTEGRITY' });
  });
  it('preserves newest waiting/blocked admission evidence rather than falling back to an older success', async () => {
    const f = fixture(2); f.state.aliases = false;
    f.state.metadata.set(id(1000), meta(0, { item_state: 'blocked', item_status: 'locations_required' })); f.state.metadata.set(id(1001), meta(1));
    const result = await f.repo.page(projectId, who, { filter: 'all' });
    expect(classifyCableWorkflow(result.rows[0]).status).toBe('needs-routing'); expect(result.rows[0].from.status).toBe('missing');
    expect(classifyCableWorkflow(result.rows[1]).status).toBe('calculating'); expect(mocks.verified).not.toHaveBeenCalled();
    const sql = f.query.mock.calls.find(([text]) => text.includes('cable-workflow:latest-admissions'))![0];
    expect(sql).toContain('ORDER BY b.cable_id,a.created_at DESC,a.id DESC'); expect(sql).not.toContain("p.status='calculated'");
  });
  it.each(['waiting', 'running'] as const)('retains actual %s item state while current model/settings becomes unavailable', async itemState => {
    const f = fixture(); f.state.metadata.set(id(1000), meta(0, { item_state: itemState }));
    f.state.common = { ...common(), inputs: null, bindingContext: null, status: 'settings_required', message: '' } as unknown as ReturnType<typeof common>;
    const result = await f.repo.page(projectId, who, { filter: 'all' });
    expect(result.rows[0].calculation).toMatchObject({ itemState, outcome: 'not-evaluated', reasonCodes: ['SETTINGS_REQUIRED'] });
    expect(classifyCableWorkflow(result.rows[0]).status).toBe('calculating');
  });
  it('retains blocked settings and resource/deadline outcome reasons without inventing an error code from free text', async () => {
    const f = fixture(3);
    for (const [n, status] of ['settings_required', 'resource_limit', 'deadline_exceeded'].entries())
      f.state.metadata.set(id(1000 + n), meta(n, { item_state: 'blocked', item_status: status }));
    const result = await f.repo.page(projectId, who, { filter: 'all' });
    expect(result.rows.map(value => value.calculation.outcome)).toEqual(['settings-required', 'resource-limit', 'deadline-exceeded']);
    expect(result.rows.every(value => value.calculation.errorCode === null && value.calculation.reasonCodes.length > 0)).toBe(true);
  });
  it('uses positive proof and current preferences, preserving incomplete-job review gates and one common context read', async () => {
    const f = fixture(2);
    for (let n = 0; n < 2; n++) f.state.metadata.set(id(1000 + n), meta(n, { job_status: 'complete', item_state: 'complete', proposal_status: 'calculated', proposal_id: id(30 + n), proposal_hash: 'f'.repeat(64) }));
    const result = await f.repo.page(projectId, who, { filter: 'ready-for-review' });
    expect(result.rows).toHaveLength(2); expect(mocks.common).toHaveBeenCalledTimes(1);
    f.state.allowReview = false; f.state.metadata.get(id(1000))!.job_status = 'running';
    const changed = await f.repo.detail(projectId, who, id(1000), {});
    expect(classifyCableWorkflow(changed.row)).toEqual({ status: 'blocked', reasonCodes: ['CALCULATED_AWAITING_JOB_COMPLETION'] });
    mocks.verified.mockResolvedValue({ dependencies: { options: { ...defaultOptions, secondaryDistanceMeters: 99 } } });
    const mismatch = await f.repo.detail(projectId, who, id(1000), {}); expect(mismatch.row.calculation.currentness).toBe('changed');
  });
  it('only asks for receipt proof when an actual latest receipt identity exists', async () => {
    const f = fixture(); await f.repo.page(projectId, who, {}); expect(mocks.accepted).not.toHaveBeenCalled();
    f.state.hasReceipt = true; mocks.accepted.mockResolvedValue(true); f.state.cables[0].routing = '/SYNTHETIC' as never; f.state.cables[0].design_length = '12' as never;
    const result = await f.repo.page(projectId, who, { filter: 'up-to-date' });
    expect(mocks.accepted).toHaveBeenCalledTimes(1); expect(result.rows[0].calculation.acceptedMatchesCurrent).toBe(true);
  });
  it('excludes MV, preserves unknown categories and refuses oversized fields before projection', async () => {
    const f = fixture(3); f.state.cables[0].mto = 'MV'; f.state.cables[1].mto = 'Unknown';
    const result = await f.repo.page(projectId, who, { filter: 'all' });
    expect(result.rows.map(value => value.cable.id)).toEqual([id(1001), id(1002)]); expect(classifyCableWorkflow(result.rows[0]).status).toBe('blocked');
    f.state.cables[1].input_oversize = true; await expect(f.repo.page(projectId, who, {})).rejects.toMatchObject({ code: 'WORKFLOW_CABLE_INPUT_LIMIT' });
    const sql = f.query.mock.calls.find(([text]) => text.includes('cable-workflow:candidates'))![0]; expect(sql).toContain('CASE WHEN octet_length'); expect(sql).toContain('LIMIT 201');
  });
  it('requires exact current-project detail ownership and uses the same read-only boundary for every request', async () => {
    const f = fixture(), result = await f.repo.detail(projectId, who, id(1000), {});
    expect(result.cableId).toBe(id(1000)); expect(result.row.projectId).toBe(projectId);
    await expect(f.repo.detail(projectId, who, id(9999), {})).rejects.toMatchObject({ code: 'CABLE_NOT_FOUND' });
    expect(mocks.tx).toHaveBeenCalledTimes(2); expect(f.query.mock.calls.every(([sql]) => /^\s*(?:\/\*[\s\S]*?\*\/\s*)?SELECT\b/i.test(sql))).toBe(true);
  });
});
