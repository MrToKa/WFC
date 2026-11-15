import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useProjectDetailsData } from './useProjectDetailsData';
import { fetchProject } from '@/api/client';
vi.mock('@/api/client', () => ({ fetchProject: vi.fn(), ApiError: class extends Error {} }));
it('refreshes purpose template metadata without unloading an already visible project', async () => {
 const project = { id: 'p', createdAt: '2026-01-01', updatedAt: '2026-01-01' };
 let finish!: (value: unknown) => void;
 vi.mocked(fetchProject).mockResolvedValueOnce({ project } as never).mockImplementationOnce(() => new Promise(resolve => { finish = resolve as typeof finish; }));
 const { result } = renderHook(() => useProjectDetailsData({ projectId: 'p', token: 'token' }));
 await waitFor(() => expect(result.current.project?.id).toBe('p'));
 let pending!: Promise<void>;
 act(() => { pending = result.current.reloadProject({ showSpinner: false }); });
 expect(result.current.projectLoading).toBe(false);
 expect(result.current.project?.id).toBe('p');
 await act(async () => { finish({ project: { ...project, name: 'Refreshed' } }); await pending; });
 expect(result.current.project?.name).toBe('Refreshed');
});
