// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import { readTrayCapacityRouting } from './trayCapacityRouting.js';
import { readDrawingPolicy } from './drawingPolicy.js';
import { DEFAULT_DRAWING_MODES } from '../../shared/pathfinderDrawingPolicy.js';
import { AUTOMATIC_PAIR_POLICY, automaticPairMandateHashInput, automaticPairMandateSchema } from '../../shared/pathfinderAutomaticPair.js';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy.js';
import type { TrayRow } from '../models/tray.js';
vi.mock('./drawingPolicy.js', () => ({ readDrawingPolicy: vi.fn() }));

const id = (n: number) => `88888888-8888-4888-8888-${String(n).padStart(12, '0')}`;
const projectId = id(1), jobId = id(2), cableId = id(10), siblingId = id(11);
const dates: Pick<TrayRow, 'created_at' | 'updated_at'> = { created_at: '2026-10-24T00:00:00Z', updated_at: '2026-10-24T00:00:00Z' };
const category = { maxRows: 1, maxColumns: 100, bundleSpacing: '0', trefoil: false, trefoilSpacingBetweenBundles: false, applyPhaseRotation: false };
const mandate = (selected: string, revision = '0') => {
  const record = automaticPairMandateSchema.parse({ schemaVersion: 'wfc.pf.automatic-pair-mandate.v1', id: id(70 + Number(selected.slice(-2))),
    projectId, jobId, cableId: selected, actorId: id(3), actorAdminRevision: '0', loginId: id(4), installationEpoch: id(5),
    createdAt: '2026-10-24T00:00:00Z', loginExpiresAt: '2026-10-24T01:00:00Z', authorityExpiresAt: '2026-10-24T00:20:00Z',
    policy: AUTOMATIC_PAIR_POLICY, source: { kind: 'explicit-job' }, requestSha256: 'a'.repeat(64), dependencyHash: 'b'.repeat(64),
    cableWriteRevision: revision, baselineSha256: 'c'.repeat(64), ownership: { kind: 'automatic', originReceiptId: id(6), previousReceiptId: id(7),
      previousReceiptSha256: 'd'.repeat(64), afterCableWriteRevision: revision, history: { id: id(8), version: '1' } }, contentSha256: '0'.repeat(64) });
  record.contentSha256 = createHash('sha256').update(canonicalPurposeJson(automaticPairMandateHashInput(record))).digest('hex');
  return { project_id: projectId, job_id: jobId, cable_id: selected, id: record.id, actor_id: record.actorId,
    login_id: record.loginId, record_sha256: record.contentSha256, record };
};
function fixture() {
  const project = { id: projectId, project_number: 'CAPACITY', name: 'Capacity', customer: '', manager: null, description: null,
    secondary_tray_length: '7', connection_gap: '1', support_distance: null, support_weight: null, additional_bending_percent: '10',
    end_connection_length: '5', tray_load_safety_factor: null, support_distances: {}, tray_purpose_templates: {},
    cable_layout_settings: { autoRerouteForFreeSpace: true, cableSpacing: 1, considerBundleSpacingAsFree: false,
      minFreeSpacePercent: 30 as number | null, maxFreeSpacePercent: 80, control: { ...category }, power: { ...category } }, ...dates };
  const trays = [1, 2].map((n) => ({ id: id(20 + n), project_id: projectId, name: `T${n}`, tray_type: 'Type', purpose: 'Control tray',
    width_mm: '100', height_mm: '300', length_mm: '1000', include_grounding_cable: false, grounding_cable_type_id: null, ...dates }));
  const cable = (n: number, from = 'A', to = 'B', routing: string | null = '/T1') => ({ id: id(n), project_id: projectId, cable_id: n,
    cable_type_id: id(50), mto: 'Control', revision: null, tag: null, from_location: from, to_location: to, routing,
    design_length: null, install_length: null, delivery: null, pull_date: null, connected_from: null, connected_to: null, tested: null,
    type_name: 'Synthetic', type_purpose: 'Control', type_diameter_mm: '30', type_weight_kg_per_m: '1', cable_write_revision: '0', ...dates });
  const cables = [cable(10), cable(11, ' A ', 'b'), cable(12, 'OTHER', 'END')];
  cables[2].type_diameter_mm = '10';
  const proposals: Array<{ cable_id: string; result: unknown; dependencies?: unknown }> = [];
  const settledSources: Array<{ id: string; cable_id: string; proposal_hash: string; dependencies: unknown; result: unknown }> = [];
  const mandates = cables.map(value => mandate(value.id));
  const overrides: Array<{ tray_id: string; revision: string; value: unknown }> = [];
  const materials: Array<{ id: string; tray_type: string; rung_height_mm: string | null }> = [];
  const calls: string[] = [];
  const query = vi.fn(async (sql: string) => {
    calls.push(sql);
    if (sql.includes('tray-capacity:project')) return { rows: [project] };
    if (sql.includes('tray-capacity:trays')) return { rows: trays };
    if (sql.includes('tray-capacity:cables')) return { rows: cables };
    if (sql.includes('tray-capacity:completed')) return { rows: proposals.map(value => {
      const result = value.result as { status: string; route?: { routeCodes: string[] } };
      return { cable_id: value.cable_id, status: result.status, route_codes: result.route?.routeCodes ?? null,
        cable_inputs: (value.dependencies as { cableInputs?: unknown } | undefined)?.cableInputs ?? null };
    }) };
    if (sql.includes('tray-capacity:settled-source')) return { rows: settledSources };
    if (sql.includes('tray-capacity:mandates')) return { rows: mandates };
    if (sql.includes('tray-capacity:overrides')) return { rows: overrides };
    if (sql.includes('tray-capacity:materials')) return { rows: materials };
    throw Error('Unexpected capacity test query');
  });
  const client = { query } as unknown as PoolClient;
  const read = (selected = cableId) => readTrayCapacityRouting(client, { projectId, jobId, cableId: selected });
  return { project, trays, cables, proposals, settledSources, mandates, overrides, materials, calls, read };
}
beforeEach(() => {
  vi.mocked(readDrawingPolicy).mockResolvedValue({ schemaVersion: 'pathfinder.drawing-purpose-policy.v1', projectId,
    catalogRevision: '1', drawingPolicyRevision: '1', rules: [{ purposeKey: 'Control tray', categoryModes: { ...DEFAULT_DRAWING_MODES } }] });
});

describe('transaction-local tray capacity inputs', () => {
  it('still balances occupied routes when the minimum restriction checkbox is disabled', async () => {
    const f = fixture(); f.project.cable_layout_settings.autoRerouteForFreeSpace = false;
    const context = (await f.read())!;
    expect(context.restrictionEnabled).toBe(false); expect(context.policy.enabled).toBe(false);
    expect(context.routeCostMultipliers.find(value => value.routeCode === '/T1')!.multiplier)
      .toBeGreaterThan(context.routeCostMultipliers.find(value => value.routeCode === '/T2')!.multiplier);
    f.project.cable_layout_settings.minFreeSpacePercent = 99;
    expect((await f.read())!.evaluate(['/T1']).blockedRouteCodes).toEqual([]);
  });
  it('ranks actual overfill instead of losing the load difference when both free percentages clamp to zero', async () => {
    const f = fixture(); f.project.cable_layout_settings.autoRerouteForFreeSpace = false;
    f.project.cable_layout_settings.minFreeSpacePercent = null;
    f.cables[0].type_diameter_mm = f.cables[1].type_diameter_mm = '70'; f.trays[1].width_mm = '50';
    const context = (await f.read())!, assessment = context.evaluate(['/T1', '/T2']);
    expect(assessment).toMatchObject({ restrictionEnabled: false, minimumFreeSpacePercent: null, blockedRouteCodes: [] });
    expect(assessment.trays.map(value => value.freeSpacePercent)).toEqual([0, 0]);
    expect(assessment.trays[1].occupancyPercent!).toBeGreaterThan(assessment.trays[0].occupancyPercent!);
    expect(context.routeCostMultipliers.find(value => value.routeCode === '/T2')!.multiplier)
      .toBeGreaterThan(context.routeCostMultipliers.find(value => value.routeCode === '/T1')!.multiplier);
    expect(context.score(['/T2']).bottleneckOccupiedPercent).toBeGreaterThan(100);
  });
  it('finds a common To suffix while retaining different From prefixes and per-cable physical occupancy', async () => {
    const f = fixture(); f.cables[0].routing = f.cables[1].routing = '/ENTRY_A/SHARED/END';
    f.cables.push({ ...f.cables[0], id: id(13), cable_id: 13, from_location: 'C', to_location: 'B', routing: '/ENTRY_C/SHARED/END' });
    for (const [index, name] of ['ENTRY_A', 'ENTRY_C', 'SHARED', 'END'].entries()) f.trays.push({ ...f.trays[0], id: id(24 + index), name, width_mm: '1000' });
    const context = (await f.read())!;
    expect(context.groupCableIds).toEqual([cableId, siblingId]);
    expect(context.sameToGroupCableIds).toEqual([cableId, siblingId, id(13)]);
    expect(context.preferredCorridors).toEqual([['/SHARED', '/END']]);
    const assessment = context.evaluate(['/ENTRY_A', '/SHARED', '/END']);
    expect(assessment.trays[1].occupancyPercent!).toBeGreaterThan(assessment.trays[0].occupancyPercent!);
    expect(context.score(['/ENTRY_A', '/SHARED', '/END']).sharedSuffixRouteCodes).toEqual(['/SHARED', '/END']);
    const weights = new Map(context.routeCostMultipliers.map(value => [value.routeCode, value.multiplier]));
    expect(weights.get('/SHARED')).toBeCloseTo(Math.max(1, (1 + 8 * (assessment.trays[1].occupancyPercent! / 100) ** 2) * 0.85));
    expect(weights.get('/ENTRY_A')).toBeCloseTo(1 + 8 * (assessment.trays[0].occupancyPercent! / 100) ** 2);
  });
  it('uses completed same-To paths as corridor observations without copying their From prefixes', async () => {
    const f = fixture(); f.cables[0].routing = f.cables[1].routing = '/A/TRUNK/DEST';
    f.cables.push({ ...f.cables[0], id: id(13), cable_id: 13, from_location: 'C', to_location: 'B', routing: null as unknown as string });
    f.proposals.push({ cable_id: id(13), result: { status: 'calculated', route: { success: true, routeCodes: ['/C', '/TRUNK', '/DEST'] } } });
    const context = (await f.read())!;
    expect(context.preferredCorridors).toEqual([['/TRUNK', '/DEST']]);
    expect(context.groupCableIds).not.toContain(id(13));
    expect(f.cables[0].routing).toBe('/A/TRUNK/DEST');
  });
  it('seeds the second From-group with soft To affinity before a common corridor is proven', async () => {
    const f = fixture(); f.project.cable_layout_settings.autoRerouteForFreeSpace = false;
    f.cables[0].routing = f.cables[1].routing = null;
    Object.assign(f.cables[2], { from_location: 'C', to_location: 'B', routing: null, type_diameter_mm: '30' });
    for (const [index, name] of ['ENTRY_A', 'ENTRY_C', 'TRUNK', 'END'].entries()) f.trays.push({ ...f.trays[0], id: id(24 + index), name });
    f.proposals.push({ cable_id: cableId, result: { status: 'calculated', route: { success: true, routeCodes: ['/ENTRY_A', '/TRUNK', '/END'] } } });
    const context = (await f.read(id(12)))!;
    expect(context.groupCableIds).toEqual([id(12)]); expect(context.settledSource).toBeNull();
    expect(context.preferredCorridors).toEqual([]); // One actual donor is affinity, not proof of a shared prefix.
    const assessment = context.evaluate(['/ENTRY_C', '/TRUNK', '/END']);
    const weights = new Map(context.routeCostMultipliers.map(value => [value.routeCode, value.multiplier]));
    const trunkOccupancy = assessment.trays[1].occupancyPercent!, entryOccupancy = assessment.trays[0].occupancyPercent!;
    expect(weights.get('/TRUNK')).toBeCloseTo(Math.max(1, (1 + 8 * (trunkOccupancy / 100) ** 2) * 0.85));
    expect(weights.get('/TRUNK')).toBeLessThan(1 + 8 * (trunkOccupancy / 100) ** 2);
    expect(weights.get('/ENTRY_C')).toBeCloseTo(1 + 8 * (entryOccupancy / 100) ** 2);
    expect(context.score(['/ENTRY_C', '/TRUNK', '/END']).sharedSuffixRouteCodes).toEqual([]);
    expect(f.cables[2].routing).toBeNull(); // Different From still needs its own native route.
  });
  it('does not infer a common corridor from one From or an incompatible destination category', async () => {
    const f = fixture(); f.cables[0].routing = f.cables[1].routing = '/A/TRUNK/DEST';
    expect((await f.read())!.preferredCorridors).toEqual([]);
    f.cables.push({ ...f.cables[0], id: id(13), cable_id: 13, from_location: 'C', to_location: 'B', mto: 'LV', routing: '/C/TRUNK/DEST' });
    expect((await f.read())!.preferredCorridors).toEqual([]);
  });
  it('keeps physical occupancy identity when the active automatic group loses a common-To corridor after no_path', async () => {
    const f = fixture(); f.cables[0].routing = f.cables[1].routing = '/ENTRY_A/SHARED/END';
    f.cables.push({ ...f.cables[0], id: id(13), cable_id: 13, from_location: 'C', to_location: 'B', routing: '/ENTRY_C/SHARED/END' });
    const before = (await f.read())!; expect(before.preferredCorridors).toEqual([['/SHARED', '/END']]);
    f.proposals.push({ cable_id: cableId, result: { status: 'no_path' } });
    const after = (await f.read())!;
    expect(after.preferredCorridors).toEqual([]);
    expect(after.occupancySha256).toBe(before.occupancySha256);
  });
  it('exposes an exact-pair source only as an immutable-result hint for the worker to verify', async () => {
    const f = fixture(), source = { id: id(80), cable_id: siblingId, proposal_hash: 'a'.repeat(64), dependencies: { synthetic: true },
      result: { status: 'calculated', route: { success: true, routeCodes: ['/T1'] } } };
    f.settledSources.push(source);
    expect((await f.read())!.settledSource).toEqual({ id: source.id, cableId: siblingId, proposalHash: source.proposal_hash, dependencies: source.dependencies, result: source.result });
    source.cable_id = id(12);
    expect((await f.read())!.settledSource).toBeNull();
  });
  it('includes an exact-pair no-capacity result with its actual query for sealed refusal reuse', async () => {
    const f = fixture(), source = { id: id(80), cable_id: siblingId, proposal_hash: 'a'.repeat(64), dependencies: { synthetic: true },
      result: { status: 'no_path', trayCapacity: { outcome: 'no-capacity', query: {
        excludedRouteCodes: ['/T1'], routeCostMultipliers: [{ routeCode: '/T1', multiplier: 4 }], timeoutMilliseconds: 60000 } } } };
    f.settledSources.push(source);
    expect((await f.read())!.settledSource).toMatchObject({ id: source.id, cableId: siblingId, result: source.result });
    const sql = f.calls.find(value => value.includes('tray-capacity:settled-source'))!;
    expect(sql).toContain("p.status='no_path'"); expect(sql).toContain("->>'outcome'='no-capacity'");
    expect(sql).toContain("jsonb_typeof(p.result->'trayCapacity'->'query')='object'");
    expect(sql).toContain('p.cable_id=ANY($3::uuid[])'); expect(sql).toContain('LIMIT 1');
  });
  it('counts a whole compatible group once and removes all its old occupancy', async () => {
    const f = fixture(), context = (await f.read())!;
    expect(context.groupCableIds).toEqual([cableId, siblingId]);
    const assessed = context.evaluate(['/SECONDARY', '/T1', '/T1']);
    expect(assessed).toMatchObject({ groupCableCount: 2, blockedRouteCodes: [], trays: [{ routeCode: '/T1', status: 'fits' }] });
    expect(assessed.trays[0].freeSpacePercent).toBeCloseTo(28);
    expect(context.evaluate(['/T2']).trays[0]).toMatchObject({ status: 'fits', freeSpacePercent: 39 });
    expect(f.cables.map(v => v.routing)).toEqual(['/T1', '/T1', '/T1']);
    expect(f.calls.every(sql => !/\b(?:INSERT|UPDATE|DELETE|COMMIT|BEGIN)\b/.test(sql))).toBe(true);
  });
  it('keeps ordered direction and MTO boundaries for compatible groups', async () => {
    const f = fixture(); f.cables.push({ ...f.cables[0], id: id(13), cable_id: 13, from_location: 'B', to_location: 'A' });
    f.cables.push({ ...f.cables[0], id: id(14), cable_id: 14, mto: 'LV' });
    expect((await f.read())!.groupCableIds).toEqual([cableId, siblingId]);
  });
  it('uses dynamic project thresholds and refuses trays after physical group insertion', async () => {
    const f = fixture(); f.project.cable_layout_settings.minFreeSpacePercent = 45;
    const result = (await f.read())!.evaluate(['/T1', '/T2']);
    expect(result).toMatchObject({ minimumFreeSpacePercent: 45, effectiveMinimumFreeSpacePercent: 42, tolerancePercentagePoints: 3,
      blockedRouteCodes: ['/T1', '/T2'] });
  });
  it('overlays a completed donor route for all its unprocessed physical siblings', async () => {
    const f = fixture(); const other = { ...f.cables[2], id: id(13), cable_id: 13 }; f.cables.push(other);
    f.proposals.push({ cable_id: id(12), result: { status: 'calculated', route: { success: true, routeCodes: ['/T2'] } } });
    const result = (await f.read())!.evaluate(['/T2']);
    expect(result.trays[0].freeSpacePercent).toBe(17); // Both physical groups plus authoritative within/between-bundle gaps.
    expect(result.blockedRouteCodes).toEqual(['/T2']);
    expect(f.cables[2].routing).toBe('/T1');
  });
  it('retains another automatic group stored route after no_path until the writer actually clears it', async () => {
    const f = fixture(); f.proposals.push({ cable_id: id(12), result: { status: 'no_path' } });
    expect((await f.read())!.evaluate(['/T1']).trays[0].freeSpacePercent).toBeCloseTo(28);
    f.cables[2].routing = null;
    expect((await f.read())!.evaluate(['/T1']).trays[0].freeSpacePercent).toBe(39);
  });
  it('reserves both stored and planned routes for another automatic group until its write commits', async () => {
    const f = fixture(); f.proposals.push({ cable_id: id(12), result: { status: 'calculated', route: { success: true, routeCodes: ['/T2'] } } });
    const pending = (await f.read())!.evaluate(['/T1', '/T2']);
    for (const tray of pending.trays) expect(tray.freeSpacePercent).toBeCloseTo(28);
    f.cables[2].routing = '/T2'; f.cables[2].cable_write_revision = '1';
    const committed = (await f.read())!.evaluate(['/T1', '/T2']);
    expect(committed.trays[0].freeSpacePercent).toBe(39); expect(committed.trays[1].freeSpacePercent).toBeCloseTo(28);
  });
  it('keeps manual routes reserved until confirmation while also reserving their proposal', async () => {
    const f = fixture(); f.mandates.splice(f.mandates.findIndex(value => value.cable_id === id(12)), 1);
    f.proposals.push({ cable_id: id(12), result: { status: 'calculated', route: { success: true, routeCodes: ['/T2'] } } });
    const assessed = (await f.read())!.evaluate(['/T1', '/T2']);
    for (const tray of assessed.trays) expect(tray.freeSpacePercent).toBeCloseTo(28);
    f.proposals.push({ cable_id: id(12), result: { status: 'no_path' } });
    const failed = (await f.read())!.evaluate(['/T1', '/T2']);
    expect(failed.trays[0].freeSpacePercent).toBeCloseTo(28);
    expect(failed.trays[1].freeSpacePercent).toBe(39); // Earlier virtual proposal released; real manual T1 remains.
  });
  it('never double-counts a manual member of the currently planned group', async () => {
    const f = fixture(); f.mandates.splice(f.mandates.findIndex(value => value.cable_id === siblingId), 1);
    const assessed = (await f.read())!.evaluate(['/T1', '/T2']);
    expect(assessed.trays[0].freeSpacePercent).toBeCloseTo(28);
    expect(assessed.trays[1].freeSpacePercent).toBe(39);
  });
  it('treats malformed, foreign, tampered and revision-stale mandates conservatively', async () => {
    for (const mutation of [
      (value: ReturnType<typeof mandate>) => { Object.assign(value, { record: null }); },
      (value: ReturnType<typeof mandate>) => { value.record_sha256 = '0'.repeat(64); },
      (value: ReturnType<typeof mandate>) => { value.job_id = id(90); },
      (value: ReturnType<typeof mandate>) => { value.record.cableId = id(91); },
      (_value: ReturnType<typeof mandate>, f: ReturnType<typeof fixture>) => { f.cables[2].cable_write_revision = '1'; },
    ]) {
      const f = fixture(); mutation(f.mandates[2], f);
      f.proposals.push({ cable_id: id(12), result: { status: 'no_path' } });
      expect((await f.read())!.evaluate(['/T1']).trays[0].freeSpacePercent).toBeCloseTo(28);
    }
  });
  it('does not overlay a proposal whose ordered logical inputs changed', async () => {
    const f = fixture(); f.proposals.push({ cable_id: id(12), result: { status: 'calculated', route: { success: true, routeCodes: ['/T2'] } },
      dependencies: { cableInputs: { fromLocation: 'OBSOLETE', toLocation: 'END', mto: 'Control' } } });
    expect((await f.read())!.evaluate(['/T2']).trays[0].freeSpacePercent).toBe(39);
  });
  it('gives all siblings the same occupancy key despite their previous automatic writes', async () => {
    const f = fixture(), first = (await f.read())!;
    f.cables[0].routing = '/T2'; f.cables[0].cable_write_revision = '8'; f.cables[0].updated_at = '2026-10-24T01:00:00Z';
    const next = (await f.read(siblingId))!;
    expect(next.groupKey).toBe(first.groupKey); expect(next.occupancySha256).toBe(first.occupancySha256);
    f.cables[1].type_diameter_mm = '31'; expect((await f.read())!.occupancySha256).not.toBe(first.occupancySha256);
  });
  it('keeps physical identity stable across unrelated business revisions and mandate-only changes', async () => {
    const f = fixture(), before = (await f.read())!;
    f.cables[2].cable_write_revision = '1'; f.cables[2].updated_at = '2026-10-24T02:00:00Z';
    f.mandates[2].record_sha256 = '0'.repeat(64);
    const changedMetadata = (await f.read())!;
    expect(changedMetadata.occupancySha256).toBe(before.occupancySha256);
    expect(changedMetadata.evaluate(['/T1', '/T2'])).toEqual(before.evaluate(['/T1', '/T2']));
    f.proposals.push({ cable_id: id(12), result: { status: 'calculated', route: { success: true, routeCodes: ['/T1'] } } });
    expect((await f.read())!.occupancySha256).toBe(before.occupancySha256); // Same physical route; provenance alone changed.
    f.cables[2].routing = '/T2'; f.proposals.length = 0;
    expect((await f.read())!.occupancySha256).not.toBe(before.occupancySha256);
  });
  it('accepts PostgreSQL Date timestamps with the same physical identity as string timestamps', async () => {
    const f = fixture(), before = (await f.read())!;
    for (const row of [f.project, ...f.trays, ...f.cables]) {
      row.created_at = new Date(typeof row.created_at === 'string' ? row.created_at : row.created_at.getTime());
      row.updated_at = new Date(typeof row.updated_at === 'string' ? row.updated_at : row.updated_at.getTime());
    }
    const postgresRows = (await f.read())!;
    expect(postgresRows.occupancySha256).toBe(before.occupancySha256);
    expect(postgresRows.evaluate(['/T1', '/T2'])).toEqual(before.evaluate(['/T1', '/T2']));
    expect(() => canonicalPurposeJson(new Date('2026-10-24T00:00:00Z'))).toThrow('INVALID_POLICY_JSON_VALUE');
  });
  it('excludes tray audit metadata and unused weight settings from physical identity', async () => {
    const f = fixture(), before = (await f.read())!;
    Object.assign(f.trays[0], { created_at: new Date('2026-10-23T00:00:00Z'), updated_at: new Date('2026-10-26T00:00:00Z'),
      change_log: [{ id: id(90), userId: id(91), userName: 'Reviewer', changedAt: '2026-10-26T00:00:00Z', changes: ['Audit only'] }],
      length_mm: '2000', include_grounding_cable: true, grounding_cable_type_id: id(92), trefoil_clamp_spacing_mm: '900' });
    const metadata = (await f.read())!;
    expect(metadata.occupancySha256).toBe(before.occupancySha256);
    expect(metadata.evaluate(['/T1', '/T2'])).toEqual(before.evaluate(['/T1', '/T2']));
  });
  it.each([
    ['name', 'T1-renamed'], ['tray_type', 'Changed material'], ['purpose', 'Changed purpose'],
    ['width_mm', '101'], ['height_mm', '301'], ['use_trefoil_clamps', true],
  ] as const)('retains the placement input %s in physical identity', async (field, value) => {
    const f = fixture(), before = (await f.read())!;
    Object.assign(f.trays[0], { [field]: value });
    expect((await f.read())!.occupancySha256).not.toBe(before.occupancySha256);
  });
  it('keeps unknown capacity as visible diagnostics rather than excluding the route', async () => {
    const f = fixture(); f.cables[2].type_diameter_mm = '';
    const result = (await f.read())!.evaluate(['/T1', '/MISSING']);
    expect(result.blockedRouteCodes).toEqual([]); expect(result.unavailableRouteCodes).toEqual(['/T1', '/MISSING']);
    expect(result.trays[0].diagnosticCodes).toContain('MISSING_CABLE_DIAMETER');
    f.project.cable_layout_settings.minFreeSpacePercent = null;
    expect((await f.read())!.evaluate(['/T2'])).toMatchObject({ minimumFreeSpacePercent: null, effectiveMinimumFreeSpacePercent: null,
      policyIssue: 'CAPACITY_MINIMUM_REQUIRED', unavailableRouteCodes: ['/T2'] });
  });
  it('treats duplicate material types, tray names and invalid overrides as unavailable', async () => {
    const f = fixture(); f.materials.push({ id: id(60), tray_type: 'Type', rung_height_mm: '15' }, { id: id(61), tray_type: 'Type', rung_height_mm: '20' });
    expect((await f.read())!.evaluate(['/T2']).trays[0].diagnosticCodes).toEqual(['DRAWING_MATERIAL_AMBIGUOUS']);
    f.materials.length = 0; f.trays.push({ ...f.trays[1], id: id(23), name: 't2' });
    expect((await f.read())!.evaluate(['/T2']).trays[0].diagnosticCodes).toEqual(['CAPACITY_TRAY_AMBIGUOUS']);
    f.trays.pop(); f.overrides.push({ tray_id: id(22), revision: '1', value: { useCustom: 'invalid' } });
    expect((await f.read())!.evaluate(['/T2']).trays[0].diagnosticCodes).toEqual(['CAPACITY_OVERRIDE_INVALID']);
  });
  it('bounds large diagnostic results without throwing or claiming inspected capacity', async () => {
    const f = fixture(), context = (await f.read())!;
    const result = context.evaluate(Array.from({ length: 4096 }, (_, n) => '/T' + n));
    expect(result.policyIssue).toBe('CAPACITY_INPUT_LIMIT'); expect(result.trays).toHaveLength(128);
    expect(result.blockedRouteCodes).toEqual([]); expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(262144);
  });
});
