import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { BARRIER_CAPTURE_VERSION, BARRIER_LIMITS, barrierCanonicalJson, type BarrierCapture, type BarrierModelScope } from '../../shared/pathfinderBarriers.js';
import { MIXED_BARRIER_POLICY } from '../../shared/pathfinderBarrierMixed.js';
import { barrierCommandRecoveryTargetSchema, matchBarrierCommandRecovery } from '../../shared/pathfinderBarrierRecovery.js';
import type { JobPrincipal } from './jobContracts.js';
const storage = vi.hoisted(() => ({ blobs: new Map<string, Buffer>(), fail: false }));
vi.mock('./barrierStorage.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./barrierStorage.js')>();
  return { ...actual,
    storeBarrierBytes: vi.fn(async (project: string, intent: string, blob: string, value: Buffer) => {
      if (storage.fail) throw new Error('synthetic storage failure');
      const key = `${project}/${intent}/${blob}`, old = storage.blobs.get(key);
      if (old && !old.equals(value)) throw Error('immutable conflict');
      storage.blobs.set(key, Buffer.from(value)); return { blobId: blob, sha256: actual.barrierBytesHash(value), bytes: value.length };
    }),
    readBarrierBytes: vi.fn(async (project: string, intent: string, ref: { blobId: string; sha256: string; bytes: number }) => {
      const value = storage.blobs.get(`${project}/${intent}/${ref.blobId}`);
      if (!value || value.length !== ref.bytes || actual.barrierBytesHash(value) !== ref.sha256) throw Error('blob integrity'); return Buffer.from(value);
    }),
  };
});
import { barrierBytesHash, barrierValueHash } from './barrierStorage.js';
import { barrierPublicationReceiptSchema } from '../../shared/pathfinderBarrierOutcomes.js';
import { BARRIER_REGISTRY_SQL, initializeBarrierRegistrySchema } from './barrierRegistrySchema.js';
import { BarrierCaptureQualificationRefusal, BARRIER_REGISTRY_SQL_BOUNDS, barrierRegistryTransaction, createBarrierRegistryRepository, type BarrierCaptureCommand, type BarrierCaptureIntent, type BarrierRegistryAdapters } from './barrierRegistryRepository.js';
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = (): BarrierModelScope => ({ projectId: id(1), modelVersionId: id(2), contentFingerprint: 'a'.repeat(64), selectionRevision: '1', captureFrameId: id(3), captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' });
type Row = Record<string, unknown>;
function fixture() {
  let durable = { head: null as { revision: string; snapshot_id: string } | null, intents: new Map<string, Row>(), snapshots: new Map<string, Row>(), receipts: new Map<string, Row>(), closures: new Map<string, Row>() };
  let checkpoint: typeof durable | null = null;
  const who: JobPrincipal = { userId: id(4), loginId: id(5), loginExpiresAt: Date.now() + 3600000 };
  const controls = { scope: scope(), admin: true, revoked: false, qualifyError: null as Error | null, commitUnknown: false,
    finalAuthorityError: null as Error | null,
    duringQualify: (() => undefined) as () => void, duringHead: (() => undefined) as () => void,
    duringReceipt: (() => undefined) as () => void, clearLeaseRows: true };
  const calls: string[] = [], release = vi.fn();
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    calls.push(sql);
    if (sql === 'BEGIN') { checkpoint = structuredClone(durable); return { rows: [] }; }
    if (sql === 'ROLLBACK') { if (checkpoint) durable = checkpoint; checkpoint = null; return { rows: [] }; }
    if (sql === 'COMMIT') { checkpoint = null; if (controls.commitUnknown) { controls.commitUnknown = false; throw Error('lost acknowledgement'); } return { rows: [] }; }
    if (sql.startsWith('SET LOCAL') || sql.startsWith('INSERT INTO viewer_login_bindings')) return { rows: [] };
    if (sql.includes('barrier:command-fence')) return { rows: [durable.closures.get(`${values[0]}/${values[1]}`)].filter(Boolean) };
    if (sql.includes('barrier:recovery-receipts')) return { rows: [...durable.receipts.values()].filter(row => row.project_id === values[0] && row.request_sha256 === values[1]).slice(0, 2) };
    if (sql.includes('barrier:recovery-intents')) return { rows: [...durable.intents.values()].filter(row => row.project_id === values[0] && row.request_sha256 === values[1]).slice(0, 2).map(row => ({ ...row, allocation_is_null: row.allocation === null,
      allocation: row.allocation === null || Buffer.byteLength(JSON.stringify(row.allocation)) > Number(values[3]) ? null : row.allocation })) };
    if (sql.includes('barrier:recovery-snapshot')) return { rows: [...durable.snapshots.values()].filter(row => row.project_id === values[0] && row.id === values[1]).slice(0, 2) };
    if (sql.includes('barrier:recovery-clear-lease')) { const row = durable.intents.get(String(values[1])); if (!row || row.project_id !== values[0] || row.state !== 'pending') return { rows: [] }; row.lease_token = null; row.lease_expires_at = null; return { rows: [{ id: row.id }] }; }
    if (sql.startsWith('INSERT INTO pf_barrier_command_closures')) { const key = `${values[0]}/${values[1]}`; if (durable.closures.has(key)) throw Error('immutable closure conflict'); durable.closures.set(key, { project_id: values[0], command_sha256: values[1], id: values[2], record_sha256: values[3], record: values[4], closed_by: values[5], login_id: values[6], closed_at: new Date(String(values[7])) }); return { rows: [] }; }
    if (sql.startsWith('SELECT id FROM projects')) return { rows: [{ id: id(1) }] };
    if (sql.startsWith('SELECT is_admin')) return { rows: [{ is_admin: controls.admin }] };
    if (sql.startsWith('SELECT user_id,expires_at,revoked_at')) return { rows: [{ user_id: who.userId, expires_at: new Date(who.loginExpiresAt), revoked_at: controls.revoked ? new Date() : null }] };
    if (sql.startsWith('SELECT revision::text')) return { rows: durable.head ? [durable.head] : [] };
    if (sql.startsWith('SELECT id,actor_id')) {
      const rows = [...durable.intents.values()].filter(row => row.project_id === values[0]);
      return { rows: sql.includes('actor_id=$2') ? rows.filter(row => row.actor_id === values[1] && row.idempotency_key === values[2]) : rows.filter(row => row.id === values[1]) };
    }
    if (sql.startsWith('SELECT id FROM pf_barrier_capture_intents')) return { rows: [...durable.intents.values()].filter(row => row.project_id === values[0] && row.actor_id === values[1] && row.idempotency_key === values[2]) };
    if (sql.startsWith('INSERT INTO pf_barrier_capture_intents')) {
      durable.intents.set(String(values[0]), { id: values[0], project_id: values[1], actor_id: values[2], login_id: values[3], idempotency_key: values[4], request_sha256: values[5], request: values[6], frozen: values[7], state: 'pending', capture_sha256: null, allocation: null, lease_token: null, lease_expires_at: null }); return { rows: [] };
    }
    if (sql.startsWith('UPDATE pf_barrier_capture_intents SET capture_sha256')) {
      if (typeof values[3] !== 'string') throw Error('JSONB allocation must be sent as JSON text, not a PostgreSQL array');
      Object.assign(durable.intents.get(String(values[1]))!, { capture_sha256: values[2], allocation: JSON.parse(values[3]), lease_token: values[4], lease_expires_at: values[5] }); return { rows: [] };
    }
    if (sql.startsWith("UPDATE pf_barrier_capture_intents SET state='complete'")) { durable.intents.get(String(values[1]))!.state = 'complete'; return { rows: [] }; }
    if (sql.startsWith('UPDATE pf_barrier_capture_intents SET lease_token=NULL')) {
      const row = durable.intents.get(String(values[1]));
      if (!controls.clearLeaseRows || !row || row.project_id !== values[0] || row.lease_token !== values[2]) return { rows: [] };
      row.lease_token = null; row.lease_expires_at = null; return { rows: [{ id: row.id }] };
    }
    if (sql.startsWith('SELECT request_sha256')) return { rows: [durable.receipts.get(`${values[0]}/${values[1]}/${values[2]}`)].filter(Boolean) };
    if (sql.startsWith('INSERT INTO pf_barrier_receipts')) { durable.receipts.set(`${values[0]}/${values[1]}/${values[2]}`, { project_id: values[0], actor_id: values[1], idempotency_key: values[2], request_sha256: values[3], request: values[4], receipt: values[5] }); controls.duringReceipt(); return { rows: [] }; }
    if (sql.startsWith('INSERT INTO pf_barrier_snapshots')) {
      durable.snapshots.set(String(values[0]), { id: values[0], project_id: values[1], model_version_id: values[2], registry_revision: values[3], storage_intent_id: values[4], manifest_blob: values[5], manifest: values[6], created_by: values[7], login_id: values[8] }); return { rows: [] };
    }
    if (sql.startsWith('INSERT INTO pf_barrier_heads')) { durable.head = { revision: String(values[1]), snapshot_id: String(values[2]) }; controls.duringHead(); return { rows: [] }; }
    if (sql.startsWith('SELECT id,storage_intent_id')) {
      const rows = [...durable.snapshots.values()].filter(row => row.project_id === values[0]);
      return { rows: sql.includes('AND id=$2') ? rows.filter(row => row.id === values[1]) : rows.sort((a, b) => Number(b.registry_revision) - Number(a.registry_revision)).slice(Number(values[2]), Number(values[2]) + Number(values[1])) };
    }
    throw Error(`Unexpected SQL: ${sql}`);
  });
  const client = { query, release }, pool = { connect: async () => client } as unknown as Pool;
  const adapters = { currentScope: vi.fn<BarrierRegistryAdapters['currentScope']>(async () => controls.scope), publicationFrameSha256: vi.fn(() => 'f'.repeat(64)), assertBeforeCommit: vi.fn(() => { if (controls.finalAuthorityError) throw controls.finalAuthorityError; }), qualifyCapture: vi.fn<BarrierRegistryAdapters['qualifyCapture']>(async () => {
    controls.duringQualify(); if (controls.qualifyError) throw controls.qualifyError;
    return { producerVersion: 'wfc.pf.barrier-verifier.v1' as const, computationalMeshes: 1, verificationSha256: 'c'.repeat(64) };
  }) };
  const repository = createBarrierRegistryRepository(pool, adapters);
  const command: BarrierCaptureCommand = { schemaVersion: 'wfc.pf.barrier-capture-command.v1', scope: scope(), expectedRegistryRevision: '0', idempotencyKey: id(6), selectedParents: [{ selectionId: id(7), kind: 'wall', objectId: 'dbid:10', dbId: 10, externalId: null, name: 'Selected wall parent', identityBasis: 'version-local-only', inclusion: 'own-and-all-descendant-fragments' }] };
  const capture = (intent: BarrierCaptureIntent): BarrierCapture => ({ schemaVersion: BARRIER_CAPTURE_VERSION, captureId: intent.id, scope: intent.command.scope, selectedParents: intent.command.selectedParents,
    fragments: [{ source: { fragmentId: 15, ownerObjectId: 'dbid:11', parentSelectionIds: [id(7)], sourceUnits: 'm', metresPerSourceUnit: 1,
      sourceToWorldMetres: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], transformSha256: 'd'.repeat(64) },
    bounds: { minimum: [0, 0, 0], maximum: [1, 1, 1] }, verticesMetres: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]], triangleIndices: [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3] }],
    observation: { state: 'reported-complete', verification: 'unverified', enumeratedFragmentIds: [15], unavailableFragmentIds: [], enumerationSha256: 'e'.repeat(64) } });
  const bytes = (intent: BarrierCaptureIntent) => Buffer.from(barrierCanonicalJson(capture(intent)));
  const outcomeQuery = (intent: BarrierCaptureIntent) => ({ commandSha256: barrierValueHash(intent.command), captureSha256: barrierBytesHash(bytes(intent)), frameSha256: 'f'.repeat(64) });
  const refusal = (intent: BarrierCaptureIntent) => new BarrierCaptureQualificationRefusal(barrierBytesHash(bytes(intent)), 'f'.repeat(64), '9'.repeat(64));
  const empty = (revision = '0', key = id(20)) => ({ schemaVersion: 'wfc.pf.barrier-registry-command.v1', action: 'declare-empty', scope: scope(), expectedRegistryRevision: revision, idempotencyKey: key, reason: 'Administrator explicitly selected no physical barriers.' });
  return { pool, repository, adapters, controls, who, command, capture, bytes, refusal, outcomeQuery, empty, calls, query, release, get durable() { return durable; } };
}
beforeEach(() => { storage.blobs.clear(); storage.fail = false; });

function recoveryTarget(f: ReturnType<typeof fixture>, command: unknown, options: { mixed?: boolean; empty?: boolean; intent?: BarrierCaptureIntent; publication?: boolean } = {}) {
  const knownIntent = options.intent ? { actorId: options.intent.createdBy, loginId: options.intent.loginId,
    intentId: options.intent.id, snapshotId: options.intent.snapshotId } : null;
  return barrierCommandRecoveryTargetSchema.parse({ schemaVersion: 'wfc.pf.barrier-command-recovery-target.v1', projectId: id(1),
    commandSha256: barrierValueHash(command), scope: scope(), pendingRecordSha256: '6'.repeat(64),
    pendingRecordVersion: options.mixed ? 'wfc.pf.barrier-pending-command.v2' : 'wfc.pf.barrier-pending-command.v1',
    ...(options.mixed ? { geometryPolicy: MIXED_BARRIER_POLICY } : {}),
    ...(options.empty ? { kind: 'empty' } : options.publication ? { kind: 'publication', knownIntent,
      captureSha256: barrierBytesHash(f.bytes(options.intent!)), frameSha256: 'f'.repeat(64), loadId: id(99) } : { kind: 'capture-intent', knownIntent }) });
}
describe('exact hash recovery with synthetic transaction/storage boundary', () => {
  it('keeps absent inspection nonterminal and does not call Viewer/current-scope qualification', async () => {
    const f = fixture(), target = recoveryTarget(f, f.command), before = structuredClone(f.durable);
    const value = await f.repository.readCommandRecovery(id(1), f.who, target);
    expect(value.outcome).toBe('not-recorded'); expect(matchBarrierCommandRecovery(target, value, text => barrierBytesHash(Buffer.from(text)))).toBeNull();
    expect(f.durable).toEqual(before); expect(f.adapters.currentScope).not.toHaveBeenCalled(); expect(f.adapters.qualifyCapture).not.toHaveBeenCalled();
  });
  it.each([['legacy', 'capture'], ['mixed', 'capture'], ['legacy', 'empty'], ['mixed', 'empty']] as const)('closes absent %s %s and refuses its delayed original mutation', async (lane, kind) => {
    const f = fixture(), mixed = lane === 'mixed', request = kind === 'capture' ? mixed ? mixedCommand(f) : f.command
      : { ...f.empty(), ...(mixed ? { schemaVersion: 'wfc.pf.barrier-registry-command.v2', geometryPolicy: MIXED_BARRIER_POLICY } : {}) };
    const target = recoveryTarget(f, request, { mixed, empty: kind === 'empty' }), close = { schemaVersion: 'wfc.pf.barrier-command-close.v1', target };
    const value = await f.repository.closeCommand(id(1), f.who, close); expect(value.outcome).toBe('closed');
    if (value.outcome !== 'closed') throw Error('closure fixture');
    expect(value.closure.original).toEqual({ state: 'not-recorded' }); expect(f.durable.head).toBeNull(); expect(f.durable.snapshots.size).toBe(0);
    expect(await f.repository.closeCommand(id(1), f.who, close)).toEqual(value);
    expect(await f.repository.readCommandRecovery(id(1), f.who, target)).toEqual(value);
    await expect(kind === 'capture' ? f.repository.begin(id(1), f.who, request) : f.repository.command(id(1), f.who, request)).rejects.toMatchObject({ code: 'BARRIER_COMMAND_CLOSED' });
    expect(f.durable.intents.size).toBe(0); expect(f.durable.receipts.size).toBe(0); expect(f.durable.closures.size).toBe(1);
  });
  it('closes an admitted pending capture under new administrator authority without resuming original login', async () => {
    const f = fixture(), intent = (await f.repository.begin(id(1), f.who, f.command)).intent, oldOwner = { actorId: f.who.userId, loginId: f.who.loginId };
    const target = recoveryTarget(f, f.command, { intent }), row = f.durable.intents.get(intent.id)!;
    row.capture_sha256 = barrierBytesHash(f.bytes(intent)); row.allocation = [{ fragmentId: 15, blobId: id(80) }]; row.lease_token = id(81); row.lease_expires_at = new Date(Date.now() + 60000);
    const oldIdentity = structuredClone(row.frozen); Object.assign(f.who, { userId: id(90), loginId: id(91) });
    f.adapters.currentScope.mockClear();
    const result = await f.repository.closeCommand(id(1), f.who, { schemaVersion: 'wfc.pf.barrier-command-close.v1', target });
    expect(result).toMatchObject({ outcome: 'closed', closure: { original: { state: 'recorded', command: oldOwner },
      closedBy: { actorId: id(90), loginId: id(91), authority: 'current-project-administrator-close-only' }, mayResumeCapture: false, mayPublish: false, grantsCalculation: false } });
    expect(f.durable.intents.get(intent.id)).toMatchObject({ frozen: oldIdentity, capture_sha256: row.capture_sha256, allocation: row.allocation, lease_token: null, lease_expires_at: null });
    expect(f.adapters.currentScope).not.toHaveBeenCalled();
  });
  it('never closes a target claiming acknowledged IDs when the original row is absent', async () => {
    const f = fixture(), intent = { id: id(70), snapshotId: id(71), captureBlobId: id(72), manifestBlobId: id(73), command: f.command, createdBy: f.who.userId, loginId: f.who.loginId };
    await expect(f.repository.closeCommand(id(1), f.who, { schemaVersion: 'wfc.pf.barrier-command-close.v1', target: recoveryTarget(f, f.command, { intent }) })).rejects.toMatchObject({ code: 'BARRIER_RECOVERY_ORIGINAL_UNAVAILABLE' });
    expect(f.durable.closures.size).toBe(0);
  });
  it('lets an exact committed capture success win instead of writing a closure', async () => {
    const f = fixture(), intent = (await f.repository.begin(id(1), f.who, f.command)).intent; await f.repository.publish(id(1), f.who, intent.id, f.bytes(intent));
    const before = structuredClone(f.durable), target = recoveryTarget(f, f.command, { intent, publication: true });
    const result = await f.repository.closeCommand(id(1), f.who, { schemaVersion: 'wfc.pf.barrier-command-close.v1', target });
    expect(result).toMatchObject({ outcome: 'published', original: { actorId: intent.createdBy, loginId: intent.loginId }, frameBinding: 'not-recorded', frameSha256: null });
    expect(f.durable).toEqual(before);
  });
  it('lets an exact empty publication win and derives original owner from the stored snapshot', async () => {
    const f = fixture(), request = f.empty(); await f.repository.command(id(1), f.who, request);
    const target = recoveryTarget(f, request, { empty: true }), previous = { actorId: f.who.userId, loginId: f.who.loginId };
    Object.assign(f.who, { userId: id(90), loginId: id(91) });
    expect(await f.repository.closeCommand(id(1), f.who, { schemaVersion: 'wfc.pf.barrier-command-close.v1', target })).toMatchObject({ outcome: 'published', original: { ...previous, kind: 'declare-empty' } });
    expect(f.durable.closures.size).toBe(0);
  });
  it('lets exact logical refusal win and preserves actual full-frame binding', async () => {
    const f = fixture(), intent = (await f.repository.begin(id(1), f.who, f.command)).intent; f.controls.qualifyError = f.refusal(intent);
    await f.repository.publish(id(1), f.who, intent.id, f.bytes(intent));
    const before = structuredClone(f.durable), target = recoveryTarget(f, f.command, { intent, publication: true });
    expect(await f.repository.closeCommand(id(1), f.who, { schemaVersion: 'wfc.pf.barrier-command-close.v1', target })).toMatchObject({ outcome: 'geometry-refused', refusal: { frameSha256: 'f'.repeat(64) } });
    expect(f.durable).toEqual(before);
  });
  it('reconciles a closure whose COMMIT acknowledgement was lost using its exact original target', async () => {
    const f = fixture(), target = recoveryTarget(f, f.command); f.controls.commitUnknown = true;
    await expect(f.repository.closeCommand(id(1), f.who, { schemaVersion: 'wfc.pf.barrier-command-close.v1', target })).rejects.toMatchObject({ code: 'BARRIER_COMMIT_OUTCOME_UNKNOWN' });
    expect(f.durable.closures.size).toBe(1);
    expect((await f.repository.readCommandRecovery(id(1), f.who, target)).outcome).toBe('closed'); expect(f.release).toHaveBeenCalledWith(true);
  });
  it.each(['lane', 'scope', 'known-owner'] as const)('refuses a foreign %s recovery constraint without inserting a fence', async field => {
    const f = fixture(), intent = (await f.repository.begin(id(1), f.who, f.command)).intent;
    let target = recoveryTarget(f, f.command, { intent });
    if (field === 'lane') target = recoveryTarget(f, f.command, { intent, mixed: true });
    if (field === 'scope') target.scope.captureFrameSha256 = '9'.repeat(64);
    if (field === 'known-owner' && target.kind !== 'empty') target.knownIntent!.actorId = id(90);
    await expect(f.repository.closeCommand(id(1), f.who, { schemaVersion: 'wfc.pf.barrier-command-close.v1', target })).rejects.toMatchObject({ code: 'BARRIER_RECOVERY_TARGET_CHANGED' });
    expect(f.durable.closures.size).toBe(0);
  });
  it('refuses bounded ambiguous indexed original matches rather than selecting an owner', async () => {
    const f = fixture(), intent = (await f.repository.begin(id(1), f.who, f.command)).intent;
    f.durable.intents.set(id(90), { ...structuredClone(f.durable.intents.get(intent.id)!), id: id(90) });
    await expect(f.repository.readCommandRecovery(id(1), f.who, recoveryTarget(f, f.command))).rejects.toMatchObject({ code: 'BARRIER_RECOVERY_AMBIGUOUS' });
    expect(f.durable.closures.size).toBe(0);
  });
  it.each([false, true])('bounds retained allocation JSON and refuses oversized original coupling (capture hash present=%s)', async captureHashPresent => {
    const f = fixture(), intent = (await f.repository.begin(id(1), f.who, f.command)).intent;
    const row = f.durable.intents.get(intent.id)!;
    row.capture_sha256 = captureHashPresent ? barrierBytesHash(f.bytes(intent)) : null;
    row.allocation = { oversized: 'x'.repeat(BARRIER_LIMITS.fragments * 128) };
    const before = structuredClone(f.durable), target = recoveryTarget(f, f.command, { intent });
    await expect(f.repository.readCommandRecovery(id(1), f.who, target)).rejects.toMatchObject({ code: 'BARRIER_RECOVERY_INTEGRITY' });
    await expect(f.repository.closeCommand(id(1), f.who, { schemaVersion: 'wfc.pf.barrier-command-close.v1', target })).rejects.toMatchObject({ code: 'BARRIER_RECOVERY_INTEGRITY' });
    const query = f.query.mock.calls.find(([sql]) => sql.includes('barrier:recovery-intents'))!;
    expect(query[0]).toContain('CASE WHEN octet_length(allocation::text)<=$4 THEN allocation ELSE NULL END AS allocation');
    expect(query[0]).toContain('allocation IS NULL AS allocation_is_null');
    expect(query[1]?.[3]).toBe(BARRIER_LIMITS.fragments * 128);
    expect(f.durable).toEqual(before); expect(f.durable.closures.size).toBe(0);
  });
  it('retains auth/role/cancellation refusals without a close record', async () => {
    const f = fixture(), input = { schemaVersion: 'wfc.pf.barrier-command-close.v1', target: recoveryTarget(f, f.command) };
    f.controls.admin = false; await expect(f.repository.closeCommand(id(1), f.who, input)).rejects.toMatchObject({ code: 'ADMIN_REQUIRED' });
    f.controls.admin = true; f.controls.revoked = true; await expect(f.repository.closeCommand(id(1), f.who, input)).rejects.toMatchObject({ code: 'LOGIN_REVOKED' });
    f.controls.revoked = false; const stopped = new AbortController(); stopped.abort(); await expect(f.repository.closeCommand(id(1), f.who, input, stopped.signal)).rejects.toThrow();
    expect(f.durable.closures.size).toBe(0);
  });
});

function mixedCommand(f: ReturnType<typeof fixture>) { return { ...f.command, schemaVersion: 'wfc.pf.barrier-capture-command.v2' as const, geometryPolicy: MIXED_BARRIER_POLICY }; }
function installMixedQualification(f: ReturnType<typeof fixture>) {
  // This is a transaction/storage test double, not geometric qualification.
  f.adapters.qualifyCapture.mockImplementation(async ({ capture }) => ({ producerVersion: 'wfc.pf.barrier-mixed-verifier.v2', geometryPolicy: MIXED_BARRIER_POLICY,
    originalGeometrySha256: '8'.repeat(64), verificationSha256: '9'.repeat(64), componentMemberships: [{ componentId: 'synthetic-component', kind: 'original-surface',
      fragmentIds: capture.fragments.map(row => row.source.fragmentId).sort((a, b) => a - b), parentSelectionIds: capture.selectedParents.map(row => row.selectionId).sort(),
      triangleCount: capture.fragments.reduce((sum, row) => sum + row.triangleIndices.length / 3, 0), sourceMembershipSha256: '7'.repeat(64) }],
    engineeringAccepted: false, ownTerminalExemptionsSupported: false, authority: 'none' }));
}

describe('versioned mixed publication without reinterpretation of legacy commands', () => {
  it('publishes a strict v2 snapshot/receipt with original bytes and exact full component membership, then reads historical outcome without a fabricated frame', async () => {
    const f = fixture(); installMixedQualification(f); const admitted = await f.repository.begin(id(1), f.who, mixedCommand(f));
    expect(admitted.schemaVersion).toBe('wfc.pf.barrier-intent-receipt.v2');
    const raw = f.bytes(admitted.intent), receipt = await f.repository.publish(id(1), f.who, admitted.intent.id, raw);
    expect(receipt).toMatchObject({ schemaVersion: 'wfc.pf.barrier-publication-receipt.v2', snapshot: { geometryPolicy: MIXED_BARRIER_POLICY, mode: 'mixed-mesh-set', registryRevision: '1' } });
    if ('outcome' in receipt) throw Error('Expected publication');
    const manifest = await f.repository.getSnapshot(id(1), f.who, receipt.snapshot.snapshotId);
    expect(manifest).toMatchObject({ schemaVersion: 'wfc.pf.barrier-snapshot.v2', geometryPolicy: MIXED_BARRIER_POLICY, engineeringAccepted: false, ownTerminalExemptionsSupported: false, authority: 'none' });
    if (manifest.geometry.mode !== 'mixed-mesh-set') throw Error('Expected mixed geometry');
    expect(manifest.geometry.verification.componentMemberships[0]).toMatchObject({ fragmentIds: [15], parentSelectionIds: [id(7)], triangleCount: 4 });
    const fragment = manifest.geometry.fragments[0]; expect(fragment.source).toEqual(f.capture(admitted.intent).fragments[0].source);
    expect(JSON.parse(storage.blobs.get(`${id(1)}/${admitted.intent.id}/${fragment.mesh.blobId}`)!.toString())).toEqual({ verticesMetres: f.capture(admitted.intent).fragments[0].verticesMetres, triangleIndices: f.capture(admitted.intent).fragments[0].triangleIndices });
    expect((await f.repository.get(id(1), f.who)).schemaVersion).toBe('wfc.pf.barrier-registry.v2');
    f.controls.scope = { ...scope(), selectionRevision: '2' }; f.adapters.currentScope.mockClear();
    expect(await f.repository.readCaptureOutcome(id(1), f.who, admitted.intent.id, f.outcomeQuery(admitted.intent))).toEqual({ schemaVersion: 'wfc.pf.barrier-capture-outcome.v2', outcome: 'published', intentId: admitted.intent.id,
      commandSha256: barrierValueHash(admitted.intent.command), captureSha256: barrierBytesHash(raw), frameBinding: 'not-recorded', frameSha256: null, publication: { ...receipt, duplicate: true } });
    expect(f.adapters.currentScope).not.toHaveBeenCalled();
  });
  it('never promotes a saved v1 same-key command into v2, and never accepts qualification from the other lane', async () => {
    const f = fixture(); await f.repository.begin(id(1), f.who, f.command);
    await expect(f.repository.begin(id(1), f.who, mixedCommand(f))).rejects.toMatchObject({ code: 'BARRIER_IDEMPOTENCY_CONFLICT' });
    const other = fixture(), { intent } = await other.repository.begin(id(1), other.who, mixedCommand(other));
    await expect(other.repository.publish(id(1), other.who, intent.id, other.bytes(intent))).rejects.toMatchObject({ code: 'BARRIER_VERIFIER_CAPTURE_MISMATCH' });
    expect(other.durable.head).toBeNull(); expect(other.durable.receipts.size).toBe(0);
  });
  it('retains strict exact-command terminal refusal v1 for a failed explicit v2 capture', async () => {
    const f = fixture(), { intent } = await f.repository.begin(id(1), f.who, mixedCommand(f)); f.controls.qualifyError = f.refusal(intent);
    expect(await f.repository.publish(id(1), f.who, intent.id, f.bytes(intent))).toMatchObject({ schemaVersion: 'wfc.pf.barrier-publication-refusal.v1', outcome: 'not-published', commandSha256: barrierValueHash(intent.command) });
    expect(await f.repository.readCaptureOutcome(id(1), f.who, intent.id, f.outcomeQuery(intent))).toMatchObject({ duplicate: true, frameSha256: 'f'.repeat(64) });
    expect(f.durable.head).toBeNull(); expect(f.durable.snapshots.size).toBe(0);
  });
  it('does not repair malformed duplicate metadata on a stored mixed success', async () => {
    const f = fixture(); installMixedQualification(f); const { intent } = await f.repository.begin(id(1), f.who, mixedCommand(f));
    await f.repository.publish(id(1), f.who, intent.id, f.bytes(intent)); delete ([...f.durable.receipts.values()][0].receipt as Record<string, unknown>).duplicate;
    await expect(f.repository.readCaptureOutcome(id(1), f.who, intent.id, f.outcomeQuery(intent))).rejects.toBeDefined();
  });
  it('keeps strict canonical server intent identities when reading a frozen v2 artifact', async () => {
    const f = fixture(), { intent } = await f.repository.begin(id(1), f.who, mixedCommand(f));
    const row = f.durable.intents.get(intent.id)!;
    // Use an alphabetic UUID nibble so this remains a meaningful malformed case.
    (row.frozen as BarrierCaptureIntent).captureBlobId = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
    await expect(f.repository.publish(id(1), f.who, intent.id, f.bytes(intent))).rejects.toBeDefined();
    expect(f.adapters.qualifyCapture).not.toHaveBeenCalled();
  });
});

describe('barrier immutable registry and trusted qualification boundary', () => {
  it('has no ready scope before an explicit publication; begin keeps the prior head unchanged', async () => {
    const f = fixture(); expect((await f.repository.get(id(1), f.who)).state).toBe('unconfigured');
    const value = await f.repository.begin(id(1), f.who, f.command); expect(value.state).toBe('pending'); expect(value.intent.id).not.toBe(f.command.idempotencyKey);
    expect(f.durable.head).toBeNull(); expect(f.adapters.qualifyCapture).not.toHaveBeenCalled(); expect(f.durable.snapshots.size).toBe(0);
  });
  it('publishes exact capture and original fragment bytes only after trusted qualification, atomically', async () => {
    const f = fixture(), { intent } = await f.repository.begin(id(1), f.who, f.command), raw = f.bytes(intent), receipt = barrierPublicationReceiptSchema.parse(await f.repository.publish(id(1), f.who, intent.id, raw));
    expect(receipt.duplicate).toBe(false); expect(receipt.snapshot.mode).toBe('mesh-set'); expect(receipt.snapshot.registryRevision).toBe('1');
    expect(f.adapters.qualifyCapture).toHaveBeenCalledOnce(); expect(f.adapters.qualifyCapture.mock.calls[0][0]).toMatchObject({ intent, captureSha256: barrierValueHash(f.capture(intent)) });
    expect([...storage.blobs.values()].some(value => value.equals(raw))).toBe(true);
    const manifest = await f.repository.getSnapshot(id(1), f.who, receipt.snapshot.snapshotId);
    expect(manifest.selectedParents[0].objectId).toBe('dbid:10'); expect(manifest.geometry.mode).toBe('mesh-set');
    if (manifest.geometry.mode === 'mesh-set') {
      const fragment = manifest.geometry.fragments[0]; expect(fragment.source.ownerObjectId).toBe('dbid:11'); expect(fragment.source.parentSelectionIds).toEqual([id(7)]);
      const data = storage.blobs.get(`${id(1)}/${intent.id}/${fragment.mesh.blobId}`)!;
      expect(JSON.parse(data.toString())).toEqual({ verticesMetres: f.capture(intent).fragments[0].verticesMetres, triangleIndices: f.capture(intent).fragments[0].triangleIndices });
    }
    expect((await f.repository.get(id(1), f.who)).state).toBe('ready'); expect(f.durable.receipts.size).toBe(1);
    expect(f.calls.some(sql => /UPDATE cables|pf_project_state|pf_recalculation/.test(sql))).toBe(false);
  });
  it('sends the allocation array as explicit JSON text for the PostgreSQL JSONB parameter', async () => {
    const f = fixture(), { intent } = await f.repository.begin(id(1), f.who, f.command);
    await f.repository.publish(id(1), f.who, intent.id, f.bytes(intent));
    const update = f.query.mock.calls.find(([sql]) => sql.startsWith('UPDATE pf_barrier_capture_intents SET capture_sha256'))!;
    expect(update[0]).toContain('allocation=$4::jsonb');
    expect(typeof update[1]?.[3]).toBe('string');
    expect(JSON.parse(update[1]![3] as string)).toEqual([{ fragmentId: 15, blobId: expect.any(String) }]);
    expect([...f.durable.intents.values()][0].allocation).toEqual(JSON.parse(update[1]![3] as string));
  });
  it('reconciles exact completed capture without another qualifier or publication', async () => {
    const f = fixture(), { intent } = await f.repository.begin(id(1), f.who, f.command);
    const first = await f.repository.publish(id(1), f.who, intent.id, f.bytes(intent)), second = await f.repository.publish(id(1), f.who, intent.id, f.bytes(intent));
    expect(second).toEqual({ ...first, duplicate: true }); expect(f.adapters.qualifyCapture).toHaveBeenCalledOnce(); expect(f.durable.snapshots.size).toBe(1);
    expect((await f.repository.begin(id(1), f.who, f.command)).state).toBe('complete');
  });
  it('refreshes current viewer/frame authority on completed publish replay and refuses stale replay scope', async () => {
    const f = fixture(), { intent } = await f.repository.begin(id(1), f.who, f.command);
    const first = barrierPublicationReceiptSchema.parse(await f.repository.publish(id(1), f.who, intent.id, f.bytes(intent)));
    f.adapters.currentScope.mockClear(); expect((await f.repository.publish(id(1), f.who, intent.id, f.bytes(intent))).duplicate).toBe(true);
    expect(f.adapters.currentScope).toHaveBeenCalledOnce();
    f.controls.scope = { ...scope(), selectionRevision: '2' };
    await expect(f.repository.publish(id(1), f.who, intent.id, f.bytes(intent))).rejects.toMatchObject({ code: 'BARRIER_MODEL_SCOPE_CHANGED' });
    expect((await f.repository.getSnapshot(id(1), f.who, first.snapshot.snapshotId)).snapshotId).toBe(first.snapshot.snapshotId);
    expect(f.adapters.qualifyCapture).toHaveBeenCalledOnce(); expect(f.durable.snapshots.size).toBe(1);
  });
  it('rejects changed same-key command and a different login taking over a capture', async () => {
    const f = fixture(), { intent } = await f.repository.begin(id(1), f.who, f.command);
    await expect(f.repository.begin(id(1), f.who, { ...f.command, selectedParents: [{ ...f.command.selectedParents[0], name: 'Changed' }] })).rejects.toMatchObject({ code: 'BARRIER_IDEMPOTENCY_CONFLICT' });
    const other = { ...f.who, loginId: id(99) };
    await expect(f.repository.publish(id(1), other, intent.id, f.bytes(intent))).rejects.toMatchObject({ code: 'BARRIER_INTENT_AUTHORITY_CHANGED' });
  });
  it('rejects changed exact capture bytes after admission, including after success', async () => {
    const f = fixture(), { intent } = await f.repository.begin(id(1), f.who, f.command); await f.repository.publish(id(1), f.who, intent.id, f.bytes(intent));
    const changed = f.capture(intent); changed.fragments[0].verticesMetres[0][0] = 0.1;
    await expect(f.repository.publish(id(1), f.who, intent.id, Buffer.from(barrierCanonicalJson(changed)))).rejects.toMatchObject({ code: 'BARRIER_CAPTURE_CHANGED' });
    expect(f.adapters.qualifyCapture).toHaveBeenCalledOnce();
  });
  it.each(['captureId', 'scope', 'parents', 'partial'] as const)('rejects %s mismatch before verifier authority is consulted', async kind => {
    const f = fixture(), { intent } = await f.repository.begin(id(1), f.who, f.command), value = f.capture(intent);
    if (kind === 'captureId') value.captureId = id(99);
    if (kind === 'scope') value.scope = { ...value.scope, captureFrameSha256: 'f'.repeat(64) };
    if (kind === 'parents') value.selectedParents[0].name = 'Not the admitted parent';
    if (kind === 'partial') value.observation.state = 'partial';
    await expect(f.repository.publish(id(1), f.who, intent.id, Buffer.from(barrierCanonicalJson(value)))).rejects.toBeDefined();
    expect(f.adapters.qualifyCapture).not.toHaveBeenCalled(); expect(f.durable.head).toBeNull();
  });
  it('retains the prior good immutable head when topology qualification fails', async () => {
    const f = fixture(), old = await f.repository.command(id(1), f.who, f.empty());
    const { intent } = await f.repository.begin(id(1), f.who, { ...f.command, expectedRegistryRevision: '1' });
    f.controls.qualifyError = Error('OPEN_SURFACE'); await expect(f.repository.publish(id(1), f.who, intent.id, f.bytes(intent))).rejects.toThrow('OPEN_SURFACE');
    expect(f.durable.head?.snapshot_id).toBe(old.snapshot.snapshotId); expect(f.durable.snapshots.size).toBe(1); expect(f.durable.receipts.size).toBe(1);
    expect((await f.repository.get(id(1), f.who)).state).toBe('ready');
  });
  it('durably refuses one exact protected capture, fences its lease and replays without qualification or publication', async () => {
    const f = fixture(), { intent } = await f.repository.begin(id(1), f.who, f.command);
    f.controls.qualifyError = f.refusal(intent);
    const first = await f.repository.publish(id(1), f.who, intent.id, f.bytes(intent));
    expect(first).toEqual({ schemaVersion: 'wfc.pf.barrier-publication-refusal.v1', outcome: 'not-published', intentId: intent.id,
      ...f.outcomeQuery(intent), implementationSha256: '9'.repeat(64), reasonCode: 'BARRIER_GEOMETRY_REFUSED', duplicate: false });
    expect(f.durable.head).toBeNull(); expect(f.durable.snapshots.size).toBe(0); expect(f.durable.receipts.size).toBe(1);
    expect(f.durable.intents.get(intent.id)).toMatchObject({ state: 'pending', lease_token: null, lease_expires_at: null });
    expect(await f.repository.publish(id(1), f.who, intent.id, f.bytes(intent))).toEqual({ ...first, duplicate: true });
    expect(f.adapters.qualifyCapture).toHaveBeenCalledOnce();
    f.controls.scope = { ...scope(), selectionRevision: '2' }; f.adapters.currentScope.mockClear(); f.adapters.assertBeforeCommit.mockClear();
    expect(await f.repository.readCaptureOutcome(id(1), f.who, intent.id, f.outcomeQuery(intent))).toEqual({ ...first, duplicate: true });
    expect(f.adapters.currentScope).not.toHaveBeenCalled(); expect(f.adapters.assertBeforeCommit).not.toHaveBeenCalled();
  });
  it('reconciles a lost refusal COMMIT acknowledgement by the exact immutable outcome without another qualifier', async () => {
    const f = fixture(), { intent } = await f.repository.begin(id(1), f.who, f.command); f.controls.qualifyError = f.refusal(intent);
    f.controls.duringReceipt = () => { f.controls.commitUnknown = true; };
    await expect(f.repository.publish(id(1), f.who, intent.id, f.bytes(intent))).rejects.toMatchObject({ code: 'BARRIER_COMMIT_OUTCOME_UNKNOWN' });
    expect(f.release).toHaveBeenCalledWith(true); f.controls.duringReceipt = () => undefined;
    expect(await f.repository.readCaptureOutcome(id(1), f.who, intent.id, f.outcomeQuery(intent))).toMatchObject({ outcome: 'not-published', duplicate: true });
    expect(f.adapters.qualifyCapture).toHaveBeenCalledOnce(); expect(f.durable.snapshots.size).toBe(0);
  });
  it.each(['token', 'deadline', 'clear-result'] as const)('does not mint refusal proof when its owned lease %s fails', async kind => {
    const f = fixture(), { intent } = await f.repository.begin(id(1), f.who, f.command); f.controls.qualifyError = f.refusal(intent);
    f.controls.duringQualify = () => {
      if (kind === 'token') f.durable.intents.get(intent.id)!.lease_token = id(90);
      if (kind === 'deadline') f.durable.intents.get(intent.id)!.lease_expires_at = new Date(Date.now() - 1);
      if (kind === 'clear-result') f.controls.clearLeaseRows = false;
    };
    await expect(f.repository.publish(id(1), f.who, intent.id, f.bytes(intent))).rejects.toMatchObject({ code: 'BARRIER_CAPTURE_LEASE_CHANGED' });
    expect(f.durable.receipts.size).toBe(0); expect(f.durable.snapshots.size).toBe(0);
    expect(await f.repository.readCaptureOutcome(id(1), f.who, intent.id, f.outcomeQuery(intent))).toBeNull();
  });
  it('does not turn an operational exception with the same public code into durable logical-refusal proof', async () => {
    const f = fixture(), { intent } = await f.repository.begin(id(1), f.who, f.command);
    f.controls.qualifyError = Object.assign(Error('Operational transport failure'), { code: 'BARRIER_GEOMETRY_REFUSED', status: 503 });
    await expect(f.repository.publish(id(1), f.who, intent.id, f.bytes(intent))).rejects.toThrow('Operational transport failure');
    expect(f.durable.receipts.size).toBe(0); expect(f.durable.intents.get(intent.id)!.lease_token).not.toBeNull();
  });
  it.each(['commandSha256', 'captureSha256', 'frameSha256'] as const)('refuses historical refusal proof for a changed %s', async field => {
    const f = fixture(), { intent } = await f.repository.begin(id(1), f.who, f.command); f.controls.qualifyError = f.refusal(intent);
    await f.repository.publish(id(1), f.who, intent.id, f.bytes(intent));
    await expect(f.repository.readCaptureOutcome(id(1), f.who, intent.id, { ...f.outcomeQuery(intent), [field]: '8'.repeat(64) }))
      .rejects.toMatchObject({ code: 'BARRIER_CAPTURE_CHANGED' });
    await expect(f.repository.readCaptureOutcome(id(1), { ...f.who, loginId: id(98) }, intent.id, f.outcomeQuery(intent)))
      .rejects.toMatchObject({ code: 'BARRIER_INTENT_AUTHORITY_CHANGED' });
  });
  it('reads an exact old success after model change without fabricating a missing full-frame binding', async () => {
    const f = fixture(), { intent } = await f.repository.begin(id(1), f.who, f.command);
    const publication = await f.repository.publish(id(1), f.who, intent.id, f.bytes(intent));
    f.controls.scope = { ...scope(), selectionRevision: '2' }; f.adapters.currentScope.mockClear();
    expect(await f.repository.readCaptureOutcome(id(1), f.who, intent.id, f.outcomeQuery(intent))).toEqual({ schemaVersion: 'wfc.pf.barrier-capture-outcome.v1',
      outcome: 'published', intentId: intent.id, commandSha256: barrierValueHash(intent.command), captureSha256: barrierBytesHash(f.bytes(intent)),
      frameBinding: 'not-recorded', frameSha256: null, publication: { ...publication, duplicate: true } });
    expect(f.adapters.currentScope).not.toHaveBeenCalled(); expect(f.adapters.qualifyCapture).toHaveBeenCalledOnce();
  });
  it.each(['missing', 'string', 'number'] as const)('does not repair a stored successful receipt with %s duplicate during historical read or replay', async kind => {
    const f = fixture(), { intent } = await f.repository.begin(id(1), f.who, f.command);
    await f.repository.publish(id(1), f.who, intent.id, f.bytes(intent));
    const stored = [...f.durable.receipts.values()][0].receipt as Record<string, unknown>;
    if (kind === 'missing') delete stored.duplicate;
    if (kind === 'string') stored.duplicate = 'true';
    if (kind === 'number') stored.duplicate = 1;
    await expect(f.repository.readCaptureOutcome(id(1), f.who, intent.id, f.outcomeQuery(intent))).rejects.toBeDefined();
    await expect(f.repository.publish(id(1), f.who, intent.id, f.bytes(intent))).rejects.toBeDefined();
    expect(f.adapters.qualifyCapture).toHaveBeenCalledOnce(); expect(f.durable.snapshots.size).toBe(1); expect(f.durable.receipts.size).toBe(1);
  });
  it('lets a concurrent completed success win over a stale worker logical refusal', async () => {
    const f = fixture(), { intent } = await f.repository.begin(id(1), f.who, f.command);
    f.adapters.qualifyCapture.mockImplementationOnce(async () => {
      f.durable.intents.get(intent.id)!.lease_expires_at = new Date(Date.now() - 1);
      await f.repository.publish(id(1), f.who, intent.id, f.bytes(intent)); throw f.refusal(intent);
    });
    expect(await f.repository.publish(id(1), f.who, intent.id, f.bytes(intent))).toMatchObject({ schemaVersion: 'wfc.pf.barrier-publication-receipt.v1', duplicate: true });
    expect(f.durable.snapshots.size).toBe(1); expect(f.durable.receipts.size).toBe(1); expect(f.adapters.qualifyCapture).toHaveBeenCalledTimes(2);
  });
  it('prevents a stale successful worker from publishing after a replacement lease recorded terminal refusal', async () => {
    const f = fixture(), { intent } = await f.repository.begin(id(1), f.who, f.command);
    f.adapters.qualifyCapture.mockImplementationOnce(async () => {
      f.durable.intents.get(intent.id)!.lease_expires_at = new Date(Date.now() - 1); f.controls.qualifyError = f.refusal(intent);
      await f.repository.publish(id(1), f.who, intent.id, f.bytes(intent)); f.controls.qualifyError = null;
      return { producerVersion: 'wfc.pf.barrier-verifier.v1', computationalMeshes: 1, verificationSha256: 'c'.repeat(64) };
    });
    expect(await f.repository.publish(id(1), f.who, intent.id, f.bytes(intent))).toMatchObject({ outcome: 'not-published', duplicate: true });
    expect(f.durable.snapshots.size).toBe(0); expect(f.durable.head).toBeNull(); expect(f.durable.receipts.size).toBe(1);
  });
  it('rolls back refusal evidence and lease clearing when authority expires at the final commit fence', async () => {
    const f = fixture(), { intent } = await f.repository.begin(id(1), f.who, f.command); f.controls.qualifyError = f.refusal(intent);
    f.controls.duringReceipt = () => { f.controls.finalAuthorityError = Error('Expired protected Viewer'); };
    await expect(f.repository.publish(id(1), f.who, intent.id, f.bytes(intent))).rejects.toThrow('Expired protected Viewer');
    expect(f.durable.receipts.size).toBe(0); expect(f.durable.intents.get(intent.id)!.lease_token).not.toBeNull(); expect(f.durable.head).toBeNull();
  });
  it('retains the prior head when any blob write fails; no partial ready manifest exists', async () => {
    const f = fixture(), old = await f.repository.command(id(1), f.who, f.empty());
    const { intent } = await f.repository.begin(id(1), f.who, { ...f.command, expectedRegistryRevision: '1' });
    storage.fail = true; await expect(f.repository.publish(id(1), f.who, intent.id, f.bytes(intent))).rejects.toThrow('synthetic storage failure');
    expect(f.durable.head?.snapshot_id).toBe(old.snapshot.snapshotId); expect(f.durable.snapshots.size).toBe(1);
  });
  it('rechecks original capture integrity in the final transaction before publishing any head', async () => {
    const f = fixture(), { intent } = await f.repository.begin(id(1), f.who, f.command);
    f.controls.duringQualify = () => { storage.blobs.set(`${id(1)}/${intent.id}/${intent.captureBlobId}`, Buffer.from('tampered after qualification started')); };
    await expect(f.repository.publish(id(1), f.who, intent.id, f.bytes(intent))).rejects.toThrow('blob integrity');
    expect(f.durable.head).toBeNull(); expect(f.durable.snapshots.size).toBe(0); expect(f.durable.receipts.size).toBe(0);
  });
  it.each(['admin', 'login', 'scope', 'revision'] as const)('fences final %s changes after slow qualification', async kind => {
    const f = fixture(), { intent } = await f.repository.begin(id(1), f.who, f.command);
    f.controls.duringQualify = () => { if (kind === 'admin') f.controls.admin = false; if (kind === 'login') f.controls.revoked = true;
      if (kind === 'scope') f.controls.scope = { ...scope(), selectionRevision: '2' }; if (kind === 'revision') f.durable.head = { revision: '1', snapshot_id: id(90) }; };
    await expect(f.repository.publish(id(1), f.who, intent.id, f.bytes(intent))).rejects.toBeDefined();
    expect(f.durable.snapshots.size).toBe(0); expect(f.durable.receipts.size).toBe(0); expect(f.durable.head?.snapshot_id).not.toBe(intent.snapshotId);
  });
  it.each(['expiry', 'cancellation'] as const)('rolls back all publication mutations at final %s boundary', async kind => {
    const f = fixture(), { intent } = await f.repository.begin(id(1), f.who, f.command), controller = new AbortController();
    f.controls.duringHead = () => { if (kind === 'expiry') f.who.loginExpiresAt = Date.now() - 1; else controller.abort(); };
    await expect(f.repository.publish(id(1), f.who, intent.id, f.bytes(intent), controller.signal)).rejects.toBeDefined();
    expect(f.durable.head).toBeNull(); expect(f.durable.snapshots.size).toBe(0); expect(f.durable.receipts.size).toBe(0);
    expect([...f.durable.intents.values()][0].state).toBe('pending');
  });
  it('runs the internal synchronous viewer authority fence after every publication await', async () => {
    const f = fixture(), { intent } = await f.repository.begin(id(1), f.who, f.command);
    f.controls.duringHead = () => { f.controls.finalAuthorityError = Error('VIEWER_EXPIRED_DURING_PUBLICATION'); };
    await expect(f.repository.publish(id(1), f.who, intent.id, f.bytes(intent))).rejects.toThrow('VIEWER_EXPIRED_DURING_PUBLICATION');
    expect(f.durable.head).toBeNull(); expect(f.durable.snapshots.size).toBe(0); expect(f.durable.receipts.size).toBe(0);
    expect(f.adapters.assertBeforeCommit).toHaveBeenCalled();
  });
  it('checks the capture lease clock again after final SQL writes before COMMIT', async () => {
    const f = fixture(); let now = Date.now(); const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const { intent } = await f.repository.begin(id(1), f.who, f.command);
      f.controls.duringHead = () => { now += BARRIER_REGISTRY_SQL_BOUNDS.leaseMilliseconds + 1; };
      await expect(f.repository.publish(id(1), f.who, intent.id, f.bytes(intent))).rejects.toMatchObject({ code: 'BARRIER_CAPTURE_LEASE_CHANGED' });
      expect(f.durable.head).toBeNull(); expect(f.durable.snapshots.size).toBe(0); expect(f.durable.receipts.size).toBe(0);
    } finally { clock.mockRestore(); }
  });
  it('reconciles a lost final COMMIT acknowledgement by exact receipt without duplicate publication', async () => {
    const f = fixture(), { intent } = await f.repository.begin(id(1), f.who, f.command);
    f.controls.duringHead = () => { f.controls.commitUnknown = true; };
    await expect(f.repository.publish(id(1), f.who, intent.id, f.bytes(intent))).rejects.toMatchObject({ code: 'BARRIER_COMMIT_OUTCOME_UNKNOWN' });
    expect(f.release).toHaveBeenCalledWith(true); f.controls.duringHead = () => undefined;
    expect((await f.repository.publish(id(1), f.who, intent.id, f.bytes(intent))).duplicate).toBe(true);
    expect(f.durable.snapshots.size).toBe(1); expect(f.adapters.qualifyCapture).toHaveBeenCalledOnce();
  });
  it('keeps explicit empty separate from wall-checked geometry and exact replay idempotent', async () => {
    const f = fixture(), command = f.empty(), first = await f.repository.command(id(1), f.who, command);
    expect(first.snapshot.mode).toBe('explicit-empty'); expect((await f.repository.command(id(1), f.who, command)).duplicate).toBe(true);
    expect(f.adapters.qualifyCapture).not.toHaveBeenCalled(); expect(f.durable.snapshots.size).toBe(1);
    await expect(f.repository.command(id(1), f.who, { ...command, reason: 'Changed' })).rejects.toMatchObject({ code: 'BARRIER_IDEMPOTENCY_CONFLICT' });
  });
  it('requires recapture for removal, preserving the old head instead of silently reusing parent meshes', async () => {
    const f = fixture(), old = await f.repository.command(id(1), f.who, f.empty());
    await expect(f.repository.command(id(1), f.who, { schemaVersion: 'wfc.pf.barrier-registry-command.v1', action: 'remove', scope: scope(), expectedRegistryRevision: '1', idempotencyKey: id(22), selectionIds: [id(7)] })).rejects.toMatchObject({ code: 'BARRIER_RECAPTURE_REQUIRED' });
    expect(f.durable.head?.snapshot_id).toBe(old.snapshot.snapshotId);
  });
  it('reports changed active model/frame as stale; historical manifests remain inspectable', async () => {
    const f = fixture(), old = await f.repository.command(id(1), f.who, f.empty());
    f.controls.scope = { ...scope(), captureFrameId: id(99) };
    const current = await f.repository.get(id(1), f.who); expect(current.state).toBe('stale'); expect(current.reasonCodes).toEqual(['BARRIER_MODEL_SCOPE_CHANGED']);
    expect((await f.repository.getSnapshot(id(1), f.who, old.snapshot.snapshotId)).scope.captureFrameId).toBe(id(3));
  });
  it('bounds lists and detects stored manifest tampering rather than exposing a valid-looking snapshot', async () => {
    const f = fixture(), first = await f.repository.command(id(1), f.who, f.empty()); await f.repository.command(id(1), f.who, f.empty('1', id(21)));
    const page = await f.repository.list(id(1), f.who, { limit: 1 }); expect(page.snapshots).toHaveLength(1); expect(page.nextOffset).toBe(1);
    const row = f.durable.snapshots.get(first.snapshot.snapshotId)!; (row.manifest as { contentSha256: string }).contentSha256 = '0'.repeat(64);
    await expect(f.repository.getSnapshot(id(1), f.who, first.snapshot.snapshotId)).rejects.toMatchObject({ code: 'BARRIER_SNAPSHOT_INTEGRITY' });
  });
  it('refuses missing authoritative frame and never accepts caller producer/actor/path fields', async () => {
    const f = fixture(); f.adapters.currentScope.mockRejectedValueOnce(Error('FRAME_UNAVAILABLE'));
    await expect(f.repository.begin(id(1), f.who, f.command)).rejects.toThrow('FRAME_UNAVAILABLE');
    await expect(f.repository.begin(id(1), f.who, { ...f.command, createdBy: id(99) })).rejects.toBeDefined();
    expect(f.durable.intents.size).toBe(0);
  });
});

describe('barrier transaction and additive schema boundaries', () => {
  it('retains SQL current-authority locks, conservative triggers and no cable mutation', () => {
    expect(BARRIER_REGISTRY_SQL).toContain('FOREIGN KEY(project_id,model_version_id)');
    expect(BARRIER_REGISTRY_SQL).toContain('Barrier capture allocation is immutable');
    expect(BARRIER_REGISTRY_SQL).not.toMatch(/UPDATE cables|DELETE FROM|DROP TABLE/i);
  });
  it('expires and cancels before obtaining a database connection', async () => {
    const f = fixture(); f.who.loginExpiresAt = Date.now() - 1;
    await expect(barrierRegistryTransaction(f.pool, id(1), f.who, async () => undefined)).rejects.toMatchObject({ code: 'LOGIN_EXPIRED' });
    expect(f.calls).toEqual([]);
  });
  it.each(['commit', 'rollback'] as const)('discards migration connection on uncertain %s acknowledgement', async phase => {
    const release = vi.fn(), query = vi.fn(async (sql: string) => { if (phase === 'rollback' && sql.startsWith('SELECT pg_advisory')) throw Error('schema'); if (sql === (phase === 'commit' ? 'COMMIT' : 'ROLLBACK')) throw Error('transport'); return { rows: [] }; });
    await expect(initializeBarrierRegistrySchema({ connect: async () => ({ query, release }) } as unknown as Pool)).rejects.toThrow();
    expect(release).toHaveBeenCalledExactlyOnceWith(true);
  });
});
