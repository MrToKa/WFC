// @vitest-environment node
import type { Pool, PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { createPathFinderApplyRecovery, readApplyAbandonment } from './applyRecovery.js';
import { hash } from './dependencies.js';
import type { JobPrincipal } from './jobContracts.js';

const id = (n: number) => `da000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const projectId = id(1), proposalId = id(2), proposalHash = 'a'.repeat(64);
const input = { idempotencyKey: id(3), reviewId: id(4), expectedCableWriteRevision: '9007199254740993' };
const payloadHash = hash({ proposalId, ...input });
type Row = Record<string, unknown>;
function fixture() {
  const who: JobPrincipal = { userId: id(5), loginId: id(6), loginExpiresAt: Date.parse('2099-01-01T00:00:00Z') };
  const state = { admin: true, revoked: false, project: true, commitFails: false, expireOnInsert: false,
    receipt: null as Row | null, abandonment: null as Row | null,
    proposal: { proposal_hash: proposalHash } as Row | null,
    review: { actor_id: who.userId, proposal_id: proposalId, proposal_hash: proposalHash, review_login_id: id(90) } as Row | null };
  const calls: Array<{ sql: string; values: unknown[] }> = [], release = vi.fn();
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    if (sql === 'COMMIT' && state.commitFails) throw Error('lost commit acknowledgement');
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
    if (sql.startsWith('SELECT id FROM projects')) return { rows: state.project ? [{ id: projectId }] : [] };
    if (sql.startsWith('SELECT is_admin FROM users')) return { rows: [{ is_admin: state.admin }] };
    if (sql.startsWith('INSERT INTO viewer_login_bindings')) return { rows: [] };
    if (sql.startsWith('SELECT user_id,expires_at,revoked_at FROM viewer_login_bindings'))
      return { rows: [{ user_id: who.userId, expires_at: new Date(who.loginExpiresAt), revoked_at: state.revoked ? new Date() : null }] };
    if (sql.startsWith('SELECT * FROM pf_apply_receipts')) return { rows: state.receipt ? [state.receipt] : [] };
    if (sql.startsWith('SELECT payload_hash FROM pf_apply_abandonments')) return { rows: state.abandonment ? [state.abandonment] : [] };
    if (sql.startsWith('SELECT proposal_hash FROM pf_proposals')) return { rows: state.proposal ? [state.proposal] : [] };
    if (sql.startsWith('SELECT actor_id,proposal_id,proposal_hash FROM pf_reviews')) return { rows: state.review ? [state.review] : [] };
    if (sql.startsWith('INSERT INTO pf_apply_abandonments')) {
      state.abandonment = { payload_hash: values[6] };
      if (state.expireOnInsert) who.loginExpiresAt = 0;
      return { rows: [] };
    }
    throw Error('Unexpected query in closure control');
  });
  const client = { query, release } as unknown as PoolClient;
  const pool = { connect: async () => client } as unknown as Pool;
  return { who, state, calls, release, query, client, recover: createPathFinderApplyRecovery(pool) };
}

describe('explicit server-owned pending Apply closure', () => {
  it('closes only the exact same-actor review, allows its historical login, and retains the exact bigint revision', async () => {
    const f = fixture(); const result = await f.recover(projectId, f.who, proposalId, input);
    expect(result).toEqual({ schemaVersion: 'wfc.pf.apply-recovery.v1', projectId, proposalId, ...input,
      status: 'closed-without-apply', duplicate: false, receipt: null });
    expect(f.calls.find(c => c.sql.startsWith('INSERT INTO pf_apply_abandonments'))?.values)
      .toEqual([projectId, f.who.userId, input.idempotencyKey, proposalId, input.reviewId, '9007199254740993', payloadHash]);
    expect(f.calls.filter(c => /^(?:INSERT INTO|UPDATE|DELETE FROM)\s+(?!viewer_login_bindings\b)/i.test(c.sql)).map(c => c.sql.split('(')[0]))
      .toEqual(['INSERT INTO pf_apply_abandonments']);
    expect(f.calls.at(-1)?.sql).toBe('COMMIT');
    const duplicate = await f.recover(projectId, f.who, proposalId, input);
    expect(duplicate).toMatchObject({ status: 'closed-without-apply', duplicate: true, receipt: null });
    expect(f.calls.filter(c => c.sql.startsWith('INSERT INTO pf_apply_abandonments'))).toHaveLength(1);
  });
  it('returns the real matching committed receipt before any tombstone/proposal/review check, preserving numeric strings', async () => {
    const f = fixture(), before = { design_length: '1.00000000000000001', install_length: '3.12500', cable_write_revision: '9007199254740993' },
      after = { ...before, design_length: '7', cable_write_revision: '9007199254740994' }, provenance = { schemaVersion: 'pathfinder.apply.v2' };
    f.state.receipt = { id: id(8), project_id: projectId, proposal_id: proposalId, cable_id: id(9), payload_hash: payloadHash,
      before_snapshot: before, after_snapshot: after, provenance, applied_at: '2026-10-19T12:00:00.123Z' };
    f.state.abandonment = { payload_hash: 'b'.repeat(64) }; f.state.proposal = null; f.state.review = null;
    const result = await f.recover(projectId, f.who, proposalId, input);
    expect(result).toMatchObject({ status: 'already-applied', duplicate: true,
      receipt: { id: id(8), before, after, provenance, appliedAt: '2026-10-19T12:00:00.123Z' } });
    expect(result.receipt?.before).toBe(before); expect(result.receipt?.after).toBe(after);
    expect(f.calls.some(c => c.sql.includes('pf_apply_abandonments'))).toBe(false);
    expect(f.calls.some(c => c.sql.includes('pf_reviews'))).toBe(false);
  });
  it.each(['receipt', 'abandonment'] as const)('refuses key reuse with a different payload in %s history', async source => {
    const f = fixture(); f.state[source] = { payload_hash: 'b'.repeat(64) };
    await expect(f.recover(projectId, f.who, proposalId, input)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 });
    expect(f.calls.at(-1)?.sql).toBe('ROLLBACK');
    expect(f.calls.some(c => c.sql.startsWith('INSERT INTO pf_apply_abandonments'))).toBe(false);
  });
  it.each(['missing', 'actor', 'proposal', 'hash'] as const)('refuses a %s review without writing a closure', async invalid => {
    const f = fixture();
    if (invalid === 'missing') f.state.review = null;
    else f.state.review![{ actor: 'actor_id', proposal: 'proposal_id', hash: 'proposal_hash' }[invalid]] = invalid === 'hash' ? 'b'.repeat(64) : id(99);
    await expect(f.recover(projectId, f.who, proposalId, input)).rejects.toMatchObject({ code: 'REVIEW_REQUIRED', status: 409 });
    expect(f.calls.some(c => c.sql.startsWith('INSERT INTO pf_apply_abandonments'))).toBe(false);
  });
  it('refuses a missing proposal without inventing any review or receipt', async () => {
    const f = fixture(); f.state.proposal = null;
    await expect(f.recover(projectId, f.who, proposalId, input)).rejects.toMatchObject({ code: 'PROPOSAL_NOT_FOUND', status: 404 });
    expect(f.calls.some(c => c.sql.startsWith('SELECT actor_id'))).toBe(false);
  });
  it.each(['admin', 'revoked', 'expired', 'expiry-before-commit', 'project'] as const)('enforces current %s authorization, including through commit', async control => {
    const f = fixture();
    const codes = { admin: 'ADMIN_REQUIRED', revoked: 'LOGIN_REVOKED', expired: 'LOGIN_EXPIRED', 'expiry-before-commit': 'LOGIN_EXPIRED', project: 'PROJECT_NOT_FOUND' };
    if (control === 'admin') f.state.admin = false;
    if (control === 'revoked') f.state.revoked = true;
    if (control === 'expired') f.who.loginExpiresAt = 0;
    if (control === 'expiry-before-commit') f.state.expireOnInsert = true;
    if (control === 'project') f.state.project = false;
    await expect(f.recover(projectId, f.who, proposalId, input)).rejects.toMatchObject({ code: codes[control] });
    expect(f.calls.at(-1)?.sql).toBe('ROLLBACK');
    expect(f.calls.some(c => c.sql === 'COMMIT')).toBe(false);
  });
  it('rejects producer authorities before entering any human transaction', async () => {
    const f = fixture(), producer = { kind: 'calculation-grant', userId: f.who.userId, authority: {} } as unknown as JobPrincipal;
    await expect(f.recover(projectId, producer, proposalId, input)).rejects.toMatchObject({ code: 'HUMAN_ADMINISTRATOR_REQUIRED', status: 403 });
    expect(f.calls).toHaveLength(0);
  });
  it('does not claim closure when COMMIT acknowledgement is unknown, and discards the connection', async () => {
    const f = fixture(); f.state.commitFails = true;
    await expect(f.recover(projectId, f.who, proposalId, input)).rejects.toMatchObject({ code: 'PATHFINDER_COMMIT_OUTCOME_UNKNOWN', status: 503 });
    expect(f.release).toHaveBeenCalledExactlyOnceWith(true);
    expect(f.calls.filter(c => c.sql.startsWith('INSERT INTO pf_apply_abandonments'))).toHaveLength(1);
  });
});

describe('Apply abandonment lookup', () => {
  it('uses the exact tenant/actor/key and distinguishes absence from exact closure', async () => {
    const f = fixture(), request = { projectId, actorId: f.who.userId, idempotencyKey: input.idempotencyKey, payloadHash };
    expect(await readApplyAbandonment(f.client, request)).toBe(false);
    f.state.abandonment = { payload_hash: payloadHash };
    expect(await readApplyAbandonment(f.client, request)).toBe(true);
    expect(f.calls.at(-1)?.values).toEqual([projectId, f.who.userId, input.idempotencyKey]);
    f.state.abandonment = { payload_hash: 'b'.repeat(64) };
    await expect(readApplyAbandonment(f.client, request)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
});
