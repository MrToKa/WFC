import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectPreparationPanel } from './ProjectPreparationPanel';
import { useProjectPreparation } from './hooks/useProjectPreparation';
import { preparationFixture } from '@/test/preparationFixtures';
import type { usePathFinder } from './hooks/usePathFinder';
import { fetchRoutingPurposePolicy } from '@/api/pathfinderPolicies';

vi.mock('./hooks/useProjectPreparation', () => ({ useProjectPreparation: vi.fn() }));
vi.mock('@/api/pathfinderPolicies', () => ({ fetchRoutingPurposePolicy: vi.fn() }));
const fixture = preparationFixture();
function setup() {
  const state = { enabled: true, loading: false, busy: false, unknown: false, conflict: false, error: null, notice: null, progress: null,
    context: structuredClone(fixture.context), session: structuredClone(fixture.session), discovery: null, networkReady: true, networkReadinessKey: 'verified-network-trace',
    checkTrays: vi.fn(async () => {}), assignTray: vi.fn(async () => {}), freezePlan: vi.fn(), collect: vi.fn(), publish: vi.fn(), pause: vi.fn(), cancel: vi.fn() };
  const read = vi.fn(async () => ({ objects: [] as Array<{objectId: number}> }));
  const readMetadata = vi.fn<() => Promise<{ objects: Array<{objectId:number;parentId:number|null}> } | null>>(async () => {
    const selected = await read.mock.results.at(-1)?.value;
    return { objects: (selected?.objects ?? []).map((object: {objectId: number}) => ({ objectId: object.objectId, parentId: 20 })) };
  });
  const showTray = vi.fn(async () => true);
  const hideTray = vi.fn(async () => true);
  const pf = { preparationAccess: { projectId: state.context.projectId, token: 'test-token' }, data: { activeModel: { ...state.context.scope } }, preparationViewerGeneration: 1, viewerPhase: 'ready', busy: false,
    showTray, hideTray, runProjectPreparation: vi.fn(async (_scope, operation) => operation({ readTrayRootSelection: read, readSelection: readMetadata })) } as unknown as ReturnType<typeof usePathFinder>;
  vi.mocked(useProjectPreparation).mockReturnValue(state as unknown as ReturnType<typeof useProjectPreparation>);
  return { state, pf, read, readMetadata, showTray, hideTray, tray: state.context.trays[0] };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchRoutingPurposePolicy).mockResolvedValue({ schemaVersion: 'pathfinder.routing-purpose-policy.v1', projectId: fixture.context.projectId,
    catalogRevision: fixture.context.scope.catalogRevision, routingPolicyRevision: fixture.context.scope.routingPolicyRevision,
    rules: [{ purposeKey: fixture.context.trays[0].purposeKey!, allowedCategories: ['Power', 'VFD'] }] });
});
afterEach(async () => { await act(async () => {}); });

describe('simple project tray preparation', () => {
  it('explains missing permissions even when every tray has assigned objects', () => {
    const { state, pf, tray } = setup(); state.networkReady = false; tray.policyState = 'unconfigured';
    render(<ProjectPreparationPanel pf={pf} active />);
    const alert = screen.getByRole('alert', { name: 'Network preparation blockers' });
    expect(alert).toHaveTextContent('Assigned objects are saved');
    expect(alert).toHaveTextContent('Routing permissions are missing'); expect(alert).toHaveTextContent(tray.rawName);
    expect(screen.getByText('Assigned')).toBeVisible();
    expect(screen.getByRole('button', { name: `Use current model selection for ${tray.rawName}` })).toBeEnabled();
  });
  it('shows all current plan blockers and retires old diagnostics after a policy revision', () => {
    const { state, pf, tray } = setup(); state.networkReady = false;
    state.session.plan.diagnostics = [{ code: 'TRAY_GEOMETRY_MISSING', projectTrayIds: [tray.projectTrayId], objectIds: [], message: 'Generic refusal' },
      { code: 'NON_LEAF_ROUTING_GEOMETRY', projectTrayIds: [tray.projectTrayId], objectIds: [], message: 'Generic refusal' }];
    const view = render(<ProjectPreparationPanel pf={pf} active />);
    const alert = screen.getByRole('alert', { name: 'Network preparation blockers' });
    expect(alert).toHaveTextContent('no usable tray geometry'); expect(alert).toHaveTextContent('parent object has its own geometry');
    state.context.scope.routingPolicyRevision = '2'; view.rerender(<ProjectPreparationPanel pf={pf} active />);
    expect(screen.queryByRole('alert', { name: 'Network preparation blockers' })).toBeNull();
  });
  it('does not display preparation blockers for another active model', () => {
    const { state, pf, tray } = setup(); state.networkReady = false; tray.policyState = 'unconfigured';
    render(<ProjectPreparationPanel pf={{ ...pf, data: { ...pf.data!, activeModel: { ...pf.data!.activeModel, modelVersionId: '22222222-2222-4222-8222-222222222223' } } }} active />);
    expect(screen.queryByRole('alert', { name: 'Network preparation blockers' })).toBeNull();
  });
  it('shows the project tray type and width by height in millimetres for an assigned tray', () => {
    const { pf, tray } = setup(); tray.details = { type: 'Cable ladder RA 60', widthMm: 600, heightMm: 77 };
    render(<ProjectPreparationPanel pf={pf} active />);
    const card = within(screen.getByRole('article', { name: `Tray ${tray.rawName}` }));
    expect(card.getByText('Assigned')).toBeVisible(); expect(card.getByText('Type')).toBeVisible();
    expect(card.getByText('Cable ladder RA 60')).toBeVisible(); expect(card.getByText('Width × height')).toBeVisible();
    expect(card.getByText('600 × 77 mm')).toBeVisible();
  });
  it('preserves fractional and zero dimensions while showing missing values without inventing zero', () => {
    const { pf, tray } = setup(); tray.details = { type: null, widthMm: 600.125, heightMm: 0 };
    const view = render(<ProjectPreparationPanel pf={pf} active />);
    expect(screen.getByText('Not specified')).toBeVisible(); expect(screen.getByText('600.125 × 0 mm')).toBeVisible();
    tray.details = { type: null, widthMm: null, heightMm: 77 }; view.rerender(<ProjectPreparationPanel pf={pf} active />);
    expect(screen.getByText('— × 77 mm')).toBeVisible(); expect(screen.queryByText('0 × 77 mm')).toBeNull();
  });
  it('keeps an older context without tray details usable without claiming a type or dimension', () => {
    const { pf, tray } = setup(); delete tray.details;
    render(<ProjectPreparationPanel pf={pf} active />);
    expect(screen.getByText('Not available')).toBeVisible(); expect(screen.getByText('— × — mm')).toBeVisible();
    expect(screen.getByRole('button', { name: `Use current model selection for ${tray.rawName}` })).toBeEnabled();
  });
  it('reveals details after assignment and retires them when the current model changes', () => {
    const { pf, state, tray } = setup(); tray.details = { type: 'Cable ladder RA 60', widthMm: 600, heightMm: 77 };
    const resolution = { id: 'tray-decision', projectTrayId: tray.projectTrayId, mode: 'exclude' as const, rootObjectIds: [],
      scope: { ...state.context.scope }, reason: 'Selection pending', actorId: 'admin', createdAt: '2026-10-29T00:00:00Z' };
    state.context.resolutions = [resolution];
    const view = render(<ProjectPreparationPanel pf={pf} active />);
    expect(screen.getByText('Not assigned')).toBeVisible(); expect(screen.queryByText('Cable ladder RA 60')).toBeNull();
    state.context.resolutions = [{ ...resolution, mode: 'roots', rootObjectIds: ['dbid:23'] }];
    view.rerender(<ProjectPreparationPanel pf={pf} active />);
    expect(screen.getByText('600 × 77 mm')).toBeVisible();
    const changedPf = { ...pf, data: { ...pf.data!, activeModel: { ...pf.data!.activeModel, modelVersionId: '22222222-2222-4222-8222-222222222223' } } };
    view.rerender(<ProjectPreparationPanel pf={changedPf} active />);
    expect(screen.queryByText('Cable ladder RA 60')).toBeNull(); expect(screen.queryByText('600 × 77 mm')).toBeNull();
  });
  it('has one network action plus show and immediate selection on each tray', () => {
    const { state, pf, tray } = setup(); render(<ProjectPreparationPanel pf={pf} active />);
    expect(screen.getAllByRole('button')).toHaveLength(3);
    expect(screen.getByText('Purpose and routing permission')).toBeVisible();
    expect(screen.getByRole('button', { name: `Show tray ${tray.rawName}` })).toBeVisible();
    expect(screen.getByRole('button', { name: `Use current model selection for ${tray.rawName}` })).toBeVisible();
    for (const text of ['Model selection:', 'Traceability', 'Model revision changes', 'Saved preparation plan', 'Save preparation plan',
      'Collect geometry', 'Save prepared network', 'Resolution reason', 'Exact candidates and coverage', 'Audited manual resolution'])
      expect(screen.queryByText(text)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Discover project tray candidates' }));
    expect(state.checkTrays).toHaveBeenCalledOnce();
    expect(state.freezePlan).not.toHaveBeenCalled(); expect(state.collect).not.toHaveBeenCalled(); expect(state.publish).not.toHaveBeenCalled();
  });
  it('assigns the fresh model selection immediately with no separate save', async () => {
    const { state, pf, tray, read } = setup(); read.mockResolvedValue({ objects: [{ objectId: 55 }, { objectId: 99 }] });
    render(<ProjectPreparationPanel pf={pf} active />);
    fireEvent.click(screen.getByRole('button', { name: `Use current model selection for ${tray.rawName}` }));
    await waitFor(() => expect(state.assignTray).toHaveBeenCalledExactlyOnceWith(tray.projectTrayId, ['dbid:55', 'dbid:99']));
    expect(pf.runProjectPreparation).toHaveBeenCalledWith(state.context.scope, expect.any(Function));
    expect(screen.queryByText(/unsaved|Save confirmed/)).toBeNull();
  });
  it('shows project Cable types Purpose permissions instead of the engine capture mask', async () => {
    const { pf } = setup(); render(<ProjectPreparationPanel pf={pf} active />);
    expect(await screen.findByText(/Power, VFD/)).toBeVisible(); expect(screen.queryByText('MV, LV, Control')).toBeNull();
  });
  it('assigns a verified physical selection without requiring an initial tray check', async () => {
    const { state, pf, tray, read, readMetadata } = setup(); read.mockResolvedValue({ objects: [{ objectId: 55 }] });
    vi.mocked(useProjectPreparation).mockReturnValue({ ...state, session: null, discovery: null } as unknown as ReturnType<typeof useProjectPreparation>);
    render(<ProjectPreparationPanel pf={pf} active />);
    const choose = screen.getByRole('button', { name: `Use current model selection for ${tray.rawName}` });
    expect(choose).toBeEnabled(); fireEvent.click(choose);
    await waitFor(() => expect(state.assignTray).toHaveBeenCalledExactlyOnceWith(tray.projectTrayId, ['dbid:55']));
    expect(readMetadata).toHaveBeenCalledOnce(); expect(state.checkTrays).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Discover project tray candidates' })).toBeEnabled();
  });
  it.each(['global-root', 'null', 'empty', 'mismatched'] as const)('refuses an unverified first assignment with %s metadata', async kind => {
    const { state, pf, tray, read, readMetadata } = setup(); read.mockResolvedValue({ objects: [{ objectId: 55 }] });
    readMetadata.mockResolvedValueOnce(kind === 'null' ? null : kind === 'empty' ? { objects: [] }
      : { objects: [{ objectId: kind === 'mismatched' ? 66 : 55, parentId: kind === 'global-root' ? null : 20 }] });
    vi.mocked(useProjectPreparation).mockReturnValue({ ...state, session: null, discovery: null } as unknown as ReturnType<typeof useProjectPreparation>);
    render(<ProjectPreparationPanel pf={pf} active />);
    fireEvent.click(screen.getByRole('button', { name: `Use current model selection for ${tray.rawName}` }));
    expect(await screen.findByRole('alert')).toHaveTextContent(kind === 'global-root' ? 'physical tray'
      : kind === 'null' ? 'could not be verified' : 'selection changed');
    expect(state.assignTray).not.toHaveBeenCalled();
  });
  it('accepts a known same-model physical root without requiring a prior plan or new parent metadata', async () => {
    const { state, pf, tray, read, readMetadata } = setup(); read.mockResolvedValue({ objects: [{ objectId: 55 }] }); readMetadata.mockResolvedValue(null);
    state.context.resolutions = [{ id: 'known-root', projectTrayId: tray.projectTrayId, mode: 'roots', rootObjectIds: ['dbid:55'],
      scope: { ...state.context.scope }, reason: 'Known physical tray', actorId: 'admin', createdAt: '2026-10-27T00:00:00Z' }];
    vi.mocked(useProjectPreparation).mockReturnValue({ ...state, session: null, discovery: null } as unknown as ReturnType<typeof useProjectPreparation>);
    render(<ProjectPreparationPanel pf={pf} active />);
    fireEvent.click(screen.getByRole('button', { name: `Use current model selection for ${tray.rawName}` }));
    await waitFor(() => expect(state.assignTray).toHaveBeenCalledExactlyOnceWith(tray.projectTrayId, ['dbid:55']));
    expect(readMetadata).not.toHaveBeenCalled();
  });
  it('keeps the assignment busy until its network update finishes', async () => {
    const { state, pf, tray, read } = setup(); read.mockResolvedValue({ objects: [{ objectId: 55 }] });
    let finish!: () => void;
    state.assignTray.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    render(<ProjectPreparationPanel pf={pf} active />);
    const choose = screen.getByRole('button', { name: `Use current model selection for ${tray.rawName}` });
    fireEvent.click(choose); await waitFor(() => expect(state.assignTray).toHaveBeenCalledOnce());
    expect(choose).toBeDisabled(); expect(screen.getByRole('button', { name: 'Discover project tray candidates' })).toBeDisabled();
    await act(async () => finish()); expect(choose).toBeEnabled();
  });
  it('explains an empty selection without saving an empty assignment', async () => {
    const { state, pf, tray } = setup(); render(<ProjectPreparationPanel pf={pf} active />);
    fireEvent.click(screen.getByRole('button', { name: `Use current model selection for ${tray.rawName}` }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Select the matching tray in the model first.');
    expect(state.assignTray).not.toHaveBeenCalled();
  });
  it('rejects an explicitly known global model root without rejecting a known tray root', async () => {
    const { state, pf, tray, read } = setup();
    state.session.plan.objectManifest.push({ objectId: 'dbid:9', parentId: null, name: 'Whole model', hasGeometry: false, isPhysicalLeaf: false, orderIndex: 9 });
    read.mockResolvedValueOnce({ objects: [{ objectId: 9 }] }).mockResolvedValueOnce({ objects: [{ objectId: 1 }] });
    render(<ProjectPreparationPanel pf={pf} active />);
    const choose = screen.getByRole('button', { name: `Use current model selection for ${tray.rawName}` });
    fireEvent.click(choose); expect(await screen.findByRole('alert')).toHaveTextContent('physical tray');
    expect(state.assignTray).not.toHaveBeenCalled();
    fireEvent.click(choose); await waitFor(() => expect(state.assignTray).toHaveBeenCalledWith(tray.projectTrayId, ['dbid:1']));
  });
  it('reads real selected-node evidence after an all-missing check before assigning unknown roots', async () => {
    const { state, pf, tray, read, readMetadata } = setup(); state.session.plan.objectManifest = [];
    state.session.plan.requestedScope.trays = [];
    read.mockResolvedValueOnce({ objects: [{ objectId: 9 }] }).mockResolvedValueOnce({ objects: [{ objectId: 55 }] });
    readMetadata.mockResolvedValueOnce({ objects: [{ objectId: 9, parentId: null }] }).mockResolvedValueOnce({ objects: [{ objectId: 55, parentId: 20 }] });
    render(<ProjectPreparationPanel pf={pf} active />);
    const choose = screen.getByRole('button', { name: `Use current model selection for ${tray.rawName}` });
    fireEvent.click(choose); expect(await screen.findByRole('alert')).toHaveTextContent('physical tray'); expect(state.assignTray).not.toHaveBeenCalled();
    fireEvent.click(choose); await waitFor(() => expect(state.assignTray).toHaveBeenCalledWith(tray.projectTrayId, ['dbid:55']));
    expect(readMetadata).toHaveBeenCalledTimes(2);
  });
  it('discards a pending selection when the model or scope changes', async () => {
    const { state, pf, tray, read } = setup(); let finish!: (value: { objects: Array<{objectId:number}> }) => void;
    read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<ProjectPreparationPanel pf={pf} active />);
    fireEvent.click(screen.getByRole('button', { name: `Use current model selection for ${tray.rawName}` }));
    const changed = { ...state, context: { ...state.context, scope: { ...state.context.scope, contentFingerprint: 'd'.repeat(64) } } };
    vi.mocked(useProjectPreparation).mockReturnValue(changed as unknown as ReturnType<typeof useProjectPreparation>);
    view.rerender(<ProjectPreparationPanel pf={pf} active />);
    await act(async () => finish({ objects: [{ objectId: 55 }] })); expect(state.assignTray).not.toHaveBeenCalled();
  });
  it('shows a ready network even when some trays still need a selection', () => {
    const { state, pf } = setup(), extra = { ...state.context.trays[0], projectTrayId: '85000000-0000-4000-8000-000000000001', rawName: 'A120' };
    state.context.trays.push(extra);
    state.context.currentAggregate = { ...state.context.scope, sessionId: state.session.id } as typeof state.context.currentAggregate;
    render(<ProjectPreparationPanel pf={pf} active />);
    expect(screen.getByRole('status')).toHaveTextContent('Network ready. 1 of 2 trays assigned; 1 still need a model selection.');
    expect(screen.getByRole('button', { name: 'Discover project tray candidates' })).toBeEnabled();
  });
  it('waits for the verified frame proof before showing ready or refreshing obstacles', () => {
    const { state, pf } = setup(), ready = vi.fn();
    state.context.currentAggregate = { ...state.context.scope } as typeof state.context.currentAggregate;
    state.networkReady = false;
    const view = render(<ProjectPreparationPanel pf={pf} active onNetworkReady={ready} />);
    expect(screen.queryByText(/Network ready/)).toBeNull(); expect(ready).not.toHaveBeenCalled();
    state.networkReady = true;
    view.rerender(<ProjectPreparationPanel pf={pf} active onNetworkReady={ready} />);
    expect(screen.getByRole('status')).toHaveTextContent('Network ready.');
    expect(ready).toHaveBeenCalledExactlyOnceWith('verified-network-trace');
    view.rerender(<ProjectPreparationPanel pf={pf} active onNetworkReady={ready} />);
    expect(ready).toHaveBeenCalledTimes(1);
  });
  it('does not show ready for an aggregate from a different model or mapping revision', () => {
    const { state, pf } = setup();
    state.context.currentAggregate = { ...state.context.scope, resolutionRevision: '99' } as typeof state.context.currentAggregate;
    render(<ProjectPreparationPanel pf={pf} active />); expect(screen.queryByText(/Network ready/)).toBeNull();
  });
  it('does not retain ready or assigned labels when the Viewer switches to another model', () => {
    const { state, pf } = setup();
    state.context.currentAggregate = { ...state.context.scope } as typeof state.context.currentAggregate;
    const view = render(<ProjectPreparationPanel pf={pf} active />);
    expect(screen.getByRole('status')).toHaveTextContent('Network ready.');
    const changed = { ...pf, data: { ...pf.data!, activeModel: { ...pf.data!.activeModel, contentFingerprint: 'e'.repeat(64) } } };
    view.rerender(<ProjectPreparationPanel pf={changed} active />);
    expect(screen.queryByText(/Network ready/)).toBeNull(); expect(screen.getByText('Not assigned')).toBeVisible();
  });
  it('searches all trays without requiring pagination controls', () => {
    const { state, pf, tray } = setup();
    state.context.trays = Array.from({ length: 55 }, (_, index) => ({ ...tray, projectTrayId: `tray-${index}`, rawName: index === 54 ? 'A105' : `BC${index}`, routeName: `/BC${index}` }));
    render(<ProjectPreparationPanel pf={pf} active />);
    fireEvent.change(screen.getByLabelText('Search project trays'), { target: { value: '/a105' } });
    expect(screen.getByRole('article', { name: 'Tray A105' })).toBeVisible();
    expect(screen.getAllByRole('article')).toHaveLength(1); expect(screen.queryByRole('button', { name: /Next/ })).toBeNull();
  });
  it('names the recovery action while an earlier update is unknown and leaves assignment disabled', () => {
    const { state, pf, tray } = setup(); state.unknown = true;
    render(<ProjectPreparationPanel pf={pf} active />);
    expect(screen.getByText('An earlier tray update needs checking. Use Retry tray update to continue.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry tray update' }));
    expect(state.checkTrays).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: `Use current model selection for ${tray.rawName}` })).toBeDisabled();
  });
  it('restores assignment controls after retry reconciles an unknown update without remounting', async () => {
    const { state, pf, tray, read } = setup(); read.mockResolvedValue({ objects: [{ objectId: 55 }] });
    let finish!: () => void; state.checkTrays.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const unresolved = { ...state, unknown: true, networkReady: false,
      error: 'The command outcome is unknown. Retry the same command before making further changes.' };
    vi.mocked(useProjectPreparation).mockReturnValue(unresolved as unknown as ReturnType<typeof useProjectPreparation>);
    const view = render(<ProjectPreparationPanel pf={pf} active />);
    const choose = screen.getByRole('button', { name: `Use current model selection for ${tray.rawName}` }); expect(choose).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry tray update' }));
    vi.mocked(useProjectPreparation).mockReturnValue({ ...unresolved, busy: true, progress: 'Checking the saved tray update…' } as unknown as ReturnType<typeof useProjectPreparation>);
    view.rerender(<ProjectPreparationPanel pf={pf} active />);
    expect(screen.getByRole('button', { name: 'Checking tray update…' })).toBeDisabled();
    expect(screen.getByRole('progressbar', { name: 'Checking the saved tray update…' })).toBeVisible();
    expect(choose).toBeDisabled(); expect(state.assignTray).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
    await act(async () => finish());
    vi.mocked(useProjectPreparation).mockReturnValue(state as unknown as ReturnType<typeof useProjectPreparation>);
    view.rerender(<ProjectPreparationPanel pf={pf} active />);
    expect(screen.getByRole('button', { name: `Use current model selection for ${tray.rawName}` })).toBe(choose); expect(choose).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Discover project tray candidates' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Retry tray update' })).toBeNull(); expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(choose); await waitFor(() => expect(state.assignTray).toHaveBeenCalledExactlyOnceWith(tray.projectTrayId, ['dbid:55']));
    expect(state.checkTrays).toHaveBeenCalledOnce();
  });
  it('keeps an unresolved retry available after its busy phase while preserving the assignment gate', async () => {
    const { state, pf, tray } = setup();
    let finish!: () => void; state.checkTrays.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const unresolved = { ...state, unknown: true, networkReady: false,
      error: 'The command outcome is unknown. Retry the same command before making further changes.' };
    vi.mocked(useProjectPreparation).mockReturnValue(unresolved as unknown as ReturnType<typeof useProjectPreparation>);
    const view = render(<ProjectPreparationPanel pf={pf} active />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry tray update' }));
    vi.mocked(useProjectPreparation).mockReturnValue({ ...unresolved, busy: true } as unknown as ReturnType<typeof useProjectPreparation>);
    view.rerender(<ProjectPreparationPanel pf={pf} active />);
    const checking = screen.getByRole('button', { name: 'Checking tray update…' }); expect(checking).toBeDisabled();
    expect(screen.getByRole('progressbar', { name: 'Checking the earlier tray update…' })).toBeVisible();
    fireEvent.click(checking); expect(state.checkTrays).toHaveBeenCalledOnce();
    await act(async () => finish());
    vi.mocked(useProjectPreparation).mockReturnValue(unresolved as unknown as ReturnType<typeof useProjectPreparation>);
    view.rerender(<ProjectPreparationPanel pf={pf} active />);
    const retry = screen.getByRole('button', { name: 'Retry tray update' }); expect(retry).toBeEnabled();
    expect(screen.getByRole('alert')).toHaveTextContent('The command outcome is unknown');
    expect(screen.getByRole('button', { name: `Use current model selection for ${tray.rawName}` })).toBeDisabled();
    expect(screen.getByRole('button', { name: `Show tray ${tray.rawName}` })).toBeEnabled();
    fireEvent.click(retry); expect(state.checkTrays).toHaveBeenCalledTimes(2); expect(state.assignTray).not.toHaveBeenCalled();
  });
  it('keeps failed network creation visible instead of claiming ready', () => {
    const { state, pf } = setup();
    vi.mocked(useProjectPreparation).mockReturnValue({ ...state, error: 'The model could not be read. Try checking the trays again.' } as unknown as ReturnType<typeof useProjectPreparation>);
    render(<ProjectPreparationPanel pf={pf} active />);
    expect(screen.getByRole('alert')).toHaveTextContent('model could not be read'); expect(screen.queryByText(/Network ready/)).toBeNull();
  });
});

describe('project tray inspection', () => {
  it('waits for show and hide acknowledgements without changing assignments or creating global busy feedback', async () => {
    const { state, pf, tray, showTray, hideTray, read, readMetadata } = setup(), busy = vi.fn();
    let finish!: (shown: boolean) => void; showTray.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    let finishHide!: (hidden: boolean) => void; hideTray.mockImplementationOnce(() => new Promise(resolve => { finishHide = resolve; }));
    const view = render(<ProjectPreparationPanel pf={pf} active onBusyChange={busy} />);
    const show = screen.getByRole('button', { name: `Show tray ${tray.rawName}` });
    fireEvent.click(show);
    expect(showTray).toHaveBeenCalledExactlyOnceWith(state.context.scope, [1]);
    expect(show).toHaveTextContent('Showing tray…'); expect(show).toBeDisabled();
    expect(screen.getByRole('button', { name: `Use current model selection for ${tray.rawName}` })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Discover project tray candidates' })).toBeDisabled();
    expect(screen.queryByText('Tray shown in model.')).toBeNull();
    expect(busy.mock.calls.every(([value]) => value === false)).toBe(true);
    await act(async () => finish(true));
    expect(screen.getByText('Tray shown in model.')).toBeVisible(); expect(show).toBeEnabled();
    const hide = screen.getByRole('button', { name: `Hide tray ${tray.rawName}` }); expect(hide).toHaveTextContent(/^Hide$/);
    expect(screen.getByRole('button', { name: `Use current model selection for ${tray.rawName}` })).toBeEnabled();
    fireEvent.click(hide);
    expect(hideTray).toHaveBeenCalledExactlyOnceWith(state.context.scope);
    expect(hide).toHaveTextContent('Hiding tray…'); expect(hide).toBeDisabled();
    expect(screen.getByRole('button', { name: `Hide tray ${tray.rawName}` })).toBe(hide);
    expect(screen.queryByRole('button', { name: `Show tray ${tray.rawName}` })).toBeNull();
    expect(screen.getByRole('button', { name: `Use current model selection for ${tray.rawName}` })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Discover project tray candidates' })).toBeDisabled();
    await act(async () => finishHide(true));
    expect(screen.getByRole('button', { name: `Show tray ${tray.rawName}` })).toHaveTextContent('Show tray');
    expect(screen.queryByText('Tray shown in model.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Discover project tray candidates' })).toBeEnabled();
    expect(busy.mock.calls.every(([value]) => value === false)).toBe(true);
    expect(state.assignTray).not.toHaveBeenCalled(); expect(state.checkTrays).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled(); expect(readMetadata).not.toHaveBeenCalled(); expect(pf.runProjectPreparation).not.toHaveBeenCalled();
    view.unmount(); expect(hideTray).toHaveBeenCalledTimes(1);
  });
  it('shows every manually assigned root before frozen or automatic roots', async () => {
    const { state, pf, tray, showTray } = setup();
    state.context.resolutions = [{ id: 'manual', projectTrayId: tray.projectTrayId, mode: 'roots', rootObjectIds: ['dbid:99', 'dbid:55'],
      scope: { ...state.context.scope }, reason: 'Assigned physical tray', actorId: 'admin', createdAt: '2026-10-27T00:00:00Z' }];
    render(<ProjectPreparationPanel pf={pf} active />);
    fireEvent.click(screen.getByRole('button', { name: `Show tray ${tray.rawName}` }));
    await waitFor(() => expect(screen.getByText('Tray shown in model.')).toBeVisible());
    expect(showTray).toHaveBeenCalledExactlyOnceWith(state.context.scope, [99, 55]); expect(state.assignTray).not.toHaveBeenCalled();
  });
  it('moves the Hide action to the last tray shown and blocks switching while hide is pending', async () => {
    const { state, pf, tray, showTray, hideTray } = setup();
    const nextTray = { ...tray, projectTrayId: '85000000-0000-4000-8000-000000000001', rawName: 'A120' };
    state.context.trays.push(nextTray);
    state.context.resolutions = [{ id: 'second-tray', projectTrayId: nextTray.projectTrayId, mode: 'roots', rootObjectIds: ['dbid:55'],
      scope: { ...state.context.scope }, reason: 'Assigned physical tray', actorId: 'admin', createdAt: '2026-10-27T00:00:00Z' }];
    let finishHide!: (hidden: boolean) => void; hideTray.mockImplementationOnce(() => new Promise(resolve => { finishHide = resolve; }));
    render(<ProjectPreparationPanel pf={pf} active />);
    fireEvent.click(screen.getByRole('button', { name: `Show tray ${tray.rawName}` }));
    await screen.findByRole('button', { name: `Hide tray ${tray.rawName}` });
    fireEvent.click(screen.getByRole('button', { name: `Show tray ${nextTray.rawName}` }));
    const hide = await screen.findByRole('button', { name: `Hide tray ${nextTray.rawName}` });
    expect(screen.getByRole('button', { name: `Show tray ${tray.rawName}` })).toBeEnabled();
    expect(showTray).toHaveBeenNthCalledWith(1, state.context.scope, [1]);
    expect(showTray).toHaveBeenNthCalledWith(2, state.context.scope, [55]);
    expect(hideTray).not.toHaveBeenCalled();
    fireEvent.click(hide);
    expect(screen.getByRole('button', { name: `Show tray ${tray.rawName}` })).toBeDisabled();
    await act(async () => finishHide(true));
    expect(screen.getAllByRole('button', { name: /^Show tray / })).toHaveLength(2);
    expect(hideTray).toHaveBeenCalledExactlyOnceWith(state.context.scope);
    expect(state.assignTray).not.toHaveBeenCalled(); expect(state.checkTrays).not.toHaveBeenCalled();
  });
  it.each(['refused', 'error'] as const)('preserves the shown tray’s Hide action when the next display is %s', async outcome => {
    const { state, pf, tray, showTray, hideTray } = setup();
    const nextTray = { ...tray, projectTrayId: '85000000-0000-4000-8000-000000000001', rawName: 'A120' };
    state.context.trays.push(nextTray);
    state.context.resolutions = [{ id: 'second-tray', projectTrayId: nextTray.projectTrayId, mode: 'roots', rootObjectIds: ['dbid:55'],
      scope: { ...state.context.scope }, reason: 'Assigned physical tray', actorId: 'admin', createdAt: '2026-10-27T00:00:00Z' }];
    showTray.mockResolvedValueOnce(true);
    if (outcome === 'refused') showTray.mockResolvedValueOnce(false); else showTray.mockRejectedValueOnce(new Error('Viewer preflight failed'));
    render(<ProjectPreparationPanel pf={pf} active />);
    fireEvent.click(screen.getByRole('button', { name: `Show tray ${tray.rawName}` }));
    await screen.findByRole('button', { name: `Hide tray ${tray.rawName}` });
    fireEvent.click(screen.getByRole('button', { name: `Show tray ${nextTray.rawName}` }));
    const nextCard = screen.getByRole('article', { name: `Tray ${nextTray.rawName}` });
    expect(await within(nextCard).findByRole('alert')).toHaveTextContent('The tray could not be shown.');
    const hide = screen.getByRole('button', { name: `Hide tray ${tray.rawName}` }); expect(hide).toBeEnabled();
    expect(within(screen.getByRole('article', { name: `Tray ${tray.rawName}` })).getByText('Tray shown in model.')).toBeVisible();
    expect(within(nextCard).getByRole('button', { name: `Show tray ${nextTray.rawName}` })).toBeEnabled();
    expect(hideTray).not.toHaveBeenCalled(); fireEvent.click(hide);
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^Show tray / })).toHaveLength(2));
    expect(hideTray).toHaveBeenCalledExactlyOnceWith(state.context.scope);
    expect(screen.queryByText('Tray shown in model.')).toBeNull();
    expect(state.assignTray).not.toHaveBeenCalled(); expect(state.checkTrays).not.toHaveBeenCalled();
  });
  it.each(['refused', 'error'] as const)('keeps a %s hide retryable without claiming the normal view was restored', async outcome => {
    const { state, pf, tray, hideTray } = setup();
    if (outcome === 'refused') hideTray.mockResolvedValueOnce(false); else hideTray.mockRejectedValueOnce(new Error('Viewer failure'));
    render(<ProjectPreparationPanel pf={pf} active />);
    fireEvent.click(screen.getByRole('button', { name: `Show tray ${tray.rawName}` }));
    const hide = await screen.findByRole('button', { name: `Hide tray ${tray.rawName}` }); fireEvent.click(hide);
    expect(await screen.findByRole('alert')).toHaveTextContent('The normal model view could not be restored. Check the model and select Hide to try again.');
    expect(hide).toBeEnabled(); expect(hide).toHaveTextContent(/^Hide$/);
    expect(screen.queryByRole('button', { name: `Show tray ${tray.rawName}` })).toBeNull();
    fireEvent.click(hide);
    expect(await screen.findByRole('button', { name: `Show tray ${tray.rawName}` })).toBeEnabled();
    expect(screen.queryByRole('alert')).toBeNull(); expect(hideTray).toHaveBeenCalledTimes(2);
    expect(state.assignTray).not.toHaveBeenCalled(); expect(state.checkTrays).not.toHaveBeenCalled();
  });
  it('can inspect ambiguous candidates during a read-only status check without ready-network or mutation authority', async () => {
    const { state, pf, tray, showTray } = setup(); state.busy = true; state.loading = true; state.unknown = true; state.conflict = true; state.networkReady = false;
    state.context.trays[0].policyState = 'excluded'; state.session.plan.requestedScope.trays = [];
    const discovery = { schemaVersion: 'wfc.pf.discovery-report.v1', modelVersionId: state.context.scope.modelVersionId,
      contentFingerprint: state.context.scope.contentFingerprint, selectionRevision: state.context.scope.selectionRevision,
      matchingPolicyVersion: 'wfc.pf.project-exact-candidates.v1', complete: true, propertyScan: null, objects: [],
      trays: [{ projectTrayId: tray.projectTrayId, candidateRootObjectIds: ['dbid:72', 'dbid:73'] }], endpointCandidates: [] };
    vi.mocked(useProjectPreparation).mockReturnValue({ ...state, discovery } as unknown as ReturnType<typeof useProjectPreparation>);
    render(<ProjectPreparationPanel pf={pf} active />);
    const show = screen.getByRole('button', { name: `Show tray ${tray.rawName}` }); expect(show).toBeEnabled(); fireEvent.click(show);
    await waitFor(() => expect(showTray).toHaveBeenCalledExactlyOnceWith(state.context.scope, [72, 73]));
    expect(state.assignTray).not.toHaveBeenCalled(); expect(state.checkTrays).not.toHaveBeenCalled();
  });
  it('renders Show tray on missing cards with a visible explanation and does not display unrelated objects', () => {
    const { state, pf, tray, showTray } = setup();
    const missing = { ...tray, projectTrayId: '85000000-0000-4000-8000-000000000001', rawName: 'A120' }; state.context.trays.push(missing);
    render(<ProjectPreparationPanel pf={pf} active />);
    expect(screen.getAllByRole('button', { name: /^Show tray / })).toHaveLength(2);
    const card = screen.getByRole('article', { name: 'Tray A120' }), show = within(card).getByRole('button', { name: 'Show tray A120' });
    expect(show).toBeDisabled(); expect(within(card).getByText(/No model objects for this tray/)).toBeVisible();
    fireEvent.click(show); expect(showTray).not.toHaveBeenCalled(); expect(state.assignTray).not.toHaveBeenCalled();
  });
  it.each(['refused', 'error'] as const)('reports a %s display without claiming success or changing assignments', async outcome => {
    const { state, pf, tray, showTray } = setup();
    if (outcome === 'refused') showTray.mockResolvedValueOnce(false); else showTray.mockRejectedValueOnce(new Error('Viewer failure'));
    render(<ProjectPreparationPanel pf={pf} active />);
    const show = screen.getByRole('button', { name: `Show tray ${tray.rawName}` }); fireEvent.click(show);
    expect(await screen.findByRole('alert')).toHaveTextContent('The tray could not be shown.');
    expect(screen.queryByText('Tray shown in model.')).toBeNull(); expect(show).toBeEnabled(); expect(state.assignTray).not.toHaveBeenCalled();
  });
  it.each(['refused', 'error'] as const)('allows Hide recovery after an initial %s show while keeping Show retryable', async outcome => {
    const { state, pf, tray, showTray, hideTray } = setup();
    if (outcome === 'refused') showTray.mockResolvedValueOnce(false); else showTray.mockRejectedValueOnce(new Error('Tray appearance rollback failed'));
    const view = render(<ProjectPreparationPanel pf={pf} active />);
    fireEvent.click(screen.getByRole('button', { name: `Show tray ${tray.rawName}` }));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: `Show tray ${tray.rawName}` })).toBeEnabled();
    const hide = screen.getByRole('button', { name: `Hide tray ${tray.rawName}` }); expect(hide).toBeEnabled();
    expect(screen.queryByText('Tray shown in model.')).toBeNull(); fireEvent.click(hide);
    await waitFor(() => expect(screen.queryByRole('button', { name: `Hide tray ${tray.rawName}` })).toBeNull());
    expect(screen.getByRole('button', { name: `Show tray ${tray.rawName}` })).toBeEnabled();
    expect(screen.queryByRole('alert')).toBeNull(); expect(hideTray).toHaveBeenCalledExactlyOnceWith(state.context.scope);
    expect(state.assignTray).not.toHaveBeenCalled(); expect(state.checkTrays).not.toHaveBeenCalled();
    view.unmount(); expect(hideTray).toHaveBeenCalledTimes(1);
  });
  it.each(['refused', 'error'] as const)('retains cleanup ownership after an initial %s show', async outcome => {
    const { state, pf, tray, showTray, hideTray } = setup();
    if (outcome === 'refused') showTray.mockResolvedValueOnce(false); else showTray.mockRejectedValueOnce(new Error('Tray appearance rollback failed'));
    const view = render(<ProjectPreparationPanel pf={pf} active />);
    fireEvent.click(screen.getByRole('button', { name: `Show tray ${tray.rawName}` })); await screen.findByRole('alert');
    view.unmount(); expect(hideTray).toHaveBeenCalledExactlyOnceWith(state.context.scope);
  });
  it.each(['generation', 'model', 'access', 'inactive', 'scope'] as const)('ignores a late display acknowledgement after a %s change', async change => {
    const { state, pf, tray, showTray } = setup(); let finish!: (shown: boolean) => void;
    showTray.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<ProjectPreparationPanel pf={pf} active />);
    fireEvent.click(screen.getByRole('button', { name: `Show tray ${tray.rawName}` }));
    const next = change === 'generation' ? { ...pf, preparationViewerGeneration: 2 }
      : change === 'model' ? { ...pf, data: { ...pf.data!, activeModel: { ...pf.data!.activeModel, contentFingerprint: 'e'.repeat(64) } } }
        : change === 'access' ? { ...pf, preparationAccess: { ...pf.preparationAccess, token: 'new-login' } } : pf;
    if (change === 'scope') vi.mocked(useProjectPreparation).mockReturnValue({ ...state,
      context: { ...state.context, scope: { ...state.context.scope, routingPolicyRevision: '9' } } } as unknown as ReturnType<typeof useProjectPreparation>);
    view.rerender(<ProjectPreparationPanel pf={next} active={change !== 'inactive'} />);
    await act(async () => finish(true));
    expect(screen.queryByText('Tray shown in model.')).toBeNull(); expect(screen.queryByText(/The tray could not be shown/)).toBeNull();
    expect(screen.getByRole('button', { name: `Show tray ${tray.rawName}` })).toHaveTextContent('Show tray');
    if (change === 'scope') {
      const show = screen.getByRole('button', { name: `Show tray ${tray.rawName}` }); expect(show).toBeEnabled(); fireEvent.click(show);
      expect(await screen.findByText('Tray shown in model.')).toBeVisible(); expect(showTray).toHaveBeenCalledTimes(2);
    }
  });
  it.each(['generation', 'model', 'access', 'inactive', 'scope'] as const)('ignores a late hide failure after a %s change', async change => {
    const { state, pf, tray, hideTray } = setup(); let finish!: (hidden: boolean) => void;
    hideTray.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<ProjectPreparationPanel pf={pf} active />);
    fireEvent.click(screen.getByRole('button', { name: `Show tray ${tray.rawName}` }));
    fireEvent.click(await screen.findByRole('button', { name: `Hide tray ${tray.rawName}` }));
    const next = change === 'generation' ? { ...pf, preparationViewerGeneration: 2 }
      : change === 'model' ? { ...pf, data: { ...pf.data!, activeModel: { ...pf.data!.activeModel, contentFingerprint: 'e'.repeat(64) } } }
        : change === 'access' ? { ...pf, preparationAccess: { ...pf.preparationAccess, token: 'new-login' } } : pf;
    if (change === 'scope') vi.mocked(useProjectPreparation).mockReturnValue({ ...state,
      context: { ...state.context, scope: { ...state.context.scope, routingPolicyRevision: '9' } } } as unknown as ReturnType<typeof useProjectPreparation>);
    view.rerender(<ProjectPreparationPanel pf={next} active={change !== 'inactive'} />);
    await act(async () => finish(false));
    expect(screen.getByRole('button', { name: `Show tray ${tray.rawName}` })).toHaveTextContent('Show tray');
    expect(screen.queryByRole('button', { name: `Hide tray ${tray.rawName}` })).toBeNull();
    expect(screen.queryByText(/could not be restored/)).toBeNull();
    expect(screen.queryByText('Tray shown in model.')).toBeNull();
  });
  it('does not clear a newer tray display when a previous scope finishes hiding', async () => {
    const { state, pf, tray, showTray, hideTray } = setup(); let finish!: (hidden: boolean) => void;
    hideTray.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<ProjectPreparationPanel pf={pf} active />);
    fireEvent.click(screen.getByRole('button', { name: `Show tray ${tray.rawName}` }));
    fireEvent.click(await screen.findByRole('button', { name: `Hide tray ${tray.rawName}` }));
    const changedScope = { ...state.context.scope, routingPolicyRevision: '9' };
    vi.mocked(useProjectPreparation).mockReturnValue({ ...state,
      context: { ...state.context, scope: changedScope } } as unknown as ReturnType<typeof useProjectPreparation>);
    view.rerender(<ProjectPreparationPanel pf={pf} active />);
    const show = screen.getByRole('button', { name: `Show tray ${tray.rawName}` }); expect(show).toBeEnabled(); fireEvent.click(show);
    await screen.findByRole('button', { name: `Hide tray ${tray.rawName}` });
    await act(async () => finish(true));
    expect(screen.getByRole('button', { name: `Hide tray ${tray.rawName}` })).toBeEnabled();
    expect(screen.getByText('Tray shown in model.')).toBeVisible();
    expect(showTray).toHaveBeenNthCalledWith(2, changedScope, [1]);
    expect(hideTray).toHaveBeenCalledExactlyOnceWith(state.context.scope);
  });
  it.each([
    ['shown', 'leave'], ['pending', 'leave'], ['shown', 'unmount'], ['pending', 'unmount'],
  ] as const)('restores this panel’s %s peek on %s without reviving late feedback', async (phase, exit) => {
    const { state, pf, tray, showTray, hideTray } = setup(); let finish!: (shown: boolean) => void;
    if (phase === 'pending') showTray.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<ProjectPreparationPanel pf={pf} active />);
    fireEvent.click(screen.getByRole('button', { name: `Show tray ${tray.rawName}` }));
    if (phase === 'shown') await screen.findByRole('button', { name: `Hide tray ${tray.rawName}` });
    if (exit === 'leave') view.rerender(<ProjectPreparationPanel pf={pf} active={false} />); else view.unmount();
    expect(hideTray).toHaveBeenCalledExactlyOnceWith(state.context.scope);
    if (phase === 'pending') await act(async () => finish(true));
    expect(screen.queryByText('Tray shown in model.')).toBeNull();
    expect(screen.queryByRole('button', { name: `Hide tray ${tray.rawName}` })).toBeNull();
    view.unmount(); expect(hideTray).toHaveBeenCalledTimes(1);
  });
  it('releases the previous scope before allowing a new tray peek', async () => {
    const { state, pf, tray, showTray, hideTray } = setup();
    const view = render(<ProjectPreparationPanel pf={pf} active />);
    fireEvent.click(screen.getByRole('button', { name: `Show tray ${tray.rawName}` }));
    await screen.findByRole('button', { name: `Hide tray ${tray.rawName}` });
    const changedScope = { ...state.context.scope, routingPolicyRevision: '9' };
    vi.mocked(useProjectPreparation).mockReturnValue({ ...state,
      context: { ...state.context, scope: changedScope } } as unknown as ReturnType<typeof useProjectPreparation>);
    view.rerender(<ProjectPreparationPanel pf={pf} active />);
    expect(hideTray).toHaveBeenCalledExactlyOnceWith(state.context.scope);
    fireEvent.click(screen.getByRole('button', { name: `Show tray ${tray.rawName}` }));
    await screen.findByRole('button', { name: `Hide tray ${tray.rawName}` });
    expect(showTray).toHaveBeenNthCalledWith(2, changedScope, [1]);
    view.unmount(); expect(hideTray).toHaveBeenNthCalledWith(2, changedScope);
  });
  it('handles a rejected cleanup without leaving stale tray feedback', async () => {
    const { pf, tray, hideTray } = setup(); hideTray.mockRejectedValueOnce(new Error('Viewer closed'));
    const view = render(<ProjectPreparationPanel pf={pf} active />);
    fireEvent.click(screen.getByRole('button', { name: `Show tray ${tray.rawName}` }));
    await screen.findByRole('button', { name: `Hide tray ${tray.rawName}` });
    view.rerender(<ProjectPreparationPanel pf={pf} active={false} />);
    await act(async () => {});
    expect(screen.queryByText('Tray shown in model.')).toBeNull(); expect(screen.queryByRole('alert')).toBeNull();
    expect(hideTray).toHaveBeenCalledTimes(1);
  });
  it('does not clear another model display when this panel has not attempted a peek', () => {
    const { pf, hideTray } = setup();
    const view = render(<ProjectPreparationPanel pf={pf} active />);
    view.unmount(); expect(hideTray).not.toHaveBeenCalled();
  });
});

describe('project tray control readiness', () => {
  it('exposes a transient Stop checking action that pauses locally without cancelling the saved server work', () => {
    const { state, pf } = setup(); state.busy = true; state.unknown = true;
    const view = render(<ProjectPreparationPanel pf={pf} active />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop checking' }));
    expect(state.pause).toHaveBeenCalledOnce(); expect(state.cancel).not.toHaveBeenCalled(); expect(state.unknown).toBe(true);
    state.busy = false; view.rerender(<ProjectPreparationPanel pf={pf} active />);
    expect(screen.queryByRole('button', { name: 'Stop checking' })).toBeNull();
    expect(screen.getByText(/An earlier tray update needs checking/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Retry tray update' })).toBeEnabled();
  });
  it.each(['loading', 'no-model', 'error', 'viewer-busy', 'status-loading', 'unknown'] as const)('explains the %s gate and preserves read-only inspection when possible', gate => {
    const { state, pf, tray } = setup();
    if (gate === 'status-loading') state.loading = true;
    if (gate === 'unknown') state.unknown = true;
    const next = gate === 'viewer-busy' ? { ...pf, busy: true }
      : ['loading', 'no-model', 'error'].includes(gate) ? { ...pf, viewerPhase: gate as 'loading' | 'no-model' | 'error' } : pf;
    render(<ProjectPreparationPanel pf={next} active />);
    const expected = gate === 'loading' ? 'The model is loading.' : gate === 'no-model' ? 'Load a model'
      : gate === 'error' ? 'The model is not ready.' : gate === 'viewer-busy' ? 'The model is busy.'
        : gate === 'status-loading' ? 'Reading the current tray status' : 'An earlier tray update needs checking';
    expect(screen.getByText(new RegExp(expected))).toBeVisible();
    const show = screen.getByRole('button', { name: `Show tray ${tray.rawName}` });
    if (gate === 'status-loading' || gate === 'unknown') expect(show).toBeEnabled(); else expect(show).toBeDisabled();
    expect(screen.getByRole('button', { name: `Use current model selection for ${tray.rawName}` })).toBeDisabled();
  });
});
