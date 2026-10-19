// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { preparedUnionResponseSchema, validatePreparedUnionResponse } from './preparationPublisher.js';
import { latestArtifact } from './repository.js';

const fixture = () => {
  const plan = {projectId:'11111111-1111-4111-8111-111111111111',modelVersionId:'22222222-2222-4222-8222-222222222222',contentFingerprint:'a'.repeat(64)}, requestId = '88888888-8888-4888-8888-888888888888';
  const response = preparedUnionResponseSchema.parse({
    schemaVersion: 'pathfinder.model.response.v1', requestId, status: 'prepared', message: '', engineeringAccepted: false,
    model: { projectId: plan.projectId, modelVersionId: plan.modelVersionId, contentSha256: plan.contentFingerprint, sourceContentSha256: null },
    prepared: { key: 'd'.repeat(64), readiness: 'needs_review', counts: { validatedBends: 0, fallbackBends: 0, validatedStraights: 1, fallbackStraights: 0, fallbackClearances: 0 },
      cacheScope: 'fitted-centerlines-ports-and-canonical-mesh;surface-bvh-reconstructed-on-disk-load;graph-per-calculation',
      loadedFromDisk: false, objectCount: 2, segmentCount: 1, diagnosticCount: 1, diagnostics: ['Native review not asserted.'],
      diagnosticsTruncated: false, engineeringAccepted: false },
  });
  return { plan, requestId, response };
};
describe('strict whole-union engine receipt', () => {
  it('accepts exact scoped fitting with explicit unaccepted status', () => {
    const f = fixture(); expect(() => validatePreparedUnionResponse(f.plan, f.response, f.requestId, 2, 1)).not.toThrow();
  });
  it.each(['objectCount', 'segmentCount', 'diagnosticCount'] as const)('refuses silently partial %s', key => {
    const f = fixture(); f.response.prepared[key] = 0;
    expect(() => validatePreparedUnionResponse(f.plan, f.response, f.requestId, 2, 1)).toThrowError(expect.objectContaining({ code: 'PREPARATION_ENGINE_INCOMPLETE' }));
  });
  it('refuses empty networks and wrong identity or truncated diagnostic evidence', () => {
    const f = fixture();
    for (const change of [
      () => validatePreparedUnionResponse(f.plan, f.response, f.requestId, 2, 0),
      () => validatePreparedUnionResponse(f.plan, f.response, '99999999-9999-4999-8999-999999999999', 2, 1),
      () => validatePreparedUnionResponse({ ...f.plan, contentFingerprint: 'f'.repeat(64) }, f.response, f.requestId, 2, 1),
      () => validatePreparedUnionResponse(f.plan, { ...f.response, prepared: { ...f.response.prepared, diagnosticsTruncated: true } }, f.requestId, 2, 1),
    ]) expect(change).toThrowError(expect.objectContaining({ code: 'PREPARATION_ENGINE_INCOMPLETE' }));
  });
  it.each([
    { engineeringAccepted: true }, { unknown: true },
    { model: { ...fixture().response.model, contentSha256: 'invalid' } },
    { prepared: { ...fixture().response.prepared, segmentCount: Infinity } },
    { prepared: { ...fixture().response.prepared, engineeringAccepted: true } },
    { prepared: { ...fixture().response.prepared, cacheScope: 'persistent-final-graph' } },
  ])('refuses untrusted response %j', mutation => expect(preparedUnionResponseSchema.safeParse({ ...fixture().response, ...mutation }).success).toBe(false));
});

describe('trusted preparation pointer', () => {
  const client = (rows: unknown[][]) => ({ query: vi.fn(async () => ({ rows: rows.shift() ?? [] })) }) as unknown as PoolClient;
  const pointer = { current_aggregate_id: 'aggregate', current_artifact_id: 'trusted', aggregate_artifact_id: 'trusted',
    aggregate_model_id: 'model', aggregate_revision: '5', pointer_revision: '5' };
  it('keeps current whole aggregate ahead of a newer manual diagnostic artifact', async () => {
    const c = client([[pointer], [{ id: 'trusted' }]]);
    await expect(latestArtifact(c, 'project', 'model')).resolves.toEqual({ id: 'trusted' });
    expect(c.query).toHaveBeenNthCalledWith(2, expect.stringContaining('id=$3'), ['project', 'model', 'trusted']);
  });
  it.each([{ current_artifact_id: null }, { current_aggregate_id: null }, { aggregate_revision: '4' }, { aggregate_artifact_id: 'foreign' }])('fails closed for inconsistent pointer %j', async mutation => {
    const c = client([[{ ...pointer, ...mutation }]]);
    await expect(latestArtifact(c, 'project', 'model')).rejects.toMatchObject({ code: 'PREPARATION_CURRENT_INTEGRITY' });
    expect(c.query).toHaveBeenCalledTimes(1);
  });
  it('refuses a dangling current artifact', async () => {
    await expect(latestArtifact(client([[pointer], []]), 'project', 'model')).rejects.toMatchObject({ code: 'PREPARATION_CURRENT_INTEGRITY' });
  });
  it.each([{rows:[]}, {rows:[{ current_aggregate_id: null, current_artifact_id: null }]}, {rows:[{ ...pointer, aggregate_model_id: 'old-model' }]}])('retains diagnostic lookup fallback only when no current-model aggregate exists', async ({rows}) => {
    const c = client([rows, [{ id: 'diagnostic' }]]);
    await expect(latestArtifact(c, 'project', 'model')).resolves.toEqual({ id: 'diagnostic' });
    expect(c.query).toHaveBeenLastCalledWith(expect.stringContaining('ORDER BY created_at'), ['project', 'model']);
  });
});
