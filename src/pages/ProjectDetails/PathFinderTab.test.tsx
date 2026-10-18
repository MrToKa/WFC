import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PathFinderTab } from './PathFinderTab';
import { usePathFinder } from './hooks/usePathFinder';
import type { PathFinderLookup, PathFinderProposal, PathFinderState } from '@/api/pathfinder';

vi.mock('./hooks/usePathFinder', () => ({ usePathFinder: vi.fn() }));
vi.mock('./hooks/useRoutingsViewerHeight', () => ({ useRoutingsViewerHeight: () => 720 }));
const projectId = '11111111-1111-4111-8111-111111111111', modelId = '22222222-2222-4222-8222-222222222222', locationId = '33333333-3333-4333-8333-333333333333';
function model() {
  const matched = { status: 'matched' as const, locationId, candidates: [locationId] }, missing = { status: 'missing' as const, locationId: null, candidates: [] };
  return { loading: false, busy: false, error: null, viewerPhase: 'ready' as const, viewerMessage: 'The active model is ready.',
    data: { schemaVersion: 1 as const, projectId, registryRevision: '3', activeModel: { modelVersionId: modelId, selectionRevision: '2', contentFingerprint: 'a'.repeat(64) },
      settings: { connectionGap: '1', secondaryTrayLength: '4', endConnectionLength: '2', additionalBendingPercent: '5' }, artifacts: [], jobs: [], proposals: [],
      cables: [{ id: '44444444-4444-4444-8444-444444444444', cableId: 1, tag: '=CABLE-1', fromLocation: 'EQ-001', toLocation: 'EQ-002', mto: 'Control', routing: null, designLength: null, installLength: 123, cableWriteRevision: '0', fromMatch: matched, toMatch: missing },
        { id: '55555555-5555-4555-8555-555555555555', cableId: 2, tag: '=CABLE-2', fromLocation: 'EQ-002', toLocation: 'EQ-001', mto: 'Instrumentation', routing: null, designLength: null, installLength: null, cableWriteRevision: '0', fromMatch: missing, toMatch: matched }],
      locations: [{ id: locationId, name: 'EQ-001', aliases: ['Equipment A'], revision: '1', binding: { modelVersionId: modelId, revision: '1', point: [1, 2, 3] as [number, number, number], objectId: 'dbid:23', externalId: 'ext-23', source: 'manual' as const, status: 'confirmed' as const } }] },
    refresh: vi.fn(), reloadViewer: vi.fn(), action: vi.fn(async () => null), matchAll: vi.fn(async () => null), calculate: vi.fn(async () => null), readProposal: vi.fn(async () => null), readJob: vi.fn(async () => null), reviewProposal: vi.fn(async () => null), prepareModel: vi.fn(async () => null), startLookup: vi.fn(async () => null), readLookup: vi.fn(async () => null), saveLocation: vi.fn(async () => ({ locationId, registryRevision: '4' })), uploadSnapshot: vi.fn(async () => null),
    pickPoint: vi.fn(async () => ({ objectId: 44, point: [4.5, -6, 7] as [number, number, number], derivation: 'picked-surface-point' as const })), cancelPicking: vi.fn(), readObjects: vi.fn(async () => null), showPath: vi.fn(async () => null), clear: vi.fn(), zoom: vi.fn() };
}
let pf: ReturnType<typeof model>;
beforeEach(() => { vi.clearAllMocks(); pf = model(); vi.mocked(usePathFinder).mockReturnValue(pf); });
const mount = (isAdmin = true) => render(<PathFinderTab projectId={projectId} loadedProjectId={projectId} token="isolated-test-token" isAdmin={isAdmin} />);
function proposal(synthetic: boolean): PathFinderProposal { return {
  id: '66666666-6666-4666-8666-666666666666', projectId, jobId: '77777777-7777-4777-8777-777777777777', cableId: pf.data.cables[0].id,
  status: 'calculated', proposalHash: 'f'.repeat(64), cableWriteRevision: '0', stale: false, synthetic, engineeringAccepted: synthetic, acceptanceScope: synthetic ? 'local-synthetic-fixture' : 'unaccepted-model', canApply: synthetic,
  compatibilityIssue: null, message: 'Route calculated.', engineeringMessage: synthetic ? 'Synthetic local demonstration only.' : 'Native engineering verification is pending.', createdAt: '2026-10-18T00:00:00Z',
  design: { lengthBeforePercentageMeters: '20', unroundedLengthMeters: '21', designLengthMeters: '21' },
  route: { success: true, message: 'Route found.', routeText: '/BC1', routeCodes: ['/BC1'], segmentIds: ['dbid:23'], objectIds: ['dbid:23'], points: [[1, 2, 3], [4, 5, 6]], lengthMeters: 18, fromDistanceMeters: 0, toDistanceMeters: 0, fromRequiresSecondary: false, toRequiresSecondary: false, connectionGapCount: 0, connectionGapLengthMeters: 0 },
}; }
const artifact = (): PathFinderState['artifacts'][number] => ({ id: '99999999-9999-4999-8999-999999999999', modelVersionId: modelId, snapshotSha256: 'a'.repeat(64), objectCount: 2, engineeringAccepted: false, readiness: 'unverified', capture: {}, coordinates: {}, createdAt: '2026-10-18T00:00:00Z' });
function lookup(id: string, reverse = false): PathFinderLookup { return { id, projectId, kind: 'lookup', status: 'complete', total: 1, completed: 1, createdAt: '2026-10-18T00:00:00Z', updatedAt: '2026-10-18T00:00:01Z', failure: null, input: { routeText: '/BC1/BC2', reverse },
  result: { status: 'calculated', message: 'Diagnostic lookup complete.', prepared: {}, engineeringAccepted: false, acceptanceScope: 'diagnostic-lookup', stale: false, design: null, route: { ...proposal(false).route!, routeText: reverse ? '/BC2/BC1' : '/BC1/BC2', points: reverse ? [[4, 5, 6], [1, 2, 3]] : [[1, 2, 3], [4, 5, 6]] } } }; }

describe('admin PathFinder interface', () => {
  it('does not mount any hook or protected frame when administrator access is absent', () => {
    mount(false); expect(screen.getByText('PathFinder is available only to administrators.')).toBeVisible();
    expect(usePathFinder).not.toHaveBeenCalled(); expect(screen.queryByTestId('pathfinder-model-host')).toBeNull();
  });
  it('resolves either cable endpoint using the same saved project location and preserves install length', async () => {
    const user = userEvent.setup(); mount();
    await user.click(screen.getByRole('button', { name: /=CABLE-2/ })); await user.click(screen.getByRole('button', { name: 'Resolve To' }));
    expect(screen.getByRole('textbox', { name: 'Location name' })).toHaveValue('EQ-001'); expect(screen.getByRole('textbox', { name: 'Location X in metres' })).toHaveValue('1');
    await user.click(screen.getByRole('button', { name: 'Save shared location' }));
    expect(pf.saveLocation).toHaveBeenCalledWith({ locationId, name: 'EQ-001', aliases: ['Equipment A'], point: [1, 2, 3], objectId: 'dbid:23', externalId: 'ext-23', derivation: 'manual-world-point' });
    expect(await screen.findByText('Shared location saved. 2 cables can reuse this location at either endpoint.')).toBeVisible();
    expect(pf.data.cables[0].installLength).toBe(123);
  });
  it('requires explicit finite coordinates for a missing endpoint and keeps a pick uncommitted until Save', async () => {
    const user = userEvent.setup(); mount();
    await user.click(screen.getByRole('button', { name: /=CABLE-1/ })); await user.click(screen.getByRole('button', { name: 'Resolve To' }));
    expect(screen.getByRole('textbox', { name: 'Location name' })).toHaveValue('EQ-002'); expect(screen.getByRole('button', { name: 'Save shared location' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Pick point in model' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Location X in metres' })).toHaveValue('4.5'));
    expect(pf.saveLocation).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save shared location' }));
    expect(pf.saveLocation).toHaveBeenCalledWith({ locationId: null, name: 'EQ-002', aliases: [], point: [4.5, -6, 7], objectId: 'dbid:44', externalId: null, derivation: 'picked-surface-point' });
  });
  it('manual point edits remove picked object evidence and invalid numbers cannot be saved', async () => {
    const user = userEvent.setup(); mount();
    await user.click(screen.getByRole('button', { name: /=CABLE-1/ })); await user.click(screen.getByRole('button', { name: 'Resolve From' }));
    const x = screen.getByRole('textbox', { name: 'Location X in metres' }); await user.clear(x); await user.type(x, 'Infinity');
    expect(screen.getByRole('button', { name: 'Save shared location' })).toBeDisabled(); await user.clear(x); await user.type(x, '1.25');
    await user.click(screen.getByRole('button', { name: 'Save shared location' })); expect(pf.saveLocation).toHaveBeenCalledWith(expect.objectContaining({ point: [1.25, 2, 3], objectId: null, externalId: null }));
  });
  it('can save a picked point explicitly as coordinates when its object is outside the prepared snapshot', async () => {
    const user = userEvent.setup(); mount();
    await user.click(screen.getByRole('button', { name: /=CABLE-1/ })); await user.click(screen.getByRole('button', { name: 'Resolve To' }));
    await user.click(screen.getByRole('button', { name: 'Pick point in model' })); await screen.findByRole('button', { name: 'Use as manual coordinates' });
    await user.click(screen.getByRole('button', { name: 'Use as manual coordinates' })); await user.click(screen.getByRole('button', { name: 'Save shared location' }));
    expect(pf.saveLocation).toHaveBeenCalledWith(expect.objectContaining({ point: [4.5, -6, 7], objectId: null, externalId: null, derivation: 'picked-surface-point' }));
  });
  it('prepares selected protected geometry only after explicit category selection and retains endpoint names', async () => {
    const user = userEvent.setup(); mount();
    await user.click(screen.getByRole('button', { name: /=CABLE-1/ })); await user.type(screen.getByRole('textbox', { name: 'Routing network codes' }), '/BC1/SECONDARY/BC2');
    expect(screen.getByRole('button', { name: 'Prepare selected model network' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Control (including Instrumentation)' }));
    await user.click(screen.getByRole('button', { name: 'Prepare selected model network' }));
    expect(pf.prepareModel).toHaveBeenCalledWith({ routeCodes: ['BC1', 'BC2'], allowedCategories: ['Control'], equipmentNames: ['EQ-001', 'EQ-002'] });
  });
  it('displays exact calculated points and requires review before an explicit synthetic Apply', async () => {
    const user = userEvent.setup(), detail = proposal(true), reviewId = '88888888-8888-4888-8888-888888888888';
    const action = vi.fn(async () => ({ receipt: {}, duplicate: false }));
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, data: { ...pf.data, proposals: [detail] }, readProposal: vi.fn(async () => detail), showPath: vi.fn(async () => 'display-request'), reviewProposal: vi.fn(async () => ({ reviewId, proposal: detail })), action });
    mount(); await user.click(screen.getByRole('button', { name: /=CABLE-1 — Ready for review/ }));
    expect(await screen.findByText('Design length: 21 m')).toBeVisible(); expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Confirm proposal review' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Apply reviewed result' }));
    expect(action).toHaveBeenCalledWith(`/proposals/${detail.id}/apply`, { reviewId, idempotencyKey: expect.any(String), expectedCableWriteRevision: '0' });
    expect(await screen.findByText('Routing and design length applied together. Installed length was preserved.')).toBeVisible();
  });
  it('keeps server-ineligible real results disabled for review and Apply', async () => {
    const user = userEvent.setup(), detail = proposal(false);
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, data: { ...pf.data, proposals: [detail] }, readProposal: vi.fn(async () => detail), showPath: vi.fn(async () => 'display-request'), reviewProposal: vi.fn(async () => ({ reviewId: '88888888-8888-4888-8888-888888888888', proposal: detail })) });
    mount(); await user.click(screen.getByRole('button', { name: /=CABLE-1 — Ready for review/ })); await screen.findByText('Design length: 21 m');
    expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeDisabled(); expect(pf.action).not.toHaveBeenCalled();
  });
  it('does not offer review for a visible successful route whose required design settings are missing', async () => {
    const user = userEvent.setup(), detail = { ...proposal(false), status: 'settings_required', acceptanceScope: 'manual-review', design: null, canApply: false, message: 'Set the SECONDARY allowance in Project Details.' };
    const reviewProposal = vi.fn(async () => null), showPath = vi.fn(async () => 'complete-path-ack');
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, data: { ...pf.data, proposals: [detail] }, readProposal: vi.fn(async () => detail), showPath, reviewProposal });
    mount(); await user.click(screen.getByRole('button', { name: /=CABLE-1 — Project values required/ })); await screen.findByText('Geometric length: 18 m'); await waitFor(() => expect(showPath).toHaveBeenCalled());
    expect(screen.getByText('Set the SECONDARY allowance in Project Details.')).toBeVisible(); expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeDisabled(); expect(reviewProposal).not.toHaveBeenCalled();
  });
  it('applies an eligible manually reviewed real result without claiming native engineering acceptance', async () => {
    const user = userEvent.setup(), detail = { ...proposal(false), acceptanceScope: 'manual-review', canApply: true, engineeringMessage: 'Review the route and length before applying.' }, reviewId = '88888888-8888-4888-8888-888888888888';
    const action = vi.fn(async () => ({ receipt: {}, duplicate: false }));
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, data: { ...pf.data, proposals: [detail] }, readProposal: vi.fn(async () => detail), showPath: vi.fn(async () => 'display-request'), reviewProposal: vi.fn(async () => ({ reviewId, proposal: detail })), action });
    mount(); await user.click(screen.getByRole('button', { name: /=CABLE-1 — Ready for review/ })); await screen.findByText('Design length: 21 m');
    expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeDisabled(); expect(screen.getByText('Review the route and length before applying.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Confirm proposal review' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Apply reviewed result' })); expect(action).toHaveBeenCalledWith(`/proposals/${detail.id}/apply`, { reviewId, idempotencyKey: expect.any(String), expectedCableWriteRevision: '0' }); expect(detail.engineeringAccepted).toBe(false); expect(detail.synthetic).toBe(false);
  });
  it('invalidates manual review when the authoritative project gap changes', async () => {
    const user = userEvent.setup(), detail = { ...proposal(false), acceptanceScope: 'manual-review', canApply: true }, reviewId = '88888888-8888-4888-8888-888888888888';
    const current = { ...pf, data: { ...pf.data, proposals: [detail] }, readProposal: vi.fn(async () => detail), showPath: vi.fn(async () => 'display-request'), reviewProposal: vi.fn(async () => ({ reviewId, proposal: detail })) };
    vi.mocked(usePathFinder).mockReturnValue(current); const view = mount(); await user.click(screen.getByRole('button', { name: /=CABLE-1 — Ready for review/ })); await screen.findByText('Design length: 21 m'); await user.click(screen.getByRole('button', { name: 'Confirm proposal review' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeEnabled());
    vi.mocked(usePathFinder).mockReturnValue({ ...current, data: { ...current.data, settings: { ...current.data.settings, connectionGap: '2' }, proposals: [{ ...detail, stale: true, canApply: false }] } });
    view.rerender(<PathFinderTab projectId={projectId} loadedProjectId={projectId} token="isolated-test-token" isAdmin />);
    expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeDisabled(); expect(screen.getByText('This result is outdated. Calculate a new proposal before reviewing or applying it.')).toBeVisible(); expect(pf.action).not.toHaveBeenCalled();
  });
  it('shows path loading and enables proposal review only after the protected display acknowledgement', async () => {
    const user = userEvent.setup(), detail = proposal(true); let acknowledge!: (requestId: string) => void;
    const showPath = vi.fn(() => new Promise<string>(resolve => { acknowledge = resolve; }));
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, data: { ...pf.data, proposals: [detail] }, readProposal: vi.fn(async () => detail), showPath }); mount();
    await user.click(screen.getByRole('button', { name: /=CABLE-1 — Ready for review/ }));
    expect(await screen.findByText('Loading the exact computed path…')).toBeVisible(); expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled();
    await act(async () => acknowledge('protected-display-ack'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeEnabled()); expect(screen.queryByText('Loading the exact computed path…')).toBeNull();
  });
  it('reviews a native-shaped zero-length proposal using its one exact point and unchanged design values', async () => {
    const user = userEvent.setup(), detail = proposal(true); detail.route = { ...detail.route!, points: [[1, 0, 0.5]], lengthMeters: 0 }; detail.design = { lengthBeforePercentageMeters: '6', unroundedLengthMeters: '6.6', designLengthMeters: '7' };
    const showPath = vi.fn(async () => 'zero-length-marker-ack'); vi.mocked(usePathFinder).mockReturnValue({ ...pf, data: { ...pf.data, proposals: [detail] }, readProposal: vi.fn(async () => detail), showPath }); mount();
    await user.click(screen.getByRole('button', { name: /=CABLE-1 — Ready for review/ }));
    expect(await screen.findByText('Geometric length: 0 m')).toBeVisible(); expect(screen.getByText('Design length: 7 m')).toBeVisible();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeEnabled());
    expect(showPath).toHaveBeenCalledWith({ pathId: detail.id, points: [[1, 0, 0.5]], objectIds: [23] });
  });
  it('links blank endpoints to existing cable editing without inventing location names', async () => {
    const user = userEvent.setup(); vi.mocked(usePathFinder).mockReturnValue({ ...pf, data: { ...pf.data, cables: [{ ...pf.data.cables[0], fromLocation: null, toLocation: '' }] } }); mount();
    await user.click(screen.getByRole('button', { name: /=CABLE-1/ }));
    expect(screen.getByRole('link', { name: 'Edit cable endpoints' })).toHaveAttribute('href', `/projects/${projectId}/cables/${pf.data.cables[0].id}`);
    expect(screen.getByRole('button', { name: 'Resolve From' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Resolve To' })).toBeDisabled();
  });
  it('keeps automatic proposals enabled and forces only explicit calculation retries', async () => {
    const user = userEvent.setup(), matched = pf.data.cables[0].fromMatch;
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, data: { ...pf.data, artifacts: [artifact()], cables: [{ ...pf.data.cables[0], toMatch: matched }] } }); mount();
    await waitFor(() => expect(pf.calculate).toHaveBeenCalledWith()); expect(screen.queryByRole('checkbox', { name: 'Automatically calculate ready cables' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Calculate all cables' })); expect(pf.calculate).toHaveBeenLastCalledWith(undefined, true);
    await user.click(screen.getByRole('button', { name: /=CABLE-1/ })); await user.click(screen.getByRole('button', { name: 'Calculate selected cable' })); expect(pf.calculate).toHaveBeenLastCalledWith([pf.data.cables[0].id], true);
  });
  it('previews exact ordered lookup and reverse with unchanged cable labels and the read-only project gap', async () => {
    const user = userEvent.setup(), forwardId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', reverseId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const startLookup = vi.fn().mockResolvedValueOnce(forwardId).mockResolvedValueOnce(reverseId), readLookup = vi.fn().mockImplementation(async (id: string) => lookup(id, id === reverseId)), showPath = vi.fn(async () => 'displayed');
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, data: { ...pf.data, artifacts: [artifact()] }, startLookup, readLookup, showPath }); mount();
    await user.click(screen.getByRole('button', { name: /=CABLE-1/ })); await user.click(screen.getByText('Manual ordered lookup and reverse preview'));
    await user.type(screen.getByRole('textbox', { name: 'PathFinder ordered route' }), '/BC1/BC2'); expect(screen.queryByRole('spinbutton', { name: 'Lookup connection tolerance in metres' })).toBeNull(); expect(screen.getByText('Connection gap: 1 m. Change this in Project Details. Larger values permit larger unmodelled gaps.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Run ordered lookup' })); await screen.findByText('Lookup complete — forward preview');
    expect(startLookup).toHaveBeenNthCalledWith(1, '/BC1/BC2', false); await waitFor(() => expect(showPath).toHaveBeenCalledWith({ pathId: forwardId, points: [[1, 2, 3], [4, 5, 6]], objectIds: [23] }));
    await user.click(screen.getByRole('button', { name: 'Reverse preview' })); await screen.findByText('Lookup complete — reverse preview');
    expect(startLookup).toHaveBeenNthCalledWith(2, '/BC1/BC2', true); await waitFor(() => expect(showPath).toHaveBeenLastCalledWith({ pathId: reverseId, points: [[4, 5, 6], [1, 2, 3]], objectIds: [23] }));
    expect(screen.getByText(/Original cable labels: From EQ-001; To EQ-002/)).toBeVisible(); expect(within(screen.getByRole('region', { name: 'Ordered lookup result' })).queryByRole('button', { name: /Apply/ })).toBeNull(); expect(pf.action).not.toHaveBeenCalled();
  });
  it('retains an outdated lookup without displaying its stale points', async () => {
    const user = userEvent.setup(), id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', detail = lookup(id); detail.result!.stale = true;
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, data: { ...pf.data, artifacts: [artifact()] }, startLookup: vi.fn(async () => id), readLookup: vi.fn(async () => detail) }); mount();
    await user.click(screen.getByText('Manual ordered lookup and reverse preview')); await user.type(screen.getByRole('textbox', { name: 'PathFinder ordered route' }), '/BC1/BC2'); await user.click(screen.getByRole('button', { name: 'Run ordered lookup' }));
    expect(await screen.findByText('The active model or lookup dependencies changed. Run a fresh lookup before displaying it.')).toBeVisible(); expect(pf.showPath).not.toHaveBeenCalled();
  });
});
