import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchRoutingPurposePolicy, type RoutingPurposePolicy } from '@/api/pathfinderPolicies';
import { useProjectCablePurposes } from './useProjectCablePurposes';
vi.mock('@/api/pathfinderPolicies', () => ({ fetchRoutingPurposePolicy: vi.fn() }));
const scope = { projectId: 'project-one', loadedProjectId: 'project-one', token: 'login', isAdmin: true };
const policy = { cablePurposes: ['Control', 'Grounding', 'Power', 'VFD'], invalidCablePurposeCount: 2 } as RoutingPurposePolicy;
beforeEach(() => { vi.mocked(fetchRoutingPurposePolicy).mockReset(); });
describe('standalone project cable purposes', () => {
  it('loads actual values and clears them immediately when project identity no longer matches', async () => {
    vi.mocked(fetchRoutingPurposePolicy).mockResolvedValue(policy);
    const hook = renderHook(useProjectCablePurposes, { initialProps: scope });
    await waitFor(() => expect(hook.result.current.cablePurposes).toEqual(policy.cablePurposes));
    expect(hook.result.current.invalidCablePurposeCount).toBe(2);
    hook.rerender({ ...scope, projectId: 'project-two' });
    expect(hook.result.current.cablePurposes).toEqual([]);
    expect(hook.result.current.invalidCablePurposeCount).toBe(0);
    expect(fetchRoutingPurposePolicy).toHaveBeenCalledTimes(1);
  });
  it('ignores late catalog responses after access changes', async () => {
    let resolve!: (value: RoutingPurposePolicy) => void;
    vi.mocked(fetchRoutingPurposePolicy).mockReturnValue(new Promise(done => { resolve = done; }));
    const hook = renderHook(useProjectCablePurposes, { initialProps: scope });
    hook.rerender({ ...scope, isAdmin: false });
    await act(async () => resolve(policy));
    expect(hook.result.current.cablePurposes).toEqual([]);
  });
  it('reports catalog failure without offering guessed categories', async () => {
    vi.mocked(fetchRoutingPurposePolicy).mockRejectedValue(new Error('Unavailable'));
    const hook = renderHook(() => useProjectCablePurposes(scope));
    await waitFor(() => expect(hook.result.current.cablePurposesError).toContain('could not be loaded'));
    expect(hook.result.current.cablePurposes).toEqual([]);
  });
});
