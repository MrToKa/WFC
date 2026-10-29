// @vitest-environment node
import type { PoolClient } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appendInitialFillMandateInTransaction, readInitialFillMandate, readInitialFillMandateForImpact, requireCurrentInitialFillMandate } from './initialFillMandates.js';
import { endpointBindingHash } from './endpointBindingRepository.js';
import { initialFillMandateContentHashInput } from '../../shared/pathfinderInitialFill.js';
const mocks = vi.hoisted(() => ({ authority: vi.fn() }));
vi.mock('./locationImpactRepository.js', () => ({ readLocationImpactJobAuthority: mocks.authority }));
const id = (n: number) => `f5000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
beforeEach(() => vi.resetAllMocks());
function fixture() {
  const who = { userId: id(1), loginId: id(2), loginExpiresAt: Date.now() + 60000 }, projectId = id(3), impactId = id(4), cableId = id(5);
  const current = { modelVersionId: id(6), selectionRevision: '1', contentFingerprint: 'a'.repeat(64), aggregateId: id(7), artifactId: id(8), projectionSha256: 'b'.repeat(64), captureFrameId: id(9), geometryRevision: '2', traceId: id(10) };
  const command = { schemaVersion: 'wfc.pf.cable-endpoint-command.v3', idempotencyKey: id(11), expectedContextSha256: 'c'.repeat(64), expectedCableWriteRevision: '7', expectedLogicalName: 'Equipment',
    expectedRegistryRevision: '3', expectedLocationId: null, expectedLocationRevision: null, expectedHeadId: null, expectedCurrent: current, reason: 'Explicit synthetic initial fill',
    selection: { mode: 'fixed-world', pointProjectMetres: [1, 2, 3], derivation: 'manual-world-point', displaySdkObjectId: null }, calculation: null, initialFill: { mode: 'when-both-empty' } };
  const impactBody = { schemaVersion: 'wfc.pf.location-impact-record.v1', id: impactId, projectId, actorId: who.userId, actorAdminRevision: '0', loginId: who.loginId,
    loginExpiresAt: new Date(who.loginExpiresAt).toISOString(), authorityExpiresAt: new Date(who.loginExpiresAt).toISOString(), installationEpoch: id(12), idempotencyKey: command.idempotencyKey,
    commandSha256: endpointBindingHash(command), locationId: id(13), bindingId: id(14), bindingContentSha256: 'd'.repeat(64), observedRegistryRevision: '4', current,
    calculation: null, eligibleCableIds: [cableId], excludedMvCableIds: [], blockedCategoryCableIds: [], createdAt: new Date().toISOString() };
  const record = { ...impactBody, contentSha256: endpointBindingHash(impactBody) };
  const impact = { project_id: projectId, id: impactId, actor_id: who.userId, login_id: who.loginId, idempotency_key: command.idempotencyKey, command_sha256: record.commandSha256, record_sha256: record.contentSha256, record };
  const state = { impact: impact as Record<string, any> | null, mandates: new Map<string, Record<string, any>>() };
  const query = vi.fn(async (sql: string, args: any[] = []) => {
    if (sql.includes('FROM pf_location_impacts')) return { rows: state.impact ? [state.impact] : [] };
    if (sql.includes('FROM pf_initial_fill_mandates')) return { rows: [...state.mandates.values()].filter(row => row.project_id === args[0] && (sql.includes('AND impact_id=') ? row.impact_id === args[1] : row.id === args[1])) };
    if (sql.startsWith('INSERT INTO pf_initial_fill_mandates')) { state.mandates.set(args[1], { project_id: args[0], id: args[1], impact_id: args[2], actor_id: args[3], login_id: args[4], idempotency_key: args[5], command_sha256: args[6], record_sha256: args[7], record: args[8] }); return { rows: [] }; }
    throw Error('Unexpected mocked SQL: ' + sql.slice(0, 80));
  });
  mocks.authority.mockResolvedValue({ enrolled: true, valid: true, impactId, generation: '4', authorityEpoch: '0', scope: 'location-impact', code: 'LOCATION_IMPACT_AUTHORITY_CURRENT' });
  const client = { query } as unknown as PoolClient;
  const input = { projectId, principal: who, impactId, commandSha256: record.commandSha256, idempotencyKey: command.idempotencyKey, command };
  const append = (value = input, check = () => undefined) => appendInitialFillMandateInTransaction(client, value, check);
  const require = (mandateId: string, extra: object = {}) => requireCurrentInitialFillMandate(client, { projectId, mandateId, impactId, cableId, jobId: id(15), principal: who, ...extra });
  return { who, projectId, impactId, cableId, command, record, state, query, client, input, append, require };
}
describe('explicit initial-fill mandate source protocol; synthetic SQL only', () => {
  it('derives exact authority, model and eligible scope from the same immutable impact; no fake review or cable writes', async () => {
    const f = fixture(), ref = await f.append(), record = await readInitialFillMandate(f.client, f.projectId, ref.id);
    expect(record).toMatchObject({ actorId: f.who.userId, loginId: f.who.loginId, impactId: f.impactId, eligibleCableIds: [f.cableId], authorityExpiresAt: f.record.authorityExpiresAt, installationEpoch: f.record.installationEpoch });
    expect(record!.contentSha256).toBe(endpointBindingHash(initialFillMandateContentHashInput(record!))); expect(f.query.mock.calls.map(([sql]) => sql).join('\n')).not.toMatch(/UPDATE cables|INSERT INTO pf_reviews|INSERT INTO pf_apply_receipts/);
  });
  it('exact same impact replay returns one immutable mandate instead of renewing its expiry or scope', async () => {
    const f = fixture(), first = await f.append(), second = await f.append(); expect(second).toEqual(first); expect(f.state.mandates.size).toBe(1);
    expect((await readInitialFillMandateForImpact(f.client, f.projectId, f.impactId))?.id).toBe(first.id);
  });
  it.each(['v1', 'v2', 'null-policy', 'wrong-hash', 'wrong-key'] as const)('refuses %s promotion before reading or writing a mandate', async kind => {
    const f = fixture(), command: Record<string, any> = { ...f.command };
    if (kind === 'v1') { command.schemaVersion = 'wfc.pf.cable-endpoint-command.v1'; delete command.initialFill; delete command.calculation; }
    if (kind === 'v2') { command.schemaVersion = 'wfc.pf.cable-endpoint-command.v2'; delete command.initialFill; }
    if (kind === 'null-policy') command.initialFill = null; if (kind === 'wrong-key') command.idempotencyKey = id(999);
    await expect(f.append({ ...f.input, command: command as typeof f.command, ...(kind === 'wrong-hash' ? { commandSha256: 'f'.repeat(64) } : {}) })).rejects.toMatchObject({ code: 'INITIAL_FILL_EXPLICIT_MANDATE_REQUIRED' }); expect(f.state.mandates.size).toBe(0);
  });
  it.each(['actor', 'login', 'scope', 'impact-hash', 'missing-impact'] as const)('refuses changed %s context without recording authority', async kind => {
    const f = fixture(); if (kind === 'actor') f.who.userId = id(999); if (kind === 'login') f.who.loginId = id(999);
    if (kind === 'scope') { const { contentSha256: _hash, ...body } = f.state.impact!.record; const record = { ...body, current: { ...body.current, selectionRevision: '9' } }; f.state.impact!.record = { ...record, contentSha256: endpointBindingHash(record) }; f.state.impact!.record_sha256 = endpointBindingHash(record); }
    if (kind === 'impact-hash') f.state.impact!.record_sha256 = 'f'.repeat(64); if (kind === 'missing-impact') f.state.impact = null;
    await expect(f.append()).rejects.toBeDefined(); expect(f.state.mandates.size).toBe(0);
  });
  it('historical evidence remains readable after original login expiry without invoking live authority', async () => {
    const f = fixture(), ref = await f.append(); f.who.loginExpiresAt = Date.now() - 1;
    expect((await readInitialFillMandate(f.client, f.projectId, ref.id))?.id).toBe(ref.id); expect(mocks.authority).not.toHaveBeenCalled();
  });
  it('current writer requires the exact mandate principal, eligible cable and scoped job authority', async () => {
    const f = fixture(), ref = await f.append(); expect((await f.require(ref.id)).id).toBe(ref.id);
    await expect(f.require(ref.id, { cableId: id(999) })).rejects.toMatchObject({ code: 'INITIAL_FILL_MANDATE_SCOPE' });
    await expect(f.require(ref.id, { principal: { ...f.who, loginId: id(999) } })).rejects.toMatchObject({ code: 'INITIAL_FILL_MANDATE_PRINCIPAL' });
    mocks.authority.mockResolvedValue(null); await expect(f.require(ref.id)).rejects.toMatchObject({ code: 'INITIAL_FILL_IMPACT_REQUIRED' });
  });
  it.each(['LOCATION_IMPACT_RESTORE_FENCED', 'LOCATION_IMPACT_AUTHORITY_EXPIRED', 'LOCATION_IMPACT_TARGET_SUPERSEDED', 'LOCATION_IMPACT_JOB_REVOKED'])('does not bypass live %s refusal', async code => {
    const f = fixture(), ref = await f.append(); mocks.authority.mockResolvedValue({ enrolled: true, valid: false, impactId: f.impactId, code }); await expect(f.require(ref.id)).rejects.toMatchObject({ code });
  });
  it('rejects altered stored mandate hashes and refuses already-aborted append before SQL', async () => {
    const f = fixture(), ref = await f.append(); f.state.mandates.get(ref.id)!.record_sha256 = 'f'.repeat(64);
    await expect(readInitialFillMandate(f.client, f.projectId, ref.id)).rejects.toMatchObject({ code: 'INITIAL_FILL_MANDATE_INTEGRITY' });
    const g = fixture(); await expect(g.append(g.input, () => { throw Error('aborted'); })).rejects.toThrow('aborted'); expect(g.query).not.toHaveBeenCalled();
  });
});
