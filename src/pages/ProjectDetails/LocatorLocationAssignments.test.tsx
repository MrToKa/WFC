import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { getBarrierRegistry } from '@/api/pathfinderBarriers';
import type { CableEndpointReceipt } from '@/api/pathfinderCableEndpoints';
import { fetchPathFinderCableWorkflowDetail } from '@/api/pathfinderCableWorkflow';
import type { PathFinderCableRoutingPanelProps } from '@/components/pathfinder/PathFinderCableRoutingPanel';
import { usePathfinderLocationImpactProgress } from '@/hooks/usePathfinderLocationImpactProgress';
import { barrierCalculationFixture } from '@/test/pathfinderBarrierFixtures';
import { LocatorLocationAssignments } from './LocatorLocationAssignments';
import { useModelLocationMatch } from './hooks/useModelLocationMatch';
import type { usePathFinder } from './hooks/usePathFinder';
import type { EndpointCurrentScope } from '../../../shared/pathfinderEndpointBindings';

const { closeWindow, requestWindow, waitForSave, pointPickAbort } = vi.hoisted(() => ({
  closeWindow: vi.fn(), requestWindow: vi.fn(), waitForSave: vi.fn<() => Promise<void>>(), pointPickAbort: new AbortController(),
}));

vi.mock('@/api/pathfinderBarriers', () => ({ getBarrierRegistry: vi.fn() }));
vi.mock('@/api/pathfinderCableWorkflow', () => ({ fetchPathFinderCableWorkflowDetail: vi.fn() }));
vi.mock('@/hooks/usePathfinderLocationImpactProgress', () => ({ usePathfinderLocationImpactProgress: vi.fn() }));
vi.mock('@/hooks/useFloatingCablePanel', () => ({
  requestFloatingCableWindow: requestWindow,
}));
vi.mock('./hooks/useModelLocationMatch', () => ({ useModelLocationMatch: vi.fn() }));
vi.mock('@/components/pathfinder/PathFinderCableRoutingPanel', () => ({
  PathFinderCableRoutingPanel: ({ access, cable, onLocationWriteChange, onHideLocation }: PathFinderCableRoutingPanelProps) => {
    const name = access.locationTarget!.name;
    return <section role="dialog" aria-label={name}>
      {cable && access.pickEndpointPoint ? <button onClick={() => void access.pickEndpointPoint?.(pointPickAbort.signal, 42)}>Pick cable entry</button> : null}
      {cable && onHideLocation ? <button onClick={() => void onHideLocation()}>Hide</button> : null}
      {cable ? <button disabled={!access.calculation} onClick={async () => {
        onLocationWriteChange?.(true);
        await waitForSave();
        await access.onSaved?.({ logicalName: name, locationImpact: { id: 'impact' } } as CableEndpointReceipt,
          access.calculation?.preferences.barrierRouting?.scope as unknown as EndpointCurrentScope, access.calculation);
        onLocationWriteChange?.(false);
      }}>Confirm Save</button> : null}
    </section>;
  },
}));

it('updates the same editor before and after saving, without waiting for recalculation', async () => {
  requestWindow.mockReturnValue({ id: 'locator-popup', blocked: false, window: { close: closeWindow } });
  const { preferences } = barrierCalculationFixture(n => `c5000000-0000-4000-8000-${String(n).padStart(12, '0')}`);
  const { scope, expectedRegistryRevision, expectedSnapshot } = preferences.barrierRouting;
  vi.mocked(useModelLocationMatch).mockReturnValue({
    allowed: true, canStart: true, complete: true, totalNames: 2,
    owner: 'scope', storageReady: true, busy: false, phase: 'idle', summaryLoading: false,
    progress: null, error: null, notice: null, pending: null,
    start: vi.fn(), retry: vi.fn(), beforeCalculation: vi.fn(), cancel: vi.fn(),
    results: ['+HE', '+NSHV'].map(name => ({ name, status: 'missing', candidateObjectIds: [], locationId: null,
      bindingId: null, reasonCode: 'MISSING' })),
  });
  vi.mocked(usePathfinderLocationImpactProgress).mockReturnValue({ impact: null } as ReturnType<typeof usePathfinderLocationImpactProgress>);
  vi.mocked(getBarrierRegistry).mockResolvedValue({
    schemaVersion: 'wfc.pf.barrier-registry.v1', scope, registryRevision: expectedRegistryRevision,
    state: 'ready', snapshot: expectedSnapshot, selectedParents: [], reasonCodes: [],
  });
  vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue({
    row: { cable: { fromLocation: '+HE', toLocation: '+NSHV' } },
  } as Awaited<ReturnType<typeof fetchPathFinderCableWorkflowDetail>>);
  const refresh = vi.fn(), pickPoint = vi.fn(), hideLocation = vi.fn();
  const pf = {
    viewerPhase: 'ready', preparationViewerGeneration: 1, refresh, pickPoint, hideLocation,
    preparationAccess: { projectId: scope.projectId, loadedProjectId: scope.projectId, token: 'token', isAdmin: true },
    data: { activeModel: scope, artifacts: [], cables: [{ id: 'cable', fromLocation: '+HE', toLocation: '+NSHV' }] },
  } as unknown as ReturnType<typeof usePathFinder>;
  const onRoutesChanged = vi.fn();
  render(<LocatorLocationAssignments pf={pf} accountId="account" active writable secondaryDistanceMeters={2}
    onRoutesChanged={onRoutesChanged} />);

  fireEvent.click(screen.getByRole('button', { name: '+HE' }));
  await screen.findByRole('button', { name: 'Confirm Save' });
  fireEvent.click(screen.getByRole('button', { name: 'Pick cable entry' }));
  expect(pickPoint).toHaveBeenCalledExactlyOnceWith({ signal: pointPickAbort.signal, sdkObjectId: 42 });
  fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
  expect(hideLocation).toHaveBeenCalledOnce();
  const first = screen.getByRole('button', { name: '+HE' });
  const next = screen.getByRole('button', { name: '+NSHV' });
  expect(next).toBeEnabled();
  fireEvent.click(next);
  expect(screen.getByRole('dialog', { name: '+NSHV' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Confirm Save' })).toBeNull();
  await screen.findByRole('button', { name: 'Confirm Save' });
  fireEvent.click(first);
  await screen.findByRole('button', { name: 'Confirm Save' });
  let resolveSave!: () => void;
  waitForSave.mockReturnValue(new Promise<void>(resolve => { resolveSave = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm Save' }));
  expect(next).toBeDisabled();
  await act(async () => { resolveSave(); });
  expect(screen.getByRole('dialog', { name: '+HE' })).toBeVisible();
  expect(screen.getByText('Saved location +HE.')).toBeVisible();
  expect(refresh).toHaveBeenCalledOnce();
  expect(usePathfinderLocationImpactProgress).toHaveBeenLastCalledWith(expect.objectContaining({ active: true, impactId: 'impact' }));
  expect(onRoutesChanged).not.toHaveBeenCalled();
  expect(next).toBeEnabled();
  fireEvent.click(next);
  await screen.findByRole('button', { name: 'Confirm Save' });
  expect(screen.getByRole('dialog', { name: '+NSHV' })).toBeVisible();
  expect(requestWindow).toHaveBeenCalledOnce();
  expect(closeWindow).not.toHaveBeenCalled();
});
