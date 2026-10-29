// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { calculationGrantProvenanceSchema } from '../../shared/pathfinderCalculationGrant.js';
import { PathFinderError } from './errors.js';

const guards = vi.hoisted(() => ({ revision: vi.fn(), executionLease: vi.fn() }));
vi.mock('./calculationAuthority.js', () => ({
  requireCalculationGrantRevision: guards.revision,
  requireCalculationGrant: guards.executionLease,
}));
import { readGrantJobAuthority } from './grantJobAuthority.js';

const id = (n: number) => `f8200000-0000-4000-8000-${String(n).padStart(12, '0')}`;
type Row = Record<string, unknown>;
const reference = () => calculationGrantProvenanceSchema.parse({
  kind: 'calculation-grant', projectId: id(1), grantId: id(2), grantRevision: '3', grantEpoch: '4',
  installationEpoch: id(5), issuerId: id(6), issuerAdminRevision: '7',
});

function fixture() {
  const ref = reference(), order: string[] = [], input = { projectId: id(1), jobId: id(8) };
  const state: { job: Row | null; enrollment: Row | null } = {
    job: { authority_kind: 'calculation-grant', grant_provenance: ref, requested_by: ref.issuerId,
      state: 'complete', login_id: null, login_expires_at: null },
    enrollment: { generation: '9', authority_epoch: '10', grant_provenance: ref, actor_id: ref.issuerId,
      login_id: null, desired_generation: '9', enabled: false, paused: false, engine_unavailable_code: null },
  };
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.startsWith('SELECT authority_kind,grant_provenance,requested_by FROM pf_jobs')) {
      order.push('job');
      expect(values).toEqual([input.projectId, input.jobId]);
      return { rows: state.job ? [state.job] : [] };
    }
    if (sql.includes('FROM pf_recalculation_enrollments e')) {
      order.push('enrollment');
      expect(values).toEqual([input.projectId, input.jobId]);
      return { rows: state.enrollment ? [state.enrollment] : [] };
    }
    throw Error('Unexpected mocked authority SQL: ' + sql);
  });
  const client = { query } as unknown as Pick<PoolClient, 'query'>;
  guards.revision.mockImplementation(async () => { order.push('grant-revision'); });
  return { ref, order, input, state, query, client };
}

beforeEach(() => {
  guards.revision.mockReset();
  guards.executionLease.mockReset();
  guards.executionLease.mockImplementation(() => { throw Error('A completed proposal must not require an execution lease.'); });
});

describe('persistent original authority for grant calculation jobs', () => {
  it('fails closed for a missing job instead of inheriting the manual-job no-op', async () => {
    const f = fixture(); f.state.job = null;
    expect(await readGrantJobAuthority(f.client, f.input)).toMatchObject({ enrolled: true, valid: false, code: 'JOB_AUTHORITY_REQUIRED' });
    expect(f.order).toEqual(['job']);
    expect(guards.revision).not.toHaveBeenCalled();
  });

  it.each([undefined, null, 'unknown', 'current-login-admin'])('refuses absent or unknown authority kind %s', async authority_kind => {
    const f = fixture(); f.state.job = { ...f.state.job, authority_kind };
    expect(await readGrantJobAuthority(f.client, f.input)).toMatchObject({ enrolled: true, valid: false, code: 'JOB_AUTHORITY_INVALID' });
    expect(f.order).toEqual(['job']);
    expect(guards.revision).not.toHaveBeenCalled();
  });

  it('returns null only for the explicit historical current-login variant', async () => {
    const f = fixture(); f.state.job = { authority_kind: 'current-login', grant_provenance: null, requested_by: id(6) };
    expect(await readGrantJobAuthority(f.client, { ...f.input, lock: true })).toBeNull();
    expect(f.order).toEqual(['job']);
    expect(guards.revision).not.toHaveBeenCalled();
  });

  it.each(['foreign-project', 'foreign-issuer', 'missing-reference', 'owner-secret', 'fabricated-login'] as const)
  ('rejects %s provenance before any current-grant or enrollment lookup', async variant => {
    const f = fixture();
    const provenance = variant === 'foreign-project' ? { ...f.ref, projectId: id(20) }
      : variant === 'missing-reference' ? null
      : variant === 'owner-secret' ? { ...f.ref, ownerToken: 'a'.repeat(64) }
      : variant === 'fabricated-login' ? { ...f.ref, loginId: id(21) } : f.ref;
    f.state.job = { ...f.state.job, grant_provenance: provenance,
      requested_by: variant === 'foreign-issuer' ? id(22) : f.ref.issuerId };
    expect(await readGrantJobAuthority(f.client, f.input)).toMatchObject({ enrolled: true, valid: false, code: 'CALCULATION_GRANT_PROVENANCE_INVALID' });
    expect(f.order).toEqual(['job']);
    expect(guards.revision).not.toHaveBeenCalled();
  });

  it('validates the persistent grant before taking the shared generation/job locks', async () => {
    const f = fixture();
    expect(await readGrantJobAuthority(f.client, { ...f.input, lock: true })).toEqual({
      enrolled: true, valid: true, code: 'CALCULATION_GRANT_CURRENT', generation: '9', authorityEpoch: '10',
    });
    expect(f.order).toEqual(['job', 'grant-revision', 'enrollment']);
    expect(guards.revision).toHaveBeenCalledExactlyOnceWith(f.client, f.ref, { lock: true });
    expect(f.query.mock.calls[1][0]).toContain('FOR SHARE OF e,s,j');
    expect(guards.executionLease).not.toHaveBeenCalled();
  });

  it('keeps a completed grant proposal reviewable without a login or renewed execution lease', async () => {
    const f = fixture();
    expect(await readGrantJobAuthority(f.client, f.input)).toMatchObject({ enrolled: true, valid: true, code: 'CALCULATION_GRANT_CURRENT' });
    expect(guards.revision).toHaveBeenCalledExactlyOnceWith(f.client, f.ref, { lock: undefined });
    expect(f.query.mock.calls[1][0]).not.toContain('FOR SHARE');
    expect(guards.executionLease).not.toHaveBeenCalled();
    expect(guards.revision.mock.calls[0][1]).not.toHaveProperty('leaseId');
    expect(guards.revision.mock.calls[0][1]).not.toHaveProperty('ownerToken');
  });

  it.each(['CALCULATION_GRANT_REVOKED', 'CALCULATION_GRANT_ISSUER_REVOKED', 'CALCULATION_GRANT_RESTORE_FENCED'] as const)
  ('preserves %s and never reaches the enrollment/manual fallback', async code => {
    const f = fixture(); guards.revision.mockRejectedValueOnce(new PathFinderError(code, 403));
    expect(await readGrantJobAuthority(f.client, { ...f.input, lock: true })).toMatchObject({ enrolled: true, valid: false, code });
    expect(f.order).toEqual(['job']);
    expect(f.query).toHaveBeenCalledTimes(1);
  });

  it('requires the shared immutable enrollment for every grant job', async () => {
    const f = fixture(); f.state.enrollment = null;
    expect(await readGrantJobAuthority(f.client, f.input)).toMatchObject({ enrolled: true, valid: false, code: 'CALCULATION_GRANT_ENROLLMENT_REQUIRED' });
    expect(f.order).toEqual(['job', 'grant-revision', 'enrollment']);
  });

  it.each(['issuer', 'login', 'grant-reference'] as const)('refuses an enrollment with mismatched %s', async variant => {
    const f = fixture(); f.state.enrollment = { ...f.state.enrollment,
      ...(variant === 'issuer' ? { actor_id: id(23) } : variant === 'login' ? { login_id: id(24) }
        : { grant_provenance: { ...f.ref, grantEpoch: '99' } }) };
    expect(await readGrantJobAuthority(f.client, f.input)).toEqual({
      enrolled: true, valid: false, code: 'CALCULATION_GRANT_PROVENANCE_INVALID', generation: '9', authorityEpoch: '10',
    });
  });

  it('refuses an otherwise live grant whose enrolled generation was superseded', async () => {
    const f = fixture(); f.state.enrollment = { ...f.state.enrollment, desired_generation: '11' };
    expect(await readGrantJobAuthority(f.client, f.input)).toMatchObject({ enrolled: true, valid: false, code: 'AUTOMATIC_GENERATION_SUPERSEDED' });
  });

  it.each(['enabled', 'paused'] as const)('refuses the competing finite-login producer state %s', async field => {
    const f = fixture(); f.state.enrollment = { ...f.state.enrollment, [field]: true };
    expect(await readGrantJobAuthority(f.client, f.input)).toMatchObject({ enrolled: true, valid: false, code: 'RECALCULATION_AUTHORITY_MODE_CONFLICT' });
  });

  it('refuses current-engine unavailability despite an unchanged persistent grant', async () => {
    const f = fixture(); f.state.enrollment = { ...f.state.enrollment, engine_unavailable_code: 'ENGINE_IMPLEMENTATION_RESTART_REQUIRED' };
    expect(await readGrantJobAuthority(f.client, f.input)).toMatchObject({ enrolled: true, valid: false, code: 'ENGINE_IDENTITY_UNAVAILABLE' });
  });

  it('propagates unknown storage errors instead of converting them into manual authority', async () => {
    const f = fixture(), failure = Error('Synthetic authority storage failure.');
    guards.revision.mockRejectedValueOnce(failure);
    await expect(readGrantJobAuthority(f.client, f.input)).rejects.toBe(failure);
    expect(f.query).toHaveBeenCalledTimes(1);
  });
});
