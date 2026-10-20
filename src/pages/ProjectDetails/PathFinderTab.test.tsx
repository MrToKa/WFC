import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PathFinderTab } from './PathFinderTab';
import { usePathFinder } from './hooks/usePathFinder';
import type { PathFinderLookup, PathFinderProposal, PathFinderPreview, PathFinderState } from '@/api/pathfinder';
import type { ViewerModelObject } from '../../../viewer-runtime/protocol.mjs';
import { fetchEndpointBinding, fetchEndpointBindingHistory, saveEndpointBinding } from '@/api/pathfinderEndpointBindings';
import { endpointBindingFixture } from '@/test/endpointBindingFixtures';
import { PENDING_APPLY_STORAGE_KEY } from './hooks/usePathfinderPendingApply';
import { calculationAvailabilitySchema, type CalculationAvailability } from '../../../shared/pathfinderCalculationAvailability';
vi.mock('@/api/pathfinderEndpointBindings', async original => ({ ...await original<typeof import('@/api/pathfinderEndpointBindings')>(), fetchEndpointBinding: vi.fn(), fetchEndpointBindingHistory: vi.fn(), saveEndpointBinding: vi.fn() }));

vi.mock('./hooks/usePathFinder', () => ({ usePathFinder: vi.fn() }));
vi.mock('./hooks/useRoutingsViewerHeight', () => ({ useRoutingsViewerHeight: () => 720 }));
// These network panels have dedicated contract/authority tests. This suite owns
// Tab tool composition and the real pending-Apply hook, not incidental reads.
vi.mock('./PathFinderCalculationGrantPanel', () => ({ PathFinderCalculationGrantPanel: () => null }));
vi.mock('./PathFinderRecalculationPanel', () => ({ PathFinderRecalculationPanel: () => null }));
vi.mock('./PathFinderRevisionResults', () => ({ PathFinderRevisionResults: () => null }));
vi.mock('./ProjectPreparationPanel', () => ({ ProjectPreparationPanel: () => null }));
const projectId = '11111111-1111-4111-8111-111111111111', modelId = '22222222-2222-4222-8222-222222222222', locationId = '33333333-3333-4333-8333-333333333333';
const accountId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function model() {
  const action = vi.fn(async () => null);
  const matched = { status: 'matched' as const, locationId, candidates: [locationId] }, missing = { status: 'missing' as const, locationId: null, candidates: [] };
  return { preparationAccess: {projectId:null,loadedProjectId:null,token:null,isAdmin:false}, preparationViewerGeneration:0, runProjectPreparation:vi.fn(async()=>{throw new Error('Not part of this diagnostic fixture');}), loading: false, busy: false, error: null, viewerPhase: 'ready' as const, viewerMessage: 'The active model is ready.',
    data: { schemaVersion: 1 as const, projectId, registryRevision: '3', activeModel: { modelVersionId: modelId, selectionRevision: '2', contentFingerprint: 'a'.repeat(64) },
      settings: { revision: '1', connectionGap: '1', secondaryTrayLength: '4', endConnectionLength: '2', additionalBendingPercent: '5' }, artifacts: [], jobs: [], proposals: [],
      cables: [{ id: '44444444-4444-4444-8444-444444444444', cableId: 1, tag: '=CABLE-1', fromLocation: 'EQ-001', toLocation: 'EQ-002', mto: 'Control', routing: null, designLength: null, installLength: 123, cableWriteRevision: '0', fromMatch: matched, toMatch: missing },
        { id: '55555555-5555-4555-8555-555555555555', cableId: 2, tag: '=CABLE-2', fromLocation: 'EQ-002', toLocation: 'EQ-001', mto: 'Instrumentation', routing: null, designLength: null, installLength: null, cableWriteRevision: '0', fromMatch: missing, toMatch: matched }],
      locations: [{ id: locationId, name: 'EQ-001', aliases: ['Equipment A'], revision: '1', binding: { modelVersionId: modelId, revision: '1', point: [1, 2, 3] as [number, number, number], objectId: 'dbid:23', externalId: 'ext-23', source: 'manual' as const, status: 'confirmed' as const } }] },
    refresh: vi.fn(), reloadViewer: vi.fn(), action, actionWithoutRefresh: action, matchAll: vi.fn(async () => null), calculate: vi.fn(async () => null), readProposal: vi.fn(async () => null), readJob: vi.fn(async () => null), reviewProposal: vi.fn(async () => null), prepareModel: vi.fn(async () => null), startLookup: vi.fn(async () => null), readLookup: vi.fn(async () => null), startPreview: vi.fn(async () => null), readPreview: vi.fn(async () => null), saveLocation: vi.fn(async () => ({ locationId, registryRevision: '4' })), uploadSnapshot: vi.fn(async () => null),
    pickPoint: vi.fn(async () => ({ objectId: 44, point: [4.5, -6, 7] as [number, number, number], derivation: 'picked-surface-point' as const })), cancelPicking: vi.fn(), cancelOperation: vi.fn(), readObjects: vi.fn(async () => null), readSelection: vi.fn(async () => ({ coordinateFrame: 'world-metres-z-up' as const, metresPerDisplayUnit: 1, globalOffsetMetres: [0, 0, 0] as [number, number, number], objects: [viewerObject(44, 'Tray group A')] })), setPathTransparency: vi.fn(async () => undefined), showPath: vi.fn(async () => null), clear: vi.fn(), zoom: vi.fn() };
}
function viewerObject(objectId: number, name: string): ViewerModelObject { return { objectId, name, parentId: null, externalId: null, bounds: { minimum: [1, 2, 3], maximum: [3, 4, 5] }, bottomCentre: [2, 3, 3], derivation: 'display-aabb-bottom-centre', nativeVisibility: 'unknown', properties: [], propertiesTruncated: false }; }
let pf: ReturnType<typeof model>;
function proposalModel() { return { ...pf, preparationAccess: { projectId, loadedProjectId: projectId, token: 'isolated-test-token', isAdmin: true } }; }
beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); pf = model(); vi.mocked(usePathFinder).mockReturnValue(pf);
  vi.mocked(fetchEndpointBinding).mockImplementation(async (_project, _token, selectedId) => {
    const f = endpointBindingFixture(), existing = selectedId === locationId;
    return { ...f.context, projectId, locationId: selectedId, current: { ...f.context.current!, modelVersionId: modelId, traceId: null }, location: existing ? { id: locationId, name: 'EQ-001', aliases: ['Equipment A'], revision: '1' } : null, head: existing ? { ...f.binding, projectId, locationId, modelVersionId: modelId, pointProjectMetres: [1, 2, 3] } : null, usage: { fromOccurrences: 1, toOccurrences: 1, distinctCables: 2 } };
  });
  vi.mocked(fetchEndpointBindingHistory).mockResolvedValue({ schemaVersion: 'wfc.pf.endpoint-binding-history.v1', projectId, locationId, bindings: [], nextBeforeRevision: null });
  vi.mocked(saveEndpointBinding).mockImplementation(async (_project, _token, selectedId) => { const f = endpointBindingFixture(); return { ...f.receipt, projectId, locationId: selectedId, binding: { ...f.binding, projectId, locationId: selectedId } }; });
});
const mount = (isAdmin = true) => { const view = render(<PathFinderTab projectId={projectId} loadedProjectId={projectId} token="isolated-test-token" accountId={accountId} isAdmin={isAdmin} />); if (isAdmin) fireEvent.click(screen.getByRole('button', {name:'Manual diagnostic capture',hidden:true})); return view; };
function proposal(synthetic: boolean): PathFinderProposal { return {
  id: '66666666-6666-4666-8666-666666666666', projectId, jobId: '77777777-7777-4777-8777-777777777777', cableId: pf.data.cables[0].id,
  status: 'calculated', proposalHash: 'f'.repeat(64), revisionResultHash: 'e'.repeat(64), revisionBaselineHash: 'd'.repeat(64), cableWriteRevision: '0', stale: false, synthetic, engineeringAccepted: synthetic, acceptanceScope: synthetic ? 'local-synthetic-fixture' : 'unaccepted-model', canApply: synthetic,
  compatibilityIssue: null, routingPreferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true }, message: 'Route calculated.', engineeringMessage: synthetic ? 'Synthetic local demonstration only.' : 'Native engineering verification is pending.', createdAt: '2026-10-18T00:00:00Z',
  design: { lengthBeforePercentageMeters: '20', unroundedLengthMeters: '21', designLengthMeters: '21' },
  route: { success: true, message: 'Route found.', routeText: '/BC1', routeCodes: ['/BC1'], segmentIds: ['dbid:23'], objectIds: ['dbid:23'], points: [[1, 2, 3], [4, 5, 6]], lengthMeters: 18, fromDistanceMeters: 0, toDistanceMeters: 0, fromRequiresSecondary: false, toRequiresSecondary: false, connectionGapCount: 0, connectionGapLengthMeters: 0 },
}; }
function applyReceipt(detail: PathFinderProposal, reviewId: string) {
  return { duplicate: false, receipt: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', projectId, proposalId: detail.id, cableId: detail.cableId,
    appliedAt: '2026-10-19T14:00:00Z',
    before: { id: detail.cableId, project_id: projectId, cable_write_revision: detail.cableWriteRevision, routing: null, design_length: null, install_length: '123' },
    after: { id: detail.cableId, project_id: projectId, cable_write_revision: (BigInt(detail.cableWriteRevision) + 1n).toString(),
      routing: detail.route!.routeText, design_length: detail.design!.designLengthMeters, install_length: '123' },
    provenance: { schemaVersion: 'pathfinder.apply.v2', proposalId: detail.id, proposalHash: detail.proposalHash, reviewId,
      nativeParity: 'not-performed', acceptanceScope: detail.acceptanceScope,
      review: { id: reviewId, actorId: accountId, reviewedAt: '2026-10-19T13:59:00Z' },
      revisionResult: { revisionResultSha256: detail.revisionResultHash!, baselineHash: detail.revisionBaselineHash! } } } };
}
const artifact = (): PathFinderState['artifacts'][number] => ({ id: '99999999-9999-4999-8999-999999999999', modelVersionId: modelId, snapshotSha256: 'a'.repeat(64), objectCount: 2, engineeringAccepted: false, readiness: 'unverified', capture: {}, coordinates: {}, createdAt: '2026-10-18T00:00:00Z' });
function lookup(id: string, reverse = false): PathFinderLookup { return { id, projectId, kind: 'lookup', status: 'complete', total: 1, completed: 1, createdAt: '2026-10-18T00:00:00Z', updatedAt: '2026-10-18T00:00:01Z', failure: null, input: { routeText: '/BC1/BC2', reverse },
  result: { status: 'calculated', message: 'Diagnostic lookup complete.', prepared: {}, connectionGap: '1', diagnostics: { geometryLeavesUsed: 2, fallbackBends: 0, fallbackStraights: 0, fallbackClearances: 0 }, engineeringAccepted: false, acceptanceScope: 'diagnostic-lookup', stale: false, design: null, route: { ...proposal(false).route!, routeText: reverse ? '/BC2/BC1' : '/BC1/BC2', points: reverse ? [[4, 5, 6], [1, 2, 3]] : [[1, 2, 3], [4, 5, 6]] } } }; }
function preview(id: string, reverse = false): PathFinderPreview { return { id, projectId, kind: 'preview', status: 'complete', total: 1, completed: 1, cancelRequested: false, createdAt: '2026-10-18T00:00:00Z', updatedAt: '2026-10-18T00:00:01Z', failure: null,
  input: { from: { name: 'EQ-001' }, to: { name: 'EQ-002' }, category: 'LV', reverse, secondaryDistanceMeters: 2, preferVerticalApproach: true, artifactId: artifact().id, expectedSelectionRevision: '2', expectedSettingsRevision: '1', expectedRegistryRevision: '3' },
  result: { status: 'calculated', message: 'Standalone route found.', prepared: {}, engineeringAccepted: false, acceptanceScope: 'standalone-preview', canApply: false, stale: false, design: proposal(false).design, settings: pf.data.settings, effectiveCategory: 'LV',
    from: { name: reverse ? 'EQ-002' : 'EQ-001', point: [1, 2, 3], source: 'shared-location', objectId: null, locationId, bindingRevision: '1' }, to: { name: reverse ? 'EQ-001' : 'EQ-002', point: [4, 5, 6], source: 'shared-location', objectId: null, locationId, bindingRevision: '1' }, route: { ...proposal(false).route!, points: reverse ? [[4, 5, 6], [1, 2, 3]] : [[1, 2, 3], [4, 5, 6]] } } }; }

// Fluent's expanded sidebar makes jsdom role/style queries expensive; assertions still use their normal wait budgets.
describe('admin PathFinder interface', { timeout: 60_000 }, () => {
  it('shows automatic point availability independently of saved bindings and filters only missing calculation points', async () => {
    const user = userEvent.setup(), automaticId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const confirmed = calculationAvailabilitySchema.parse({ status: 'confirmed-ready', pointAvailable: true, source: 'confirmed-shared-location', approximate: false, candidateObjectIds: [], reasonCode: null, engineeringAccepted: false });
    const automatic = calculationAvailabilitySchema.parse({ status: 'automatic-ready', pointAvailable: true, source: 'automatic-model-candidate', approximate: true, candidateObjectIds: ['dbid:44'], reasonCode: null, engineeringAccepted: false });
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, data: { ...pf.data,
      locations: [{ ...pf.data.locations[0], calculationAvailability: confirmed }, { id: automaticId, name: 'EQ-002', aliases: [], revision: '1', binding: null, calculationAvailability: automatic }],
      cables: [{ ...pf.data.cables[0], toMatch: { status: 'missing', locationId: automaticId, candidates: [] } }, pf.data.cables[1]],
    } }); mount();
    await user.click(screen.getByRole('button', { name: /=CABLE-1From:/ }));
    const selected = within(screen.getByTestId('pathfinder-selected-cable'));
    expect(selected.getByText('To: EQ-002 — Automatic model point (approximate, unconfirmed)')).toBeVisible();
    expect(selected.getByText('To saved binding: missing')).toBeVisible(); expect(selected.getByText('From saved binding: matched')).toBeVisible();
    expect(screen.getByText(/Point availability does not guarantee a route or authorize Apply/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Resolve From' })).toBeEnabled(); expect(screen.getByRole('button', { name: 'Resolve To' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Resolve To' })); expect(screen.getByRole('textbox', { name: 'Location name' })).toHaveValue('EQ-002');
    await user.click(screen.getByRole('checkbox', { name: 'Without a calculation point' }));
    const list = within(screen.getByRole('list', { name: 'Path Finder cables' }));
    expect(list.queryByRole('button', { name: /=CABLE-1From:/ })).toBeNull(); expect(list.getByRole('button', { name: /=CABLE-2From:/ })).toBeVisible();
    expect(pf.calculate).not.toHaveBeenCalled(); expect(saveEndpointBinding).not.toHaveBeenCalled();
  });
  it('fails closed on absent legacy availability even when old binding labels say matched', async () => {
    const user = userEvent.setup(), matched = pf.data.cables[0].fromMatch;
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, data: { ...pf.data, cables: [{ ...pf.data.cables[0], toMatch: matched }] } }); mount();
    await user.click(screen.getByRole('checkbox', { name: 'Without a calculation point' }));
    const row = within(screen.getByRole('list', { name: 'Path Finder cables' })).getByRole('button', { name: /=CABLE-1From:/ });
    expect(row).toHaveTextContent('From: Calculation point not evaluated; To: Calculation point not evaluated');
    expect(row).toHaveTextContent('Saved bindings — From: matched; To: matched');
  });
  it('does not borrow an available point from an ambiguous alias candidate with no unique location ID', async () => {
    const user = userEvent.setup(), availability = calculationAvailabilitySchema.parse({ status: 'automatic-ready', pointAvailable: true, source: 'automatic-model-candidate', approximate: true, candidateObjectIds: ['dbid:44'], reasonCode: null, engineeringAccepted: false });
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, data: { ...pf.data,
      locations: [{ ...pf.data.locations[0], calculationAvailability: availability }],
      cables: [{ ...pf.data.cables[0], fromMatch: { status: 'ambiguous', locationId: null, candidates: [locationId, locationId] }, toMatch: pf.data.cables[0].fromMatch }],
    } }); mount(); await user.click(screen.getByRole('checkbox', { name: 'Without a calculation point' }));
    const row = within(screen.getByRole('list', { name: 'Path Finder cables' })).getByRole('button', { name: /=CABLE-1From:/ });
    expect(row).toHaveTextContent('From: Calculation point not evaluated; To: Automatic model point (approximate, unconfirmed)');
    expect(row).toHaveTextContent('Saved bindings — From: ambiguous; To: matched');
  });
  it('keeps blocked point evidence visible with explicit manual-resolution labels', async () => {
    const user = userEvent.setup();
    const blocked: [CalculationAvailability['status'], string][] = [['missing', 'No model point found'], ['ambiguous', 'Multiple model points; resolve manually'], ['saved-binding-required', 'Saved binding needs confirmation'], ['object-unverified', 'Model point is unverified'], ['preparation-required', 'Current preparation required'], ['not-evaluated', 'Calculation point not evaluated']];
    const locations = blocked.map(([status], index) => ({ id: `cccccccc-cccc-4ccc-8ccc-${String(index).padStart(12, '0')}`, name: 'EQ-' + index, aliases: [], revision: '1', binding: null,
      calculationAvailability: calculationAvailabilitySchema.parse({ status, pointAvailable: false, source: null, approximate: false, candidateObjectIds: [], reasonCode: 'POINT_REVIEW_REQUIRED', engineeringAccepted: false }) }));
    const cables = locations.map((location, index) => ({ ...pf.data.cables[0], id: location.id, cableId: index, tag: '=BLOCKED-' + index, fromMatch: { status: 'missing' as const, locationId: location.id, candidates: [] }, toMatch: { status: 'missing' as const, locationId: location.id, candidates: [] } }));
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, data: { ...pf.data, locations, cables } }); mount(); await user.click(screen.getByRole('checkbox', { name: 'Without a calculation point' }));
    const list = within(screen.getByRole('list', { name: 'Path Finder cables' })); expect(list.getAllByRole('button')).toHaveLength(blocked.length);
    for (const [index, [, label]] of blocked.entries()) expect(list.getByRole('button', { name: new RegExp('=BLOCKED-' + index + 'From:') })).toHaveTextContent('From: ' + label + '; To: ' + label);
  });
  it('retains an unknown atomic endpoint command across tool changes and locks shared location selection until reconciliation', async () => {
    const user = userEvent.setup(); vi.mocked(saveEndpointBinding).mockRejectedValueOnce(new TypeError('Lost save acknowledgement')); mount();
    await user.click(screen.getByRole('button', { name: /=CABLE-1/ })); await user.click(screen.getByRole('button', { name: 'Resolve From' }));
    await waitFor(() => expect(screen.getByLabelText('Reason for confirmation')).toBeEnabled());
    await user.type(screen.getByLabelText('Reason for confirmation'), 'Reviewed shared point'); await user.click(screen.getByRole('button', { name: 'Confirm shared endpoint' }));
    await screen.findByRole('button', { name: 'Reconcile same save' });
    expect(screen.getByRole('combobox', { name: 'Saved location' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Resolve From' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Resolve To' })).toBeDisabled();
    const command = vi.mocked(saveEndpointBinding).mock.calls[0][3];
    await user.click(screen.getByRole('tab', { name: 'Routes' })); await user.click(screen.getByRole('tab', { name: 'Path' }));
    await user.click(screen.getByRole('button', { name: 'Reconcile same save' }));
    expect(saveEndpointBinding).toHaveBeenCalledTimes(2); expect(vi.mocked(saveEndpointBinding).mock.calls[1][3]).toBe(command);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Saved location' })).toBeEnabled()); expect(pf.saveLocation).not.toHaveBeenCalled();
  });
  it('does not mount any hook or protected frame when administrator access is absent', () => {
    mount(false); expect(screen.getByText('Path Finder is available only to administrators.')).toBeVisible();
    expect(usePathFinder).not.toHaveBeenCalled(); expect(screen.queryByTestId('pathfinder-model-host')).toBeNull();
  });
  it('resolves either cable endpoint using the same saved project location and preserves install length', async () => {
    const user = userEvent.setup();
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, data: { ...pf.data, locations: pf.data.locations.map(location => ({ ...location, binding: { ...location.binding, status: 'stale' as const, derivation: 'equipment-bottom-aabb' as const } })) } }); mount();
    await user.click(screen.getByRole('button', { name: /=CABLE-2/ })); await user.click(screen.getByRole('button', { name: 'Resolve To' }));
    expect(screen.getByRole('textbox', { name: 'Location name' })).toHaveValue('EQ-001'); await waitFor(() => expect(screen.getByRole('textbox', { name: 'Endpoint X in metres' })).toHaveValue('1'));
    await user.type(screen.getByLabelText('Reason for confirmation'), 'Shared current-frame confirmation');
    await user.click(screen.getByRole('button', { name: 'Confirm shared endpoint' }));
    expect(saveEndpointBinding).toHaveBeenCalledWith(projectId, 'isolated-test-token', locationId, expect.objectContaining({ mode: 'fixed-world', location: { name: 'EQ-001', aliases: ['Equipment A'] }, pointProjectMetres: [1, 2, 3] }), expect.any(AbortSignal));
    expect(pf.refresh).toHaveBeenCalled(); expect(pf.saveLocation).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox', { name: 'Saved location' })).toHaveValue(locationId);
    expect(pf.data.cables[0].installLength).toBe(123);
  });
  it('requires explicit finite coordinates for a missing endpoint and keeps a pick uncommitted until Save', async () => {
    const user = userEvent.setup(); mount();
    await user.click(screen.getByRole('button', { name: /=CABLE-1/ })); await user.click(screen.getByRole('button', { name: 'Resolve To' }));
    expect(screen.getByRole('textbox', { name: 'Location name' })).toHaveValue('EQ-002'); expect(screen.getByRole('button', { name: 'Confirm shared endpoint' })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pick surface point in 3D' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Pick surface point in 3D' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Endpoint X in metres' })).toHaveValue('4.5'));
    expect(pf.saveLocation).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Reason for confirmation'), 'Reviewed picked point');
    await user.click(screen.getByRole('button', { name: 'Confirm shared endpoint' }));
    expect(saveEndpointBinding).toHaveBeenCalledWith(projectId, 'isolated-test-token', expect.any(String), expect.objectContaining({ expectedLocationRevision: null, mode: 'fixed-world', pointProjectMetres: [4.5, -6, 7], provenanceObject: null, derivation: 'picked-surface-point', location: { name: 'EQ-002', aliases: [] } }), expect.any(AbortSignal));
  });
  it('manual point edits remove picked object evidence and invalid numbers cannot be saved', async () => {
    const user = userEvent.setup(); mount();
    await user.click(screen.getByRole('button', { name: /=CABLE-1/ })); await user.click(screen.getByRole('button', { name: 'Resolve From' }));
    const x = screen.getByRole('textbox', { name: 'Endpoint X in metres' }); await waitFor(() => expect(x).toBeEnabled()); await user.clear(x); await user.type(x, 'Infinity');
    expect(screen.getByRole('button', { name: 'Confirm shared endpoint' })).toBeDisabled(); await user.clear(x); await user.type(x, '1.25');
    await user.type(screen.getByLabelText('Reason for confirmation'), 'Manual coordinate correction');
    await user.click(screen.getByRole('button', { name: 'Confirm shared endpoint' })); expect(saveEndpointBinding).toHaveBeenCalledWith(projectId, 'isolated-test-token', locationId, expect.objectContaining({ pointProjectMetres: [1.25, 2, 3], provenanceObject: null, derivation: 'manual-world-point' }), expect.any(AbortSignal));
  });
  it('can save a picked point explicitly as coordinates when its object is outside the prepared snapshot', async () => {
    const user = userEvent.setup(); mount();
    await user.click(screen.getByRole('button', { name: /=CABLE-1/ })); await user.click(screen.getByRole('button', { name: 'Resolve To' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pick surface point in 3D' })).toBeEnabled()); await user.click(screen.getByRole('button', { name: 'Pick surface point in 3D' }));
    await user.type(screen.getByLabelText('Reason for confirmation'), 'Fixed picked point without object evidence'); await user.click(screen.getByRole('button', { name: 'Confirm shared endpoint' }));
    expect(saveEndpointBinding).toHaveBeenCalledWith(projectId, 'isolated-test-token', expect.any(String), expect.objectContaining({ mode: 'fixed-world', pointProjectMetres: [4.5, -6, 7], provenanceObject: null, derivation: 'picked-surface-point' }), expect.any(AbortSignal));
  });
  it('prepares selected protected geometry only after explicit category selection and retains endpoint names', async () => {
    const user = userEvent.setup(); mount();
    await user.click(screen.getByRole('button', { name: /=CABLE-1/ })); await user.click(screen.getByRole('tab', { name: 'Routes' })); await user.click(screen.getByText('Advanced model preparation and import')); await user.type(screen.getByRole('textbox', { name: 'Routing network codes' }), '/BC1/SECONDARY/BC2');
    expect(screen.getByRole('button', { name: 'Prepare selected model network' })).toBeDisabled();
    await user.click(within(screen.getByRole('group', { name: 'Allowed cable categories for this network' })).getByRole('checkbox', { name: 'Control (including Instrumentation)' }));
    await user.click(screen.getByRole('button', { name: 'Prepare selected model network' }));
    expect(pf.prepareModel).toHaveBeenCalledWith({ routeCodes: ['BC1', 'BC2'], allowedCategories: ['Control'], equipmentNames: ['EQ-001', 'EQ-002'] });
  });
  it('displays exact calculated points and requires review before an explicit synthetic Apply', async () => {
    const user = userEvent.setup(), detail = proposal(true), reviewId = '88888888-8888-4888-8888-888888888888';
    const action = vi.fn(async () => applyReceipt(detail, reviewId));
    vi.mocked(usePathFinder).mockReturnValue({ ...proposalModel(), data: { ...pf.data, proposals: [detail] }, readProposal: vi.fn(async () => detail), showPath: vi.fn(async () => 'display-request'), reviewProposal: vi.fn(async () => ({ reviewId, proposal: detail })), action, actionWithoutRefresh: action });
    mount(); await user.click(screen.getByRole('button', { name: /=CABLE-1 — Ready for review/ }));
    expect(await screen.findByText('Design length: 21 m')).toBeVisible(); expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Confirm proposal review' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Apply reviewed result' }));
    expect(action).toHaveBeenCalledWith(`/proposals/${detail.id}/apply`, { reviewId, idempotencyKey: expect.any(String), expectedCableWriteRevision: '0' });
    expect(await screen.findByText('Routing and design length applied together. Installed length was preserved. The matching Apply receipt is confirmed.')).toBeVisible();
    expect(JSON.parse(sessionStorage.getItem(PENDING_APPLY_STORAGE_KEY)!).intents).toHaveLength(0);
  });
  it('keeps server-ineligible real results disabled for review and Apply', async () => {
    const user = userEvent.setup(), detail = proposal(false);
    vi.mocked(usePathFinder).mockReturnValue({ ...proposalModel(), data: { ...pf.data, proposals: [detail] }, readProposal: vi.fn(async () => detail), showPath: vi.fn(async () => 'display-request'), reviewProposal: vi.fn(async () => ({ reviewId: '88888888-8888-4888-8888-888888888888', proposal: detail })) });
    mount(); await user.click(screen.getByRole('button', { name: /=CABLE-1 — Review blocked/ })); await screen.findByText('Design length: 21 m');
    expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeDisabled(); expect(pf.action).not.toHaveBeenCalled();
  });
  it('does not offer review for a visible successful route whose required design settings are missing', async () => {
    const user = userEvent.setup(), detail = { ...proposal(false), status: 'settings_required', acceptanceScope: 'manual-review', design: null, canApply: false, message: 'Set the SECONDARY allowance in Project Details.' };
    const reviewProposal = vi.fn(async () => null), showPath = vi.fn(async () => 'complete-path-ack');
    vi.mocked(usePathFinder).mockReturnValue({ ...proposalModel(), data: { ...pf.data, proposals: [detail] }, readProposal: vi.fn(async () => detail), showPath, reviewProposal });
    mount(); await user.click(screen.getByRole('button', { name: /=CABLE-1 — Project values required/ })); await screen.findByText('Geometric length: 18 m'); await waitFor(() => expect(showPath).toHaveBeenCalled());
    expect(screen.getByText('Set the SECONDARY allowance in Project Details.')).toBeVisible(); expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeDisabled(); expect(reviewProposal).not.toHaveBeenCalled();
  });
  it('applies an eligible manually reviewed real result without claiming native engineering acceptance', async () => {
    const user = userEvent.setup(), detail = { ...proposal(false), acceptanceScope: 'manual-review', canApply: true, engineeringMessage: 'Review the route and length before applying.' }, reviewId = '88888888-8888-4888-8888-888888888888';
    const action = vi.fn(async () => applyReceipt(detail, reviewId));
    vi.mocked(usePathFinder).mockReturnValue({ ...proposalModel(), data: { ...pf.data, proposals: [detail] }, readProposal: vi.fn(async () => detail), showPath: vi.fn(async () => 'display-request'), reviewProposal: vi.fn(async () => ({ reviewId, proposal: detail })), action, actionWithoutRefresh: action });
    mount(); await user.click(screen.getByRole('button', { name: /=CABLE-1 — Ready for review/ })); await screen.findByText('Design length: 21 m');
    expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeDisabled(); expect(screen.getByText('Review the route and length before applying.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Confirm proposal review' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Apply reviewed result' })); expect(action).toHaveBeenCalledWith(`/proposals/${detail.id}/apply`, { reviewId, idempotencyKey: expect.any(String), expectedCableWriteRevision: '0' }); expect(detail.engineeringAccepted).toBe(false); expect(detail.synthetic).toBe(false);
    expect(await screen.findByText('Routing and design length applied together. Installed length was preserved. The matching Apply receipt is confirmed.')).toBeVisible();
    expect((await action.mock.results[0].value).receipt.provenance.nativeParity).toBe('not-performed');
  });
  it('retains an incomplete Apply receipt as unknown under the same authorised account', async () => {
    const user = userEvent.setup(), detail = proposal(true), reviewId = '88888888-8888-4888-8888-888888888888';
    const action = vi.fn(async () => ({ receipt: {}, duplicate: false }));
    vi.mocked(usePathFinder).mockReturnValue({ ...proposalModel(), data: { ...pf.data, proposals: [detail] }, readProposal: vi.fn(async () => detail),
      showPath: vi.fn(async () => 'displayed'), reviewProposal: vi.fn(async () => ({ reviewId, proposal: detail })), action, actionWithoutRefresh: action });
    mount(); await user.click(screen.getByRole('button', { name: /=CABLE-1 — Ready for review/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Confirm proposal review' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Apply reviewed result' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry pending Apply' })).toBeEnabled());
    expect(action).toHaveBeenCalledOnce(); expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled();
    expect(screen.queryByText(/matching Apply receipt is confirmed/)).toBeNull();
    const stored = JSON.parse(sessionStorage.getItem(PENDING_APPLY_STORAGE_KEY)!);
    expect(stored.intents).toHaveLength(1); expect(stored.intents[0]).toMatchObject({ projectId, accountId, proposalId: detail.id, reviewId, expectedCableWriteRevision: '0', revisionResultHash: detail.revisionResultHash });
    expect(JSON.stringify(stored)).not.toContain('isolated-test-token');
  });
  it('invalidates manual review when the authoritative project gap changes', async () => {
    const user = userEvent.setup(), detail = { ...proposal(false), acceptanceScope: 'manual-review', canApply: true }, reviewId = '88888888-8888-4888-8888-888888888888';
    const current = { ...proposalModel(), data: { ...pf.data, proposals: [detail] }, readProposal: vi.fn(async () => detail), showPath: vi.fn(async () => 'display-request'), reviewProposal: vi.fn(async () => ({ reviewId, proposal: detail })) };
    vi.mocked(usePathFinder).mockReturnValue(current); const view = mount(); await user.click(screen.getByRole('button', { name: /=CABLE-1 — Ready for review/ })); await screen.findByText('Design length: 21 m'); await user.click(screen.getByRole('button', { name: 'Confirm proposal review' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeEnabled());
    vi.mocked(usePathFinder).mockReturnValue({ ...current, data: { ...current.data, settings: { ...current.data.settings, connectionGap: '2' }, proposals: [{ ...detail, stale: true, canApply: false }] } });
    view.rerender(<PathFinderTab projectId={projectId} loadedProjectId={projectId} token="isolated-test-token" accountId={accountId} isAdmin />);
    expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeDisabled(); expect(screen.getByText('This result is outdated. Calculate a new proposal before reviewing or applying it.')).toBeVisible(); expect(pf.action).not.toHaveBeenCalled();
  });
  it('discards a delayed review response after the selected cable changes', async () => {
    const user = userEvent.setup(), detail = { ...proposal(false), acceptanceScope: 'manual-review', canApply: true }, reviewId = '88888888-8888-4888-8888-888888888888';
    let finishReview!: (value: { reviewId: string; proposal: PathFinderProposal }) => void;
    const reviewProposal = vi.fn(() => new Promise<{ reviewId: string; proposal: PathFinderProposal }>(resolve => { finishReview = resolve; }));
    vi.mocked(usePathFinder).mockReturnValue({ ...proposalModel(), data: { ...pf.data, proposals: [detail] }, readProposal: vi.fn(async () => detail), showPath: vi.fn(async () => 'display-ack'), reviewProposal }); mount();
    await user.click(screen.getByRole('button', { name: /=CABLE-1From:/ })); await user.click(screen.getByRole('button', { name: /=CABLE-1 — Ready for review/ })); await screen.findByText('Design length: 21 m');
    await user.click(screen.getByRole('button', { name: 'Confirm proposal review' })); await waitFor(() => expect(reviewProposal).toHaveBeenCalledOnce());
    await user.click(screen.getByRole('button', { name: /=CABLE-2From:/ })); expect(screen.queryByRole('region', { name: 'Proposal review' })).toBeNull();
    await act(async () => finishReview({ reviewId, proposal: detail }));
    expect(screen.getByText('Selected: =CABLE-2')).toBeVisible(); expect(screen.queryByRole('region', { name: 'Proposal review' })).toBeNull(); expect(screen.queryByText('Review confirmed for this immutable proposal.')).toBeNull(); expect(pf.action).not.toHaveBeenCalled();
  });
  it('does not show a late Apply success in a different selected cable context', async () => {
    const user = userEvent.setup(), detail = { ...proposal(false), acceptanceScope: 'manual-review', canApply: true }, reviewId = '88888888-8888-4888-8888-888888888888';
    let finishApply!: (value: { receipt: object; duplicate: boolean }) => void;
    const action = vi.fn(() => new Promise<{ receipt: object; duplicate: boolean }>(resolve => { finishApply = resolve; }));
    vi.mocked(usePathFinder).mockReturnValue({ ...proposalModel(), data: { ...pf.data, proposals: [detail] }, readProposal: vi.fn(async () => detail), showPath: vi.fn(async () => 'display-ack'), reviewProposal: vi.fn(async () => ({ reviewId, proposal: detail })), action, actionWithoutRefresh: action }); mount();
    await user.click(screen.getByRole('button', { name: /=CABLE-1From:/ })); await user.click(screen.getByRole('button', { name: /=CABLE-1 — Ready for review/ })); await screen.findByText('Design length: 21 m'); await user.click(screen.getByRole('button', { name: 'Confirm proposal review' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Apply reviewed result' })); await waitFor(() => expect(action).toHaveBeenCalledOnce()); await user.click(screen.getByRole('button', { name: /=CABLE-2From:/ }));
    await act(async () => finishApply(applyReceipt(detail, reviewId))); expect(screen.getByText('Selected: =CABLE-2')).toBeVisible(); expect(screen.queryByText('Routing and design length applied together. Installed length was preserved.')).toBeNull();
  });
  it('shows path loading and enables proposal review only after the protected display acknowledgement', async () => {
    const user = userEvent.setup(), detail = proposal(true); let acknowledge!: (requestId: string) => void;
    const showPath = vi.fn(() => new Promise<string>(resolve => { acknowledge = resolve; }));
    vi.mocked(usePathFinder).mockReturnValue({ ...proposalModel(), data: { ...pf.data, proposals: [detail] }, readProposal: vi.fn(async () => detail), showPath }); mount();
    await user.click(screen.getByRole('button', { name: /=CABLE-1 — Ready for review/ }));
    expect(await screen.findByText('Loading the exact computed path…')).toBeVisible(); expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled();
    await act(async () => acknowledge('protected-display-ack'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeEnabled()); expect(screen.queryByText('Loading the exact computed path…')).toBeNull();
  });
  it('reviews a native-shaped zero-length proposal using its one exact point and unchanged design values', async () => {
    const user = userEvent.setup(), detail = proposal(true); detail.route = { ...detail.route!, points: [[1, 0, 0.5]], lengthMeters: 0 }; detail.design = { lengthBeforePercentageMeters: '6', unroundedLengthMeters: '6.6', designLengthMeters: '7' };
    const showPath = vi.fn(async () => 'zero-length-marker-ack'); vi.mocked(usePathFinder).mockReturnValue({ ...proposalModel(), data: { ...pf.data, proposals: [detail] }, readProposal: vi.fn(async () => detail), showPath }); mount();
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
  it('leaves automatic production to the server and forces only explicit calculation retries', async () => {
    const user = userEvent.setup(), matched = pf.data.cables[0].fromMatch;
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, data: { ...pf.data, artifacts: [artifact()], cables: [{ ...pf.data.cables[0], toMatch: matched }] } }); mount();
    expect(pf.calculate).not.toHaveBeenCalled(); expect(screen.queryByRole('checkbox', { name: 'Automatically calculate ready cables' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Calculate non-MV cables' })); expect(pf.calculate).toHaveBeenLastCalledWith([pf.data.cables[0].id], true, { secondaryDistanceMeters: 2, preferVerticalApproach: true });
    await user.click(screen.getByRole('button', { name: /=CABLE-1/ })); await user.click(screen.getByRole('button', { name: 'Calculate selected cable' })); expect(pf.calculate).toHaveBeenLastCalledWith([pf.data.cables[0].id], true, { secondaryDistanceMeters: 2, preferVerticalApproach: true });
  });
  it('previews exact ordered lookup and reverse with unchanged cable labels and the read-only project gap', async () => {
    const user = userEvent.setup(), forwardId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', reverseId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const startLookup = vi.fn().mockResolvedValueOnce(forwardId).mockResolvedValueOnce(reverseId), readLookup = vi.fn().mockImplementation(async (id: string) => lookup(id, id === reverseId)), showPath = vi.fn(async () => 'displayed');
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, data: { ...pf.data, artifacts: [artifact()] }, startLookup, readLookup, showPath }); mount();
    await user.click(screen.getByRole('button', { name: /=CABLE-1/ })); await user.click(screen.getByRole('tab', { name: 'Path lookup' }));
    await user.type(screen.getByRole('textbox', { name: 'Path Finder ordered route' }), '/BC1/BC2'); expect(screen.queryByRole('spinbutton', { name: 'Lookup connection tolerance in metres' })).toBeNull(); expect(screen.getByText('Connection gap: 1 m. Change this in Project Details. Larger values permit larger unmodelled gaps.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Show route' })); await screen.findByText('Lookup complete — forward preview');
    expect(startLookup).toHaveBeenNthCalledWith(1, '/BC1/BC2', false); await waitFor(() => expect(showPath).toHaveBeenCalledWith({ pathId: forwardId, points: [[1, 2, 3], [4, 5, 6]], objectIds: [23] }));
    await user.click(screen.getByRole('button', { name: 'Reverse preview' })); await screen.findByText('Lookup complete — reverse preview');
    expect(startLookup).toHaveBeenNthCalledWith(2, '/BC1/BC2', true); await waitFor(() => expect(showPath).toHaveBeenLastCalledWith({ pathId: reverseId, points: [[4, 5, 6], [1, 2, 3]], objectIds: [23] }));
    expect(screen.getByText(/Original cable labels: From EQ-001; To EQ-002/)).toBeVisible(); expect(within(screen.getByRole('region', { name: 'Ordered lookup result' })).queryByRole('button', { name: /Apply/ })).toBeNull(); expect(pf.action).not.toHaveBeenCalled();
  });
  it('retains an outdated lookup without displaying its stale points', async () => {
    const user = userEvent.setup(), id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', detail = lookup(id); detail.result!.stale = true;
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, data: { ...pf.data, artifacts: [artifact()] }, startLookup: vi.fn(async () => id), readLookup: vi.fn(async () => detail) }); mount();
    await user.click(screen.getByRole('tab', { name: 'Path lookup' })); await user.type(screen.getByRole('textbox', { name: 'Path Finder ordered route' }), '/BC1/BC2'); await user.click(screen.getByRole('button', { name: 'Show route' }));
    expect(await screen.findByText('The active model or lookup dependencies changed. Run a fresh lookup before displaying it.')).toBeVisible(); expect(pf.showPath).not.toHaveBeenCalled();
  });
  it('offers three keyboard-accessible tools while retaining one protected model host and local drafts', async () => {
    const user = userEvent.setup(); mount(); const host = screen.getByTestId('pathfinder-model-host');
    expect(screen.getByRole('tab', { name: 'Path' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Location name' })).toBeEnabled()); await user.type(screen.getByRole('textbox', { name: 'Location name' }), 'Draft location');
    await user.type(screen.getByRole('textbox', { name: 'Path From location' }), 'Equipment draft');
    await user.click(screen.getByRole('tab', { name: 'Routes' }));
    expect(screen.getByRole('tabpanel', { name: 'Routes' })).toBeVisible(); expect(screen.queryByRole('textbox', { name: 'Path From location' })).toBeNull();
    screen.getByRole('tab', { name: 'Path' }).focus(); await user.keyboard('{Enter}'); expect(screen.getByRole('tab', { name: 'Path' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('textbox', { name: 'Location name' })).toHaveValue(''); expect(screen.getByRole('textbox', { name: 'Path From location' })).toHaveValue('Equipment draft');
    screen.getByRole('tab', { name: 'Path lookup' }).focus(); await user.keyboard('{Enter}');
    expect(screen.getByRole('tabpanel', { name: 'Path lookup' })).toBeVisible();
    await user.type(screen.getByRole('textbox', { name: 'Path Finder ordered route' }), '/DRAFT'); await user.click(screen.getByRole('checkbox', { name: 'Reverse route order' }));
    await user.click(screen.getByRole('tab', { name: 'Routes' })); await user.click(screen.getByRole('tab', { name: 'Path lookup' }));
    expect(screen.getByRole('textbox', { name: 'Path Finder ordered route' })).toHaveValue('/DRAFT'); expect(screen.getByRole('checkbox', { name: 'Reverse route order' })).toBeChecked();
    expect(screen.getAllByRole('tabpanel', { hidden: true })).toHaveLength(3);
    expect(screen.getByTestId('pathfinder-model-host')).toBe(host); expect(pf.reloadViewer).not.toHaveBeenCalled(); expect(pf.cancelOperation).toHaveBeenCalled();
  });
  it('prepares every ordered selected-object rule and makes category edits the newest override', async () => {
    const user = userEvent.setup(), readSelection = vi.fn().mockResolvedValueOnce({ objects: [viewerObject(44, 'Group A')] }).mockResolvedValueOnce({ objects: [viewerObject(45, 'Group B')] });
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, readSelection }); mount(); await user.click(screen.getByRole('tab', { name: 'Routes' }));
    await user.click(screen.getByRole('button', { name: 'Add current selection' })); await screen.findByRole('checkbox', { name: 'LV for rule 1' });
    expect(screen.getByRole('checkbox', { name: 'MV for rule 1' })).not.toBeChecked(); expect(screen.getByRole('checkbox', { name: 'LV for rule 1' })).toBeChecked(); expect(screen.getByRole('checkbox', { name: 'Control for rule 1' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Add current selection' })); await screen.findByRole('checkbox', { name: 'LV for rule 2' });
    await user.click(screen.getByRole('checkbox', { name: 'MV for rule 1' })); await user.click(screen.getByRole('button', { name: 'Prepare routes from all rules' }));
    expect(pf.prepareModel).toHaveBeenCalledWith({ routeRules: [{ id: expect.any(String), objectIds: [45], allowedCategories: ['LV', 'Control'] }, { id: expect.any(String), objectIds: [44], allowedCategories: ['MV', 'LV', 'Control'] }], equipmentNames: ['EQ-001', 'EQ-002'] }, expect.any(Function));
    await user.click(screen.getByRole('button', { name: 'Remove rule 1' })); expect(screen.queryByRole('button', { name: /Group B/ })).toBeNull();
  });
  it('updates a selected root group and supports explicit category exclusion', async () => {
    const user = userEvent.setup(), readSelection = vi.fn().mockResolvedValueOnce({ objects: [viewerObject(44, 'Group A')] }).mockResolvedValueOnce({ objects: [viewerObject(46, 'Group C')] });
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, readSelection }); mount(); await user.click(screen.getByRole('tab', { name: 'Routes' }));
    await user.click(screen.getByRole('button', { name: 'Add current selection' })); await screen.findByRole('button', { name: /Group A/ });
    await user.click(screen.getByRole('button', { name: 'Update selected group' })); await screen.findByRole('button', { name: /Group C/ });
    await user.click(screen.getByRole('checkbox', { name: 'LV for rule 1' })); await user.click(screen.getByRole('checkbox', { name: 'Control for rule 1' })); await user.click(screen.getByRole('button', { name: 'Prepare routes from all rules' }));
    expect(pf.prepareModel).toHaveBeenLastCalledWith({ routeRules: [{ id: expect.any(String), objectIds: [46], allowedCategories: [] }], equipmentNames: ['EQ-001', 'EQ-002'] }, expect.any(Function));
  });
  it('clears route rules on a model selection revision change and ignores a late selection from the hidden tab', async () => {
    const user = userEvent.setup(); let finish!: (value: { objects: ViewerModelObject[] }) => void;
    const readSelection = vi.fn().mockResolvedValueOnce({ objects: [viewerObject(44, 'Group A')] }).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const current = { ...pf, readSelection }; vi.mocked(usePathFinder).mockReturnValue(current); const view = mount(); await user.click(screen.getByRole('tab', { name: 'Routes' }));
    await user.click(screen.getByRole('button', { name: 'Add current selection' })); await screen.findByRole('button', { name: /Group A/ });
    vi.mocked(usePathFinder).mockReturnValue({ ...current, data: { ...current.data, activeModel: { ...current.data.activeModel, selectionRevision: '3' } } }); view.rerender(<PathFinderTab projectId={projectId} loadedProjectId={projectId} token="isolated-test-token" accountId={accountId} isAdmin />);
    expect(screen.queryByRole('button', { name: /Group A/ })).toBeNull(); await user.click(screen.getByRole('button', { name: 'Add current selection' })); await user.click(screen.getByRole('tab', { name: 'Path' }));
    await act(async () => finish({ objects: [viewerObject(45, 'Late group')] })); await user.click(screen.getByRole('tab', { name: 'Routes' })); expect(screen.queryByRole('button', { name: /Late group/ })).toBeNull();
  });
  it('searches protected model metadata and adds checked objects to a category rule', async () => {
    const user = userEvent.setup(), object = viewerObject(44, 'BC001');
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, readObjects: vi.fn(async () => ({ cursor: 0, nextCursor: null, complete: true, query: 'BC001', coordinateFrame: 'world-metres-z-up' as const, metresPerDisplayUnit: 1, globalOffsetMetres: [0, 0, 0] as [number, number, number], objects: [object] })) });
    mount(); await user.click(screen.getByRole('tab', { name: 'Routes' })); await user.click(screen.getByText('Find route objects by name')); await user.type(screen.getByRole('textbox', { name: 'Route object query' }), 'BC001'); await user.click(screen.getByRole('button', { name: 'Find route objects' }));
    await user.click(await screen.findByRole('checkbox', { name: 'Select BC001 (44)' })); await user.click(screen.getByRole('button', { name: 'Add checked objects as a rule' })); await user.click(screen.getByRole('button', { name: 'Prepare routes from all rules' }));
    expect(pf.prepareModel).toHaveBeenCalledWith({ routeRules: [{ id: expect.any(String), objectIds: [44], allowedCategories: ['LV', 'Control'] }], equipmentNames: ['EQ-001', 'EQ-002'] }, expect.any(Function));
  });
  it('calculates and reverses a standalone path using original endpoint names and current Path preferences', async () => {
    const user = userEvent.setup(), forwardId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', reverseId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const startPreview = vi.fn().mockResolvedValueOnce(forwardId).mockResolvedValueOnce(reverseId), readPreview = vi.fn(async (id: string) => preview(id, id === reverseId)), showPath = vi.fn(async () => 'displayed');
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, data: { ...pf.data, artifacts: [artifact()] }, startPreview, readPreview, showPath }); mount();
    await user.type(screen.getByRole('textbox', { name: 'Path From location' }), 'EQ-001'); await user.type(screen.getByRole('textbox', { name: 'Path To location' }), 'EQ-002'); await user.click(screen.getByRole('button', { name: 'Calculate path' }));
    expect(startPreview).toHaveBeenNthCalledWith(1, { from: { name: 'EQ-001' }, to: { name: 'EQ-002' }, category: 'LV', reverse: false, secondaryDistanceMeters: 2, preferVerticalApproach: true });
    await screen.findByText('Path calculation complete'); await waitFor(() => expect(showPath).toHaveBeenCalledWith({ pathId: forwardId, points: [[1, 2, 3], [4, 5, 6]], objectIds: [23] }));
    await user.click(screen.getByRole('button', { name: 'Reverse path' })); await screen.findByText(/Original endpoints: From EQ-001; To EQ-002. Reverse preview/);
    expect(startPreview).toHaveBeenLastCalledWith(expect.objectContaining({ from: { name: 'EQ-001' }, to: { name: 'EQ-002' }, category: 'LV', reverse: true }));
    await waitFor(() => expect(showPath).toHaveBeenLastCalledWith({ pathId: reverseId, points: [[4, 5, 6], [1, 2, 3]], objectIds: [23] })); expect(pf.action).not.toHaveBeenCalled();
    expect(within(screen.getByRole('region', { name: 'Standalone path result' })).queryByRole('button', { name: /Apply/ })).toBeNull();
  });
  it('shared Clear removes the displayed standalone notice and result while preserving drafts and preferences without requests', async () => {
    const user = userEvent.setup(), id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const startPreview = vi.fn(async () => id), readPreview = vi.fn(async () => preview(id)), showPath = vi.fn(async () => 'displayed');
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, data: { ...pf.data, artifacts: [artifact()] }, startPreview, readPreview, showPath }); mount();
    await user.type(screen.getByRole('textbox', { name: 'Path From location' }), 'EQ-001'); await user.type(screen.getByRole('textbox', { name: 'Path To location' }), 'EQ-002');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Path cable type' }), 'Control');
    const trigger = screen.getByRole('textbox', { name: 'SECONDARY trigger distance in metres' }); await user.clear(trigger); await user.type(trigger, '3');
    await user.click(screen.getByRole('checkbox', { name: 'Prefer vertical approach' })); await user.click(screen.getByRole('button', { name: 'Calculate path' }));
    expect(await screen.findByText('The exact standalone path is displayed. Review its route and length.')).toBeVisible();
    const beforeClear = { start: startPreview.mock.calls.length, read: readPreview.mock.calls.length, calculate: pf.calculate.mock.calls.length, clear: pf.clear.mock.calls.length };
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByText('The exact standalone path is displayed. Review its route and length.')).toBeNull(); expect(screen.queryByRole('region', { name: 'Standalone path result' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Path From location' })).toHaveValue('EQ-001'); expect(screen.getByRole('textbox', { name: 'Path To location' })).toHaveValue('EQ-002');
    expect(screen.getByRole('combobox', { name: 'Path cable type' })).toHaveValue('Control'); expect(trigger).toHaveValue('3'); expect(screen.getByRole('checkbox', { name: 'Prefer vertical approach' })).not.toBeChecked();
    for (const name of ['Routes', 'Path', 'Path lookup']) expect(screen.getByRole('tab', { name })).toBeVisible(); expect(screen.getByRole('button', { name: 'Calculate path' })).toBeEnabled();
    expect(pf.clear.mock.calls.length).toBeGreaterThan(beforeClear.clear); expect(startPreview).toHaveBeenCalledTimes(beforeClear.start); expect(readPreview).toHaveBeenCalledTimes(beforeClear.read); expect(pf.calculate).toHaveBeenCalledTimes(beforeClear.calculate);
    expect(pf.action).not.toHaveBeenCalled(); expect(pf.reviewProposal).not.toHaveBeenCalled(); expect(pf.saveLocation).not.toHaveBeenCalled(); expect(pf.matchAll).not.toHaveBeenCalled();
  });
  it('shared Clear prevents a late standalone display acknowledgement from restoring its notice or result', async () => {
    const user = userEvent.setup(), id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; let finish!: (value: string) => void;
    const showPath = vi.fn(() => new Promise<string>(resolve => { finish = resolve; })), startPreview = vi.fn(async () => id), readPreview = vi.fn(async () => preview(id));
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, data: { ...pf.data, artifacts: [artifact()] }, startPreview, readPreview, showPath }); mount();
    await user.type(screen.getByRole('textbox', { name: 'Path From location' }), 'EQ-001'); await user.type(screen.getByRole('textbox', { name: 'Path To location' }), 'EQ-002'); await user.click(screen.getByRole('button', { name: 'Calculate path' }));
    await waitFor(() => expect(showPath).toHaveBeenCalledOnce()); await user.click(screen.getByRole('button', { name: 'Clear' })); await act(async () => finish('displayed'));
    expect(screen.queryByText('The exact standalone path is displayed. Review its route and length.')).toBeNull(); expect(screen.queryByRole('region', { name: 'Standalone path result' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Path From location' })).toHaveValue('EQ-001'); expect(screen.getByRole('textbox', { name: 'Path To location' })).toHaveValue('EQ-002');
    expect(startPreview).toHaveBeenCalledOnce(); expect(readPreview).toHaveBeenCalledOnce(); expect(pf.action).not.toHaveBeenCalled(); expect(pf.reviewProposal).not.toHaveBeenCalled();
  });
  it('shared Clear removes a completed lookup notice while preserving its route draft without cancellation requests', async () => {
    const user = userEvent.setup(), id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const startLookup = vi.fn(async () => id), readLookup = vi.fn(async () => lookup(id));
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, startLookup, readLookup, showPath: vi.fn(async () => 'displayed') }); mount();
    await user.click(screen.getByRole('tab', { name: 'Path lookup' })); await user.type(screen.getByRole('textbox', { name: 'Path Finder ordered route' }), '/BC1/BC2'); await user.click(screen.getByRole('button', { name: 'Show route' }));
    expect(await screen.findByText('The exact ordered lookup is displayed.')).toBeVisible(); await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByText('The exact ordered lookup is displayed.')).toBeNull(); expect(screen.queryByRole('region', { name: 'Ordered lookup result' })).toBeNull(); expect(screen.getByRole('textbox', { name: 'Path Finder ordered route' })).toHaveValue('/BC1/BC2');
    expect(startLookup).toHaveBeenCalledOnce(); expect(readLookup).toHaveBeenCalledOnce(); expect(pf.action).not.toHaveBeenCalled();
  });
  it('shared Clear removes the proposal review notice and eligibility without another review or Apply', async () => {
    const user = userEvent.setup(), detail = proposal(true), reviewProposal = vi.fn(async () => ({ reviewId: '88888888-8888-4888-8888-888888888888', proposal: detail }));
    vi.mocked(usePathFinder).mockReturnValue({ ...proposalModel(), data: { ...pf.data, proposals: [detail] }, readProposal: vi.fn(async () => detail), showPath: vi.fn(async () => 'displayed'), reviewProposal }); mount();
    await user.click(screen.getByRole('button', { name: /=CABLE-1 — Ready for review/ })); await screen.findByText('Design length: 21 m'); await user.click(screen.getByRole('button', { name: 'Confirm proposal review' }));
    expect(await screen.findByText('Review confirmed for this immutable proposal.')).toBeVisible(); await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByText('Review confirmed for this immutable proposal.')).toBeNull(); expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeDisabled();
    expect(reviewProposal).toHaveBeenCalledOnce(); expect(pf.action).not.toHaveBeenCalled();
  });
  it('uses one selected equipment object as an endpoint and rejects partial or non-finite manual coordinates', async () => {
    const user = userEvent.setup(); vi.mocked(usePathFinder).mockReturnValue({ ...pf, data: { ...pf.data, artifacts: [artifact()] } }); mount();
    await user.click(screen.getByRole('button', { name: 'Use selection as From' })); expect(await screen.findByRole('textbox', { name: 'Path From location' })).toHaveValue('Tray group A');
    await user.type(screen.getByRole('textbox', { name: 'Path To location' }), 'EQ-002'); await user.click(screen.getByText('To coordinates (metres)')); await user.type(screen.getByRole('textbox', { name: 'Path To X in metres' }), 'Infinity');
    expect(screen.getByRole('button', { name: 'Calculate path' })).toBeDisabled(); await user.clear(screen.getByRole('textbox', { name: 'Path To X in metres' })); expect(screen.getByRole('button', { name: 'Calculate path' })).toBeEnabled();
  });
  it('discards a hidden standalone preview response and keeps its endpoint draft', async () => {
    const user = userEvent.setup(), id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; let finish!: (value: PathFinderPreview) => void;
    const readPreview = vi.fn(() => new Promise<PathFinderPreview>(resolve => { finish = resolve; }));
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, data: { ...pf.data, artifacts: [artifact()] }, startPreview: vi.fn(async () => id), readPreview }); mount();
    await user.type(screen.getByRole('textbox', { name: 'Path From location' }), 'EQ-001'); await user.type(screen.getByRole('textbox', { name: 'Path To location' }), 'EQ-002'); await user.click(screen.getByRole('button', { name: 'Calculate path' })); await waitFor(() => expect(readPreview).toHaveBeenCalled());
    await user.click(screen.getByRole('tab', { name: 'Routes' })); await act(async () => finish(preview(id))); expect(pf.showPath).not.toHaveBeenCalled();
    await user.click(screen.getByRole('tab', { name: 'Path' })); expect(screen.getByRole('textbox', { name: 'Path From location' })).toHaveValue('EQ-001'); expect(screen.queryByRole('region', { name: 'Standalone path result' })).toBeNull();
  });
  it('invalidates proposal review when another Path tool claims the shared view', async () => {
    const user = userEvent.setup(), detail = { ...proposal(false), acceptanceScope: 'manual-review', canApply: true }, id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    vi.mocked(usePathFinder).mockReturnValue({ ...proposalModel(), data: { ...pf.data, artifacts: [artifact()], proposals: [detail] }, readProposal: vi.fn(async () => detail), showPath: vi.fn(async () => 'displayed'), reviewProposal: vi.fn(async () => ({ reviewId: '88888888-8888-4888-8888-888888888888', proposal: detail })), startLookup: vi.fn(async () => id), readLookup: vi.fn(async () => lookup(id)) }); mount();
    await user.click(screen.getByRole('button', { name: /=CABLE-1 — Ready for review/ })); await screen.findByText('Design length: 21 m'); await user.click(screen.getByRole('button', { name: 'Confirm proposal review' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeEnabled());
    await user.click(screen.getByRole('tab', { name: 'Path lookup' })); await user.type(screen.getByRole('textbox', { name: 'Path Finder ordered route' }), '/BC1/BC2'); await user.click(screen.getByRole('button', { name: 'Show route' })); await screen.findByText('Lookup complete — forward preview');
    await user.click(screen.getByRole('tab', { name: 'Path' })); expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled();
  });
  it('does not display a late ordered lookup after a proposal takes ownership of the view', async () => {
    const user = userEvent.setup(), detail = proposal(true), id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; let finish!: (value: PathFinderLookup) => void;
    const readLookup = vi.fn(() => new Promise<PathFinderLookup>(resolve => { finish = resolve; })), showPath = vi.fn(async () => 'displayed');
    vi.mocked(usePathFinder).mockReturnValue({ ...proposalModel(), data: { ...pf.data, artifacts: [artifact()], proposals: [detail] }, readProposal: vi.fn(async () => detail), showPath, startLookup: vi.fn(async () => id), readLookup }); mount();
    await user.click(screen.getByRole('tab', { name: 'Path lookup' })); await user.type(screen.getByRole('textbox', { name: 'Path Finder ordered route' }), '/BC1/BC2'); await user.click(screen.getByRole('button', { name: 'Show route' })); await waitFor(() => expect(readLookup).toHaveBeenCalled());
    await user.click(screen.getByRole('tab', { name: 'Path' })); await user.click(screen.getByRole('button', { name: /=CABLE-1 — Ready for review/ })); await screen.findByText('Design length: 21 m'); await act(async () => finish(lookup(id)));
    expect(showPath).toHaveBeenCalledTimes(1); expect(showPath).toHaveBeenCalledWith(expect.objectContaining({ pathId: detail.id })); expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeEnabled();
  });
  it('requires matching immutable preferences when reopening an old proposal and rejects invalid trigger values', async () => {
    const user = userEvent.setup(), detail = proposal(true); vi.mocked(usePathFinder).mockReturnValue({ ...proposalModel(), data: { ...pf.data, artifacts: [artifact()], proposals: [detail] }, readProposal: vi.fn(async () => detail), showPath: vi.fn(async () => 'displayed') }); mount();
    const trigger = screen.getByRole('textbox', { name: 'SECONDARY trigger distance in metres' }); await user.clear(trigger); await user.type(trigger, '3'); await user.click(screen.getByRole('button', { name: /=CABLE-1 — Ready for review/ }));
    expect(await screen.findByText('This proposal uses different routing preferences. Calculate a new proposal with the current Path values before reviewing or applying.')).toBeVisible(); expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled();
    await user.clear(trigger); await user.type(trigger, '-1'); expect(screen.getByRole('button', { name: 'Calculate non-MV cables' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Calculate path' })).toBeDisabled();
  });
  it('applies draft transparency explicitly and restores the shared view without changing native ghost defaults on load', async () => {
    const user = userEvent.setup(), detail = proposal(true); vi.mocked(usePathFinder).mockReturnValue({ ...proposalModel(), data: { ...pf.data, proposals: [detail] }, readProposal: vi.fn(async () => detail), showPath: vi.fn(async () => 'displayed') }); mount();
    expect(screen.getByRole('textbox', { name: 'Background transparency to apply percent' })).toHaveValue('75'); expect(pf.setPathTransparency).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /=CABLE-1 — Ready for review/ })); await screen.findByText('Design length: 21 m'); await user.click(screen.getByRole('button', { name: 'Apply transparency' })); expect(pf.setPathTransparency).toHaveBeenCalledWith(75);
    await user.click(screen.getByRole('button', { name: 'Opaque background' })); expect(pf.setPathTransparency).toHaveBeenLastCalledWith(0); await user.click(screen.getByRole('button', { name: 'Restore view' })); expect(pf.cancelOperation).toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled();
  });
  it('includes arbitrary standalone endpoint names when preparing selected route rules', async () => {
    const user = userEvent.setup(); mount(); await user.type(screen.getByRole('textbox', { name: 'Path From location' }), 'Standalone source'); await user.type(screen.getByRole('textbox', { name: 'Path To location' }), 'Standalone destination');
    await user.click(screen.getByRole('tab', { name: 'Routes' })); await user.click(screen.getByRole('button', { name: 'Add current selection' })); await screen.findByRole('checkbox', { name: 'LV for rule 1' }); await user.click(screen.getByRole('button', { name: 'Prepare routes from all rules' }));
    expect(pf.prepareModel).toHaveBeenCalledWith({ routeRules: [{ id: expect.any(String), objectIds: [44], allowedCategories: ['LV', 'Control'] }], equipmentNames: ['Standalone source', 'Standalone destination', 'EQ-001', 'EQ-002'] }, expect.any(Function));
  });
  it('blocks calculations and review for dirty category rules, keeps the block on failed preparation, and permits explicit discard', async () => {
    const user = userEvent.setup(), detail = proposal(true); vi.mocked(usePathFinder).mockReturnValue({ ...proposalModel(), data: { ...pf.data, artifacts: [artifact()], proposals: [detail] }, readProposal: vi.fn(async () => detail), showPath: vi.fn(async () => 'displayed'), reviewProposal: vi.fn(async () => ({ reviewId: '88888888-8888-4888-8888-888888888888', proposal: detail })) }); mount();
    await user.click(screen.getByRole('button', { name: /=CABLE-1 — Ready for review/ })); await screen.findByText('Design length: 21 m'); await user.click(screen.getByRole('button', { name: 'Confirm proposal review' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeEnabled());
    await user.click(screen.getByRole('tab', { name: 'Routes' })); await user.click(screen.getByRole('button', { name: 'Add current selection' })); await screen.findByRole('checkbox', { name: 'LV for rule 1' }); await user.click(screen.getByRole('button', { name: 'Prepare routes from all rules' })); await user.click(screen.getByRole('tab', { name: 'Path' }));
    expect(screen.getByText('Route rules have changed. Prepare all rules in Routes or discard the draft before calculating, reviewing or applying Path results. Path lookup uses the active model independently.')).toBeVisible(); expect(screen.getByRole('button', { name: 'Calculate non-MV cables' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Calculate path' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeDisabled();
    await user.click(screen.getByRole('tab', { name: 'Routes' })); await user.click(screen.getByRole('button', { name: 'Discard route rule changes' })); await user.click(screen.getByRole('tab', { name: 'Path' }));
    expect(screen.getByRole('button', { name: 'Calculate non-MV cables' })).toBeEnabled(); expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeDisabled();
  });
  it('releases the dirty category rule gate only after successful preparation', async () => {
    const user = userEvent.setup(), prepareModel = vi.fn(async () => ({ artifactId: artifact().id, captureSummary: {} })); vi.mocked(usePathFinder).mockReturnValue({ ...pf, data: { ...pf.data, artifacts: [artifact()] }, prepareModel }); mount();
    await user.click(screen.getByRole('tab', { name: 'Routes' })); await user.click(screen.getByRole('button', { name: 'Add current selection' })); await screen.findByRole('checkbox', { name: 'LV for rule 1' }); await user.click(screen.getByRole('tab', { name: 'Path' })); expect(screen.getByRole('button', { name: 'Calculate non-MV cables' })).toBeDisabled();
    await user.click(screen.getByRole('tab', { name: 'Routes' })); await user.click(screen.getByRole('button', { name: 'Prepare routes from all rules' })); await screen.findByText('All route rules were prepared. Review category assignments and locations before using calculated results.'); await user.click(screen.getByRole('tab', { name: 'Path' })); expect(screen.getByRole('button', { name: 'Calculate non-MV cables' })).toBeEnabled();
  });
  it('cancels point picking and ignores a picked point delivered after switching tools', async () => {
    const user = userEvent.setup(); let finish!: (point: { objectId: number; point: [number, number, number]; derivation: 'picked-surface-point' }) => void;
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, pickPoint: vi.fn(() => new Promise<{ objectId: number; point: [number, number, number]; derivation: 'picked-surface-point' }>(resolve => { finish = resolve; })) }); mount();
    await user.click(screen.getByRole('button', { name: /=CABLE-1/ })); await user.click(screen.getByRole('button', { name: 'Resolve To' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Pick surface point in 3D' })).toBeEnabled()); await user.click(screen.getByRole('button', { name: 'Pick surface point in 3D' })); await user.click(screen.getByRole('tab', { name: 'Routes' }));
    await act(async () => finish({ objectId: 44, point: [9, 8, 7], derivation: 'picked-surface-point' })); await user.click(screen.getByRole('tab', { name: 'Path' })); expect(screen.getByRole('textbox', { name: 'Endpoint X in metres' })).toHaveValue(''); expect(pf.cancelPicking).toHaveBeenCalled(); expect(pf.saveLocation).not.toHaveBeenCalled();
  });
  it('reconciles the prepared rule baseline when an artifact save succeeds after viewer cancellation', async () => {
    const user = userEvent.setup(); let finish!: (value: { captureSummary: Record<string, unknown> }) => void;
    const prepareModel = vi.fn(() => new Promise<{ captureSummary: Record<string, unknown> }>(resolve => { finish = resolve; }));
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, data: { ...pf.data, artifacts: [artifact()] }, prepareModel }); mount();
    await user.click(screen.getByRole('tab', { name: 'Routes' })); await user.click(screen.getByRole('button', { name: 'Add current selection' })); await screen.findByRole('checkbox', { name: 'LV for rule 1' });
    await user.click(screen.getByRole('button', { name: 'Prepare routes from all rules' })); await waitFor(() => expect(prepareModel).toHaveBeenCalled()); await user.click(screen.getByRole('button', { name: 'Cancel route preparation' }));
    await act(async () => finish({ captureSummary: {} })); expect(screen.getByText('The snapshot was saved before cancellation completed. Its prepared rules were retained.')).toBeVisible(); expect(screen.getByRole('button', { name: 'Discard route rule changes' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'LV for rule 1' })); await user.click(screen.getByRole('button', { name: 'Discard route rule changes' })); expect(screen.getByRole('checkbox', { name: 'LV for rule 1' })).toBeChecked();
    await user.click(screen.getByRole('tab', { name: 'Path' })); expect(screen.getByRole('button', { name: 'Calculate non-MV cables' })).toBeEnabled();
  });
  it('runs Path lookup without a planning snapshot while dirty Routes continue to block Path', async () => {
    const user = userEvent.setup(), id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', startLookup = vi.fn(async () => id);
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, startLookup, readLookup: vi.fn(async () => lookup(id)), showPath: vi.fn(async () => 'displayed') }); mount();
    await user.click(screen.getByRole('tab', { name: 'Routes' })); await user.click(screen.getByRole('button', { name: 'Add current selection' })); await screen.findByRole('checkbox', { name: 'LV for rule 1' });
    await user.click(screen.getByRole('tab', { name: 'Path' })); expect(screen.getByRole('button', { name: 'Calculate path' })).toBeDisabled();
    await user.click(screen.getByRole('tab', { name: 'Path lookup' })); await user.type(screen.getByRole('textbox', { name: 'Path Finder ordered route' }), '/BC1/BC2');
    expect(screen.getByRole('button', { name: 'Show route' })).toBeEnabled(); await user.click(screen.getByRole('button', { name: 'Show route' })); await screen.findByText('Lookup complete — forward preview');
    expect(startLookup).toHaveBeenCalledWith('/BC1/BC2', false); expect(pf.prepareModel).not.toHaveBeenCalled(); expect(pf.uploadSnapshot).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Apply reviewed result' })).toBeNull(); expect(screen.getByRole('textbox', { name: 'Background transparency to apply percent' })).toBeVisible();
  });
  it('requires the active ready Viewer for independent lookup', async () => {
    const user = userEvent.setup(); vi.mocked(usePathFinder).mockReturnValue({ ...pf, viewerPhase: 'loading' }); mount();
    await user.click(screen.getByRole('tab', { name: 'Path lookup' })); await user.type(screen.getByRole('textbox', { name: 'Path Finder ordered route' }), '/BC1');
    expect(screen.getByRole('button', { name: 'Show route' })).toBeDisabled(); expect(pf.startLookup).not.toHaveBeenCalled();
  });
  it('clears a displayed lookup on route, reverse and copied-routing edits while preserving drafts', async () => {
    const user = userEvent.setup(), id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, data: { ...pf.data, cables: [{ ...pf.data.cables[0], routing: '/COPIED' }] }, startLookup: vi.fn(async () => id), readLookup: vi.fn(async () => lookup(id)), showPath: vi.fn(async () => 'displayed') }); mount();
    await user.click(screen.getByRole('button', { name: /=CABLE-1/ })); await user.click(screen.getByRole('tab', { name: 'Path lookup' }));
    const input = screen.getByRole('textbox', { name: 'Path Finder ordered route' }); await user.type(input, '/BC1/BC2'); await user.click(screen.getByRole('button', { name: 'Show route' })); await screen.findByText('The exact ordered lookup is displayed.');
    await user.type(input, '/BC3'); expect(screen.queryByRole('region', { name: 'Ordered lookup result' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show route' })); await screen.findByText('The exact ordered lookup is displayed.'); await user.click(screen.getByRole('checkbox', { name: 'Reverse route order' }));
    expect(screen.queryByRole('region', { name: 'Ordered lookup result' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show route' })); await screen.findByText('The exact ordered lookup is displayed.'); await user.click(screen.getByRole('button', { name: 'Use cable routing for lookup' }));
    expect(input).toHaveValue('/COPIED'); expect(screen.getByRole('checkbox', { name: 'Reverse route order' })).toBeChecked(); expect(screen.queryByRole('region', { name: 'Ordered lookup result' })).toBeNull();
  });
  it('cancels a pending model capture and cancels any late accepted lookup without displaying it', async () => {
    const user = userEvent.setup(), id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; let finish!: (value: string) => void;
    const startLookup = vi.fn(() => new Promise<string>(resolve => { finish = resolve; })); vi.mocked(usePathFinder).mockReturnValue({ ...pf, startLookup }); mount();
    await user.click(screen.getByRole('tab', { name: 'Path lookup' })); await user.type(screen.getByRole('textbox', { name: 'Path Finder ordered route' }), '/BC1'); await user.click(screen.getByRole('button', { name: 'Show route' }));
    expect(screen.getByRole('textbox', { name: 'Path Finder ordered route' })).toBeDisabled(); expect(screen.getByRole('checkbox', { name: 'Reverse route order' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Cancel lookup' })); expect(pf.cancelOperation).toHaveBeenCalled(); await act(async () => finish(id));
    expect(pf.action).toHaveBeenCalledWith(`/jobs/${id}`, undefined, 'DELETE'); expect(pf.readLookup).not.toHaveBeenCalled(); expect(pf.showPath).not.toHaveBeenCalled();
  });
  it('cancels the queued job and ignores its late completed response', async () => {
    const user = userEvent.setup(), id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; let finish!: (value: PathFinderLookup) => void;
    const readLookup = vi.fn(() => new Promise<PathFinderLookup>(resolve => { finish = resolve; }));
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, startLookup: vi.fn(async () => id), readLookup }); mount(); await user.click(screen.getByRole('tab', { name: 'Path lookup' }));
    await user.type(screen.getByRole('textbox', { name: 'Path Finder ordered route' }), '/BC1'); await user.click(screen.getByRole('button', { name: 'Show route' })); await waitFor(() => expect(readLookup).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'Cancel lookup' })); await act(async () => finish(lookup(id)));
    expect(pf.action).toHaveBeenCalledWith(`/jobs/${id}`, undefined, 'DELETE'); expect(pf.showPath).not.toHaveBeenCalled(); expect(screen.queryByRole('region', { name: 'Ordered lookup result' })).toBeNull();
  });
  it.each(['tab switch', 'shared Clear', 'project dependency change'])('cancels an acknowledged pending lookup when detached by %s', async detach => {
    const user = userEvent.setup(), id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; let finish!: (value: PathFinderLookup) => void;
    const readLookup = vi.fn(() => new Promise<PathFinderLookup>(resolve => { finish = resolve; }));
    const current = { ...pf, startLookup: vi.fn(async () => id), readLookup }; vi.mocked(usePathFinder).mockReturnValue(current); const view = mount();
    await user.click(screen.getByRole('tab', { name: 'Path lookup' })); await user.type(screen.getByRole('textbox', { name: 'Path Finder ordered route' }), '/BC1');
    await user.click(screen.getByRole('button', { name: 'Show route' })); await waitFor(() => expect(readLookup).toHaveBeenCalled());
    if (detach === 'tab switch') await user.click(screen.getByRole('tab', { name: 'Routes' }));
    else if (detach === 'shared Clear') await user.click(screen.getByRole('button', { name: 'Clear' }));
    else {
      vi.mocked(usePathFinder).mockReturnValue({ ...current, data: { ...current.data, settings: { ...current.data.settings, revision: '3' } } });
      view.rerender(<PathFinderTab projectId={projectId} loadedProjectId={projectId} token="isolated-test-token" accountId={accountId} isAdmin />);
    }
    expect(pf.action).toHaveBeenCalledTimes(1); expect(pf.action).toHaveBeenCalledWith(`/jobs/${id}`, undefined, 'DELETE');
    await act(async () => finish(lookup(id))); expect(pf.showPath).not.toHaveBeenCalled(); expect(screen.queryByRole('region', { name: 'Ordered lookup result' })).toBeNull();
  });
  it('shows actual nullable diagnostics and fallback warnings without inventing zero counts', async () => {
    const user = userEvent.setup(), id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', detail = lookup(id);
    detail.result!.diagnostics = { geometryLeavesUsed: 12, fallbackBends: 2, fallbackStraights: null, fallbackClearances: 3 };
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, startLookup: vi.fn(async () => id), readLookup: vi.fn(async () => detail), showPath: vi.fn(async () => 'displayed') }); mount();
    await user.click(screen.getByRole('tab', { name: 'Path lookup' })); await user.type(screen.getByRole('textbox', { name: 'Path Finder ordered route' }), '/BC1'); await user.click(screen.getByRole('button', { name: 'Show route' }));
    expect(await screen.findByText('Geometry leaves used: 12')).toBeVisible(); expect(screen.getByText('Prepared geometry fallbacks — bends: 2; straights: Unavailable; clearances: 3')).toBeVisible(); expect(screen.getByText('Connection gap used: 1 m')).toBeVisible();
    expect(screen.getByText('Some prepared geometry diagnostics are unavailable. Missing counts are not assumed to be zero.')).toBeVisible(); expect(screen.getByText('Fallback geometry exists in the prepared lookup network and may be outside the returned route. Review the relevant geometry against the model.')).toBeVisible();
  });
  it('fences a late model capture on a tab switch without losing the ordered-route draft', async () => {
    const user = userEvent.setup(), id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; let finish!: (value: string) => void;
    const startLookup = vi.fn(() => new Promise<string>(resolve => { finish = resolve; })); vi.mocked(usePathFinder).mockReturnValue({ ...pf, startLookup }); mount();
    await user.click(screen.getByRole('tab', { name: 'Path lookup' })); await user.type(screen.getByRole('textbox', { name: 'Path Finder ordered route' }), '/DRAFT'); await user.click(screen.getByRole('button', { name: 'Show route' }));
    await user.click(screen.getByRole('tab', { name: 'Path' })); await act(async () => finish(id)); expect(pf.action).toHaveBeenCalledWith(`/jobs/${id}`, undefined, 'DELETE'); expect(pf.readLookup).not.toHaveBeenCalled();
    await user.click(screen.getByRole('tab', { name: 'Path lookup' })); expect(screen.getByRole('textbox', { name: 'Path Finder ordered route' })).toHaveValue('/DRAFT'); expect(screen.queryByRole('region', { name: 'Ordered lookup result' })).toBeNull();
  });
  it('clears completed lookup display on a project revision change even when the gap value returns unchanged', async () => {
    const user = userEvent.setup(), id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const current = { ...pf, startLookup: vi.fn(async () => id), readLookup: vi.fn(async () => lookup(id)), showPath: vi.fn(async () => 'displayed') }; vi.mocked(usePathFinder).mockReturnValue(current); const view = mount();
    await user.click(screen.getByRole('tab', { name: 'Path lookup' })); await user.type(screen.getByRole('textbox', { name: 'Path Finder ordered route' }), '/BC1'); await user.click(screen.getByRole('button', { name: 'Show route' })); await screen.findByText('The exact ordered lookup is displayed.');
    const cleared = pf.clear.mock.calls.length; vi.mocked(usePathFinder).mockReturnValue({ ...current, data: { ...current.data, settings: { ...current.data.settings, revision: '3' } } }); view.rerender(<PathFinderTab projectId={projectId} loadedProjectId={projectId} token="isolated-test-token" accountId={accountId} isAdmin />);
    expect(screen.queryByRole('region', { name: 'Ordered lookup result' })).toBeNull(); expect(pf.clear.mock.calls.length).toBeGreaterThan(cleared); expect(screen.getByRole('textbox', { name: 'Path Finder ordered route' })).toHaveValue('/BC1'); expect(pf.action).not.toHaveBeenCalled();
  });
});
