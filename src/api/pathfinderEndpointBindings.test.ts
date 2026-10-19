import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchEndpointBinding,
  fetchEndpointBindingHistory,
  saveEndpointBinding,
  EndpointBindingApiError,
  evaluateEndpointMigration,
} from './pathfinderEndpointBindings';
import { endpointBindingFixture, endpointIds as ids } from '@/test/endpointBindingFixtures';
beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => vi.unstubAllGlobals());
const respond = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
describe('fixed-path endpoint binding transport', () => {
  it('verifies immutable migration decisions and uses only the fixed evaluation path', async () => {
    const f = endpointBindingFixture();
    const command = {
      schemaVersion: 'wfc.pf.endpoint-migration-write.v1' as const,
      sourceBindingId: ids.binding,
      expectedRegistryRevision: '2',
      expectedLocationRevision: '2',
      expectedHeadId: ids.binding,
      expectedSelectionRevision: '1',
      targetModelVersionId: ids.model,
      targetAggregateId: ids.aggregate,
      targetProjectionSha256: 'a'.repeat(64),
      targetCaptureFrameId: ids.frame,
      objectDecisionId: null,
      frameDecisionId: null,
      idempotencyKey: ids.key,
      reason: 'Review available evidence',
    };
    vi.mocked(fetch)
      .mockResolvedValueOnce(respond(f.migration))
      .mockResolvedValueOnce(
        respond({
          ...f.migration,
          evaluation: { ...f.migration.evaluation, disposition: 'carried-fixed' },
        }),
      );
    await expect(
      evaluateEndpointMigration(ids.project, 'token', ids.location, command),
    ).resolves.toEqual(f.migration);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/endpoint-bindings/migrations'),
      expect.objectContaining({ method: 'POST' }),
    );
    await expect(
      evaluateEndpointMigration(ids.project, 'token', ids.location, command),
    ).rejects.toThrow();
  });
  it('uses strict atomic save and current/history paths with exact canonical binding hashes', async () => {
    const fixture = endpointBindingFixture();
    vi.mocked(fetch)
      .mockResolvedValueOnce(respond(fixture.context))
      .mockResolvedValueOnce(respond(fixture.receipt))
      .mockResolvedValueOnce(respond(fixture.history));
    await expect(fetchEndpointBinding(ids.project, 'token', ids.location)).resolves.toEqual(
      fixture.context,
    );
    await expect(
      saveEndpointBinding(ids.project, 'token', ids.location, fixture.write),
    ).resolves.toEqual(fixture.receipt);
    await expect(fetchEndpointBindingHistory(ids.project, 'token', ids.location)).resolves.toEqual(
      fixture.history,
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(`/locations/${ids.location}/endpoint-binding`),
      expect.objectContaining({
        method: 'PUT',
        cache: 'no-store',
        redirect: 'error',
        body: JSON.stringify(fixture.write),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('/binding-history?limit=25'),
      expect.anything(),
    );
  });
  it('rejects forged content, foreign identities, duplicate JSON and invalid outgoing mode fields', async () => {
    const fixture = endpointBindingFixture();
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        respond({
          ...fixture.context,
          head: { ...fixture.binding, pointProjectMetres: [9, 9, 9] },
        }),
      )
      .mockResolvedValueOnce(
        respond({ ...fixture.context, locationId: ids.actor, location: null, head: null }),
      )
      .mockResolvedValueOnce(new Response('{"schemaVersion":"x","schemaVersion":"y"}'));
    await expect(fetchEndpointBinding(ids.project, 'token', ids.location)).rejects.toThrow();
    await expect(fetchEndpointBinding(ids.project, 'token', ids.location)).rejects.toThrow();
    await expect(fetchEndpointBinding(ids.project, 'token', ids.location)).rejects.toThrow();
    await expect(
      saveEndpointBinding(ids.project, 'token', ids.location, {
        ...fixture.write,
        mode: 'object-derived',
        object: { traceId: ids.trace, objectRevisionId: ids.object, recordSha256: 'a'.repeat(64) },
        anchorRule: 'equipment-bottom-aabb.v1',
      } as never),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST', outcome: 'refused' });
    await expect(fetchEndpointBinding(ids.project + '\n', 'token', ids.location)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('preserves typed unknown outcomes and enforces exclusive descending history cursors', async () => {
    const fixture = endpointBindingFixture();
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        respond(
          {
            schemaVersion: 'wfc.pf.endpoint-binding-error.v1',
            code: 'COMMIT_OUTCOME_UNKNOWN',
            message: 'Reconcile the same command.',
            outcome: 'unknown',
          },
          503,
        ),
      )
      .mockResolvedValueOnce(respond(fixture.history));
    await expect(
      saveEndpointBinding(ids.project, 'token', ids.location, fixture.write),
    ).rejects.toMatchObject({ code: 'COMMIT_OUTCOME_UNKNOWN', status: 503, outcome: 'unknown' });
    await expect(
      fetchEndpointBindingHistory(ids.project, 'token', ids.location, '1'),
    ).rejects.toBeInstanceOf(EndpointBindingApiError);
    await expect(
      fetchEndpointBindingHistory(ids.project, 'token', ids.location, '2\n'),
    ).rejects.toMatchObject({ outcome: 'refused' });
  });
});
