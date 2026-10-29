// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { readTrayDrawingSnapshot, saveTrayDrawingSettings, assertCurrentDrawingSnapshot } from './drawingSnapshots.js';
import { ensureProjectExists } from '../services/projectService.js';
import { readPurposePolicyState } from './policySchema.js';
import { readDrawingPolicy } from './drawingPolicy.js';
import { computeTrayDrawing } from '../../shared/trayDrawing/index.js';
import { DEFAULT_DRAWING_MODES } from '../../shared/pathfinderDrawingPolicy.js';
import { trayDrawingResponseSchema } from '../../shared/trayDrawingSnapshot.js';
vi.mock('../services/projectService.js', () => ({ ensureProjectExists: vi.fn() }));
vi.mock('../models/project.js', () => ({ mapProjectRow: (row: unknown) => row }));
vi.mock('../models/tray.js', () => ({ mapTrayRow: (row: unknown) => row }));
vi.mock('../models/cable.js', () => ({ mapCableRow: (row: unknown) => row }));
vi.mock('../models/cableType.js', () => ({ mapCableTypeRow: (row: unknown) => row }));
vi.mock('../models/materialTray.js', () => ({ mapMaterialTrayRow: (row: unknown) => row }));
vi.mock('../models/materialSupport.js', () => ({ mapMaterialSupportRow: (row: unknown) => row }));
vi.mock('../models/materialLoadCurve.js', () => ({ mapMaterialLoadCurveRow: (row: object, points: unknown[]) => ({ ...row, points }), mapMaterialLoadCurvePointRow: (row: unknown) => row }));
vi.mock('./policySchema.js', () => ({ readPurposePolicyState: vi.fn() }));
vi.mock('./drawingPolicy.js', () => ({ readDrawingPolicy: vi.fn() }));
vi.mock('../../shared/trayDrawing/index.js', () => ({ computeTrayDrawing: vi.fn(), determineCableDiameterGroupWithCustomRanges: () => '8.1-15' }));
const id = (n: number) => '55555555-5555-4555-8555-' + String(n).padStart(12, '0');
const projectId = id(1), trayId = id(2), cableId = id(3), userId = id(4), loginId = id(5), typeId = id(6);
const dates = { createdAt: '2026-10-19T00:00:00Z', updatedAt: '2026-10-19T00:00:00Z' };
const authority = { role: 'admin' as const, isAdmin: true, canEdit: true };
const reader = { role: 'basic' as const, isAdmin: false, canEdit: false };
const layout = () => ({ schemaVersion: 'wfc.tray-drawing-layout.v1', algorithmVersion: 'wfc-tray-placement-v2', widthPx: 2000, heightPx: 800, commands: [], summary: { hasBottomRow: true }, diagnostics: [] as Array<{ code: string; cableIds: string[]; message: string }>, placements: [] });
function fixture() {
  const project = { id: projectId, projectNumber: 'SYN', name: 'Synthetic', customer: 'Test', manager: null, description: null, connectionGap: 1, secondaryTrayLength: 7, supportDistance: null, supportWeight: null, additionalBendingPercent: 10, endConnectionLength: 5, trayLoadSafetyFactor: null, supportDistanceOverrides: {}, trayPurposeTemplates: {}, cableLayout: { cableSpacing: 1, considerBundleSpacingAsFree: false, minFreeSpacePercent: null, maxFreeSpacePercent: null, mv: null, power: null, vfd: null, control: null, customBundleRanges: null }, ...dates };
  const tray = { id: trayId, projectId, name: 'SYN-TRAY', type: 'Synthetic', purpose: 'Shared', widthMm: 300, heightMm: 100, lengthMm: 1000, includeGroundingCable: false, groundingCableTypeId: null, useTrefoilClamps: false, trefoilClampSpacingMm: 300, ...dates };
  const reportTrays = [tray];
  const cables = [{ id: cableId, projectId, cableId: 1, cableTypeId: typeId, typeName: 'Synthetic type', purpose: 'power', diameterMm: 10 as number | null, weightKgPerM: 1, fromLocation: 'A', toLocation: 'B', routing: '/SYN-TRAY/', ...dates }];
  const state = { catalogRevision: '2', routingPolicyRevision: '9', drawingPolicyRevision: '1', drawingInputRevision: '3' };
  const snapshots = new Map<string, { id: string; payload: any; source_facts: unknown }>(), history = new Map<string, any>(), settings = { revision: '0', value: null as unknown };
  const materials: any[] = [], cableTypes: any[] = [], supports: any[] = [], curves: any[] = [], points: any[] = [];
  let sources: unknown = { synthetic: 'source-v1' };
  const calls: Array<{ sql: string; values: any[] }> = [];
  const query = vi.fn(async (sql: string, values: any[] = []) => {
    calls.push({ sql, values });
    if (sql === 'SELECT * FROM trays WHERE project_id=$1 ORDER BY name,id LIMIT 100001') return { rows: reportTrays };
    if (sql.startsWith('SELECT * FROM trays')) return { rows: [tray] };
    if (sql.startsWith('SELECT c.*,ct.name')) return { rows: cables };
    if (sql.startsWith('SELECT m.*,l.name')) return { rows: materials };
    if (sql.startsWith('SELECT * FROM cable_types')) return { rows: cableTypes };
    if (sql.startsWith('SELECT s.* FROM material_supports')) return { rows: supports };
    if (sql.startsWith('SELECT * FROM material_load_curves')) return { rows: curves };
    if (sql.startsWith('SELECT * FROM material_load_curve_points')) return { rows: points };
    if (sql.startsWith('SELECT jsonb_build_object')) return { rows: [{ facts: sources }] };
    if (sql.startsWith('SELECT revision::text,value')) return { rows: settings.revision === '0' ? [] : [{ ...settings }] };
    if (sql.startsWith('SELECT id,payload,source_facts')) return { rows: snapshots.has(values[2]) ? [snapshots.get(values[2])] : [] };
    if (sql.startsWith('SELECT count(*)::text')) return { rows: [{ count: String(snapshots.size) }] };
    if (sql.startsWith('INSERT INTO pf_tray_drawing_snapshots')) { snapshots.set(values[3], { id: values[0], payload: structuredClone(values[4]), source_facts: structuredClone(values[5]) }); return { rows: [] }; }
    if (sql.startsWith('SELECT request_sha256,request_body')) return { rows: history.has(values[3]) ? [history.get(values[3])] : [] };
    if (sql.startsWith('SELECT id FROM trays')) return { rows: [{ id: trayId }] };
    if (sql.startsWith('INSERT INTO pf_tray_drawing_settings(')) { settings.revision = values[2]; settings.value = values[3]; return { rows: [] }; }
    if (sql.startsWith('SELECT pf_catalog_bump')) { state.drawingInputRevision = String(BigInt(state.drawingInputRevision) + 1n); return { rows: [] }; }
    if (sql.startsWith('INSERT INTO pf_tray_drawing_settings_history')) { history.set(values[5], { request_sha256: values[6], request_body: values[7] }); return { rows: [] }; }
    throw new Error('Unexpected synthetic query');
  });
  vi.mocked(ensureProjectExists).mockResolvedValue(project as never);
  vi.mocked(readPurposePolicyState).mockImplementation(async () => ({ ...state }));
  vi.mocked(readDrawingPolicy).mockImplementation(async () => ({ schemaVersion: 'pathfinder.drawing-purpose-policy.v1', projectId, catalogRevision: state.catalogRevision, drawingPolicyRevision: state.drawingPolicyRevision, rules: [] }));
  vi.mocked(computeTrayDrawing).mockReturnValue(layout() as never);
  const client = { query } as unknown as PoolClient;
  return { client, project, tray, reportTrays, cables, materials, cableTypes, supports, curves, points, state, snapshots, history, settings, calls, setSources: (value: unknown) => { sources = value; }, read: (who = authority as typeof authority | typeof reader) => readTrayDrawingSnapshot(client, projectId, trayId, who) };
}
beforeEach(() => vi.clearAllMocks());
describe('consistent server drawing snapshot and exact input identity', () => {
  it('normal reader and admin reuse the same immutable snapshot without caching edit authority', async () => { const x = fixture(), admin = await x.read(), basic = await x.read(reader); expect(admin.snapshot).toEqual(basic.snapshot); expect(admin.layout).toEqual(basic.layout); expect(admin.permissions.canEdit).toBe(true); expect(basic.permissions.canEdit).toBe(false); expect(x.snapshots.size).toBe(1); expect(x.calls.filter(call => call.sql.startsWith('INSERT INTO pf_tray_drawing_snapshots'))).toHaveLength(1); expect(readPurposePolicyState).toHaveBeenCalledWith(x.client, projectId, { lock: true }); expect(ensureProjectExists).toHaveBeenCalledWith(projectId, x.client); });
  it('binds ordered membership and returns frozen report closure from the same client', async () => { const x = fixture(); x.cables.push({ ...x.cables[0], id: id(30), cableId: 2, routing: '/ANOTHER/' }); x.cableTypes.push({ id: typeId, projectId, name: 'Synthetic type', purpose: 'power', diameterMm: 10, weightKgPerM: 1 }); x.supports.push({ id: id(31), type: 'Synthetic support', weightKg: 1, lengthMm: 300 }); x.materials.push({ id: id(32), type: 'Synthetic', rungHeightMm: 15, load_curve_id: id(33) }); x.curves.push({ id: id(33), name: 'Synthetic curve' }); x.points.push({ id: id(34), order: 0, spanM: 1, loadKnPerM: 2 }); const value = await x.read(); expect(value.snapshot.orderedCableIds).toEqual([cableId]); expect(value.data.cables).toHaveLength(2); expect(value.data.cableTypes).toHaveLength(1); expect(value.data.materialSupports).toHaveLength(1); expect(value.data.loadCurves[0].points).toEqual(x.points); expect(x.calls.find(call => call.sql.startsWith('SELECT s.*'))?.values).toEqual([projectId]); });
  it('freezes the complete report tray list and purpose count even when the visible route does not change', async () => { const x = fixture(); x.reportTrays.push({ ...x.tray, id: id(50), name: 'SYN-SECOND' }, { ...x.tray, id: id(51), name: 'SYN-OTHER', purpose: 'Other' }); const before = await x.read(); expect(before.data.reportTrays).toHaveLength(3); expect(before.data.reportTrays.filter(tray => tray.purpose === before.data.tray.purpose)).toHaveLength(2); expect(x.calls.find(call => call.sql === 'SELECT * FROM trays WHERE project_id=$1 ORDER BY name,id LIMIT 100001')?.values).toEqual([projectId]); x.reportTrays[1].purpose = 'Other'; x.state.catalogRevision = '3'; x.state.drawingInputRevision = '4'; const after = await x.read(); expect(after.data.reportTrays.filter(tray => tray.purpose === after.data.tray.purpose)).toHaveLength(1); expect(after.snapshot.orderedCableIds).toEqual(before.snapshot.orderedCableIds); expect(after.layout).toEqual(before.layout); expect(after.snapshot.inputSha256).not.toBe(before.snapshot.inputSha256); expect(after.snapshot.contentSha256).not.toBe(before.snapshot.contentSha256); await expect(assertCurrentDrawingSnapshot(x.client, projectId, trayId, before.snapshot.snapshotId, before.snapshot.contentSha256, authority)).rejects.toMatchObject({ code: 'DRAWING_SNAPSHOT_STALE' }); });
  it('report tray list scope requires unique project-owned entries and the current tray', async () => { const x = fixture(), value = await x.read(); for (const reportTrays of [[{ ...value.data.tray, projectId: id(90) }], [value.data.tray, value.data.tray], [{ ...value.data.tray, id: id(90) }], []]) expect(trayDrawingResponseSchema.safeParse({ ...value, data: { ...value.data, reportTrays } }).success).toBe(false); });
  it('refuses an over-budget complete report tray list without publishing a prefix', async () => { const x = fixture(); x.reportTrays.length = 100001; x.reportTrays.fill(x.tray); await expect(x.read()).rejects.toMatchObject({ code: 'DRAWING_INPUT_LIMIT', status: 413 }); expect(computeTrayDrawing).not.toHaveBeenCalled(); expect(x.snapshots.size).toBe(0); });
  it('changes snapshot identity for source template facts or cable input revisions', async () => { const x = fixture(), before = await x.read(); x.setSources({ synthetic: 'changed-template' }); x.state.drawingInputRevision = '4'; const changed = await x.read(); expect(changed.sourceSha256).not.toBe(before.sourceSha256); expect(changed.snapshot.snapshotId).not.toBe(before.snapshot.snapshotId); x.cables[0].diameterMm = 12; x.state.drawingInputRevision = '5'; expect((await x.read()).snapshot.inputSha256).not.toBe(changed.snapshot.inputSha256); });
  it('rejects tampered immutable payload or private source proof', async () => { const x = fixture(); const value = await x.read(); x.snapshots.get(value.snapshot.contentSha256)!.payload.data.tray.widthMm = 500; await expect(x.read()).rejects.toMatchObject({ code: 'DRAWING_SNAPSHOT_INTEGRITY' }); });
  it('rejects ambiguous material type matches rather than choosing one', async () => { const x = fixture(); x.materials.push({ id: id(40) }, { id: id(41) }); await expect(x.read()).rejects.toMatchObject({ code: 'DRAWING_MATERIAL_AMBIGUOUS' }); expect(computeTrayDrawing).not.toHaveBeenCalled(); });
  it('unknown drawing purpose and missing diameter cannot become exported capacity evidence', async () => { const x = fixture(); x.cables[0].purpose = 'Unknown'; x.cables[0].diameterMm = null; const value = await x.read(); expect(value.snapshot.state).toBe('blocked'); expect(value.snapshot.diagnostics.map(d => d.code)).toEqual(expect.arrayContaining(['UNKNOWN_DRAWING_CATEGORY', 'MISSING_CABLE_DIAMETER'])); await expect(assertCurrentDrawingSnapshot(x.client, projectId, trayId, value.snapshot.snapshotId, value.snapshot.contentSha256, authority)).rejects.toMatchObject({ code: 'DRAWING_SNAPSHOT_BLOCKED' }); });
  it('a positive gap too small for the required divider blocks export', async () => { const x = fixture(), result = layout(); result.diagnostics.push({ code: 'DIVIDER_GAP_UNAVAILABLE', cableIds: [], message: 'No usable divider gap.' }); vi.mocked(computeTrayDrawing).mockReturnValue(result as never); const value = await x.read(); expect(value.snapshot.state).toBe('blocked'); await expect(assertCurrentDrawingSnapshot(x.client, projectId, trayId, value.snapshot.snapshotId, value.snapshot.contentSha256, authority)).rejects.toMatchObject({ code: 'DRAWING_SNAPSHOT_BLOCKED' }); });
  it('a missing tray purpose visibly uses defaults without changing routing permissions', async () => { const x = fixture(); x.tray.purpose = null as never; const value = await x.read(); expect(value.snapshot.categoryModes).toEqual(DEFAULT_DRAWING_MODES); expect(value.snapshot.diagnostics.some(d => d.code === 'MISSING_TRAY_PURPOSE')).toBe(true); expect(x.state.routingPolicyRevision).toBe('9'); });
  it('rejects a stale or foreign snapshot identity before export', async () => { const x = fixture(), value = await x.read(); await expect(assertCurrentDrawingSnapshot(x.client, projectId, trayId, id(90), value.snapshot.contentSha256, authority)).rejects.toMatchObject({ code: 'DRAWING_SNAPSHOT_STALE' }); x.state.drawingPolicyRevision = '2'; await expect(assertCurrentDrawingSnapshot(x.client, projectId, trayId, value.snapshot.snapshotId, value.snapshot.contentSha256, authority)).rejects.toMatchObject({ code: 'DRAWING_SNAPSHOT_STALE' }); });
  it('public response binding rejects cross-project cable or mismatched ordered identity', async () => { const x = fixture(), value = await x.read(); expect(trayDrawingResponseSchema.safeParse({ ...value, data: { ...value.data, trayCables: [{ ...value.data.trayCables[0], projectId: id(90) }] } }).success).toBe(false); expect(trayDrawingResponseSchema.safeParse({ ...value, snapshot: { ...value.snapshot, orderedCableIds: [] } }).success).toBe(false); });
});
describe('server per-tray settings CAS and replay', () => {
  const command = () => ({ schemaVersion: 'pathfinder.tray-drawing-settings.write.v1' as const, expectedDrawingInputRevision: '3', expectedRevision: '0', idempotencyKey: id(80), value: { useCustom: true, categories: {} } });
  const who = { userId, loginId, loginExpiresAt: Date.now() + 3600000 };
  it('ordinary read authority cannot save local layout settings', async () => { const x = fixture(); await expect(saveTrayDrawingSettings(x.client, projectId, trayId, who, command(), reader)).rejects.toMatchObject({ code: 'DRAWING_EDIT_REQUIRED', status: 403 }); expect(x.calls).toEqual([]); });
  it('stale input or override revision refuses without changing shared settings', async () => { const x = fixture(); await expect(saveTrayDrawingSettings(x.client, projectId, trayId, who, { ...command(), expectedDrawingInputRevision: '2' }, authority)).rejects.toMatchObject({ code: 'DRAWING_SETTINGS_STALE' }); expect(x.settings.revision).toBe('0'); expect(x.history.size).toBe(0); });
  it('saves one revision and replays without another write or routing change', async () => { const x = fixture(); const first = await saveTrayDrawingSettings(x.client, projectId, trayId, who, command(), authority); expect(first.override.revision).toBe('1'); expect(x.state.drawingInputRevision).toBe('4'); expect(x.state.routingPolicyRevision).toBe('9'); const replay = await saveTrayDrawingSettings(x.client, projectId, trayId, who, command(), authority); expect(replay.snapshot.snapshotId).toBe(first.snapshot.snapshotId); expect(x.history.size).toBe(1); expect(x.state.drawingInputRevision).toBe('4'); await expect(saveTrayDrawingSettings(x.client, projectId, trayId, who, { ...command(), value: null }, authority)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' }); });
});
