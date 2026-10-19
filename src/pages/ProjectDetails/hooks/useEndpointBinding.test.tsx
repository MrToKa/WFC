import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEndpointBinding, type EndpointBindingAccess } from './useEndpointBinding';
import {
  fetchEndpointBinding,
  fetchEndpointBindingHistory,
  saveEndpointBinding,
  EndpointBindingApiError,
  evaluateEndpointMigration,
} from '@/api/pathfinderEndpointBindings';
import { endpointBindingFixture, endpointIds as ids } from '@/test/endpointBindingFixtures';
vi.mock('@/api/pathfinderEndpointBindings', async (original) => ({
  ...(await original<typeof import('@/api/pathfinderEndpointBindings')>()),
  fetchEndpointBinding: vi.fn(),
  fetchEndpointBindingHistory: vi.fn(),
  saveEndpointBinding: vi.fn(),
  evaluateEndpointMigration: vi.fn(),
  confirmEndpointMigration: vi.fn(),
}));
const access = (): EndpointBindingAccess => ({
  projectId: ids.project,
  loadedProjectId: ids.project,
  token: 'token',
  isAdmin: true,
  locationId: ids.location,
  contextKey: 'model-A',
  onSaved: vi.fn(),
  onAuthorityLost: vi.fn(),
});
beforeEach(() => {
  vi.clearAllMocks();
  const f = endpointBindingFixture();
  vi.mocked(fetchEndpointBinding).mockResolvedValue(f.context);
  vi.mocked(fetchEndpointBindingHistory).mockResolvedValue(f.history);
  vi.mocked(saveEndpointBinding).mockResolvedValue(f.receipt);
  vi.mocked(evaluateEndpointMigration).mockResolvedValue(f.migration);
});
describe('shared endpoint lifecycle', () => {
  it('keeps uncertain migration evaluation exact and exposes a blocked decision without changing the shared head', async () => {
    const props = access();
    vi.mocked(evaluateEndpointMigration).mockRejectedValueOnce(
      new TypeError('Lost evaluation acknowledgement'),
    );
    const { result } = renderHook(() => useEndpointBinding(props));
    await waitFor(() => expect(result.current.context).not.toBeNull());
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
    await act(() => result.current.evaluateMigration(command));
    expect(result.current.unknown).toBe(true);
    await act(() => result.current.retry());
    expect(result.current.migration?.evaluation.disposition).toBe('frame-unverified');
    expect(vi.mocked(evaluateEndpointMigration).mock.calls[1][3]).toBe(
      vi.mocked(evaluateEndpointMigration).mock.calls[0][3],
    );
    expect(saveEndpointBinding).not.toHaveBeenCalled();
    expect(props.onSaved).not.toHaveBeenCalled();
  });
  it('freezes the exact unknown command and reconciles historical receipt before refreshing current state', async () => {
    const fixture = endpointBindingFixture();
    const props = access();
    vi.mocked(saveEndpointBinding).mockRejectedValueOnce(new TypeError('Connection lost'));
    const { result } = renderHook(() => useEndpointBinding(props));
    await waitFor(() => expect(result.current.context).not.toBeNull());
    await act(() => result.current.save(fixture.write));
    expect(result.current.unknown).toBe(true);
    const command = vi.mocked(saveEndpointBinding).mock.calls[0][3];
    await act(() => result.current.save({ ...fixture.write, reason: 'Different intent' }));
    expect(saveEndpointBinding).toHaveBeenCalledTimes(1);
    await act(() => result.current.retry());
    expect(saveEndpointBinding).toHaveBeenCalledTimes(2);
    expect(vi.mocked(saveEndpointBinding).mock.calls[1][3]).toBe(command);
    expect(result.current.unknown).toBe(false);
    expect(props.onSaved).toHaveBeenCalledOnce();
    expect(fetchEndpointBinding).toHaveBeenCalledTimes(2);
  });
  it('discards late account/context responses and retains an uncertain same-account command across model generation changes', async () => {
    const fixture = endpointBindingFixture();
    let resolve!: (value: typeof fixture.context) => void;
    vi.mocked(fetchEndpointBinding).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const props = access();
    const { result, rerender } = renderHook((value) => useEndpointBinding(value), {
      initialProps: props,
    });
    rerender({ ...props, contextKey: 'model-B' });
    await waitFor(() => expect(result.current.context).not.toBeNull());
    await act(async () => resolve({ ...fixture.context, registryRevision: '999' }));
    expect(result.current.context?.registryRevision).toBe('2');
    vi.mocked(saveEndpointBinding).mockRejectedValueOnce(new TypeError('Lost ACK'));
    await act(() => result.current.save(fixture.write));
    rerender({ ...props, contextKey: 'model-C' });
    await waitFor(() => expect(result.current.unknown).toBe(true));
    await act(() => result.current.retry());
    expect(vi.mocked(saveEndpointBinding).mock.calls[1][3]).toEqual(fixture.write);
    rerender({ ...props, token: 'other-login' });
    await waitFor(() => expect(result.current.unknown).toBe(false));
  });
  it('handles conflict by explicit refresh and clears revoked authority; confirmed write survives a later failed read', async () => {
    const fixture = endpointBindingFixture(),
      props = access();
    const { result } = renderHook(() => useEndpointBinding(props));
    await waitFor(() => expect(result.current.context).not.toBeNull());
    vi.mocked(saveEndpointBinding).mockRejectedValueOnce(
      new EndpointBindingApiError('HEAD_CHANGED', 409, 'Review the current head.', 'refused'),
    );
    await act(() => result.current.save(fixture.write));
    expect(result.current.conflict).toBe(true);
    await act(() => result.current.discardRefresh());
    expect(result.current.conflict).toBe(false);
    vi.mocked(fetchEndpointBinding).mockRejectedValueOnce(new Error('Read failed after commit'));
    await act(() => result.current.save(fixture.write));
    expect(result.current.unknown).toBe(false);
    expect(props.onSaved).toHaveBeenCalledOnce();
    vi.mocked(saveEndpointBinding).mockRejectedValueOnce(
      new EndpointBindingApiError(
        'ADMIN_REQUIRED',
        403,
        'Administrator access required.',
        'refused',
      ),
    );
    await act(() => result.current.save(fixture.write));
    expect(result.current.context).toBeNull();
    expect(props.onAuthorityLost).toHaveBeenCalledOnce();
  });
});
