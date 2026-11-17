// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { readCableObstacleLinks } from './cableObstacleLinks.js';
import { syntheticBarrierWriteInputs } from './barrierWriteFixtures.js';
import { revisionResultHash } from './revisionResultRepository.js';
import { routeObstacleRemarks } from './obstacleRemarks.js';
import { buildManualRoutingSource } from './manualRoutingValidation.js';
import { cableObstacleLinksSchema } from '../../shared/pathfinderCableObstacleLinks.js';

function fixture() {
  const { dependencies, result, id } = syntheticBarrierWriteInputs();
  const projectId = dependencies.projectId, cableId = dependencies.cableId;
  const parent = { selectionId: id(500), dbId: 24018, name: 'Floor', kind: 'floor' as const, objectId: 'dbid:24018', externalId: null,
    identityBasis: 'version-local-only' as const, inclusion: 'own-and-all-descendant-fragments' as const };
  if (result.schemaVersion !== 'pathfinder.model.response.v3') throw Error('Expected synthetic protected response.');
  result.barriers.obstacleReport = { status: 'complete', crossedParentSelectionIds: [parent.selectionId], blockingParentSelectionIds: [],
    checkedSegments: 1, totalSegments: 1, reasonCode: 'SYNTHETIC_RECORDED_LINKS', selectedParents: [parent] };
  const cable = { id: cableId, project_id: projectId, routing: result.route!.routeText, cable_write_revision: '8', used_manual: false, remarks: routeObstacleRemarks('Human note', result) };
  const saved = { id: id(501), remarks: cable.remarks, result };
  const acceptedValue = { receiptId: saved.id, proposalId: id(502), afterRouting: cable.routing, afterCableWriteRevision: '8', engineResultSha256: revisionResultHash(result) };
  const accepted = vi.fn(async () => acceptedValue as any);
  const state = { exists: true, manual: [] as Record<string, any>[], history: [] as Record<string, any>[] };
  const query = vi.fn(async (sql: string, args: unknown[]) => {
    if (sql.includes('cable-obstacles:cable')) { expect(args).toEqual([projectId, cableId]); return { rows: state.exists ? [cable] : [] }; }
    if (sql.includes('cable-obstacles:manual-history')) return { rows: state.history };
    if (sql.includes('cable-obstacles:manual')) return { rows: state.manual };
    if (sql.includes('cable-obstacles:saved')) return { rows: [saved] };
    throw Error(sql);
  });
  const read = () => readCableObstacleLinks({ query } as unknown as PoolClient, projectId, cableId, { accepted });
  return { dependencies, result, id, projectId, cableId, parent, cable, saved, accepted, acceptedValue, state, query, read };
}

describe('saved cable obstacle link identities', () => {
  it('resolves only exact immutable saved report identities and retains the recorded model scope', async () => {
    const f = fixture(), result = await f.read();
    expect(result).toMatchObject({ status: 'recorded', cableWriteRevision: '8', remarks: f.cable.remarks,
      source: { kind: 'apply-receipt', id: f.saved.id }, scope: f.dependencies.barriers.binding.scope,
      obstacles: [{ dbId: 24018, selectionId: f.parent.selectionId, name: 'Floor', kind: 'floor' }] });
    expect(f.query.mock.calls.every(([sql]) => !/pf_barrier_heads|pf_auto_lengths|UPDATE|INSERT/i.test(sql))).toBe(true);
  });
  it('keeps ordinary user numbers and marker mentions inside user sentences unlinked', async () => {
    const f = fixture(); f.cable.remarks = 'User #24018 mentions [PathFinder obstacles] Crosses obstacles: #24018.';
    expect(await f.read()).toMatchObject({ status: 'none', obstacles: [], scope: null }); expect(f.accepted).not.toHaveBeenCalled();
  });
  it.each(['route', 'managed text', 'unverified receipt', 'result digest', 'receipt remarks', 'future revision'] as const)('refuses a changed or unverified %s', async kind => {
    const f = fixture();
    if (kind === 'route') f.cable.routing = '/DIFFERENT';
    if (kind === 'managed text') f.cable.remarks = '[PathFinder obstacles] Crosses obstacles: #999.';
    if (kind === 'unverified receipt') f.accepted.mockResolvedValue(null);
    if (kind === 'result digest') f.saved.result.message = 'Changed immutable output';
    if (kind === 'receipt remarks') f.saved.remarks = 'Another note';
    if (kind === 'future revision') f.cable.cable_write_revision = '7';
    expect(await f.read()).toMatchObject({ status: 'unverified', obstacles: [], source: null, scope: null });
  });
  it('allows unrelated user text edits while matching the generated line exactly', async () => {
    const f = fixture(); f.cable.remarks = f.cable.remarks!.replace('Human note', 'Updated human note');
    expect((await f.read()).status).toBe('recorded');
  });
  it('refuses duplicated managed markers', async () => {
    const f = fixture(); f.cable.remarks += '\n[PathFinder obstacles] Crosses obstacles: #24018.';
    expect((await f.read()).status).toBe('unverified');
  });
  it('supports the recorded 148-object report without reconstructing identities from current geometry', async () => {
    const f = fixture();
    f.result.barriers.obstacleReport!.selectedParents = Array.from({ length: 148 }, (_, index) => ({ ...f.parent, selectionId: f.id(500 + index), dbId: 24018 + index, objectId: `dbid:${24018 + index}` }));
    f.acceptedValue.engineResultSha256 = revisionResultHash(f.result);
    expect((await f.read()).obstacles).toHaveLength(1);
  });
  it('verifies written manual results using their hashes, original validation and matching historical saved Remarks', async () => {
    const f = fixture(); const { calculationMode: _mode, ...response } = f.result;
    f.cable.used_manual = true;
    response.route!.routeCodes = ['/A']; response.route!.routeText = '/A'; response.barriers.directSecondary = null;
    const dependencies = { schemaVersion: 'pathfinder.manual-route.dependencies.v1', manualRevision: '1', constraint: { schemaVersion: 'pathfinder.manual-ordered-route.v1', routeText: '/A' }, protected: f.dependencies, capacity: null };
    const record = { schemaVersion: 'pathfinder.manual-route.result.v1', id: f.id(510), projectId: f.projectId, cableId: f.cableId,
      manualRevision: '1', generation: '1', inputSha256: revisionResultHash(dependencies), dependencies, response, lengthMetres: 7,
      calculatedAt: '2026-11-17T06:00:00.000Z', designWrite: { status: 'written', beforeCableWriteRevision: '7', afterCableWriteRevision: '8', history: { id: f.id(511), versionNumber: '2' } } };
    const digest = revisionResultHash(record), projection = buildManualRoutingSource(record, digest);
    f.state.manual = [{ id: record.id, manual_revision: '1', record_sha256: digest, record, projection, projection_sha256: revisionResultHash(projection) }];
    f.state.history = [{ routing: f.cable.routing, remarks: f.cable.remarks }];
    expect(await f.read()).toMatchObject({ status: 'recorded', source: { kind: 'manual-result', id: record.id } });
    expect(f.accepted).not.toHaveBeenCalled();
    f.state.history[0].remarks = 'Tampered';
    expect((await f.read()).status).toBe('unverified');
  });
  it('keeps missing tenant cables unavailable', async () => {
    const f = fixture(); f.state.exists = false; await expect(f.read()).rejects.toMatchObject({ code: 'CABLE_NOT_FOUND', status: 404 });
  });
  it('rejects recorded link payloads without original scope or with duplicate target numbers', () => {
    const f = fixture();
    expect(cableObstacleLinksSchema.safeParse({ schemaVersion: 'wfc.pf.cable-obstacle-links.v1', projectId: f.projectId, cableId: f.cableId,
      cableWriteRevision: '8', remarks: f.cable.remarks, status: 'recorded', source: null, scope: null, obstacles: [] }).success).toBe(false);
  });
});
