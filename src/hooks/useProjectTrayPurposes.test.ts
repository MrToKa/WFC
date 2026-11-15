import { renderHook, waitFor, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectTrayPurposes } from './useProjectTrayPurposes';
import { projectTrayPurposesRequest } from '@/api/projectTrayPurposes';
vi.mock('@/api/projectTrayPurposes', () => ({ projectTrayPurposesRequest: vi.fn() }));
const request = vi.mocked(projectTrayPurposesRequest);
describe('project tray purposes', () => {
  beforeEach(() => request.mockReset());
  it('does not carry another project catalog or late response into the current project', async () => {
    let finish!: (value: { name: string; trayCount: number }[]) => void;
    request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce([{ name: 'Current purpose', trayCount: 2 }]);
    const { result, rerender } = renderHook(({ id }) => useProjectTrayPurposes(id, 'token'), { initialProps: { id: 'first' } });
    rerender({ id: 'second' });
    await waitFor(() => expect(result.current.purposes[0]?.name).toBe('Current purpose'));
    await act(async () => { finish([{ name: 'Old purpose', trayCount: 1 }]); });
    expect(result.current.purposes).toEqual([{ name: 'Current purpose', trayCount: 2 }]);
  });
  it('keeps the catalog on a failed refresh and exposes the failure', async () => {
    request.mockResolvedValueOnce([{ name: 'Custom', trayCount: 0 }]).mockRejectedValueOnce(new Error('Service unavailable'));
    const { result } = renderHook(() => useProjectTrayPurposes('project', 'token'));
    await waitFor(() => expect(result.current.purposes).toHaveLength(1));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.purposes[0].name).toBe('Custom');
    expect(result.current.error).toBe('Service unavailable');
  });
});
