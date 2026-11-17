import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { CableObstacleRemarks, CalculationObstacleText, ObstacleModelLink, obstacleTextParts } from './ObstacleModelLink';
import { fetchCableObstacleLinks } from '@/api/cableObstacleLinks';
import { fetchPathFinderProposal, type PathFinderProposal } from '@/api/pathfinder';
import type { CableObstacleLinks } from '../../../shared/pathfinderCableObstacleLinks';

const auth = vi.hoisted(() => ({ token: 'test-token' as string | null, user: { isAdmin: true } }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('@/api/cableObstacleLinks', () => ({ fetchCableObstacleLinks: vi.fn() }));
vi.mock('@/api/pathfinder', () => ({ fetchPathFinderProposal: vi.fn() }));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { projectId: id(1), modelVersionId: id(2), selectionRevision: '3', contentFingerprint: 'a'.repeat(64),
  captureFrameId: id(4), captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' as const };
const remarks = 'Manual note #999\r\n[PathFinder obstacles] Crosses obstacles: #18, #42.';
const links = (): CableObstacleLinks => ({ schemaVersion: 'wfc.pf.cable-obstacle-links.v1', projectId: id(1), cableId: id(5),
  cableWriteRevision: '7', remarks, status: 'recorded', source: { kind: 'apply-receipt', id: id(6) }, scope,
  obstacles: [18, 42].map(dbId => ({ dbId, selectionId: id(dbId), name: 'Floor', kind: 'floor' })) });
function Location() { const location = useLocation(); return <output data-testid="location">{JSON.stringify(location)}</output>; }
const app = (child: ReactNode) => <MemoryRouter initialEntries={['/cable']}>{child}<Location /></MemoryRouter>;
const location = () => JSON.parse(screen.getByTestId('location').textContent!);
const cable = (props: Partial<Parameters<typeof CableObstacleRemarks>[0]> = {}) => <CableObstacleRemarks projectId={id(1)} cableId={id(5)} remarks={remarks} {...props} />;
beforeEach(() => { vi.resetAllMocks(); auth.token = 'test-token'; auth.user = { isAdmin: true }; vi.mocked(fetchCableObstacleLinks).mockResolvedValue(links()); });
afterEach(cleanup);

describe('recorded obstacle links', () => {
  it('navigates result numbers with their exact recorded model and fresh click identity', () => {
    render(app(<ObstacleModelLink dbId={18} scope={scope} />));
    fireEvent.click(screen.getByRole('button', { name: 'Show obstacle #18 in 3D' }));
    expect(location()).toMatchObject({ pathname: `/projects/${id(1)}`, search: '?tab=pathfinder', state: { pathfinderObstacle: { ...scope, dbId: 18 } } });
    const first = location().state.pathfinderObstacle.requestId;
    fireEvent.click(screen.getByRole('button', { name: 'Show obstacle #18 in 3D' }));
    expect(location().state.pathfinderObstacle.requestId).not.toBe(first);
  });
  it('reads saved references only on click and keeps manual numbers as plain text', async () => {
    render(app(cable()));
    expect(screen.queryByRole('button', { name: 'Show obstacle #999 in 3D' })).toBeNull();
    expect(fetchCableObstacleLinks).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Show obstacle #42 in 3D' }));
    await waitFor(() => expect(location().state?.pathfinderObstacle.dbId).toBe(42));
    expect(fetchCableObstacleLinks).toHaveBeenCalledWith(id(1), id(5), 'test-token', expect.any(AbortSignal));
    expect(location().state.pathfinderObstacle).toMatchObject(scope);
  });
  it('shows only saved numbers below a multiline editing field when requested', () => {
    render(app(cable({ numbersOnly: true })));
    expect(screen.queryByText(/Manual note/)).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });
  it('does not send a non-admin reader to an unavailable model view', () => {
    auth.user = { isAdmin: false }; render(app(cable()));
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByTitle(/requires administrator access/)).toHaveTextContent('#18, #42');
    expect(fetchCableObstacleLinks).not.toHaveBeenCalled();
  });
  it.each(['unverified', 'changed', 'missing'])('does not navigate when saved references are %s', async cause => {
    const value = links();
    if (cause === 'unverified') Object.assign(value, { status: 'unverified', source: null, scope: null, obstacles: [] });
    if (cause === 'changed') value.remarks = 'Another route';
    if (cause === 'missing') value.obstacles = value.obstacles.filter(parent => parent.dbId !== 18);
    vi.mocked(fetchCableObstacleLinks).mockResolvedValue(value);
    render(app(cable())); fireEvent.click(screen.getByRole('button', { name: 'Show obstacle #18 in 3D' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeVisible());
    expect(location().pathname).toBe('/cable');
  });
  it('ignores an old asynchronous response after the displayed cable changes', async () => {
    let finish!: (value: CableObstacleLinks) => void;
    vi.mocked(fetchCableObstacleLinks).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = render(app(cable())); fireEvent.click(screen.getByRole('button', { name: 'Show obstacle #18 in 3D' }));
    view.rerender(app(cable({ cableId: id(8) })));
    await act(async () => finish(links()));
    expect(location().pathname).toBe('/cable'); expect(screen.queryByRole('alert')).toBeNull();
  });
  it('does not revive an unmounted Remarks action', async () => {
    let finish!: (value: CableObstacleLinks) => void;
    vi.mocked(fetchCableObstacleLinks).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = render(app(cable())); fireEvent.click(screen.getByRole('button', { name: 'Show obstacle #18 in 3D' }));
    view.rerender(app(null)); await act(async () => finish(links())); expect(location().pathname).toBe('/cable');
  });
  it('resolves blocking numbers from the exact failed proposal and refuses a different job', async () => {
    const value = { projectId: id(1), id: id(6), cableId: id(5), jobId: id(7), barriers: { context: { binding: { scope } },
      obstacleReport: { selectedParents: [{ dbId: 18, selectionId: id(18) }], crossedParentSelectionIds: [], blockingParentSelectionIds: [id(18)] } } } as unknown as PathFinderProposal;
    vi.mocked(fetchPathFinderProposal).mockResolvedValue(value);
    const props = { text: 'Blocking obstacles: #18.', projectId: id(1), cableId: id(5), jobId: id(7), proposalId: id(6), token: 'test-token' };
    const view = render(app(<CalculationObstacleText {...props} />));
    fireEvent.click(screen.getByRole('button', { name: 'Show obstacle #18 in 3D' }));
    await waitFor(() => expect(location().state?.pathfinderObstacle.dbId).toBe(18));
    view.unmount();
    vi.mocked(fetchPathFinderProposal).mockResolvedValue({ ...value, jobId: id(99) });
    render(app(<CalculationObstacleText {...props} />)); fireEvent.click(screen.getByRole('button', { name: 'Show obstacle #18 in 3D' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('does not belong to this calculation'));
    expect(location().pathname).toBe('/cable');
  });
  it('does not reinterpret arbitrary numbers, root ids or malformed ids as managed links', () => {
    const text = 'Manual #18\n[PathFinder obstacles] #0 #001 #2147483648 #42';
    expect(obstacleTextParts(text, true).filter(part => part.dbId !== undefined)).toEqual([{ text: '#42', dbId: 42 }]);
    render(<ObstacleModelLink dbId={18} scope={scope} />); expect(screen.getByText('#18')).toBeVisible();
  });
});
