import { FluentProvider, webDarkTheme, webLightTheme } from '@fluentui/react-components';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteCheckResult } from '@/viewer/routeValidation';
import { RoutingsViewerTab } from './RoutingsViewerTab';
import { useRoutingsViewer } from './hooks/useRoutingsViewer';
import { useRoutingCables } from './hooks/useRoutingCables';

vi.mock('./hooks/useRoutingsViewer', () => ({ useRoutingsViewer: vi.fn() }));
vi.mock('./hooks/useRoutingCables', () => ({ useRoutingCables: vi.fn() }));
vi.mock('./hooks/useRoutingsViewerHeight', () => ({ useRoutingsViewerHeight: () => 560 }));
const projectId = '11111111-1111-4111-8111-111111111111';
const modelId = '22222222-2222-4222-8222-222222222222';
type State = ReturnType<typeof useRoutingsViewer>;
let current: State;
let cables: ReturnType<typeof useRoutingCables>;
const combined = (status: RouteCheckResult['status'] = 'complete'): RouteCheckResult => ({
  protocolVersion: 1, projectId, modelVersionId: modelId, loadId: modelId, requestId: modelId,
  source: 'manual', cableId: null, rawRouting: '/BC001/SECONDARY/BC001', status, databaseCheck: 'available',
  segments: [0, 2].map(segmentIndex => ({ segmentIndex, token: 'BC001', key: 'BC001', project: { state: 'exists', matchCount: 1 }, model: { state: 'found', matchCount: 1, drawable: true } })),
  ignored: [{ segmentIndex: 1, token: 'SECONDARY', reason: 'SECONDARY' }], drawableCount: 2, lineCount: 1, warnings: [],
});
const view = (token: string | null = 'token-a', dark = false) => <FluentProvider theme={dark ? webDarkTheme : webLightTheme}>
  <RoutingsViewerTab projectId={projectId} loadedProjectId={projectId} token={token} />
</FluentProvider>;
beforeEach(() => {
  vi.clearAllMocks(); current = {
    scope: { projectId, loadedProjectId: projectId, token: 'token-a' }, phase: 'ready', message: 'The model and its identifiers are ready.',
    lifecycleKey: 'test-lifecycle', model: null, checking: false, result: null, operationId: null, currentRoute: null, canShow: true, canZoom: false,
    show: vi.fn(async () => {}), showCable: vi.fn(async () => {}), retryRoute: vi.fn(async () => {}), terminateAccess: vi.fn(), invalidateCableRoute: vi.fn(),
    clear: vi.fn(), zoom: vi.fn(), retry: vi.fn(),
  };
  cables = { scope: { projectId, token: 'token-a' }, cables: [], snapshotGeneration: 0, rows: [], omittedCount: 0, taggedCount: 0, hasSnapshot: false, hasActivated: false,
    loading: false, refreshing: false, stale: true, error: null, search: '', selectedCableId: null, selectedCable: null, selectedHidden: false, notice: null, canActivate: false,
    setSearch: vi.fn(), select: vi.fn(), refresh: vi.fn(async () => {}), getSelectedForRetry: vi.fn(() => null) };
  vi.mocked(useRoutingsViewer).mockImplementation(() => current);
  vi.mocked(useRoutingCables).mockImplementation(() => cables);
});
describe('Routings viewer controls', () => {
  it.each(['loading', 'no-model'] as const)('offers keyboard information while %s without enabling cable routing', phase => {
    const cable = { id: modelId, projectId, tag: 'Information only', routing: '/A', fromLocation: '  From\n日本語  ', toLocation: null };
    cables = { ...cables, cables: [cable], rows: [cable], snapshotGeneration: 1, hasSnapshot: true, hasActivated: true, stale: false, canActivate: true, taggedCount: 1 };
    current = { ...current, phase, canShow: false }; render(view()); fireEvent.click(screen.getByRole('tab', { name: 'Cables' }));
    const row = screen.getByRole('button', { name: cable.tag }); expect(row).toBeEnabled(); expect(row).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(row); expect(cables.select).not.toHaveBeenCalled(); expect(current.showCable).not.toHaveBeenCalled();
    fireEvent.keyDown(row, { key: 'Enter', altKey: true });
    const dialog = screen.getByRole('dialog'); expect(dialog).toHaveAttribute('aria-modal', 'false');
    expect(within(dialog).getByRole('textbox', { name: 'From' })).toHaveValue(cable.fromLocation);
    expect(within(dialog).getByRole('textbox', { name: 'To' })).toHaveValue('');
    expect(cables.select).not.toHaveBeenCalled(); expect(current.show).not.toHaveBeenCalled(); expect(current.showCable).not.toHaveBeenCalled();
  });
  it('keeps pinned unselected information and location refresh independent of the current Manual route', async () => {
    const cable = { id: modelId, projectId, tag: 'Unselected cable', routing: '/A', fromLocation: 'Before', toLocation: 'Destination' };
    cables = { ...cables, cables: [cable], rows: [cable], snapshotGeneration: 1, hasSnapshot: true, hasActivated: true, stale: false, canActivate: true, taggedCount: 1 };
    current = { ...current, result: combined(), currentRoute: { source: 'manual', cableId: null, rawRouting: '/BC001', operationId: 'existing' } };
    const h = render(view()); fireEvent.click(screen.getByRole('tab', { name: 'Cables' }));
    fireEvent.keyDown(screen.getByRole('button', { name: cable.tag }), { key: 'Enter', altKey: true });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Pin' }));
    const changed = { ...cable, fromLocation: 'After\nnew line', toLocation: null };
    cables = { ...cables, cables: [changed], rows: [changed], snapshotGeneration: 2 }; h.rerender(view());
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('textbox', { name: 'From' })).toHaveValue(changed.fromLocation));
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Copy From' })); });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(screen.getByTestId('current-routing-source')).toHaveTextContent('Manual routing');
    expect(cables.select).not.toHaveBeenCalled(); expect(current.show).not.toHaveBeenCalled(); expect(current.showCable).not.toHaveBeenCalled();
    expect(current.clear).not.toHaveBeenCalled(); expect(current.retry).not.toHaveBeenCalled();
  });
  it.each(['mode', 'token', 'model', 'access'] as const)('retires cable information on %s changes without clearing a route', change => {
    const cable = { id: modelId, projectId, tag: 'Scoped information', routing: '/A', fromLocation: 'From', toLocation: 'To' };
    cables = { ...cables, cables: [cable], rows: [cable], snapshotGeneration: 1, hasSnapshot: true, hasActivated: true, stale: false, canActivate: true, taggedCount: 1 };
    const h = render(view()); fireEvent.click(screen.getByRole('tab', { name: 'Cables' }));
    fireEvent.keyDown(screen.getByRole('button', { name: cable.tag }), { key: 'Enter', altKey: true }); expect(screen.getByRole('dialog')).toBeInTheDocument();
    if (change === 'mode') fireEvent.click(screen.getByRole('tab', { name: 'Manual routing' }));
    else if (change === 'token') h.rerender(view('another-token'));
    else { current = change === 'model' ? { ...current, lifecycleKey: 'another-load', phase: 'loading', canShow: false } : { ...current, phase: 'access-denied', canShow: false }; h.rerender(view()); }
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(current.clear).not.toHaveBeenCalled(); expect(current.showCable).not.toHaveBeenCalled();
  });
  it('starts in Manual routing without eager Cables activation or a duplicated standalone heading', () => {
    render(view());
    expect(screen.getByRole('tab', { name: 'Manual routing' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Cables' })).toBeEnabled();
    expect(useRoutingCables).toHaveBeenCalledWith(expect.objectContaining({ active: false, projectId, token: 'token-a' }));
    expect(screen.queryByRole('heading', { name: /3D viewer/ })).not.toBeInTheDocument();
    expect(useRoutingsViewer).toHaveBeenCalledWith(expect.objectContaining({ projectId, loadedProjectId: projectId, token: 'token-a' }));
    expect(screen.getByTestId('routings-layout')).toHaveStyle({ height: '560px' });
  });
  it('keeps the input editable during load but does not enable Show or Zoom before MODEL_LOADED', () => {
    current = { ...current, phase: 'loading', canShow: false, message: 'Loading the model…' };
    render(view());
    expect(screen.getByRole('textbox', { name: 'Manual routing' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Show route' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zoom to route' })).toBeDisabled();
  });
  it('uses explicit Show and retains text when clearing or showing the whole model', () => {
    render(view()); const input = screen.getByRole('textbox', { name: 'Manual routing' });
    fireEvent.change(input, { target: { value: '/BC001/SECONDARY' } });
    expect(current.show).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Show route' })); expect(current.show).toHaveBeenCalledWith('/BC001/SECONDARY');
    fireEvent.click(screen.getByRole('button', { name: 'Clear' })); fireEvent.click(screen.getByRole('button', { name: 'Show entire model' }));
    expect(current.clear).toHaveBeenCalledTimes(2); expect(input).toHaveValue('/BC001/SECONDARY');
  });
  it('offers the keyboard route action and lets a new Show supersede a pending check', () => {
    current.checking = true; render(view());
    const input = screen.getByRole('textbox', { name: 'Manual routing' }); fireEvent.change(input, { target: { value: '/BC001' } });
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true }); expect(current.show).toHaveBeenCalledWith('/BC001');
    expect(screen.getByRole('button', { name: 'Show route' })).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent('Checking this route');
  });
  it.each(['no-model', 'missing-model', 'unavailable', 'access-denied', 'error'] as const)('shows the %s state with explicit Retry', phase => {
    current = { ...current, phase, canShow: false, message: `State: ${phase}` }; render(view());
    expect(screen.getByTestId('routings-viewer-status')).toHaveAttribute('data-phase', phase);
    expect(screen.getByText(`State: ${phase}`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' })); expect(current.retry).toHaveBeenCalledOnce();
  });
  it('asks for a fresh login without offering an ineffective automatic retry loop', () => {
    current = { ...current, phase: 'login-required', canShow: false, message: 'Sign in again to open the protected model.' }; render(view());
    expect(screen.getByText(/Sign in again/)).toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });
  it('shows each repeated occurrence and independent DB/model details without hiding ignored markers', () => {
    current = { ...current, result: combined(), operationId: 'attempt-a', canZoom: true }; render(view());
    expect(screen.getByRole('region', { name: 'Route check result' })).toHaveAttribute('data-operation-id', 'attempt-a');
    expect(screen.getByText('The route is complete in the project and model.')).toBeInTheDocument();
    expect(screen.getByText('1 SECONDARY marker ignored.')).toBeInTheDocument();
    const rows = document.querySelectorAll('tr[data-route-key="BC001"]'); expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute('data-segment-index', '0'); expect(rows[1]).toHaveAttribute('data-segment-index', '2');
    expect(rows[0]).toHaveAttribute('data-project-state', 'exists'); expect(rows[0]).toHaveAttribute('data-drawable', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom to route' })); expect(current.zoom).toHaveBeenCalledOnce();
  });
  it('reports project absence while preserving the drawable model and approximate warnings', () => {
    const value = combined('partial'); value.segments[0].project = { state: 'missing', matchCount: 0 };
    value.warnings = [{ code: 'PROJECT_MISSING', segmentIndex: 0, message: 'BC001 does not exist in this project.' }, { code: 'APPROXIMATE_CONNECTOR', segmentIndex: null, message: 'An approximate visual connector was used.' }];
    current = { ...current, result: value, canZoom: true }; render(view('token-a', true));
    expect(screen.getByText('The route checks are incomplete. Review the project and model results below.')).toBeInTheDocument();
    expect(screen.getByText('BC001 does not exist in this project.')).toBeInTheDocument(); expect(screen.getByText(/approximate visual connector/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zoom to route' })).toBeEnabled();
    expect(screen.getByText(/not engineering evidence/)).toBeInTheDocument();
  });
  it('retries the explicit last route after a DB outage instead of relabelling it missing', () => {
    const value = combined('partial'); value.databaseCheck = 'unavailable'; value.segments.forEach(segment => { segment.project = { state: 'unavailable', matchCount: null }; });
    current.result = value; render(view());
    fireEvent.change(screen.getByRole('textbox', { name: 'Manual routing' }), { target: { value: '/OTHER' } });
    fireEvent.click(screen.getByRole('button', { name: 'Retry route check' })); expect(current.retryRoute).toHaveBeenCalledWith(undefined);
    expect(document.querySelector('tr[data-project-state="missing"]')).toBeNull();
  });
  it('scopes manual text to the project login, while retry and Clear leave the current draft intact', () => {
    const h = render(view()); const input = screen.getByRole('textbox', { name: 'Manual routing' }); fireEvent.change(input, { target: { value: '/PRIVATE' } });
    h.rerender(view('token-b')); expect(screen.getByRole('textbox', { name: 'Manual routing' })).toHaveValue('');
    fireEvent.change(screen.getByRole('textbox', { name: 'Manual routing' }), { target: { value: '/NEW' } });
    h.rerender(view('token-b')); expect(screen.getByRole('textbox', { name: 'Manual routing' })).toHaveValue('/NEW');
  });
  it('activates Cables lazily and clicks the exact UUID/routing of separate duplicate-tag buttons', () => {
    const first = { id: modelId, projectId, fromLocation: null, toLocation: null, tag: 'DUP', routing: '/A' }, second = { ...first, id: projectId, routing: '/B' };
    cables = { ...cables, cables: [first, second], rows: [first, second], taggedCount: 2, hasActivated: true, hasSnapshot: true, stale: false, canActivate: true };
    vi.mocked(cables.select).mockImplementation(id => cables.cables.find(cable => cable.id === id) ?? null);
    render(view()); fireEvent.click(screen.getByRole('tab', { name: 'Cables' }));
    expect(useRoutingCables).toHaveBeenLastCalledWith(expect.objectContaining({ active: true }));
    const rows = screen.getAllByRole('button', { name: 'DUP' }); expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute('data-cable-id', first.id); expect(rows[1]).toHaveAttribute('data-cable-id', second.id);
    fireEvent.click(rows[1]); expect(cables.select).toHaveBeenCalledWith(second.id); expect(current.showCable).toHaveBeenCalledWith(second);
    expect(current.show).not.toHaveBeenCalled(); expect(screen.queryByRole('button', { name: 'Show route' })).not.toBeInTheDocument();
    expect(rows[1]).toHaveTextContent('DUP'); expect(rows[1]).not.toHaveAttribute('title');
  });
  it('preserves manual draft and the current cable source across mode switches without reloading the model', () => {
    const h = render(view()); fireEvent.change(screen.getByRole('textbox', { name: 'Manual routing' }), { target: { value: '/MANUAL' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Cables' }));
    current = { ...current, currentRoute: { operationId: 'current', rawRouting: '/CABLE', source: 'cable', cableId: modelId } };
    cables = { ...cables, cables: [{ id: modelId, projectId, fromLocation: null, toLocation: null, tag: 'Visible cable', routing: '/CABLE' }] }; h.rerender(view());
    expect(screen.getByTestId('current-routing-source')).toHaveTextContent('Cable: Visible cable');
    fireEvent.click(screen.getByRole('tab', { name: 'Manual routing' }));
    expect(screen.getByRole('textbox', { name: 'Manual routing' })).toHaveValue('/MANUAL');
    expect(screen.getByTestId('current-routing-source')).toHaveTextContent('Cable: Visible cable'); expect(current.retry).not.toHaveBeenCalled(); expect(current.showCable).not.toHaveBeenCalled();
  });
  it('keeps search usable while model loading and never queues a disabled row click', () => {
    const cable = { id: modelId, projectId, fromLocation: null, toLocation: null, tag: 'Cable', routing: '/A' };
    cables = { ...cables, cables: [cable], rows: [cable], hasActivated: true, hasSnapshot: true, stale: false, canActivate: true, taggedCount: 1 };
    current = { ...current, canShow: false, phase: 'loading' }; render(view()); fireEvent.click(screen.getByRole('tab', { name: 'Cables' }));
    expect(screen.getByRole('textbox', { name: 'Search cable tags' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cable' })); expect(current.showCable).not.toHaveBeenCalled();
    expect(screen.getByText('Wait until the model is ready before selecting a cable route.')).toBeInTheDocument();
  });
  it('distinguishes empty, all-untagged, no-match and stale lists from failed loading', () => {
    const h = render(view()); fireEvent.click(screen.getByRole('tab', { name: 'Cables' })); expect(screen.getByText('Loading cables…')).toBeInTheDocument();
    cables = { ...cables, hasActivated: true, hasSnapshot: false, error: 'Cable list failed.' }; h.rerender(view());
    expect(screen.getByTestId('routing-cables-status')).toHaveAttribute('data-state', 'error'); expect(screen.queryByText('This project has no cables.')).not.toBeInTheDocument();
    cables = { ...cables, hasSnapshot: true, error: null, stale: false }; h.rerender(view()); expect(screen.getByText('This project has no cables.')).toBeInTheDocument();
    cables = { ...cables, cables: [{ id: modelId, projectId, fromLocation: null, toLocation: null, tag: null, routing: null }], omittedCount: 1 }; h.rerender(view()); expect(screen.getByText('All cables in this project are without a tag.')).toBeInTheDocument();
    expect(screen.getByText('1 cable without a tag is not shown.')).toBeInTheDocument();
    cables = { ...cables, taggedCount: 1, search: 'NONE' }; h.rerender(view()); expect(screen.getByText('No cable tags match this search.')).toBeInTheDocument();
    cables = { ...cables, stale: true, error: 'Refresh failed.' }; h.rerender(view()); expect(screen.getByTestId('routing-cables-status')).toHaveAttribute('data-state', 'stale');
    fireEvent.click(screen.getByRole('button', { name: 'Retry cables' })); expect(cables.refresh).toHaveBeenCalledOnce();
  });
  it('labels a hidden remembered selection without treating it as the current Manual route', () => {
    const cable = { id: modelId, projectId, fromLocation: null, toLocation: null, tag: 'Hidden cable', routing: '/A' };
    cables = { ...cables, selectedCable: cable, selectedCableId: modelId, selectedHidden: true };
    current.currentRoute = { operationId: 'current', rawRouting: '/MANUAL', source: 'manual', cableId: null };
    render(view()); fireEvent.click(screen.getByRole('tab', { name: 'Cables' }));
    expect(screen.getByTestId('selected-routing-cable')).toHaveTextContent('Selected cable: Hidden cable');
    expect(screen.getByText('The selected cable is hidden by this filter.')).toBeInTheDocument();
    expect(screen.getByTestId('current-routing-source')).toHaveTextContent('Manual routing');
  });
  it('uses only a fresh confirmed selected snapshot for cable Retry, preserving its source', () => {
    const cable = { id: modelId, projectId, fromLocation: null, toLocation: null, tag: 'A', routing: '/LATEST' }; const result = combined('partial'); result.source = 'cable'; result.cableId = modelId; result.databaseCheck = 'unavailable';
    current = { ...current, currentRoute: { operationId: 'old', rawRouting: '/OLD', source: 'cable', cableId: modelId }, result };
    cables = { ...cables, selectedCable: cable, selectedCableId: modelId, canActivate: true };
    vi.mocked(cables.getSelectedForRetry).mockReturnValue(cable); const h = render(view());
    fireEvent.click(screen.getByRole('button', { name: 'Retry route check' })); expect(current.retryRoute).toHaveBeenCalledWith(cable); expect(current.show).not.toHaveBeenCalled();
    cables = { ...cables, canActivate: false, stale: true }; h.rerender(view()); expect(screen.getByRole('button', { name: 'Retry route check' })).toBeDisabled();
  });
  it('gives a cable-specific empty routing explanation and Clear removes its displayed-source claim', () => {
    const result = combined('empty'); result.source = 'cable'; result.cableId = modelId; result.segments = []; result.ignored = []; result.drawableCount = 0; result.lineCount = 0;
    result.warnings = [{ code: 'ENTER_ROUTE', segmentIndex: null, message: 'Enter a route.' }];
    current = { ...current, result, currentRoute: { operationId: 'empty', rawRouting: '', source: 'cable', cableId: modelId } };
    const h = render(view()); expect(screen.getByText('This cable has no drawable routing.')).toBeInTheDocument(); expect(screen.queryByText('Enter a route.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' })); expect(current.clear).toHaveBeenCalledOnce();
    current = { ...current, result: null, currentRoute: null }; h.rerender(view()); expect(screen.getByText('No route is displayed.')).toBeInTheDocument();
  });
  it.each(['access-denied', 'login-required'] as const)('hides cached cable labels and disables reads immediately on independent viewer %s', phase => {
    const cable = { id: modelId, projectId, fromLocation: null, toLocation: null, tag: 'Private cable', routing: '/A' };
    cables = { ...cables, cables: [cable], rows: [cable], selectedCable: cable, selectedCableId: modelId, hasSnapshot: true, hasActivated: true, canActivate: true };
    const h = render(view()); fireEvent.click(screen.getByRole('tab', { name: 'Cables' })); expect(screen.getByRole('button', { name: 'Private cable' })).toBeInTheDocument();
    current = { ...current, phase, canShow: false }; h.rerender(view());
    expect(useRoutingCables).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: null, active: false }));
    expect(screen.queryByRole('button', { name: 'Private cable' })).not.toBeInTheDocument(); expect(screen.queryByTestId('selected-routing-cable')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh cables' })).toBeDisabled();
  });
});
