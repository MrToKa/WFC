import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PathFinderRoutes } from './PathFinderRoutes';
import type { usePathFinder } from './hooks/usePathFinder';
import type { PathFinderCable, PathFinderState } from '@/api/pathfinder';

const projectId = '11111111-1111-4111-8111-111111111111', modelId = '22222222-2222-4222-8222-222222222222';
function cable(index: number): PathFinderCable {
  const missing = { status: 'missing' as const, locationId: null, candidates: [] };
  return { id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, cableId: index, tag: `CABLE-${index}`, fromLocation: `EQ-${index * 2}`, toLocation: `EQ-${index * 2 + 1}`,
    mto: 'Control', routing: null, designLength: null, installLength: null, cableWriteRevision: '0', fromMatch: missing, toMatch: missing };
}
function fixture(nameCount = 2) {
  const cables = Array.from({ length: Math.ceil(nameCount / 2) }, (_, i) => cable(i));
  if (nameCount % 2) cables.at(-1)!.toLocation = null;
  const data: PathFinderState = { schemaVersion: 1, projectId, registryRevision: '1', activeModel: { modelVersionId: modelId, selectionRevision: '1', contentFingerprint: 'a'.repeat(64) },
    settings: { revision: '1', connectionGap: '1', secondaryTrayLength: '3', endConnectionLength: '5', additionalBendingPercent: '10' }, cables, locations: [], artifacts: [], jobs: [], proposals: [] };
  const readSelection = vi.fn(async () => ({ objects: [{ objectId: 44, name: 'Selected trays' }] }));
  const prepareModel = vi.fn(async (_request: unknown, _current?: () => boolean) => null as null | Record<string, unknown>), cancelOperation = vi.fn();
  const pf = { data, viewerPhase: 'ready', busy: false, readSelection, prepareModel, cancelOperation } as unknown as ReturnType<typeof usePathFinder>;
  return { pf, readSelection, prepareModel, cancelOperation, onRulesDirtyChange: vi.fn() };
}
async function addRule() {
  const user = userEvent.setup(); await user.click(screen.getByRole('button', { name: 'Add current selection' }));
  await screen.findByRole('checkbox', { name: 'Control for rule 1' }); return user;
}
describe('bounded Routes preparation and recorded provenance', () => {
  it('prepares all 1,527 synthetic endpoint spellings as one request with a live local scope guard', async () => {
    const f = fixture(1527); render(<PathFinderRoutes {...f} active standaloneNames={[]} />); const user = await addRule();
    await user.click(screen.getByRole('button', { name: 'Prepare routes from all rules' }));
    const [request, isCurrent] = f.prepareModel.mock.calls[0];
    expect((request as { equipmentNames: string[] }).equipmentNames).toHaveLength(1527);
    expect((request as { equipmentNames: string[] }).equipmentNames.at(-1)).toBe('EQ-1526');
    expect(f.prepareModel).toHaveBeenCalledTimes(1); expect(isCurrent?.()).toBe(true);
  });
  it.each(['standalone names', 'selected cable', 'cable endpoint edit', 'model selection'] as const)('cancels a pending capture when %s changes and invalidates its before-upload guard', async change => {
    const f = fixture(4); let finish!: (value: null) => void;
    f.prepareModel.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const base = { ...f, active: true, standaloneNames: ['Manual endpoint'] };
    const view = render(<PathFinderRoutes {...base} />), user = await addRule();
    await user.click(screen.getByRole('button', { name: 'Prepare routes from all rules' }));
    const guard = f.prepareModel.mock.calls[0][1]!; expect(guard()).toBe(true);
    if (change === 'standalone names') view.rerender(<PathFinderRoutes {...base} standaloneNames={['Changed endpoint']} />);
    else if (change === 'selected cable') view.rerender(<PathFinderRoutes {...base} selectedCable={f.pf.data!.cables[1]} />);
    else if (change === 'cable endpoint edit') view.rerender(<PathFinderRoutes {...base} pf={{ ...f.pf, data: { ...f.pf.data!, cables: f.pf.data!.cables.map((value, i) => i ? value : { ...value, fromLocation: 'Changed cable endpoint' }) } }} />);
    else view.rerender(<PathFinderRoutes {...base} pf={{ ...f.pf, data: { ...f.pf.data!, activeModel: { ...f.pf.data!.activeModel, selectionRevision: '2' } } }} />);
    expect(f.cancelOperation).toHaveBeenCalled(); expect(guard()).toBe(false);
    await act(async () => finish(null));
    expect(screen.queryByText('All route rules were prepared. Review category assignments and locations before using calculated results.')).toBeNull();
  });
  it('cancels on detachment and refuses to acknowledge a late capture as the current request', async () => {
    const f = fixture(); let finish!: (value: null) => void; f.prepareModel.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<PathFinderRoutes {...f} active standaloneNames={[]} />), user = await addRule(); await user.click(screen.getByRole('button', { name: 'Prepare routes from all rules' }));
    const guard = f.prepareModel.mock.calls[0][1]!; view.unmount(); expect(f.cancelOperation).toHaveBeenCalled(); expect(guard()).toBe(false); await act(async () => finish(null));
  });
  it('retains an accepted late save as the previous endpoint scope instead of clearing the current draft warning', async () => {
    const f = fixture(); let finish!: (value: Record<string, unknown>) => void; f.prepareModel.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<PathFinderRoutes {...f} active standaloneNames={[]} />), user = await addRule(); await user.click(screen.getByRole('button', { name: 'Prepare routes from all rules' }));
    view.rerender(<PathFinderRoutes {...f} active standaloneNames={['New endpoint']} />);
    await act(async () => finish({ artifactId: 'saved-before-cancel' }));
    expect(screen.getByText('The saved snapshot records a previous endpoint scope. Prepare again for the current endpoints.')).toBeVisible();
    expect(f.onRulesDirtyChange).toHaveBeenLastCalledWith(true);
  });
  it.each([1, 1527])('shows reloaded input and model row counts in separate blocks without asserting property completeness or matching (%i names)', equipmentNameCount => {
    const f = fixture(), inputScope = { schemaVersion: 'wfc.capture.input.v1' as const, equipmentNameCount: 1527, chunkCount: 6, inputUtf8Bytes: 85000, scopeSha256: 'a'.repeat(64), equipmentNamesSha256: 'b'.repeat(64),
      propertyScan: { indexedObjectCount: 438155, attemptedObjectCount: 438155, returnedObjectCount: 438154, omittedObjectCount: 1, complete: false } };
    inputScope.equipmentNameCount = equipmentNameCount;
    inputScope.chunkCount = equipmentNameCount === 1 ? 1 : 6;
    f.pf.data!.artifacts.push({ id: projectId, modelVersionId: modelId, snapshotSha256: 'c'.repeat(64), objectCount: 52, engineeringAccepted: false, readiness: 'needs_review', capture: { inputScope }, coordinates: {}, createdAt: '2026-10-18T00:00:00Z' });
    render(<PathFinderRoutes {...f} active standaloneNames={[]} />);
    expect(screen.getByText(`Last prepared locations: ${equipmentNameCount.toLocaleString()} ${equipmentNameCount === 1 ? 'name' : 'names'}.`)).toHaveStyle({ display: 'block' });
    expect(screen.getByText(/438,154 of 438,155 checked; 1 unavailable/)).toHaveStyle({ display: 'block', marginTop: '4px' });
    expect(screen.getByText(/Location matching may be incomplete/)).toBeVisible();
    expect(screen.getByText('These counts describe the last preparation. Prepare again after changing project inputs.')).toHaveStyle({ display: 'block', marginTop: '4px' });
    expect(screen.queryByText(/names in \d+ groups/)).toBeNull();
  });
  it('labels historical artifacts with unavailable input scope instead of inventing zero requested names', () => {
    const f = fixture(); f.pf.data!.artifacts.push({ id: projectId, modelVersionId: modelId, snapshotSha256: 'c'.repeat(64), objectCount: 52, engineeringAccepted: false, readiness: 'needs_review', capture: {}, coordinates: {}, createdAt: '2026-10-18T00:00:00Z' });
    render(<PathFinderRoutes {...f} active standaloneNames={[]} />); expect(screen.getByText('Recorded input scope is unavailable for this historical snapshot.')).toBeVisible(); expect(screen.queryByText(/Last prepared locations: 0/)).toBeNull();
  });
  it('refuses more than4,096 names without starting preparation', async () => {
    const f = fixture(4097); render(<PathFinderRoutes {...f} active standaloneNames={[]} />); const user = await addRule(); await user.click(screen.getByRole('button', { name: 'Prepare routes from all rules' }));
    expect(f.prepareModel).not.toHaveBeenCalled(); expect(screen.getByText(/Use at most 4,096 equipment names/)).toBeVisible();
  });
});
