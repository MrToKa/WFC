import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { usePathFinderCableWorkflow } from '@/hooks/usePathFinderCableWorkflow';
import { cableWorkflowPageSchema, type CableWorkflowRow } from '../../../shared/pathfinderCableWorkflow';
import { PathFinderNeedsRoutingList, cableWorkflowReason, type PathFinderNeedsRoutingListProps } from './PathFinderNeedsRoutingList';

vi.mock('@/hooks/usePathFinderCableWorkflow', () => ({ usePathFinderCableWorkflow: vi.fn() }));
const id = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const project = id(1), hash = 'a'.repeat(64), cable = id(10);
function page() {
  return cableWorkflowPageSchema.parse({ schemaVersion: 'wfc.pf.cable-workflow-page.v1', projectId: project, querySha256: hash, contextSha256: hash,
    scannedCount: 1, scannedThroughCableId: cable, nextCursor: null, rows: [{ projectId: project, mto: 'LV', cable: { id: cable, tag: '<b>C-001</b>', fromLocation: 'FROM-A', toLocation: 'TO-B', routing: null, designLength: null, installLength: '0', cableWriteRevision: '2' },
      from: { status: 'missing', pointAvailable: false, source: null, approximate: false, candidateObjectIds: [], reasonCode: 'LOCATION_MISSING', engineeringAccepted: false },
      to: { status: 'confirmed-ready', pointAvailable: true, source: 'confirmed-shared-location', approximate: false, candidateObjectIds: [], reasonCode: null, engineeringAccepted: false },
      calculation: { jobId: null, jobStatus: null, itemState: null, outcome: 'not-evaluated', reasonCodes: [], errorCode: null, currentness: 'not-evaluated', proposalId: null, proposalHash: null, reviewable: false, acceptedMatchesCurrent: false },
    }] });
}
function state() { return { identity: 'owned', page: page(), detail: null, loading: false, detailLoading: false, busy: false, enabled: true, error: null,
  hasPrevious: false, refresh: vi.fn(), nextPage: vi.fn(), previousPage: vi.fn(), readDetail: vi.fn() }; }
function props(): PathFinderNeedsRoutingListProps { return { projectId: project, loadedProjectId: project, accountId: id(2), token: 'token', isAdmin: true,
  active: true, modelScopeKey: 'current-model', preferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true }, onSelect: vi.fn() }; }
function mount(options = props()) { return render(<FluentProvider theme={webLightTheme}><PathFinderNeedsRoutingList {...options} /></FluentProvider>); }
beforeEach(() => { vi.resetAllMocks(); vi.mocked(usePathFinderCableWorkflow).mockReturnValue(state()); });

describe('read-only Needs routing list', () => {
  it('shows compact literal tag buttons without inline endpoint, reason or technical details', () => {
    const options = { ...props(), selectedCableId: cable }; mount(options);
    const tag = screen.getByRole('button', { name: '<b>C-001</b>' });
    expect(tag).toHaveAttribute('aria-pressed', 'true'); expect(tag.closest('li')?.textContent).toBe('<b>C-001</b>');
    expect(screen.queryByText(/From: FROM-A|To: TO-B|From point was not found|Technical details/)).not.toBeInTheDocument();
    expect(options.onSelect).not.toHaveBeenCalled(); fireEvent.click(tag); expect(options.onSelect).toHaveBeenCalledExactlyOnceWith(page().rows[0]);
    expect(document.querySelector('b')).toBeNull(); expect(screen.queryByRole('button', { name: /Apply|Calculate|Save/ })).not.toBeInTheDocument();
  });
  it('opens only the exact clicked compact row and leaves other cables unselected', () => {
    const current = state(), first = current.page.rows[0], second = { ...first, cable: { ...first.cable, id: id(11), tag: 'C-002' } };
    current.page = { ...current.page, rows: [first, second], scannedCount: 2, scannedThroughCableId: id(11) };
    vi.mocked(usePathFinderCableWorkflow).mockReturnValue(current);
    const options = props(); mount(options);
    expect(options.onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'C-002' }));
    expect(options.onSelect).toHaveBeenCalledExactlyOnceWith(second);
    expect(screen.getByRole('button', { name: '<b>C-001</b>' })).toHaveAttribute('aria-pressed', 'false');
  });
  it('submits literal search and state/preferences to the owned hook without writes', () => {
    mount(); fireEvent.change(screen.getByLabelText('Search tags, From or To'), { target: { value: '  Å_10%\\  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search cables' }));
    expect(vi.mocked(usePathFinderCableWorkflow).mock.calls.at(-1)?.[0].query).toMatchObject({ filter: 'needs-routing', search: '  Å_10%\\  ', secondaryDistanceMeters: 2, preferVerticalApproach: true, limit: 100 });
    fireEvent.change(screen.getByLabelText('Cable state'), { target: { value: 'ready-for-review' } });
    expect(vi.mocked(usePathFinderCableWorkflow).mock.calls.at(-1)?.[0].query?.filter).toBe('ready-for-review');
  });
  it('offers subsequent search results without manual scanning and never selects a match automatically', () => {
    const current = { ...state(), page: { ...page(), nextCursor: 'next_match' } }, options = props();
    vi.mocked(usePathFinderCableWorkflow).mockReturnValue(current); mount(options);
    fireEvent.change(screen.getByLabelText('Search tags, From or To'), { target: { value: 'C-001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search cables' }));
    expect(screen.queryByRole('button', { name: 'Continue scan' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('More matching results may be available.');
    fireEvent.click(screen.getByRole('button', { name: 'Next results' }));
    expect(current.nextPage).toHaveBeenCalledOnce(); expect(options.onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Apply|Calculate|Save/ })).not.toBeInTheDocument();
  });
  it('reports automatic search loading only after the draft is submitted', () => {
    const current = { ...state(), page: null, loading: true, busy: true };
    vi.mocked(usePathFinderCableWorkflow).mockReturnValue(current); mount();
    fireEvent.change(screen.getByLabelText('Search tags, From or To'), { target: { value: 'FROM-A' } });
    expect(screen.getByRole('status')).toHaveTextContent('Loading cable diagnostics…');
    fireEvent.click(screen.getByRole('button', { name: 'Search cables' }));
    expect(screen.getByRole('status')).toHaveTextContent('Searching for matching cables…');
    expect(screen.queryByRole('button', { name: 'Continue scan' })).not.toBeInTheDocument();
  });
  it('explains a completed empty search in the chosen state without changing that filter', () => {
    vi.mocked(usePathFinderCableWorkflow).mockReturnValue({ ...state(), page: { ...page(), rows: [] } }); mount();
    fireEvent.change(screen.getByLabelText('Search tags, From or To'), { target: { value: 'NOT-FOUND' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search cables' }));
    expect(screen.getByRole('status')).toHaveTextContent('Search complete.');
    expect(screen.getByText(/No cables match this search in the selected cable state/)).toHaveTextContent('Choose All non-MV cables to search other states.');
    expect(screen.getByLabelText('Cable state')).toHaveValue('needs-routing');
    expect(screen.getByRole('button', { name: 'Next results' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Cable state'), { target: { value: 'all' } });
    expect(screen.getByText('No non-MV cables match this search.')).toBeVisible();
  });
  it('keeps previous search results distinguishable from a globally empty search', () => {
    vi.mocked(usePathFinderCableWorkflow).mockReturnValue({ ...state(), hasPrevious: true, page: { ...page(), rows: [] } }); mount();
    fireEvent.change(screen.getByLabelText('Search tags, From or To'), { target: { value: 'C-001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search cables' }));
    expect(screen.getByText('No further matching cables. Previous results are still available.')).toBeVisible();
    expect(screen.queryByText(/No cables match this search in the selected cable state/)).not.toBeInTheDocument();
  });
  it('does not present an incomplete empty search as complete or require Continue scan', () => {
    vi.mocked(usePathFinderCableWorkflow).mockReturnValue({ ...state(), page: { ...page(), rows: [], nextCursor: 'next_200' } }); mount();
    fireEvent.change(screen.getByLabelText('Search tags, From or To'), { target: { value: 'C-001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search cables' }));
    expect(screen.getByText('The search is incomplete. Refresh cables to try again.')).toBeVisible();
    expect(screen.getByRole('status')).not.toHaveTextContent('Search complete.');
    expect(screen.getByRole('button', { name: 'Next results' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Continue scan' })).not.toBeInTheDocument();
  });
  it('refreshes a repeated normalized search on button or Enter submission, without duplicate first reads or writes', () => {
    const current = state(), options = props(); vi.mocked(usePathFinderCableWorkflow).mockReturnValue(current); mount(options);
    const input = screen.getByLabelText('Search tags, From or To');
    fireEvent.change(input, { target: { value: 'Å-10' } }); fireEvent.click(screen.getByRole('button', { name: 'Search cables' }));
    expect(current.refresh).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '  A\u030a-10  ' } }); fireEvent.click(screen.getByRole('button', { name: 'Search cables' }));
    expect(current.refresh).toHaveBeenCalledOnce();
    fireEvent.submit(input.closest('form')!); expect(current.refresh).toHaveBeenCalledTimes(2);
    expect(options.onSelect).not.toHaveBeenCalled(); expect(current.nextPage).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Apply|Calculate|Save/ })).not.toBeInTheDocument();
  });
  it('does not launch another read when the same search is submitted while busy', () => {
    const current = { ...state(), loading: true, busy: true }; vi.mocked(usePathFinderCableWorkflow).mockReturnValue(current); mount();
    fireEvent.change(screen.getByLabelText('Search tags, From or To'), { target: { value: 'C-001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search cables' }));
    fireEvent.click(screen.getByRole('button', { name: 'Search cables' }));
    expect(current.refresh).not.toHaveBeenCalled(); expect(current.nextPage).not.toHaveBeenCalled();
  });
  it('labels an empty continuing scan truthfully and provides explicit bounded navigation', () => {
    const current = { ...state(), page: { ...page(), rows: [], scannedCount: 200, nextCursor: 'next_200' }, hasPrevious: true };
    vi.mocked(usePathFinderCableWorkflow).mockReturnValue(current); mount();
    expect(screen.getByText(/No matches in this checked portion/)).toBeVisible(); expect(screen.getByRole('status')).toHaveTextContent('200 checked. More cables remain');
    expect(screen.queryByText(/No cables match this filter/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue scan' })); expect(current.nextPage).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' })); expect(current.previousPage).toHaveBeenCalledOnce();
  });
  it('does not call an empty final portion a globally empty result after earlier pages', () => {
    vi.mocked(usePathFinderCableWorkflow).mockReturnValue({ ...state(), hasPrevious: true, page: { ...page(), rows: [] } }); mount();
    expect(screen.getByText(/Previous pages may contain matches/)).toBeVisible(); expect(screen.getByRole('button', { name: 'Continue scan' })).toBeDisabled();
  });
  it('shows a completed empty scan only after exhaustion and disables selection/navigation during reads', () => {
    const current = { ...state(), loading: true, busy: true }; vi.mocked(usePathFinderCableWorkflow).mockReturnValue(current); const options = props(); const view = mount(options);
    expect(screen.getByRole('button', { name: '<b>C-001</b>' })).toBeDisabled(); expect(options.onSelect).not.toHaveBeenCalled();
    vi.mocked(usePathFinderCableWorkflow).mockReturnValue({ ...state(), page: { ...page(), rows: [] } }); view.rerender(<FluentProvider theme={webLightTheme}><PathFinderNeedsRoutingList {...options} /></FluentProvider>);
    expect(screen.getByText('No cables match this filter in the completed scan.')).toBeVisible();
  });
  it('renders no cable values without the owned active administrator scope', () => {
    const options = props(), view = mount({ ...options, isAdmin: false }); expect(screen.queryByRole('region')).not.toBeInTheDocument();
    view.rerender(<PathFinderNeedsRoutingList {...options} active={false} />); expect(screen.queryByText('<b>C-001</b>')).not.toBeInTheDocument();
  });
  it('resets search and filter drafts when the project or administrator login changes', () => {
    const options = props(), view = mount(options);
    fireEvent.change(screen.getByLabelText('Search tags, From or To'), { target: { value: 'private project endpoint' } });
    fireEvent.change(screen.getByLabelText('Cable state'), { target: { value: 'all' } });
    view.rerender(<FluentProvider theme={webLightTheme}><PathFinderNeedsRoutingList {...options} accountId={id(3)} token="new-login" /></FluentProvider>);
    expect(screen.getByLabelText('Search tags, From or To')).toHaveValue(''); expect(screen.getByLabelText('Cable state')).toHaveValue('needs-routing');
    expect(vi.mocked(usePathFinderCableWorkflow).mock.calls.at(-1)?.[0].query).toMatchObject({ search: '', filter: 'needs-routing' });
    fireEvent.change(screen.getByLabelText('Search tags, From or To'), { target: { value: 'another endpoint' } });
    view.rerender(<FluentProvider theme={webLightTheme}><PathFinderNeedsRoutingList {...options} projectId={id(4)} loadedProjectId={id(4)} /></FluentProvider>);
    expect(screen.getByLabelText('Search tags, From or To')).toHaveValue('');
    expect(screen.getByText(/Each page shows live observations/)).toBeVisible();
  });
  it.each([
    ['resource-limit', 'resource limit'], ['deadline-exceeded', 'timed out'], ['settings-required', 'Project Details'], ['model-required', 'active 3D model'],
  ] as const)('explains blocked %s without raw server text', (outcome, text) => {
    const row = page().rows[0]; const value = { ...row, calculation: { ...row.calculation, outcome } } as CableWorkflowRow;
    expect(cableWorkflowReason(value)).toContain(text);
  });
  it('distinguishes no-path from unresolved endpoints and a blocked sibling from a running item', () => {
    const row = page().rows[0], ready = { ...row.to };
    expect(cableWorkflowReason({ ...row, from: ready, calculation: { ...row.calculation, outcome: 'no-path' } })).toContain('Both endpoints are available, but no route was found');
    const blocked = { ...row, calculation: { ...row.calculation, jobId: id(30), jobStatus: 'running' as const, itemState: 'blocked' as const, outcome: 'locations-required' as const } };
    expect(cableWorkflowReason(blocked)).toContain('From point was not found'); expect(cableWorkflowReason(blocked)).not.toContain('being calculated');
  });
});

it('reports hover/focus and leave independently of explicit click, while Alt+Enter opens the selected cable', () => {
  const options = { ...props(), onPreview: vi.fn(), onPreviewLeave: vi.fn() }; mount(options);
  const tag = screen.getByRole('button', { name: '<b>C-001</b>' }); fireEvent.pointerEnter(tag);
  expect(options.onPreview).toHaveBeenCalledWith(page().rows[0], tag); expect(options.onSelect).not.toHaveBeenCalled();
  fireEvent.pointerLeave(tag); expect(options.onPreviewLeave).toHaveBeenCalledOnce();
  fireEvent.focus(tag); expect(options.onPreview).toHaveBeenCalledTimes(2); fireEvent.keyDown(tag, { key: 'Enter', altKey: true });
  expect(options.onSelect).toHaveBeenCalledExactlyOnceWith(page().rows[0]);
});
