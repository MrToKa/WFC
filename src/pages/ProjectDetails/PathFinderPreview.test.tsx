import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PathFinderPreview as Preview, PathFinderPreviewInput, PathFinderState } from '@/api/pathfinder';
import type { ViewerSelection } from '../../../viewer-runtime/protocol.mjs';
import type { usePathFinder } from './hooks/usePathFinder';
import { PathFinderPreview } from './PathFinderPreview';

vi.mock('./RoutingsViewerTab.styles', () => ({ useRoutingsViewerStyles: () => ({ result: 'result', actions: 'actions' }) }));

const projectId = '11111111-1111-4111-8111-111111111111', modelId = '22222222-2222-4222-8222-222222222222';
const artifactId = '99999999-9999-4999-8999-999999999999', jobId = '77777777-7777-4777-8777-777777777777';
const options = { secondaryDistanceMeters: 2, preferVerticalApproach: true };
function state(): PathFinderState {
  return { schemaVersion: 1, projectId, registryRevision: '3', activeModel: { modelVersionId: modelId, selectionRevision: '2', contentFingerprint: 'a'.repeat(64) },
    settings: { revision: '1', connectionGap: '1', secondaryTrayLength: '4', endConnectionLength: '2', additionalBendingPercent: '5' },
    artifacts: [{ id: artifactId, modelVersionId: modelId, snapshotSha256: 'a'.repeat(64), objectCount: 3, engineeringAccepted: false, readiness: 'unverified', capture: {}, coordinates: {}, createdAt: '2026-10-20T00:00:00Z' }],
    jobs: [], proposals: [], cables: [], locations: [] };
}
function preview(id = jobId, input?: PathFinderPreviewInput, current = state()): Preview {
  return { id, projectId, kind: 'preview', status: 'complete', total: 1, completed: 1, cancelRequested: false, createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-20T00:00:01Z', failure: null,
    input: { from: { name: 'FROM' }, to: { name: 'TO' }, category: 'LV', reverse: false, ...options, ...input, artifactId,
      expectedSelectionRevision: current.activeModel.selectionRevision, expectedSettingsRevision: current.settings.revision, expectedRegistryRevision: current.registryRevision },
    result: { status: 'calculated', message: 'Standalone route found.', prepared: {}, engineeringAccepted: false, acceptanceScope: 'standalone-preview', canApply: false, stale: false,
      design: { lengthBeforePercentageMeters: '20', unroundedLengthMeters: '21', designLengthMeters: '21' }, settings: current.settings, effectiveCategory: 'LV',
      from: { name: 'FROM', point: [1, 2, 3], source: 'manual-world-point', objectId: null, locationId: null, bindingRevision: null },
      to: { name: 'TO', point: [4, 5, 6], source: 'manual-world-point', objectId: null, locationId: null, bindingRevision: null },
      route: { success: true, message: 'Route found.', routeText: '/BC1', routeCodes: ['/BC1'], segmentIds: ['dbid:23'], objectIds: ['dbid:23'],
        points: [[1, 2, 3], [4, 5, 6]], lengthMeters: 18, fromDistanceMeters: 0, toDistanceMeters: 0, fromRequiresSecondary: false, toRequiresSecondary: false, connectionGapCount: 0, connectionGapLengthMeters: 0 } } };
}
function selection(objectId: number, name: string, point: [number, number, number]): ViewerSelection {
  return { coordinateFrame: 'world-metres-z-up', metresPerDisplayUnit: 1, globalOffsetMetres: [0, 0, 0], objects: [{ objectId, name, parentId: null, externalId: null,
    bounds: { minimum: point, maximum: point }, bottomCentre: point, derivation: 'display-aabb-bottom-centre', nativeVisibility: 'unknown', properties: [], propertiesTruncated: false }] };
}
function model() {
  return { data: state(), busy: false, viewerPhase: 'ready' as const, startPreview: vi.fn(async (_input: PathFinderPreviewInput) => jobId),
    readPreview: vi.fn(async (_id: string): Promise<Preview | null> => preview()), readSelection: vi.fn(async (): Promise<ViewerSelection | null> => null),
    showPath: vi.fn(async (_path: { pathId: string; points: number[][]; objectIds: number[] }) => 'displayed'), action: vi.fn() };
}
function mount(pf: ReturnType<typeof model>) {
  const callbacks = { claimViewer: vi.fn(() => () => true), onInputChange: vi.fn(), onEndpointNamesChange: vi.fn() };
  const component = (active = true, displayOwned = true) => <PathFinderPreview pf={pf as unknown as ReturnType<typeof usePathFinder>} active={active} displayOwned={displayOwned} options={options} {...callbacks} />;
  const view = render(component()); return { ...view, ...callbacks, rerenderContext: (active = true, displayOwned = true) => view.rerender(component(active, displayOwned)) };
}
function enterNames() {
  fireEvent.change(screen.getByLabelText('Path From location'), { target: { value: 'FROM' } });
  fireEvent.change(screen.getByLabelText('Path To location'), { target: { value: 'TO' } });
}
async function selectEndpoints(pf: ReturnType<typeof model>) {
  pf.readSelection.mockResolvedValueOnce(selection(44, 'FROM', [2, 3, 4])).mockResolvedValueOnce(selection(55, 'TO', [5, 6, 7]));
  fireEvent.click(screen.getByRole('button', { name: 'Use selection as From' })); await waitFor(() => expect(screen.getByLabelText('Path From location')).toHaveValue('FROM'));
  fireEvent.click(screen.getByRole('button', { name: 'Use selection as To' })); await waitFor(() => expect(screen.getByLabelText('Path To location')).toHaveValue('TO'));
}

describe('standalone path endpoint foreground', () => {
  it('includes verified From and To equipment in the exact route foreground without changing its points', async () => {
    const pf = model(), result = preview(); result.result!.route!.objectIds = ['dbid:23', 'dbid:44', 'dbid:23'];
    result.result!.from = { ...result.result!.from, source: 'equipment-bottom-aabb', objectId: 'dbid:44' };
    result.result!.to = { ...result.result!.to, source: 'equipment-bottom-aabb', objectId: 'dbid:55' };
    pf.readPreview.mockResolvedValue(result); mount(pf); enterNames(); fireEvent.click(screen.getByRole('button', { name: 'Calculate path' }));
    await waitFor(() => expect(pf.showPath).toHaveBeenCalledWith({ pathId: jobId, points: result.result!.route!.points, objectIds: [23, 44, 55] }));
    expect(pf.showPath.mock.calls[0][0].points).toBe(result.result!.route!.points);
  });

  it('retains selected SDK endpoint IDs for forward and Reverse display while keeping the calculation body unchanged', async () => {
    const pf = model(), reversedId = '88888888-8888-4888-8888-888888888888';
    pf.startPreview.mockResolvedValueOnce(jobId).mockResolvedValueOnce(reversedId);
    pf.readPreview.mockImplementation(async id => preview(id, pf.startPreview.mock.calls[id === jobId ? 0 : 1][0]));
    mount(pf); await selectEndpoints(pf); fireEvent.click(screen.getByRole('button', { name: 'Calculate path' }));
    await waitFor(() => expect(pf.showPath).toHaveBeenCalledTimes(1));
    expect(pf.startPreview.mock.calls[0][0]).toEqual({ from: { name: 'FROM', point: [2, 3, 4] }, to: { name: 'TO', point: [5, 6, 7] }, category: 'LV', reverse: false, ...options });
    expect(pf.showPath.mock.calls[0][0].objectIds).toEqual([23, 44, 55]);
    fireEvent.click(screen.getByRole('button', { name: 'Reverse path' })); await waitFor(() => expect(pf.showPath).toHaveBeenCalledTimes(2));
    expect(pf.showPath.mock.calls[1][0].objectIds).toEqual([23, 44, 55]);
    expect(pf.startPreview.mock.calls[1][0]).toEqual({ ...preview().input, from: { name: 'FROM', point: [2, 3, 4] }, to: { name: 'TO', point: [5, 6, 7] }, reverse: true });
  });

  it('drops selected object evidence when an endpoint name or coordinate is manually edited', async () => {
    const pf = model(); mount(pf); await selectEndpoints(pf);
    fireEvent.change(screen.getByLabelText('Path From location'), { target: { value: 'MANUAL FROM' } });
    fireEvent.change(screen.getByLabelText('Path To X in metres'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Calculate path' })); await waitFor(() => expect(pf.showPath).toHaveBeenCalledTimes(1));
    expect(pf.showPath.mock.calls[0][0].objectIds).toEqual([23]);
    expect(pf.startPreview.mock.calls[0][0].from).toEqual({ name: 'MANUAL FROM', point: [2, 3, 4] });
    expect(pf.startPreview.mock.calls[0][0].to).toEqual({ name: 'TO', point: [50, 6, 7] });
  });

  it('drops selected object evidence when the active model fingerprint or selection changes', async () => {
    const pf = model(), view = mount(pf); await selectEndpoints(pf);
    pf.data = { ...pf.data, activeModel: { ...pf.data.activeModel, selectionRevision: '4', contentFingerprint: 'b'.repeat(64) } }; view.rerenderContext();
    pf.readPreview.mockImplementation(async id => preview(id, pf.startPreview.mock.calls[0][0], pf.data));
    fireEvent.click(screen.getByRole('button', { name: 'Calculate path' })); await waitFor(() => expect(pf.showPath).toHaveBeenCalledTimes(1));
    expect(pf.showPath.mock.calls[0][0].objectIds).toEqual([23]);
  });

  it('does not infer equipment from manually entered world coordinates', async () => {
    const pf = model(); mount(pf); enterNames();
    for (const side of ['From', 'To']) for (const [index, axis] of ['X', 'Y', 'Z'].entries()) fireEvent.change(screen.getByLabelText(`Path ${side} ${axis} in metres`), { target: { value: String(index + 1) } });
    fireEvent.click(screen.getByRole('button', { name: 'Calculate path' })); await waitFor(() => expect(pf.showPath).toHaveBeenCalledTimes(1));
    expect(pf.showPath.mock.calls[0][0].objectIds).toEqual([23]); expect(pf.readSelection).not.toHaveBeenCalled();
  });

  it('does not redisplay a late result after Clear relinquishes viewer ownership', async () => {
    const pf = model(); let resolve!: (value: Preview) => void;
    pf.readPreview.mockImplementation(() => new Promise<Preview>(done => { resolve = done; }));
    const view = mount(pf); enterNames(); fireEvent.click(screen.getByRole('button', { name: 'Calculate path' })); await waitFor(() => expect(pf.readPreview).toHaveBeenCalledTimes(1));
    view.rerenderContext(true, false); await act(async () => { resolve(preview()); });
    expect(pf.showPath).not.toHaveBeenCalled(); expect(screen.queryByTestId('pathfinder-preview')).not.toBeInTheDocument();
  });

  it('rejects a response for a different job instead of borrowing the current selection evidence', async () => {
    const pf = model(); pf.readPreview.mockResolvedValue(preview('88888888-8888-4888-8888-888888888888')); mount(pf); await selectEndpoints(pf);
    fireEvent.click(screen.getByRole('button', { name: 'Calculate path' })); await screen.findByText('The path preview could not be read. Refresh access and calculate again.');
    expect(pf.showPath).not.toHaveBeenCalled();
  });

  it('retains the complete result without truncating foreground IDs beyond the protected bridge budget', async () => {
    const pf = model(), result = preview(); result.result!.route!.objectIds = Array.from({ length: 512 }, (_, index) => `dbid:${index + 1}`);
    result.result!.to = { ...result.result!.to, source: 'equipment-bottom-aabb', objectId: 'dbid:600' }; pf.readPreview.mockResolvedValue(result);
    mount(pf); enterNames(); fireEvent.click(screen.getByRole('button', { name: 'Calculate path' }));
    await screen.findByText('The exact path exceeds the viewer object budget. Its result is retained without truncation.');
    expect(pf.showPath).not.toHaveBeenCalled(); expect(screen.getByTestId('pathfinder-preview')).toHaveAttribute('data-state', 'complete');
  });
});
