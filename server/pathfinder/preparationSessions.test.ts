import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy.js';
const fake = vi.hoisted(() => ({ realAuthority: false, context: null as any, rows: new Map<string, any>(), parts: new Map<string, any>(), commands: new Map<string, any>(), blobs: new Map<string, Buffer>(), aggregates: [] as any[], calls: [] as string[], authorized: true, loseCommitAck: false, failBeforeCommit: false, current: { geometry_revision: '0', resolution_revision: '0', current_aggregate_id: null as string | null, current_artifact_id: null as string | null } }));
vi.mock('./auth.js', () => ({ principalTransaction: async (_pool: unknown, _project: string, _who: unknown, operation: (client: PoolClient) => Promise<unknown>) => {
  if (fake.realAuthority) return (await vi.importActual<typeof import('./auth.js')>('./auth.js')).principalTransaction(_pool as Pool, _project, _who as typeof who, operation);
  if (!fake.authorized) throw Object.assign(Error('revoked'), { code: 'ADMIN_REQUIRED', status: 403 });
  const before = structuredClone({ rows: fake.rows, parts: fake.parts, commands: fake.commands, aggregates: fake.aggregates, current: fake.current }); let committed = false;
  try { const result = await operation(client as unknown as PoolClient); if (fake.failBeforeCommit && fake.aggregates.length) throw Error('connection lost before commit'); committed = true; if (fake.loseCommitAck && fake.aggregates.length) { fake.loseCommitAck = false; throw Error('lost committed response'); } return result; }
  catch (error) { if (!committed) { fake.rows = before.rows; fake.parts = before.parts; fake.commands = before.commands; fake.aggregates = before.aggregates; fake.current = before.current; } throw error; }
} }));
vi.mock('./preparationPlans.js', async original => ({ ...await original<typeof import('./preparationPlans.js')>(), readPreparationContext: async () => structuredClone(fake.context), readPreparationState: async () => structuredClone(fake.current) }));
vi.mock('./preparationStorage.js', () => ({
  encodePreparationPayload: (value: unknown) => Buffer.from(canonicalPurposeJson(value)),
  storePreparationBlob: async (_project: string, _session: string, id: string, payload: unknown) => { const bytes = Buffer.from(canonicalPurposeJson(payload)), sha256 = createHash('sha256').update(bytes).digest('hex'); const prior = fake.blobs.get(id); if (prior && !prior.equals(bytes)) throw Object.assign(Error('conflict'), { code: 'PREPARATION_BLOB_INTEGRITY' }); fake.blobs.set(id, bytes); return { payloadRef: id, sha256, bytes: bytes.length }; },
  readPreparationBlob: async (_project: string, _session: string, reference: { payloadRef: string; sha256: string; bytes: number }) => { const bytes = fake.blobs.get(reference.payloadRef); if (!bytes || bytes.length !== reference.bytes || createHash('sha256').update(bytes).digest('hex') !== reference.sha256) throw Object.assign(Error('tampered'), { code: 'PREPARATION_BLOB_INTEGRITY' }); return bytes; },
}));
import { createPreparationService, preparationTransaction, PREPARATION_SQL_BOUNDS, type PreparationAdapters, type PreparationValidation } from './preparationSessions.js';
import { PathFinderError } from './errors.js';
import type { ComputationalSnapshot } from './contracts.js';
import type { PreparationCreate, PreparationContext, PreparationPlan } from '../../shared/pathfinderPreparation.js';
import { LEGACY_PREPARATION_CAPACITY_PROFILE, LARGE_PREPARATION_CAPACITY_PROFILE, type PreparationCapacityProfile } from '../../shared/pathfinderCapacity.js';
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const who = { userId: id(8), loginId: id(9), loginExpiresAt: Date.now() + 600000 };
const client = { query: vi.fn(async (sql: string, p: any[] = []) => {
  fake.calls.push(sql);
  if (sql.startsWith('SELECT *,revision')) return { rows: fake.rows.has(p[1]) ? [structuredClone(fake.rows.get(p[1]))] : [] };
  if (sql.startsWith('SELECT receipt FROM pf_preparation_parts')) { if (sql.includes('part_id=$2')) return { rows: fake.parts.has(p[1]) ? [{ receipt: structuredClone(fake.parts.get(p[1])) }] : [] }; return { rows: [...fake.parts.values()].filter(r => r.sessionId === p[1]).map(receipt => ({ receipt: structuredClone(receipt) })).sort((a, b) => a.receipt.partIndex - b.receipt.partIndex) }; }
  if (sql.startsWith('SELECT kind,request_sha256')) return { rows: fake.commands.has(p[2]) ? [structuredClone(fake.commands.get(p[2]))] : [] };
  if (sql.startsWith('SELECT count(*)')) return { rows: [{ count: String(fake.rows.size) }] };
  if (sql.startsWith('INSERT INTO pf_preparation_sessions')) { fake.rows.set(p[0], { id: p[0], project_id: p[1], plan: p[2], state: 'planned', revision: '0', actor_id: p[3], login_id: p[4], created_at: new Date(), updated_at: new Date(), failure: null, published_aggregate_id: null, validation_token: null, validation_key: null, validation_sha256: null, validation_expires_at: null }); return { rows: [] }; }
  if (sql.startsWith('INSERT INTO pf_preparation_commands')) { fake.commands.set(p[2], { kind: p[3], request_sha256: p[4], receipt: structuredClone(p[5]) }); return { rows: [] }; }
  if (sql.startsWith('INSERT INTO pf_preparation_parts')) { fake.parts.set(p[2], structuredClone(p[4])); return { rows: [] }; }
  if (sql.startsWith('UPDATE pf_preparation_sessions SET state=')) { const row = fake.rows.get(p[1]); if (row.revision !== p[5]) throw Error('unexpected CAS'); Object.assign(row, { state: p[2], revision: p[3], updated_at: new Date(), failure: p[4] }); return { rows: [], rowCount: 1 }; }
  if (sql.startsWith('UPDATE pf_preparation_sessions SET validation_token=$2')) { Object.assign(fake.rows.get(p[0]), { validation_token: p[1], validation_key: p[2], validation_sha256: p[3], validation_expires_at: p[4], validation_command: p[5], validation_actor_id: p[6], validation_login_id: p[7] }); return { rows: [] }; }
  if (sql.startsWith('UPDATE pf_preparation_sessions SET validation_token=NULL')) { fake.rows.get(p[0]).validation_token = null; return { rows: [] }; }
  if (sql.startsWith('UPDATE pf_preparation_sessions SET published_aggregate_id=')) { Object.assign(fake.rows.get(p[0]), { published_aggregate_id: p[1], validation_token: null }); return { rows: [] }; }
  if (sql.startsWith('INSERT INTO pf_preparation_events')) return { rows: [] };
  if (sql.startsWith('INSERT INTO pf_preparation_aggregates')) { fake.aggregates.push(p[7]); return { rows: [] }; }
  if (sql.startsWith('UPDATE pf_project_preparations SET geometry_revision=')) { Object.assign(fake.current, { geometry_revision: p[1], current_aggregate_id: p[2], current_artifact_id: p[3] }); return { rows: [] }; }
  throw Error('Unhandled fake SQL: ' + sql);
}) };
let input: PreparationCreate, adapters: PreparationAdapters;
function payload(projectId: string): ComputationalSnapshot { return { schemaVersion: 'pathfinder.model.snapshot.v1', model: { projectId, modelVersionId: id(2), contentSha256: 'a'.repeat(64) }, capture: { adapterVersion: 'synthetic-bounded-test', sourceKind: 'synthetic', inventoryComplete: false, geometryComplete: false, unitsVerified: false, transformsVerified: false, planningVisibilityKnown: false, sourceLinkVerified: false, evidenceSha256: [] }, coordinates: { vertexFrame: 'canonical-world-metres', sourceUnits: 'm', metresPerSourceUnit: 1, sourceToWorldMetres: null, globalOffsetMetres: [0, 0, 0], displayToWorldMetres: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }, objects: [{ id: 'dbid:3', parentId: null, dbId: 3, name: 'Part', geometryRole: 'routing-leaf', leafToRootNames: ['Part'], properties: [], nativeHidden: null, planningExcluded: false, routeName: '/B001', shapeName: 'Part', categoryAssignmentSource: 'synthetic', allowedCategories: ['LV'], bounds: { minimum: [0, 0, 0], maximum: [1, 1, 1] }, fragments: [] }] }; }
beforeEach(() => {
  vi.clearAllMocks(); fake.realAuthority = false; fake.rows.clear(); fake.parts.clear(); fake.commands.clear(); fake.blobs.clear(); fake.aggregates = []; fake.calls = []; fake.authorized = true; fake.loseCommitAck = false; fake.failBeforeCommit = false; fake.current = { geometry_revision: '0', resolution_revision: '0', current_aggregate_id: null, current_artifact_id: null };
  const context: PreparationContext = { schemaVersion: 'wfc.pf.preparation-context.v1', projectId: id(1), scope: { modelVersionId: id(2), contentFingerprint: 'a'.repeat(64), selectionRevision: '1', catalogRevision: '2', routingContentSha256: 'b'.repeat(64), routingPolicyRevision: '3', routingPolicySha256: 'c'.repeat(64), locationRegistryRevision: '4', resolutionRevision: '0' }, trays: [{ projectTrayId: id(10), rawName: '/B001', purposeKey: 'LV', routeName: '/B001', allowedCategories: ['LV'], policyState: 'configured', diagnosticCodes: [] }], endpointNames: [], resolutions: [], diagnostics: [], currentAggregate: null }; fake.context = context;
  input = { schemaVersion: 'wfc.pf.preparation-create.v1', expected: context.scope, idempotencyKey: id(3), discovery: { schemaVersion: 'wfc.pf.discovery-report.v1', modelVersionId: id(2), contentFingerprint: 'a'.repeat(64), selectionRevision: '1', matchingPolicyVersion: 'wfc.pf.project-exact-candidates.v1', complete: true, propertyScan: null, objects: [{ objectId: 'dbid:3', parentId: null, name: '/B001', hasGeometry: true, isPhysicalLeaf: true, orderIndex: 0 }], trays: [{ projectTrayId: id(10), candidateRootObjectIds: ['dbid:3'] }], endpointCandidates: [] } };
  adapters = { validatePart: vi.fn((_plan, _part, value) => value), validateUnion: vi.fn(async () => ({ projection: { schemaVersion: 'pathfinder.model.snapshot.v1', payloadRef: id(11), sha256: 'd'.repeat(64), bytes: 100 }, traceIndex: { schemaVersion: 'wfc.pf.preparation-trace.v1', payloadRef: id(12), sha256: 'e'.repeat(64), bytes: 100 }, counts: { objects: 1, physicalLeaves: 1, fragments: 0, vertices: 0, triangles: 0 }, engineVersion: 'unchanged-canonical-engine', rulesVersion: 'unchanged-rules', diagnostics: [], publicationData: { privateBoundReference: id(11) } })), publish: vi.fn(async () => ({ artifactId: id(13), registryRevision: '5' })) };
});
const service = (capacityProfile?: PreparationCapacityProfile) => createPreparationService({} as Pool, adapters, capacityProfile === undefined ? {} : { capacityProfile });
async function collected(s = service()) { const session = await s.create(id(1), who, input), part = session.plan.partPlan[0]; await s.upload(id(1), who, session.id, part.partId, session.plan.orderedPlanSha256, payload(id(1))); return { s, session: await s.get(id(1), who, session.id), part }; }
async function multipartCollected(capacityProfile: PreparationCapacityProfile, leaves = 513) {
  input.discovery.objects = [{ objectId: 'dbid:1', parentId: null, name: '/B001', hasGeometry: false, isPhysicalLeaf: false, orderIndex: 0 }, ...Array.from({ length: leaves }, (_, index) => ({ objectId: 'dbid:' + (index + 3), parentId: 'dbid:1', name: 'Part ' + index, hasGeometry: true, isPhysicalLeaf: true, orderIndex: index + 1 }))];
  input.discovery.trays[0].candidateRootObjectIds = ['dbid:1'];
  const result = await collected(service(capacityProfile));
  expect(result.session.plan.partPlan.length).toBeGreaterThan(1);
  return result;
}
const command = (revision: string) => ({ schemaVersion: 'wfc.pf.preparation-mutation.v1', expectedSessionRevision: revision, idempotencyKey: id(20), reason: 'Synthetic publication' });
describe('bounded preparation SQL with real authority transaction and mocked pg transport', () => {
  function transport(errorAt?: string, code = '55P03') {
    fake.realAuthority = true;
    const sql: string[] = [], release = vi.fn();
    const connection = { release, query: vi.fn(async (statement: string) => {
      sql.push(statement);
      if (statement === errorAt) throw Object.assign(Error('synthetic transport detail'), { code });
      if (statement.startsWith('SELECT id FROM projects')) return { rows: [{ id: id(1) }] };
      if (statement.startsWith('SELECT is_admin')) return { rows: [{ is_admin: true }] };
      if (statement.startsWith('SELECT user_id,expires_at')) return { rows: [{ user_id: who.userId, expires_at: new Date(who.loginExpiresAt), revoked_at: null }] };
      return { rows: [] };
    }) };
    const pool = { connect: vi.fn(async () => connection) } as unknown as Pool;
    return { pool, connection, sql, release };
  }
  it('installs local SQL bounds before project/role/login locks and keeps them through COMMIT', async () => {
    const t = transport();
    expect(await preparationTransaction(t.pool, id(1), who, async c => { await c.query('OWNED_OPERATION'); return 'done'; })).toBe('done');
    expect(t.sql).toEqual(['BEGIN', `SET LOCAL lock_timeout='${PREPARATION_SQL_BOUNDS.lockMilliseconds}ms'`, `SET LOCAL statement_timeout='${PREPARATION_SQL_BOUNDS.statementMilliseconds}ms'`, `SET LOCAL idle_in_transaction_session_timeout='${PREPARATION_SQL_BOUNDS.idleMilliseconds}ms'`, 'SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE', 'SELECT is_admin FROM users WHERE id=$1 FOR SHARE', expect.stringContaining('INSERT INTO viewer_login_bindings'), 'SELECT user_id,expires_at,revoked_at FROM viewer_login_bindings WHERE login_id=$1 FOR SHARE', 'OWNED_OPERATION', 'COMMIT']);
    expect(t.release).toHaveBeenCalledTimes(1);
  });
  it.each(['55P03', '57014'])('preserves a reconcilable command on SQL deadline %s before COMMIT', async code => {
    const t = transport('SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE', code), operation = vi.fn();
    await expect(preparationTransaction(t.pool, id(1), who, operation)).rejects.toMatchObject({ code: 'PREPARATION_DATABASE_BUSY', status: 503 });
    expect(operation).not.toHaveBeenCalled(); expect(t.sql.at(-1)).toBe('ROLLBACK'); expect(t.sql).not.toContain('COMMIT'); expect(t.release).toHaveBeenCalledTimes(1);
  });
  it('never relabels a missing final COMMIT acknowledgement as definite refusal', async () => {
    const t = transport('COMMIT', '57014');
    await expect(preparationTransaction(t.pool, id(1), who, async () => 'written')).rejects.toMatchObject({ code: 'PREPARATION_COMMIT_OUTCOME_UNKNOWN', status: 503 });
    expect(t.sql.at(-1)).toBe('COMMIT'); expect(t.sql).not.toContain('ROLLBACK'); expect(t.release).toHaveBeenCalledExactlyOnceWith(true);
  });
  it('stops an aborted final publication before issuing COMMIT and retains normal authority refusals', async () => {
    const t = transport(), controller = new AbortController();
    await expect(preparationTransaction(t.pool, id(1), who, async () => { controller.abort(); }, controller.signal)).rejects.toMatchObject({ code: 'PREPARATION_VALIDATION_CANCELLED', status: 409 });
    expect(t.sql.at(-1)).toBe('ROLLBACK'); expect(t.sql).not.toContain('COMMIT');
    const denied = transport(); await expect(preparationTransaction(denied.pool, id(1), who, async () => { throw new PathFinderError('ADMIN_REQUIRED', 403); })).rejects.toMatchObject({ code: 'ADMIN_REQUIRED', status: 403 });
  });
  it('does not acquire a connection for an already aborted publication', async () => {
    const t = transport(), controller = new AbortController(); controller.abort();
    await expect(preparationTransaction(t.pool, id(1), who, async () => undefined, controller.signal)).rejects.toMatchObject({ code: 'PREPARATION_VALIDATION_CANCELLED' });
    expect(t.pool.connect).not.toHaveBeenCalled();
  });
  it('bounds queued pool acquisition and releases a late connection without beginning a transaction', async () => {
    vi.useFakeTimers();
    try {
      fake.realAuthority = true; let resolve!: (client: PoolClient) => void, connected!: () => void;
      const connecting = new Promise<void>(r => { connected = r; });
      const pool = { connect: vi.fn(() => { connected(); return new Promise<PoolClient>(r => { resolve = r; }); }) } as unknown as Pool;
      const release = vi.fn(), query = vi.fn(), attempt = preparationTransaction(pool, id(1), who, async () => undefined);
      const refused = expect(attempt).rejects.toMatchObject({ code: 'PREPARATION_DATABASE_BUSY', status: 503 });
      await connecting; await vi.advanceTimersByTimeAsync(PREPARATION_SQL_BOUNDS.acquisitionMilliseconds + 1); await refused;
      resolve({ release, query } as unknown as PoolClient); await Promise.resolve(); await Promise.resolve();
      expect(release).toHaveBeenCalledTimes(1); expect(query).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
describe('durable whole-network preparation lifecycle with mocked transactions and storage', () => {
  it('publishes an explicit tray-only session with nonempty endpoint dependencies without claiming endpoint capture', async () => {
    fake.context.endpointNames = ['=H1=KF1=TAC1', '=L1=LC1+3'];
    input.discovery.endpointScope = { schemaVersion: 'wfc.pf.endpoint-discovery-scope.v1', mode: 'not-requested' };
    const { s, session } = await collected();
    expect(session.plan.diagnostics).toEqual([]);
    expect(session.plan.requestedScope).toMatchObject({ scopeKind: 'server-requested-project-routing-only', endpointNames: fake.context.endpointNames, endpointEvidence: [], orderedEquipmentObjectIds: [] });
    expect(session.plan.partPlan.every(part => part.equipmentObjectIds.length === 0 && part.equipmentNames.length === 0)).toBe(true);
    const result = await s.publish(id(1), who, session.id, command(session.sessionRevision));
    expect(result.aggregate.orderedScopeSha256).toBe(session.plan.requestedScope.scopeSha256);
    expect(result.aggregate.requestedScopeComplete).toBe(true);
    expect(fake.rows.get(session.id).state).toBe('published');
    expect(adapters.publish).toHaveBeenCalledTimes(1);
  });
  it('retains endpoint-name freshness checks for an explicit tray-only session', async () => {
    fake.context.endpointNames = ['=H1=KF1=TAC1'];
    input.discovery.endpointScope = { schemaVersion: 'wfc.pf.endpoint-discovery-scope.v1', mode: 'not-requested' };
    const { s, session } = await collected();
    fake.context.endpointNames.push('=L1=LC1+3');
    await expect(s.publish(id(1), who, session.id, command(session.sessionRevision))).rejects.toMatchObject({ code: 'PREPARATION_SCOPE_STALE' });
    expect(fake.rows.get(session.id).state).toBe('stale');
    expect(adapters.validateUnion).not.toHaveBeenCalled();
    expect(adapters.publish).not.toHaveBeenCalled();
  });
  it('selects capacity only from validated service construction and rejects caller profile injection', async () => {
    const legacy = await service().create(id(1), who, input);
    expect(legacy.plan.limitsProfile).toBe(LEGACY_PREPARATION_CAPACITY_PROFILE);
    const large = await service(LARGE_PREPARATION_CAPACITY_PROFILE).create(id(1), who, { ...input, idempotencyKey: id(30) });
    expect(large.plan.limitsProfile).toBe(LARGE_PREPARATION_CAPACITY_PROFILE);
    await expect(service().create(id(1), who, { ...input, idempotencyKey: id(31), limitsProfile: LARGE_PREPARATION_CAPACITY_PROFILE })).rejects.toThrow();
    for (const capacityProfile of ['', 'unlimited']) expect(() => createPreparationService({} as Pool, adapters, { capacityProfile: capacityProfile as PreparationCapacityProfile })).toThrow();
  });
  it('preserves the original frozen profile on create replay even after trusted configuration changes', async () => {
    const legacy = await service().create(id(1), who, input);
    const replay = await service(LARGE_PREPARATION_CAPACITY_PROFILE).create(id(1), who, input);
    expect(replay.id).toBe(legacy.id); expect(replay.plan).toEqual(legacy.plan);
    expect(replay.plan.limitsProfile).toBe(LEGACY_PREPARATION_CAPACITY_PROFILE);
    expect(fake.rows.size).toBe(1);
  });
  it('refuses a substituted stored capacity profile under the historical plan hash', async () => {
    const session = await service().create(id(1), who, input);
    fake.rows.get(session.id).plan.limitsProfile = LARGE_PREPARATION_CAPACITY_PROFILE;
    await expect(service(LARGE_PREPARATION_CAPACITY_PROFILE).get(id(1), who, session.id)).rejects.toMatchObject({ code: 'PREPARATION_PLAN_INTEGRITY' });
    expect(adapters.validateUnion).not.toHaveBeenCalled(); expect(fake.aggregates).toHaveLength(0);
  });
  it.each([LEGACY_PREPARATION_CAPACITY_PROFILE, LARGE_PREPARATION_CAPACITY_PROFILE])('uses frozen %s for cumulative upload admission across multiple planned parts', async profile => {
    // Mocked receipt byte accounting exercises admission; this is not a real large-model memory claim.
    const { s, session, part } = await multipartCollected(profile);
    fake.parts.get(part.partId).payloadBytes = 32 * 1024 ** 2;
    const next = session.plan.partPlan[1];
    const uploading = s.upload(id(1), who, session.id, next.partId, session.plan.orderedPlanSha256, payload(id(1)));
    if (profile === LEGACY_PREPARATION_CAPACITY_PROFILE) {
      await expect(uploading).rejects.toMatchObject({ code: 'PREPARATION_VALIDATION_INPUT_LIMIT', status: 413 });
      expect(fake.parts.size).toBe(1); expect(fake.blobs.size).toBe(1);
    } else {
      expect((await uploading).part.partId).toBe(next.partId);
      expect(fake.parts.size).toBe(2); expect(fake.blobs.size).toBe(2);
    }
    expect(adapters.validateUnion).not.toHaveBeenCalled(); expect(fake.aggregates).toHaveLength(0);
  });
  it('retains the legacy publication limit after a restart configured for the larger profile', async () => {
    const { session, part } = await collected(); fake.parts.get(part.partId).payloadBytes = 32 * 1024 ** 2 + 1;
    await expect(service(LARGE_PREPARATION_CAPACITY_PROFILE).publish(id(1), who, session.id, command(session.sessionRevision))).rejects.toMatchObject({ code: 'PREPARATION_VALIDATION_INPUT_LIMIT', status: 413 });
    expect(adapters.validateUnion).not.toHaveBeenCalled(); expect(fake.rows.get(session.id).state).toBe('collecting');
  });
  it('refuses cumulative input above128MiB before loading parts or invoking a larger-profile union', async () => {
    const { s, session, part } = await multipartCollected(LARGE_PREPARATION_CAPACITY_PROFILE, 1025);
    expect(session.plan.partPlan.length).toBeGreaterThanOrEqual(3);
    const first = fake.parts.get(part.partId);
    for (const planned of session.plan.partPlan) fake.parts.set(planned.partId, { ...structuredClone(first), partId: planned.partId, partIndex: planned.partIndex, scopeSha256: planned.scopeSha256, payloadBytes: planned.partIndex < 2 ? 64 * 1024 ** 2 : 1 });
    await expect(s.publish(id(1), who, session.id, command(session.sessionRevision))).rejects.toMatchObject({ code: 'PREPARATION_VALIDATION_INPUT_LIMIT', status: 413 });
    expect(adapters.validateUnion).not.toHaveBeenCalled(); expect(fake.rows.get(session.id).state).toBe('collecting'); expect(fake.aggregates).toHaveLength(0);
  });
  it.each([LEGACY_PREPARATION_CAPACITY_PROFILE, LARGE_PREPARATION_CAPACITY_PROFILE])('binds projection readback capacity to frozen %s before publication', async profile => {
    const { s, session } = await collected(service(profile));
    const validation = await adapters.validateUnion(session.plan, [], new AbortController().signal);
    adapters.validateUnion = vi.fn(async () => ({ ...validation, projection: { ...validation.projection, bytes: 32 * 1024 ** 2 + 1 } }));
    const publishing = s.publish(id(1), who, session.id, command(session.sessionRevision));
    if (profile === LEGACY_PREPARATION_CAPACITY_PROFILE) {
      await expect(publishing).rejects.toMatchObject({ code: 'PREPARATION_VALIDATION_INPUT_LIMIT', status: 413 }); expect(adapters.publish).not.toHaveBeenCalled(); expect(fake.aggregates).toHaveLength(0);
    } else { expect((await publishing).aggregate.projection.bytes).toBe(32 * 1024 ** 2 + 1); expect(adapters.publish).toHaveBeenCalledTimes(1); }
  });
  it('refuses a larger-profile projection above128MiB before final publication', async () => {
    const { s, session } = await collected(service(LARGE_PREPARATION_CAPACITY_PROFILE));
    const validation = await adapters.validateUnion(session.plan, [], new AbortController().signal);
    adapters.validateUnion = vi.fn(async () => ({ ...validation, projection: { ...validation.projection, bytes: 128 * 1024 ** 2 + 1 } }));
    await expect(s.publish(id(1), who, session.id, command(session.sessionRevision))).rejects.toMatchObject({ code: 'PREPARATION_VALIDATION_INPUT_LIMIT', status: 413 });
    expect(adapters.publish).not.toHaveBeenCalled(); expect(fake.aggregates).toHaveLength(0); expect(fake.rows.get(session.id).state).toBe('failed');
  });
  it('creates once on exact replay and refuses a different request under the same key', async () => { const s = service(), first = await s.create(id(1), who, input); expect((await s.create(id(1), who, input)).id).toBe(first.id); expect(fake.rows.size).toBe(1); await expect(s.create(id(1), who, { ...input, discovery: { ...input.discovery, complete: false } })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' }); });
  it.each(['TRAY_ROOT_MISSING', 'TRAY_ROOT_AMBIGUOUS'] as const)('publishes complete included geometry while recording %s as a temporary scope omission', async reason => {
    fake.context.trays.push({ ...fake.context.trays[0], projectTrayId: id(30), rawName: '/B002', routeName: '/B002' });
    input.discovery.objects.push(
      { objectId: 'dbid:4', parentId: null, name: '/B002', hasGeometry: true, isPhysicalLeaf: true, orderIndex: 1 },
      { objectId: 'dbid:5', parentId: null, name: '/B002', hasGeometry: true, isPhysicalLeaf: true, orderIndex: 2 },
    );
    input.discovery.trays.push({ projectTrayId: id(30), candidateRootObjectIds: reason === 'TRAY_ROOT_MISSING' ? [] : ['dbid:4', 'dbid:5'] });
    input.unresolvedTrayPolicy = 'skip';
    const { s, session, part } = await collected();
    expect(session.plan.requestedScope).toMatchObject({ unresolvedTrayPolicy: 'skip', skippedTrays: [{ projectTrayId: id(30), reason }], excludedProjectTrayIds: [id(30)], orderedPhysicalLeafIds: ['dbid:3'] });
    expect(session.plan.diagnostics).toEqual([]);
    expect(session.coverage).toMatchObject({ expectedParts: 1, committedParts: 1, requestedScopeComplete: true });
    const publication = await s.publish(id(1), who, session.id, command(session.sessionRevision));
    expect(publication.aggregate.requestedScopeComplete).toBe(true);
    expect(publication.aggregate.wholePlantGeometry).toBe(false);
    expect(publication.aggregate.orderedScopeSha256).toBe(session.plan.requestedScope.scopeSha256);
    expect(publication.aggregate.partReferences.map(value => value.partId)).toEqual([part.partId]);
    expect((await s.create(id(1), who, input)).id).toBe(session.id);
    expect(adapters.publish).toHaveBeenCalledOnce();
    expect(fake.context.resolutions).toEqual([]);
    expect(fake.calls.some(sql => sql.includes('INSERT INTO pf_preparation_resolutions') || sql.includes('INSERT INTO pf_preparation_resolution_events'))).toBe(false);
  });
  it('does not reinterpret an old strict command or publish a zero-geometry skipped plan', async () => {
    const s = service(), strict = await s.create(id(1), who, input);
    await expect(s.create(id(1), who, { ...input, unresolvedTrayPolicy: 'skip' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    input = { ...input, idempotencyKey: id(31), unresolvedTrayPolicy: 'skip', discovery: { ...input.discovery, trays: [{ projectTrayId: id(10), candidateRootObjectIds: [] }] } };
    const empty = await s.create(id(1), who, input);
    expect(empty.id).not.toBe(strict.id);
    expect(empty.plan.diagnostics.map(value => value.code)).toEqual(['NO_AUTHORIZED_ROUTING_GEOMETRY']);
    expect(empty.coverage.requestedScopeComplete).toBe(false);
    await expect(s.publish(id(1), who, empty.id, command(empty.sessionRevision))).rejects.toMatchObject({ code: 'PREPARATION_PARTS_INCOMPLETE' });
    expect(adapters.validateUnion).not.toHaveBeenCalled(); expect(adapters.publish).not.toHaveBeenCalled();
  });
  it('fsync-backed committed part replay cannot advance revision or publish a partial artifact', async () => { const { s, session, part } = await collected(); const result = await s.upload(id(1), who, session.id, part.partId, session.plan.orderedPlanSha256, payload(id(1))); expect(result.duplicate).toBe(true); expect(result.sessionRevision).toBe(session.sessionRevision); expect(fake.aggregates).toHaveLength(0); expect(adapters.publish).not.toHaveBeenCalled(); });
  it('historical part replay survives own publication and later scope changes under fresh authority', async () => { const { s, session, part } = await collected(); await s.publish(id(1), who, session.id, command(session.sessionRevision)); fake.context.scope.locationRegistryRevision = '5'; fake.context.scope.catalogRevision = '9'; const result = await s.upload(id(1), who, session.id, part.partId, session.plan.orderedPlanSha256, payload(id(1))); expect(result.duplicate).toBe(true); expect(fake.rows.get(session.id).state).toBe('published'); expect(fake.parts.size).toBe(1); fake.authorized = false; await expect(s.upload(id(1), who, session.id, part.partId, session.plan.orderedPlanSha256, payload(id(1)))).rejects.toMatchObject({ code: 'ADMIN_REQUIRED' }); });
  it('a conflicting historical part cannot replace its existing bytes even after scope changes', async () => { const { s, session, part } = await collected(); fake.context.scope.catalogRevision = '9'; const changed = payload(id(1)); changed.objects[0].bounds.maximum[0] = 2; await expect(s.upload(id(1), who, session.id, part.partId, session.plan.orderedPlanSha256, changed)).rejects.toMatchObject({ code: 'PART_IDENTITY_CONFLICT' }); expect(fake.parts.size).toBe(1); });
  it('requires the explicit planned-part validator before a durable part acknowledgement', async () => { adapters.validatePart = undefined; const s = service(), session = await s.create(id(1), who, input); await expect(s.upload(id(1), who, session.id, session.plan.partPlan[0].partId, session.plan.orderedPlanSha256, payload(id(1)))).rejects.toMatchObject({ code: 'PREPARATION_PART_VALIDATOR_REQUIRED' }); expect(fake.parts.size).toBe(0); expect(fake.blobs.size).toBe(0); });
  it('commits one aggregate, scoped root publication and current pointer atomically', async () => { const { s, session } = await collected(), result = await s.publish(id(1), who, session.id, command(session.sessionRevision)); expect(result.aggregate.sourceLocationRegistryRevision).toBe('4'); expect(result.aggregate.locationRegistryRevision).toBe('5'); expect(result.aggregate.engineeringAccepted).toBe(false); expect(fake.current.geometry_revision).toBe('1'); expect(fake.rows.get(session.id).state).toBe('published'); expect(adapters.publish).toHaveBeenCalledTimes(1); });
  it('replays an authenticated historical publication despite later scope edits', async () => { const { s, session } = await collected(), raw = command(session.sessionRevision), first = await s.publish(id(1), who, session.id, raw); fake.context.scope.catalogRevision = '20'; const replay = await s.publish(id(1), who, session.id, raw); expect(replay.aggregate.id).toBe(first.aggregate.id); expect(replay.duplicate).toBe(true); expect(adapters.publish).toHaveBeenCalledTimes(1); fake.authorized = false; await expect(s.publish(id(1), who, session.id, raw)).rejects.toMatchObject({ code: 'ADMIN_REQUIRED' }); });
  it('reconciles a lost final committed acknowledgement to the same receipt without a second publication', async () => { const { s, session } = await collected(); fake.loseCommitAck = true; const result = await s.publish(id(1), who, session.id, command(session.sessionRevision)); expect(result.duplicate).toBe(true); expect(fake.aggregates).toHaveLength(1); expect(fake.rows.get(session.id).state).toBe('published'); expect(adapters.publish).toHaveBeenCalledTimes(1); });
  it('retains validating intent and old pointer when final commit outcome cannot be proven', async () => { const { s, session } = await collected(); fake.failBeforeCommit = true; await expect(s.publish(id(1), who, session.id, command(session.sessionRevision))).rejects.toThrow('connection lost before commit'); expect(fake.aggregates).toHaveLength(0); expect(fake.current.current_aggregate_id).toBe(null); expect(fake.rows.get(session.id).state).toBe('validating'); expect(fake.blobs.size).toBe(1); });
  it('a new service recovers the exact durable validation command after lease expiry without guessing its CAS or key', async () => { const { s, session } = await collected(), raw = command(session.sessionRevision); fake.failBeforeCommit = true; await expect(s.publish(id(1), who, session.id, raw)).rejects.toThrow(); fake.failBeforeCommit = false; fake.rows.get(session.id).validation_expires_at = new Date(0); const restarted = service(), reloaded = await restarted.get(id(1), who, session.id); expect(reloaded.recovery).toMatchObject({ command: raw, actorId: who.userId, loginId: who.loginId }); expect((await restarted.publish(id(1), who, session.id, reloaded.recovery!.command)).aggregate.geometryRevision).toBe('1'); expect(fake.aggregates).toHaveLength(1); });
  it('rejects corrupted durable recovery command content instead of silently inventing a replacement', async () => { const { s, session } = await collected(); fake.failBeforeCommit = true; await expect(s.publish(id(1), who, session.id, command(session.sessionRevision))).rejects.toThrow(); fake.rows.get(session.id).validation_command.reason = 'Unexpected changed intent'; await expect(s.get(id(1), who, session.id)).rejects.toMatchObject({ code: 'PREPARATION_VALIDATION_INTENT_INTEGRITY' }); expect(fake.aggregates).toHaveLength(0); });
  it('marks pre-engine stale input durably and never publishes the old plan', async () => { const { s, session } = await collected(); fake.context.scope.routingPolicyRevision = '4'; await expect(s.publish(id(1), who, session.id, command(session.sessionRevision))).rejects.toMatchObject({ code: 'PREPARATION_SCOPE_STALE' }); expect(fake.rows.get(session.id).state).toBe('stale'); expect(adapters.validateUnion).not.toHaveBeenCalled(); expect(fake.current.geometry_revision).toBe('0'); });
  it('invalidates changed cable endpoint-name scope even when common registry/routing tokens did not advance', async () => { const { s, session } = await collected(); fake.context.endpointNames = ['New equipment endpoint']; await expect(s.publish(id(1), who, session.id, command(session.sessionRevision))).rejects.toMatchObject({ code: 'PREPARATION_SCOPE_STALE' }); expect(fake.rows.get(session.id).state).toBe('stale'); expect(adapters.validateUnion).not.toHaveBeenCalled(); expect(fake.current.geometry_revision).toBe('0'); });
  it('durably marks a definite post-engine dependency change stale after the final transaction refuses it', async () => { const validated = await adapters.validateUnion({} as any, [], new AbortController().signal); adapters.validateUnion = vi.fn(async () => { fake.context.scope.routingPolicyRevision = '4'; return validated; }); const { s, session } = await collected(); await expect(s.publish(id(1), who, session.id, command(session.sessionRevision))).rejects.toMatchObject({ code: 'PREPARATION_SCOPE_STALE' }); expect(fake.rows.get(session.id).state).toBe('stale'); expect(fake.aggregates).toHaveLength(0); expect(adapters.publish).not.toHaveBeenCalled(); });
  it('keeps exact in-progress publication retry explicitly uncertain, preserving its command', async () => { const validated = await adapters.validateUnion({} as any, [], new AbortController().signal); let begun!: () => void, finish!: (value: PreparationValidation) => void; const started = new Promise<void>(r => { begun = r; }); adapters.validateUnion = vi.fn(() => new Promise<PreparationValidation>(resolve => { finish = resolve; begun(); })); const { s, session } = await collected(), raw = command(session.sessionRevision), publishing = s.publish(id(1), who, session.id, raw); await started; await expect(s.publish(id(1), who, session.id, raw)).rejects.toMatchObject({ code: 'PREPARATION_VALIDATION_IN_PROGRESS', status: 503 }); finish(validated); expect((await publishing).aggregate.geometryRevision).toBe('1'); });
  it('rejects a missing/tampered part before publication and preserves its evidence', async () => { const { s, session, part } = await collected(); fake.blobs.set(part.partId, Buffer.from('{}')); await expect(s.publish(id(1), who, session.id, command(session.sessionRevision))).rejects.toMatchObject({ code: 'PREPARATION_BLOB_INTEGRITY' }); expect(fake.rows.get(session.id).state).toBe('failed'); expect(fake.parts.size).toBe(1); expect(adapters.publish).not.toHaveBeenCalled(); });
  it('refuses the effective staged 32MiB validation ceiling before reading or fitting the union', async () => { const { s, session, part } = await collected(); fake.parts.get(part.partId).payloadBytes = 32 * 1024 * 1024 + 1; await expect(s.publish(id(1), who, session.id, command(session.sessionRevision))).rejects.toMatchObject({ code: 'PREPARATION_VALIDATION_INPUT_LIMIT', status: 413 }); expect(adapters.validateUnion).not.toHaveBeenCalled(); expect(fake.rows.get(session.id).state).toBe('collecting'); expect(fake.aggregates).toHaveLength(0); });
  it('passes only immutable receipt references to large-profile validation, while final publication still rechecks stored part integrity', async () => {
    const {s,session,part}=await collected(service(LARGE_PREPARATION_CAPACITY_PROFILE));
    const receipt=fake.parts.get(part.partId),validated=await adapters.validateUnion({} as PreparationPlan,[],new AbortController().signal);
    adapters.validateUnion=vi.fn(async(_plan,parts)=>{
      expect(parts).toEqual([{partId:receipt.partId,reference:{payloadRef:receipt.payloadRef,sha256:receipt.payloadSha256,bytes:receipt.payloadBytes}}]);
      expect(Object.keys(parts[0]).sort()).toEqual(['partId','reference']);
      fake.blobs.set(receipt.payloadRef,Buffer.from('{}'));
      return validated;
    });
    await expect(s.publish(id(1),who,session.id,command(session.sessionRevision))).rejects.toMatchObject({code:'PREPARATION_BLOB_INTEGRITY'});
    expect(adapters.validateUnion).toHaveBeenCalledTimes(1);expect(adapters.publish).not.toHaveBeenCalled();expect(fake.aggregates).toHaveLength(0);
  });
  it('keeps legacy-profile inline validation input and its strict normalized snapshot',async()=>{
    const {s,session}=await collected();await s.publish(id(1),who,session.id,command(session.sessionRevision));
    const [,parts]=vi.mocked(adapters.validateUnion).mock.calls[0];expect(parts).toHaveLength(1);expect(parts[0]).toMatchObject({payload:{schemaVersion:'pathfinder.model.snapshot.v1'}});expect(Object.hasOwn(parts[0],'reference')).toBe(false);
  });
  it('cancellation aborts outside-SQL engine work and fences its final publication', async () => { let began!: () => void; const started = new Promise<void>(r => { began = r; }); adapters.validateUnion = vi.fn((_plan, _parts, signal) => new Promise<PreparationValidation>((_resolve, reject) => { began(); signal.addEventListener('abort', () => reject(new PathFinderError('PREPARATION_CANCELLED', 409)), { once: true }); })); const { s, session } = await collected(); const publishing = s.publish(id(1), who, session.id, command(session.sessionRevision)); await started; const current = await s.get(id(1), who, session.id); const cancelled = await s.cancel(id(1), who, session.id, { ...command(current.sessionRevision), idempotencyKey: id(21), reason: 'Operator cancelled' }); expect(cancelled.state).toBe('cancelled'); await expect(publishing).rejects.toMatchObject({ code: 'PREPARATION_CANCELLED' }); expect(fake.aggregates).toHaveLength(0); expect(fake.rows.get(session.id).state).toBe('cancelled'); });
  it('refuses stale cancellation CAS and exact-key conflicting payloads', async () => { const { s, session } = await collected(); await expect(s.cancel(id(1), who, session.id, command('0'))).rejects.toMatchObject({ code: 'PREPARATION_STATE_CONFLICT' }); const raw = command(session.sessionRevision); await s.cancel(id(1), who, session.id, raw); expect((await s.cancel(id(1), who, session.id, raw)).state).toBe('cancelled'); await expect(s.cancel(id(1), who, session.id, { ...raw, reason: 'Changed' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' }); });
});
