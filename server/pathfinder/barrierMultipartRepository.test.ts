import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { BARRIER_MULTIPART_PROFILE, type BarrierMultipartScope } from '../../shared/pathfinderBarrierMultipart.js';
import type { JobPrincipal } from './jobContracts.js';
import { createBarrierMultipartRepository } from './barrierMultipartRepository.js';
import { BARRIER_MULTIPART_SCHEMA_SQL } from './barrierMultipartSchema.js';

function fixture() {
  const projectId = randomUUID(), who: JobPrincipal = { userId: randomUUID(), loginId: randomUUID(), loginExpiresAt: Date.now() + 3600000 };
  const controls = { admin: true, revoked: false, project: true };
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith('SELECT id FROM projects')) return { rows: controls.project ? [{ id: projectId }] : [] };
    if (sql.startsWith('SELECT is_admin')) return { rows: [{ is_admin: controls.admin }] };
    if (sql.startsWith('SELECT user_id,expires_at,revoked_at')) return { rows: [{ user_id: who.userId, expires_at: new Date(who.loginExpiresAt), revoked_at: controls.revoked ? new Date() : null }] };
    return { rows: [] };
  });
  const release = vi.fn(), connect = vi.fn(async () => ({ query, release })), pool = { connect } as unknown as Pool;
  const scope: BarrierMultipartScope = { schemaVersion: 'wfc.pf.barrier-multipart-scope.v2', modelScope: { projectId,
    modelVersionId: randomUUID(), contentFingerprint: 'a'.repeat(64), selectionRevision: '0', captureFrameId: randomUUID(),
    captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' }, modelLoadId: randomUUID(),
  selectedParents: [{ selectionId: randomUUID(), dbId: 3, kind: 'wall' }], geometryPolicy: 'original-triangles-structural-only.v2' };
  const currentScope = vi.fn(async () => scope), storage = { store: vi.fn(), read: vi.fn() };
  const repository = createBarrierMultipartRepository(pool, { currentScope, storage });
  return { projectId, who, controls, query, connect, release, scope, currentScope, storage, repository };
}
describe('multipart admission uses authoritative existing principal transaction', () => {
  it('rejects cancellation and expired identity before acquiring a connection or touching storage', async () => {
    const f = fixture(), abort = new AbortController(); abort.abort();
    await expect(f.repository.get(f.projectId, f.who, randomUUID(), abort.signal)).rejects.toBeDefined();
    await expect(f.repository.get(f.projectId, { ...f.who, loginExpiresAt: Date.now() - 1 }, randomUUID())).rejects.toMatchObject({ code: 'LOGIN_EXPIRED' });
    expect(f.connect).not.toHaveBeenCalled(); expect(f.storage.store).not.toHaveBeenCalled(); expect(f.currentScope).not.toHaveBeenCalled();
  });
  it.each(['admin', 'login', 'project'] as const)('refuses %s loss before reading private multipart data', async kind => {
    const f = fixture(); if (kind === 'admin') f.controls.admin = false; if (kind === 'login') f.controls.revoked = true; if (kind === 'project') f.controls.project = false;
    await expect(f.repository.get(f.projectId, f.who, randomUUID())).rejects.toMatchObject({ code: kind === 'admin' ? 'ADMIN_REQUIRED' : kind === 'login' ? 'LOGIN_REVOKED' : 'PROJECT_NOT_FOUND' });
    expect(f.query.mock.calls.some(([sql]) => sql.includes('pf_barrier_multipart'))).toBe(false);
    expect(f.query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true); expect(f.release).toHaveBeenCalledOnce();
    expect(f.storage.store).not.toHaveBeenCalled(); expect(f.storage.read).not.toHaveBeenCalled();
  });
  it('refuses a different protected model load before quota reservation or filesystem I/O', async () => {
    const f = fixture(), admittedScope = structuredClone(f.scope); f.scope.modelLoadId = randomUUID();
    await expect(f.repository.admit(f.projectId, f.who, { schemaVersion: 'wfc.pf.barrier-multipart-admit.v2', idempotencyKey: randomUUID(), scope: admittedScope,
      profile: BARRIER_MULTIPART_PROFILE, expectedRegistryRevision: '0', selectedParentLabels: [{ selectionId: admittedScope.selectedParents[0].selectionId, name: 'Synthetic wall' }], reservation: { bytes: 1024, files: 2 } })).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_SCOPE_CHANGED' });
    expect(f.storage.store).not.toHaveBeenCalled(); expect(f.query.mock.calls.some(([sql]) => /^INSERT INTO pf_barrier_multipart|pg_advisory_xact_lock/.test(sql))).toBe(false);
  });
  it('rejects mismatched actual opaque bytes before copying the supplied payload or acquiring a connection', async () => {
    const f = fixture(), payload = Buffer.alloc(1024), copy = vi.spyOn(Buffer, 'from');
    try {
      await expect(f.repository.stagePart(f.projectId, f.who, { schemaVersion: 'wfc.pf.barrier-multipart-stage-part.v2', intentId: randomUUID(), expectedSessionRevision: '0',
        idempotencyKey: randomUUID(), scopeSha256: 'a'.repeat(64), profileSha256: 'b'.repeat(64), partIndex: 0, planSealSha256: 'c'.repeat(64), payload: { bytes: 1, sha256: 'd'.repeat(64) } }, payload)).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_PART_BYTES' });
      expect(copy.mock.calls.some(args => args[0] === payload)).toBe(false); expect(f.connect).not.toHaveBeenCalled(); expect(f.storage.store).not.toHaveBeenCalled();
    } finally { copy.mockRestore(); }
  });
  it('defines only additive unqualified evidence tables and immutable retention guards', () => {
    expect([...BARRIER_MULTIPART_SCHEMA_SQL.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(match => match[1])).toEqual([
      'pf_barrier_multipart_sessions', 'pf_barrier_multipart_allocations', 'pf_barrier_multipart_receipts']);
    expect(BARRIER_MULTIPART_SCHEMA_SQL).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM)\s+(?:pf_barrier_heads|pf_barrier_snapshots|cables)\b/i);
    expect(BARRIER_MULTIPART_SCHEMA_SQL).not.toMatch(/'ready'|'published'|'qualified'/);
    expect(BARRIER_MULTIPART_SCHEMA_SQL).toContain("OLD.state='cancelled'");
    expect(BARRIER_MULTIPART_SCHEMA_SQL).toContain("NEW.charged_bytes<OLD.charged_bytes");
  });
});
