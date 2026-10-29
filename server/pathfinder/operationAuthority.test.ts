import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import {
  grantOperationPrincipal,
  grantProvenance,
  isGrantPrincipal,
  operationTransaction,
  requireGrantModelScope,
  requireHumanPrincipal,
} from './operationAuthority.js';
import type { CalculationGrantAuthority } from './calculationAuthority.js';
import { createPreparationService } from './preparationSessions.js';
import { createRevisionComparisonRepository } from './revisionComparisonRepository.js';

const id = (n: number) => `f8000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const authority = (): CalculationGrantAuthority => ({
  kind: 'calculation-grant', projectId: id(1), grantId: id(2), grantRevision: '3',
  grantEpoch: '4', installationEpoch: id(5), issuerId: id(6), issuerAdminRevision: '7',
  leaseId: id(8), ownerToken: 'a'.repeat(64), leaseExpiresAt: '2099-01-01T00:00:00.000Z',
  operation: 'prepare', modelVersionId: id(9), selectionRevision: '10', contentFingerprint: 'b'.repeat(64),
});
const human = { userId: id(6), loginId: id(11), loginExpiresAt: 4070908800000 };
const scope = () => {
  const a = authority();
  return { projectId: a.projectId, modelVersionId: a.modelVersionId, selectionRevision: a.selectionRevision, contentFingerprint: a.contentFingerprint };
};

describe('discriminated calculation operation authority', () => {
  it('keeps the real issuer as audit identity without creating a human login', () => {
    const who = grantOperationPrincipal(authority());
    expect(isGrantPrincipal(who)).toBe(true);
    expect(who.userId).toBe(who.authority.issuerId);
    expect(Object.hasOwn(who, 'loginId')).toBe(false);
    expect(Object.hasOwn(who, 'loginExpiresAt')).toBe(false);
    expect(isGrantPrincipal(human)).toBe(false);
    expect(() => requireHumanPrincipal(human)).not.toThrow();
    expect(() => requireHumanPrincipal(who)).toThrow(expect.objectContaining({ code: 'HUMAN_ADMINISTRATOR_REQUIRED', status: 403 }));
  });

  it('accepts the exact pinned active-model scope and an implied same-project plan', () => {
    const who = grantOperationPrincipal(authority()), pinned = scope();
    expect(() => requireGrantModelScope(who, pinned)).not.toThrow();
    const { projectId: _projectId, ...withoutProject } = pinned;
    expect(() => requireGrantModelScope(who, withoutProject)).not.toThrow();
  });

  it.each([
    ['projectId', id(20)], ['modelVersionId', id(21)], ['selectionRevision', '11'],
    ['contentFingerprint', 'c'.repeat(64)],
  ] as const)('refuses a mismatched %s even when the other lease pins are current', (key, value) => {
    expect(() => requireGrantModelScope(grantOperationPrincipal(authority()), { ...scope(), [key]: value }))
      .toThrow(expect.objectContaining({ code: 'CALCULATION_GRANT_MODEL_SCOPE_DENIED', status: 403 }));
  });

  it('does not apply execution-lease scope restrictions to a human historical comparison', () => {
    expect(() => requireGrantModelScope(human, { ...scope(), modelVersionId: id(22), selectionRevision: '0', contentFingerprint: 'd'.repeat(64) })).not.toThrow();
  });

  it('scrubs finite execution ownership and model pins from immutable grant provenance', () => {
    const a = authority(), provenance = grantProvenance(grantOperationPrincipal(a));
    expect(provenance).toEqual({ kind: 'calculation-grant', projectId: a.projectId, grantId: a.grantId,
      grantRevision: a.grantRevision, grantEpoch: a.grantEpoch, installationEpoch: a.installationEpoch,
      issuerId: a.issuerId, issuerAdminRevision: a.issuerAdminRevision });
    for (const key of ['ownerToken', 'leaseId', 'leaseExpiresAt', 'operation', 'modelVersionId', 'selectionRevision', 'contentFingerprint', 'loginId', 'loginExpiresAt']) {
      expect(Object.hasOwn(provenance, key)).toBe(false);
    }
    expect(JSON.stringify(provenance)).not.toContain(a.ownerToken);
  });

  it.each(['issuer', 'project'] as const)('refuses a forged operation %s before opening a database connection', async kind => {
    const connect = vi.fn(), callback = vi.fn(), a = authority();
    const who = { ...grantOperationPrincipal(a), ...(kind === 'issuer' ? { userId: id(23) } : {}) };
    await expect(async () => operationTransaction({ connect } as unknown as Pool,
      kind === 'project' ? id(24) : a.projectId, who, 'prepare', callback))
      .rejects.toMatchObject({ code: 'CALCULATION_GRANT_SCOPE_DENIED', status: 403 });
    expect(connect).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
  });

  it('refuses grant-authored manual tray resolution before parsing the body or accessing SQL', async () => {
    const connect = vi.fn(), query = vi.fn(), validateUnion = vi.fn(), publish = vi.fn();
    const service = createPreparationService({ connect, query } as unknown as Pool, { validateUnion, publish });
    await expect(service.resolve(id(1), grantOperationPrincipal(authority()), { deliberatelyInvalidBody: true }))
      .rejects.toMatchObject({ code: 'HUMAN_ADMINISTRATOR_REQUIRED', status: 403 });
    expect(connect).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(validateUnion).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('refuses grant-authored frame/object engineering decisions before body parsing or SQL', async () => {
    const connect = vi.fn(), query = vi.fn(), runWorker = vi.fn();
    const repository = createRevisionComparisonRepository({ connect, query } as unknown as Pool, { runWorker });
    await expect(repository.decide(id(1), grantOperationPrincipal({ ...authority(), operation: 'compare' }),
      'deliberately-invalid-comparison-id', { deliberatelyInvalidBody: true }))
      .rejects.toMatchObject({ code: 'HUMAN_ADMINISTRATOR_REQUIRED', status: 403 });
    expect(connect).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(runWorker).not.toHaveBeenCalled();
  });
});
