import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePathfinderObstacleDisplay } from './usePathfinderObstacleDisplay';
import { createObstacleNavigation } from '../pathFinderObstacleNavigation';
import type { BarrierModelScope } from '../../../../shared/pathfinderBarriers';

const id = (n: number) => `bc700000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope: BarrierModelScope = { projectId: id(1), modelVersionId: id(2), contentFingerprint: 'a'.repeat(64), selectionRevision: '3',
  captureFrameId: id(3), captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' };
function setup() {
  let generation = 0;
  const claimViewer = vi.fn(() => { const ticket = ++generation; return () => ticket === generation; });
  const pf = { data: { activeModel: { modelVersionId: scope.modelVersionId, contentFingerprint: scope.contentFingerprint, selectionRevision: scope.selectionRevision } },
    viewerPhase: 'ready', preparationViewerGeneration: 1, busy: false, showTray: vi.fn().mockResolvedValue(true), hideTray: vi.fn().mockResolvedValue(true),
  } as unknown as Parameters<typeof usePathfinderObstacleDisplay>[0]['pf'];
  return { input: { request: createObstacleNavigation(scope, 18).state.pathfinderObstacle, pf, claimViewer, enabled: true, accessKey: 'account' },
    replaceOwner: () => { generation++; } };
}
describe('obstacle display navigation lifecycle', () => {
  it('waits for the viewer, shows the recorded object, and restores its appearance with Hide', async () => {
    const f = setup(); f.input.pf.viewerPhase = 'loading';
    const view = renderHook(({ input }) => usePathfinderObstacleDisplay(input), { initialProps: { input: f.input } });
    expect(f.input.pf.showTray).not.toHaveBeenCalled();
    f.input.pf.viewerPhase = 'ready'; view.rerender({ input: { ...f.input } });
    await waitFor(() => expect(view.result.current.message).toBe('Obstacle #18 shown in the model.'));
    expect(f.input.pf.showTray).toHaveBeenCalledExactlyOnceWith(f.input.request, [18]);
    await act(async () => { await view.result.current.hide(); });
    expect(f.input.pf.hideTray).toHaveBeenCalledWith(f.input.request);
    expect(view.result.current.shown).toBe(false);
  });
  it.each(['modelVersionId', 'contentFingerprint', 'selectionRevision'] as const)('rejects a changed %s without showing a reused dbId', async field => {
    const f = setup(); f.input.pf.data!.activeModel[field] = field === 'modelVersionId' ? id(99) : field === 'contentFingerprint' ? 'c'.repeat(64) : '99';
    const view = renderHook(() => usePathfinderObstacleDisplay(f.input));
    await waitFor(() => expect(view.result.current.error).toContain('different model revision'));
    expect(f.input.pf.showTray).not.toHaveBeenCalled(); expect(f.input.claimViewer).not.toHaveBeenCalled();
  });
  it('shows the next click only after an earlier in-flight Show finishes', async () => {
    const f = setup(); let finish!: (value: boolean) => void;
    vi.mocked(f.input.pf.showTray).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = renderHook(({ input }) => usePathfinderObstacleDisplay(input), { initialProps: { input: f.input } });
    await waitFor(() => expect(f.input.pf.showTray).toHaveBeenCalledTimes(1));
    const second = { ...f.input, request: createObstacleNavigation(scope, 42).state.pathfinderObstacle };
    view.rerender({ input: second });
    expect(f.input.pf.showTray).toHaveBeenCalledTimes(1);
    await act(async () => { finish(true); });
    await waitFor(() => expect(view.result.current.message).toBe('Obstacle #42 shown in the model.'));
    expect(f.input.pf.showTray).toHaveBeenLastCalledWith(second.request, [42]);
  });
  it('restores a late successful Show after unmount', async () => {
    const f = setup(); let finish!: (value: boolean) => void;
    vi.mocked(f.input.pf.showTray).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = renderHook(() => usePathfinderObstacleDisplay(f.input));
    await waitFor(() => expect(f.input.pf.showTray).toHaveBeenCalledTimes(1)); view.unmount();
    expect(f.input.pf.hideTray).toHaveBeenCalledTimes(1);
    await act(async () => { finish(true); });
    expect(f.input.pf.hideTray).toHaveBeenCalledTimes(2);
  });
  it('keeps a failed restoration retryable and never hides a newer display owner', async () => {
    const f = setup(); const view = renderHook(() => usePathfinderObstacleDisplay(f.input));
    await waitFor(() => expect(view.result.current.shown).toBe(true));
    vi.mocked(f.input.pf.hideTray).mockResolvedValueOnce(false);
    await act(async () => { await view.result.current.hide(); });
    expect(view.result.current.error).toContain('Try Hide again'); expect(view.result.current.shown).toBe(true);
    await act(async () => { await view.result.current.hide(); });
    expect(view.result.current.shown).toBe(false);
    f.replaceOwner(); view.unmount();
    expect(f.input.pf.hideTray).toHaveBeenCalledTimes(2);
  });
  it('restores on model reload and withholds the stale in-flight result', async () => {
    const f = setup(); let finish!: (value: boolean) => void;
    vi.mocked(f.input.pf.showTray).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = renderHook(({ input }) => usePathfinderObstacleDisplay(input), { initialProps: { input: f.input } });
    await waitFor(() => expect(f.input.pf.showTray).toHaveBeenCalledTimes(1));
    f.input.pf.preparationViewerGeneration = 2; f.input.pf.viewerPhase = 'loading'; view.rerender({ input: { ...f.input } });
    await act(async () => { finish(true); });
    expect(view.result.current.shown).toBe(false); expect(f.input.pf.hideTray).toHaveBeenCalled();
  });
});
