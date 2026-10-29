import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTrayData } from './useTrayData';
import { fetchTrayDrawingSnapshot, type TrayDrawingResponse } from '@/api/trayDrawing';
vi.mock('@/api/trayDrawing', () => ({ fetchTrayDrawingSnapshot: vi.fn() }));
vi.mock('@/api/client', () => ({ fetchTrays: vi.fn().mockResolvedValue({ trays: [] }) }));
const response = (name='Shared') => ({ snapshot: { projectId: 'project', projectTrayId: 'tray' }, data: { project: { id: 'project' }, tray: { id: 'tray', projectId: 'project', name }, reportTrays: [{ id: 'tray', projectId: 'project', name }], cables: [], trayCables: [] }, permissions: { canEdit: false } } as unknown as TrayDrawingResponse);
beforeEach(() => { vi.mocked(fetchTrayDrawingSnapshot).mockReset().mockResolvedValue(response()); });
describe('consistent tray drawing loading', () => {
  it('clears a previous login snapshot immediately and discards its late completion', async () => {
    let resolve!: (value: TrayDrawingResponse) => void;
    vi.mocked(fetchTrayDrawingSnapshot).mockReturnValueOnce(new Promise(value => { resolve=value; }));
    const hook=renderHook(({token})=>useTrayData('project','tray',token),{initialProps:{token:'old' as string|null}});
    hook.rerender({token:null}); await act(async()=>resolve(response('Private')));
    expect(hook.result.current.tray).toBeNull();expect(hook.result.current.error).toContain('Sign in');
  });
  it('shows an explicit snapshot error rather than restoring separately loaded legacy data', async () => {
    vi.mocked(fetchTrayDrawingSnapshot).mockRejectedValue(new Error('The shared drawing contract is unsupported.'));
    const hook=renderHook(()=>useTrayData('project','tray','login'));
    await waitFor(()=>expect(hook.result.current.isLoading).toBe(false));
    expect(hook.result.current.error).toContain('unsupported');expect(hook.result.current.tray).toBeNull();expect(hook.result.current.trayCables).toEqual([]);
  });
  it('refreshes frozen inputs after a tray mutation rather than splicing a new tray into old cables/layout', async () => {
    const hook=renderHook(()=>useTrayData('project','tray','login'));
    await waitFor(()=>expect(hook.result.current.tray?.name).toBe('Shared'));
    vi.mocked(fetchTrayDrawingSnapshot).mockResolvedValue(response('Fresh shared'));
    act(()=>hook.result.current.setTray(previous=>previous?{...previous,name:'Unverified'}:null));
    expect(hook.result.current.tray).toBeNull();
    await waitFor(()=>expect(hook.result.current.tray?.name).toBe('Fresh shared'));
    expect(hook.result.current.project?.canEdit).toBe(false);
  });
});
