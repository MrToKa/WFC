// @vitest-environment node
import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BARRIER_MULTIPART_PROFILE, barrierMultipartCanonicalBytes, barrierMultipartHashInput } from '../../shared/pathfinderBarrierMultipart.js';
import { barrierMultipartSessionCommandHashInput, barrierMultipartSessionSchema } from '../../shared/pathfinderBarrierMultipartSessions.js';
import { barrierCanonicalJson } from '../../shared/pathfinderBarriers.js';
import { BARRIER_MULTIPART_PRODUCER_PROFILE } from '../../viewer-runtime/barrier-multipart-protocol.mjs';
import type { BarrierFrameObservation } from '../../viewer-runtime/barrier-capture.mjs';
import type { BarrierMultipartRepositoryAdapters } from './barrierMultipartRepository.js';
const mocks = vi.hoisted(() => ({ scope: vi.fn(), repository: vi.fn() }));
vi.mock('./barrierScope.js', async original => ({ ...await original<typeof import('./barrierScope.js')>(), currentBarrierScope: mocks.scope }));
vi.mock('./barrierMultipartRepository.js', () => ({ createBarrierMultipartRepository: mocks.repository }));
import { barrierFrameProjectionHash } from './barrierScope.js';
import { barrierMultipartAdmissionBodySchema, barrierMultipartContextHashInput, createProtectedBarrierMultipartRepository,
  resolveBarrierMultipartViewerPrincipal } from './barrierMultipartContext.js';

const id = (n: number) => `bc130000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = (value: unknown) => createHash('sha256').update(barrierMultipartCanonicalBytes(value)).digest('hex');
function fixture() {
  const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], now = Date.now();
  const identity = { projectId: id(1), modelVersionId: id(2), viewerSessionId: id(3), cookieSecret: 's'.repeat(43) };
  const who = { userId: id(4), loginId: id(5), loginExpiresAt: now + 7200000 };
  const projection = { coordinateFrame: 'canonical-world-metres' as const, displayToWorldMetres: matrix, globalOffsetMetres: [0, 0, 0] as [number, number, number] };
  const modelScope = { projectId: id(1), modelVersionId: id(2), contentFingerprint: 'a'.repeat(64), selectionRevision: '1', captureFrameId: id(6),
    captureFrameSha256: barrierFrameProjectionHash(projection), coordinateFrame: 'canonical-world-metres' as const };
  const scope = { schemaVersion: 'wfc.pf.barrier-multipart-scope.v2' as const, modelScope, modelLoadId: id(7),
    selectedParents: [{ selectionId: id(8), dbId: 3, kind: 'wall' as const }], geometryPolicy: 'original-triangles-structural-only.v2' as const };
  const frameBody = { schemaVersion: 'wfc.pf.barrier-frame-observation.v1' as const, projectId: id(1), modelVersionId: id(2), contentFingerprint: modelScope.contentFingerprint,
    loadId: scope.modelLoadId, sdkVersion: '7.130.0' as const, matrixPrecision: 'binary64' as const, ...projection, sourceUnits: 'm', metresPerDisplayUnit: 1,
    upVector: [0, 0, 1] as [number, number, number], globalOffsetDisplayUnits: [0, 0, 0] as [number, number, number], modelTransform: null, placementTransform: null };
  const frame: BarrierFrameObservation = { ...frameBody, contentSha256: createHash('sha256').update(barrierCanonicalJson(frameBody)).digest('hex') };
  const command = { schemaVersion: 'wfc.pf.barrier-multipart-admit.v2' as const, idempotencyKey: id(9), scope, profile: structuredClone(BARRIER_MULTIPART_PROFILE),
    expectedRegistryRevision: '0', selectedParentLabels: [{ selectionId: id(8), name: 'Synthetic complete wall' }], reservation: { bytes: 1048576, files: 100 } };
  const admission = barrierMultipartAdmissionBodySchema.parse({ command, frameObservation: frame, producerProfile: BARRIER_MULTIPART_PRODUCER_PROFILE });
  const session = barrierMultipartSessionSchema.parse({ schemaVersion: 'wfc.pf.barrier-multipart-session.v2', id: id(10), projectId: id(1), state: 'admitted', sessionRevision: '0',
    principal: { kind: 'current-login-admin', actorId: who.userId, loginId: who.loginId }, command, requestSha256: hash(barrierMultipartSessionCommandHashInput(command)),
    scopeSha256: hash(barrierMultipartHashInput('scope', scope)), profileSha256: hash(barrierMultipartHashInput('profile', command.profile)), createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(), jobDeadline: new Date(now + 3600000).toISOString(), leaseDeadline: null, reservation: { ...command.reservation, chargedBytes: 0, chargedFiles: 0 },
    counts: { pages: 0, seals: 0, parts: 0 }, roots: { nodes: null, fragments: null, 'geometry-ranges': null, plan: null }, qualification: 'NOT_MEASURED', geometryValidation: 'NOT_VALIDATED', authority: 'none' });
  const state = { admin: true, head: '0', binding: null as Record<string, unknown> | null,
    viewer: { user_id: who.userId, login_id: who.loginId, login_expires_at: new Date(who.loginExpiresAt), load_id: scope.modelLoadId, selection_revision: '1',
      expires_at: new Date(now + 300000), absolute_expires_at: new Date(now + 1800000), revoked_at: null as Date | null, login_revoked_at: null as Date | null,
      active_model_version_id: id(2), current_selection_revision: '1', state: 'ready', health: 'healthy' } };
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.startsWith('SELECT id FROM projects')) return { rows: [{ id: id(1) }] };
    if (sql.startsWith('SELECT is_admin')) return { rows: [{ is_admin: state.admin }] };
    if (sql.startsWith('INSERT INTO viewer_login_bindings')) {
      expect(sql).toContain('ON CONFLICT(login_id) DO NOTHING');
      expect(values).toEqual([who.loginId, who.userId, new Date(who.loginExpiresAt)]); return { rows: [] };
    }
    if (sql.startsWith('SELECT user_id,expires_at,revoked_at')) return { rows: [{ user_id: who.userId, expires_at: new Date(who.loginExpiresAt), revoked_at: null }] };
    if (sql.includes('/* barrier-multipart:viewer-context */')) return { rows: [state.viewer] };
    if (sql.startsWith('SELECT s.user_id')) return { rows: [state.viewer] };
    if (sql.startsWith('INSERT INTO pf_barrier_multipart_viewer_contexts')) {
      const keys = ['intent_id', 'project_id', 'viewer_session_id', 'actor_id', 'login_id', 'model_version_id', 'model_load_id', 'scope_sha256', 'command_sha256', 'frame_sha256', 'frame_observation', 'producer_profile', 'context_sha256', 'effective_deadline'];
      state.binding = Object.fromEntries(keys.map((key, index) => [key, [10, 11].includes(index) ? JSON.parse(values![index] as string) : values![index]]));
      return { rows: [state.binding] };
    }
    if (sql.includes('FROM pf_barrier_multipart_viewer_contexts')) return { rows: state.binding ? [{ ...state.binding, command, frozen: session }] : [] };
    if (sql.startsWith('SELECT * FROM pf_barrier_multipart_sessions')) return { rows: [{ frozen: session, state: session.state, session_revision: session.sessionRevision,
      updated_at: new Date(session.updatedAt), lease_expires_at: null, charged_bytes: '0', charged_files: 0, counts: session.counts, roots: session.roots }] };
    if (sql.startsWith('SELECT revision::text FROM pf_barrier_heads')) return { rows: state.head === '0' ? [] : [{ revision: state.head }] };
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK' || sql.startsWith('SET LOCAL')) return { rows: [] };
    throw Error('Unexpected synthetic context query: ' + sql);
  });
  const release = vi.fn(), client = { query, release } as unknown as PoolClient, pool = { connect: vi.fn(async () => client) } as unknown as Pool;
  const storage = { store: vi.fn(), read: vi.fn() };
  mocks.scope.mockResolvedValue(modelScope); mocks.repository.mockImplementation((_pool, adapters) => ({ adapters }));
  const create = () => createProtectedBarrierMultipartRepository(pool, { identity, who, storage, admission });
  const adapters = () => mocks.repository.mock.calls.at(-1)![1] as BarrierMultipartRepositoryAdapters;
  return { identity, who, modelScope, scope, frame, command, admission, session, state, query, client, pool, storage, create, adapters, release };
}
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('immutable protected multipart context, synthetic database seams only', () => {
  it('resolves actor/login from the exact HttpOnly cookie and repeats current admin/session locks', async () => {
    const f = fixture(); expect(await resolveBarrierMultipartViewerPrincipal(f.pool, f.identity)).toEqual(f.who);
    const calls = f.query.mock.calls.filter(([sql]) => sql.includes('viewer_resource_sessions'));
    expect(calls).toHaveLength(2); expect(calls[0][1]).toEqual([id(3), id(1), id(2), createHash('sha256').update(f.identity.cookieSecret).digest('hex')]);
    expect(calls[1][0]).toContain('FOR SHARE OF s,l,v,p'); expect(calls[1][1]).toEqual([id(3), id(1), id(2), id(4), id(5), createHash('sha256').update(f.identity.cookieSecret).digest('hex')]);
    expect(f.release).toHaveBeenCalledTimes(2);
  });
  it('withholds the cookie principal after administrator loss', async () => {
    const f = fixture(); f.state.admin = false; await expect(resolveBarrierMultipartViewerPrincipal(f.pool, f.identity)).rejects.toMatchObject({ code: 'ADMIN_REQUIRED' });
    expect(f.query.mock.calls.some(([sql]) => sql.includes('/* barrier-multipart:viewer-context */'))).toBe(false);
  });
  it('binds the complete command, exact Viewer session, frame, profile and immutable absolute deadline inside admission', async () => {
    const f = fixture(), protectedRepo = await f.create(); await f.adapters().onAdmission!(f.client, f.session, false);
    expect(f.state.binding).toMatchObject({ viewer_session_id: id(3), model_load_id: id(7), actor_id: id(4), login_id: id(5), command_sha256: f.session.requestSha256 });
    const value = await protectedRepo.context(); expect(value.context.effectiveDeadline).toBe(f.state.viewer.absolute_expires_at.toISOString());
    expect(value.context.producerProfile).toEqual(BARRIER_MULTIPART_PRODUCER_PROFILE);
    expect(value.context.contextSha256).toBe(hash(barrierMultipartContextHashInput(f.session, value.context)));
    expect(value.session.authority).toBe('none'); expect(f.storage.store).not.toHaveBeenCalled();
  });
  it('refuses duplicate admission without an identical retained Viewer binding instead of retrofitting old sessions', async () => {
    const f = fixture(); await f.create(); await expect(f.adapters().onAdmission!(f.client, f.session, true)).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_CONTEXT_CHANGED' });
    await f.adapters().onAdmission!(f.client, f.session, false); await f.adapters().onAdmission!(f.client, f.session, true);
    f.state.binding!.viewer_session_id = id(99); await expect(f.adapters().onAdmission!(f.client, f.session, true)).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_CONTEXT_CHANGED' });
  });
  it('withholds completion context until immutable admission, then returns the full frame hash and original deadline', async () => {
    const f = fixture(); await f.create();
    await expect(f.adapters().completionContext!(f.client, id(1), f.who, f.session)).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_CONTEXT_CHANGED' });
    await f.adapters().onAdmission!(f.client, f.session, false);
    const binding = await f.adapters().completionContext!(f.client, id(1), f.who, f.session);
    expect(binding).toEqual({ contextSha256: f.state.binding!.context_sha256, frameSha256: f.frame.contentSha256,
      effectiveDeadline: f.state.viewer.absolute_expires_at.toISOString() });
    expect(binding.frameSha256).not.toBe(f.scope.modelScope.captureFrameSha256);
    expect(Object.isFrozen(binding)).toBe(true); expect(f.storage.read).not.toHaveBeenCalled();
  });
  it.each(['intent', 'scope', 'command', 'profile', 'principal'] as const)('refuses a foreign %s at the trusted completion adapter', async kind => {
    const f = fixture(); await f.create(); await f.adapters().onAdmission!(f.client, f.session, false);
    const session = structuredClone(f.session), who = { ...f.who };
    if (kind === 'intent') session.id = id(99); if (kind === 'scope') session.scopeSha256 = 'f'.repeat(64);
    if (kind === 'command') session.requestSha256 = 'f'.repeat(64); if (kind === 'profile') session.profileSha256 = 'f'.repeat(64);
    if (kind === 'principal') who.loginId = id(99);
    await expect(f.adapters().completionContext!(f.client, id(1), who, session)).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_CONTEXT_CHANGED' });
    expect(f.storage.read).not.toHaveBeenCalled();
  });
  it('does not extend the immutable completion deadline when Viewer lifetime grows', async () => {
    const f = fixture(); await f.create(); await f.adapters().onAdmission!(f.client, f.session, false);
    const original = f.state.viewer.absolute_expires_at.toISOString(); f.state.viewer.absolute_expires_at = new Date(Date.now() + 7200000);
    expect((await f.adapters().completionContext!(f.client, id(1), f.who, f.session)).effectiveDeadline).toBe(original);
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(original));
    await expect(f.adapters().completionContext!(f.client, id(1), f.who, f.session)).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_VIEWER_EXPIRED' });
  });
  it.each(['load', 'selection', 'revoked', 'idle', 'absolute', 'login'] as const)('refuses changed %s context before admission SQL', async kind => {
    const f = fixture(); await f.create();
    if (kind === 'load') f.state.viewer.load_id = id(99); if (kind === 'selection') f.state.viewer.current_selection_revision = '2';
    if (kind === 'revoked') f.state.viewer.revoked_at = new Date(); if (kind === 'idle') f.state.viewer.expires_at = new Date(Date.now() - 1);
    if (kind === 'absolute') f.state.viewer.absolute_expires_at = new Date(Date.now() - 1); if (kind === 'login') f.state.viewer.login_expires_at = new Date(f.who.loginExpiresAt + 1);
    await expect(f.adapters().onAdmission!(f.client, f.session, false)).rejects.toMatchObject({ code: kind === 'idle' || kind === 'absolute' ? 'BARRIER_MULTIPART_VIEWER_EXPIRED' : 'BARRIER_MULTIPART_VIEWER_CHANGED' });
    expect(f.state.binding).toBeNull();
  });
  it('detaches all caller metadata and retains hidden-geometry semantics without granting geometry authority', async () => {
    const f = fixture(), created = f.create(); f.admission.command.selectedParentLabels[0].name = 'Caller mutation'; f.frame.loadId = id(99); f.identity.viewerSessionId = id(98); f.who.userId = id(97);
    await created; await f.adapters().onAdmission!(f.client, f.session, false);
    expect(f.state.binding).toMatchObject({ viewer_session_id: id(3), actor_id: id(4), model_load_id: id(7) });
    expect((f.state.binding!.producer_profile as typeof BARRIER_MULTIPART_PRODUCER_PROFILE).visibility).toBe('selected-scope-includes-hidden-geometry-v1');
  });
  it('refuses a self-hashed frame projected in another world frame', async () => {
    const f = fixture(); const frame = f.admission.frameObservation as BarrierFrameObservation; frame.displayToWorldMetres[12] = 5;
    const { contentSha256: _hash, ...body } = frame; frame.contentSha256 = createHash('sha256').update(barrierCanonicalJson(body)).digest('hex');
    await expect(f.create()).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_FRAME_CHANGED' }); expect(mocks.repository).not.toHaveBeenCalled();
  });
  it('rereads the retained binding and rejects a newer head without erasing historical data', async () => {
    const f = fixture(); await f.create(); await f.adapters().onAdmission!(f.client, f.session, false);
    const existing = await createProtectedBarrierMultipartRepository(f.pool, { identity: f.identity, who: f.who, storage: f.storage, intentId: f.session.id });
    f.state.head = '1'; await expect(existing.context()).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_HEAD_CHANGED' });
    expect(f.state.binding).not.toBeNull(); expect(f.query.mock.calls.some(([sql]) => /^UPDATE|^DELETE/.test(sql))).toBe(false);
  });
  it('fences expiry again synchronously immediately before COMMIT', async () => {
    const f = fixture(); await f.create(); await f.adapters().onAdmission!(f.client, f.session, false);
    vi.spyOn(Date, 'now').mockReturnValue(f.state.viewer.expires_at.getTime());
    expect(() => f.adapters().assertBeforeCommit!()).toThrow(expect.objectContaining({ code: 'BARRIER_MULTIPART_VIEWER_EXPIRED' }));
  });
  it.each(['cookie-revoked', 'model-changed', 'head-changed'] as const)('keeps the protected per-transaction guard for reconciliation after %s', async kind => {
    const f = fixture(); await f.create(); await f.adapters().onAdmission!(f.client, f.session, false);
    if (kind === 'cookie-revoked') f.state.viewer.revoked_at = new Date();
    if (kind === 'model-changed') mocks.scope.mockResolvedValue({ ...f.modelScope, contentFingerprint: 'f'.repeat(64) });
    if (kind === 'head-changed') f.state.head = '1';
    await expect(f.adapters().authorizeContext!(f.client, id(1), f.who)).rejects.toMatchObject({ code: kind === 'cookie-revoked' ? 'BARRIER_MULTIPART_VIEWER_CHANGED'
      : kind === 'head-changed' ? 'BARRIER_MULTIPART_HEAD_CHANGED' : 'BARRIER_MULTIPART_FRAME_CHANGED' });
    expect(f.state.binding).not.toBeNull(); expect(f.storage.read).not.toHaveBeenCalled();
  });
  it('rejects caller profile/authority fields instead of interpreting them as capability', () => {
    const f = fixture(); expect(barrierMultipartAdmissionBodySchema.safeParse({ ...f.admission, actorId: id(99) }).success).toBe(false);
    expect(barrierMultipartAdmissionBodySchema.safeParse({ ...f.admission, producerProfile: { ...BARRIER_MULTIPART_PRODUCER_PROFILE, visibility: 'visible-only' } }).success).toBe(false);
    expect(barrierMultipartAdmissionBodySchema.safeParse({ ...f.admission, producerProfile: { ...BARRIER_MULTIPART_PRODUCER_PROFILE, ready: true } }).success).toBe(false);
  });
});
