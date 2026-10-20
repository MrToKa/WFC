import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectPreparationPanel } from './ProjectPreparationPanel';
import { useProjectPreparation } from './hooks/useProjectPreparation';
import { preparationFixture } from '@/test/preparationFixtures';
import type { usePathFinder } from './hooks/usePathFinder';
import { ModelRevisionChangesPanel } from './ModelRevisionChangesPanel';
import { LARGE_PREPARATION_CAPACITY_PROFILE, LEGACY_PREPARATION_CAPACITY_PROFILE } from '../../../shared/pathfinderCapacity';
vi.mock('./ModelRevisionChangesPanel', () => ({
  ModelRevisionChangesPanel: vi.fn((props: { isAdmin: boolean }) =>
    props.isAdmin ? <section aria-label="Model revision changes integration" /> : null,
  ),
}));
vi.mock('./hooks/useProjectPreparation', () => ({ useProjectPreparation: vi.fn() }));
const fixture = preparationFixture();
function setup() {
  const state = {
    enabled: true,
    canMutate: true,
    busy: false,
    loading: false,
    unknown: false,
    conflict: false,
    error: null,
    notice: null,
    progress: null,
    context: fixture.context,
    index: null,
    session: fixture.session,
    discovery: null,
    refresh: vi.fn(),
    discover: vi.fn(),
    freezePlan: vi.fn(),
    resolve: vi.fn(),
    loadSession: vi.fn(),
    collect: vi.fn(),
    publish: vi.fn(),
    cancel: vi.fn(),
    retry: vi.fn(),
    pause: vi.fn(),
  };
  const pf = {
    preparationAccess: { projectId: fixture.context.projectId },
    viewerPhase: 'ready',
    reloadViewer: vi.fn(),
    readSelection: vi.fn(),
  } as unknown as ReturnType<typeof usePathFinder>;
  return { state, pf };
}
beforeEach(() => vi.clearAllMocks());
describe('project preparation review', () => {
  it.each([
    [LEGACY_PREPARATION_CAPACITY_PROFILE, 32],
    [LARGE_PREPARATION_CAPACITY_PROFILE, 128],
  ])('uses the current frozen %s profile for the displayed capture ceiling', (limitsProfile, ceilingMiB) => {
    const { state, pf } = setup();
    vi.mocked(useProjectPreparation).mockReturnValue({
      ...state,
      session: { ...state.session, plan: { ...state.session.plan, limitsProfile },
        coverage: { ...state.session.coverage, committedParts: 3, expectedParts: 9 } },
    } as unknown as ReturnType<typeof useProjectPreparation>);
    render(<ProjectPreparationPanel pf={pf} active />);
    const ceiling = screen.getByLabelText('Preparation capture ceiling');
    expect(ceiling).toHaveTextContent(`Current frozen plan capture ceiling: complete staged captures are limited to ${ceilingMiB} MiB for validation.`);
    expect(ceiling).toHaveTextContent('Committed parts remain available when collection is paused or refused.');
    expect(ceiling).not.toHaveTextContent(/qualified|accepted|replacement plan/);
    expect(screen.getByText(/3 of 9 parts committed/)).toBeVisible();
    expect(screen.getByText(/partial captures never become the current network/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Validate and publish complete network' })).toBeDisabled();
    expect(state.collect).not.toHaveBeenCalled(); expect(state.publish).not.toHaveBeenCalled();
  });
  it('shows the legacy ceiling before any preparation plan is frozen', () => {
    const { state, pf } = setup();
    vi.mocked(useProjectPreparation).mockReturnValue({
      ...state, session: null,
    } as unknown as ReturnType<typeof useProjectPreparation>);
    render(<ProjectPreparationPanel pf={pf} active />);
    const ceiling = screen.getByLabelText('Preparation capture ceiling');
    expect(ceiling).toHaveTextContent('Legacy preparation capture ceiling: complete staged captures are limited to 32 MiB for validation.');
    expect(ceiling).not.toHaveTextContent(/128 MiB|Current frozen|Saved frozen|qualified|accepted/);
    expect(state.freezePlan).not.toHaveBeenCalled();
  });
  it.each([
    [LEGACY_PREPARATION_CAPACITY_PROFILE, 32],
    [LARGE_PREPARATION_CAPACITY_PROFILE, 128],
  ])('labels a historical frozen %s ceiling without assigning it to a replacement plan', (limitsProfile, ceilingMiB) => {
    const { state, pf } = setup();
    vi.mocked(useProjectPreparation).mockReturnValue({
      ...state,
      context: { ...state.context, scope: { ...state.context.scope, catalogRevision: '2' } },
      session: { ...state.session, plan: { ...state.session.plan, limitsProfile } },
    } as unknown as ReturnType<typeof useProjectPreparation>);
    render(<ProjectPreparationPanel pf={pf} active />);
    const ceiling = screen.getByLabelText('Preparation capture ceiling');
    expect(ceiling).toHaveTextContent(`Saved frozen plan capture ceiling: complete staged captures are limited to ${ceilingMiB} MiB for validation.`);
    expect(ceiling).toHaveTextContent('This saved limit belongs to its frozen plan and does not establish the limit of a replacement plan.');
    expect(ceiling).not.toHaveTextContent(/Current frozen|qualified|accepted/);
    expect(screen.getByText(/Historical frozen plan: 1 selected roots/)).toBeVisible();
    expect(state.discover).not.toHaveBeenCalled(); expect(state.freezePlan).not.toHaveBeenCalled();
  });
  it('places comparison beside traceability using strict admin access and current generation without a model-selection callback', () => {
    const { state, pf } = setup();
    pf.preparationAccess = {
      projectId: fixture.context.projectId,
      loadedProjectId: fixture.context.projectId,
      token: 'token',
      isAdmin: true,
    };
    vi.mocked(useProjectPreparation).mockReturnValue(
      state as unknown as ReturnType<typeof useProjectPreparation>,
    );
    render(<ProjectPreparationPanel pf={pf} active />);
    expect(
      screen.getByRole('region', { name: 'Model revision changes integration' }),
    ).toBeInTheDocument();
    const props = vi.mocked(ModelRevisionChangesPanel).mock.calls[0][0];
    expect(props).toMatchObject({
      projectId: fixture.context.projectId,
      loadedProjectId: fixture.context.projectId,
      isAdmin: true,
      active: true,
    });
    expect(props).not.toHaveProperty('setProjectActiveModel');
    expect(props).not.toHaveProperty('showPath');
  });
  it('uses stacked coverage cards at narrow widths while retaining exact identities and resolution controls', () => {
    const { state, pf } = setup(),
      tray = {
        ...state.context.trays[0],
        rawName: 'Synthetic tray identifier with several words',
        purposeKey: 'Purpose  spacing variant',
      };
    vi.mocked(useProjectPreparation).mockReturnValue({
      ...state,
      context: { ...state.context, trays: [tray] },
      discovery: {
        modelVersionId: state.context.scope.modelVersionId,
        contentFingerprint: state.context.scope.contentFingerprint,
        selectionRevision: state.context.scope.selectionRevision,
        trays: [{ projectTrayId: tray.projectTrayId, candidateRootObjectIds: ['dbid:2'] }],
        objects: [{ objectId: 'dbid:2', name: 'Synthetic physical root' }],
        complete: true,
        propertyScan: null,
      },
    } as unknown as ReturnType<typeof useProjectPreparation>);
    render(
      <div style={{ width: 300 }}>
        <ProjectPreparationPanel pf={pf} active />
      </div>,
    );
    const coverage = screen.getByRole('region', { name: 'Project tray candidate coverage' }),
      card = within(coverage).getByRole('article');
    expect(within(coverage).queryByRole('table')).toBeNull();
    expect(card).toHaveStyle({ minWidth: '0', wordBreak: 'normal', overflowWrap: 'anywhere' });
    expect(within(card).getByRole('heading').textContent).toBe(tray.rawName);
    expect(within(card).getByText('Purpose spacing variant').textContent).toBe(tray.purposeKey);
    expect(within(card).getByText('Purpose and routing permission').tagName).toBe('DT');
    expect(within(card).getByText('Exact candidates and coverage').tagName).toBe('DT');
    fireEvent.click(
      within(card).getByRole('checkbox', {
        name: `Confirm dbid:2 for ${tray.rawName} (${tray.projectTrayId})`,
      }),
    );
    fireEvent.change(
      within(card).getByRole('textbox', {
        name: `Resolution reason for ${tray.rawName} (${tray.projectTrayId})`,
      }),
      { target: { value: 'Confirmed synthetic root' } },
    );
    const save = within(card).getByRole('button', { name: 'Save confirmed roots' });
    expect(save).toBeEnabled();
    expect(save).toHaveStyle({ whiteSpace: 'normal', maxWidth: '100%' });
    fireEvent.click(save);
    expect(state.resolve).toHaveBeenCalledWith(
      tray.projectTrayId,
      'roots',
      ['dbid:2'],
      'Confirmed synthetic root',
    );
  });
  it('keeps server cancellation available while validation acknowledgement is pending', () => {
    const { state, pf } = setup(),
      cancelActive = vi.fn();
    vi.mocked(useProjectPreparation).mockReturnValue({
      ...state,
      busy: true,
      canMutate: false,
      publishPending: true,
      cancelBusy: false,
      cancelActive,
    } as unknown as ReturnType<typeof useProjectPreparation>);
    render(<ProjectPreparationPanel pf={pf} active />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Preparation command reason' }), {
      target: { value: 'Stop current validation' },
    });
    const cancel = screen.getByRole('button', { name: 'Cancel frozen preparation' });
    expect(cancel).toBeEnabled();
    fireEvent.click(cancel);
    expect(cancelActive).toHaveBeenCalledWith('Stop current validation');
  });
  it('separates missing endpoint binding evidence from complete network collection', () => {
    const { state, pf } = setup();
    state.session = {
      ...state.session,
      plan: {
        ...state.session.plan,
        requestedScope: {
          ...state.session.plan.requestedScope,
          endpointEvidence: [
            { name: 'Synthetic endpoint', candidateObjectIds: [], status: 'missing' },
          ],
        },
      },
    };
    vi.mocked(useProjectPreparation).mockReturnValue(
      state as unknown as ReturnType<typeof useProjectPreparation>,
    );
    render(<ProjectPreparationPanel pf={pf} active />);
    expect(screen.getByText(/1 names need later resolution/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Resume collection' })).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Validate and publish complete network' }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Resume collection' }));
    expect(state.collect).toHaveBeenCalledOnce();
  });
  it('freezes new commands while an acknowledgement is uncertain and exposes exact retry', () => {
    const { state, pf } = setup();
    state.unknown = true;
    state.canMutate = false;
    vi.mocked(useProjectPreparation).mockReturnValue(
      state as unknown as ReturnType<typeof useProjectPreparation>,
    );
    render(<ProjectPreparationPanel pf={pf} active />);
    expect(screen.getByRole('button', { name: 'Discover project tray candidates' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Resume collection' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry the same preparation command' }));
    expect(state.retry).toHaveBeenCalledOnce();
  });
  it('shows frozen selected roots after reload without inventing exact candidate counts', () => {
    const { state, pf } = setup();
    vi.mocked(useProjectPreparation).mockReturnValue(
      state as unknown as ReturnType<typeof useProjectPreparation>,
    );
    render(<ProjectPreparationPanel pf={pf} active />);
    const card = within(screen.getByRole('region', { name: 'Project tray candidate coverage' }))
      .getByRole('article');
    expect(within(card).getByText(/Discovery results are not loaded/)).toBeVisible();
    expect(within(card).getByText(/Current frozen plan: 1 selected roots · dbid:1/)).toBeVisible();
    expect(within(card).queryByText('Not yet discovered')).not.toBeInTheDocument();
    expect(within(card).queryByText('One exact candidate')).not.toBeInTheDocument();
    expect(within(card).queryByRole('checkbox')).not.toBeInTheDocument();
  });
  it.each(['dbid:1', 'dbid:427079'])('keeps saved roots %s current when only the resolution counter advanced', (rootId) => {
    const { state, pf } = setup(), tray = state.context.trays[0];
    vi.mocked(useProjectPreparation).mockReturnValue({
      ...state,
      session: null,
      context: {
        ...state.context,
        scope: { ...state.context.scope, resolutionRevision: '2' },
        resolutions: [{ id: 'resolution', projectTrayId: tray.projectTrayId, mode: 'roots',
          rootObjectIds: [rootId], reason: 'Reviewed tray roots', actorId: 'admin',
          createdAt: '2026-10-20T00:00:00Z', scope: { ...state.context.scope, resolutionRevision: '0' } }],
      },
    } as unknown as ReturnType<typeof useProjectPreparation>);
    render(<ProjectPreparationPanel pf={pf} active />);
    expect(screen.getByText('Saved resolution matches the current project scope.')).toBeVisible();
    expect(screen.getByText(/Saved 1 confirmed roots/)).toBeVisible();
    expect(screen.queryByText(/Stale saved resolution:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/global model root/)).not.toBeInTheDocument();
  });
  it.each(['modelVersionId', 'catalogRevision', 'routingPolicyRevision', 'locationRegistryRevision'] as const)(
    'labels a saved resolution stale after %s changes', (key) => {
      const { state, pf } = setup(), tray = state.context.trays[0];
      vi.mocked(useProjectPreparation).mockReturnValue({
        ...state,
        session: null,
        context: { ...state.context, resolutions: [{ id: 'resolution', projectTrayId: tray.projectTrayId,
          mode: 'roots', rootObjectIds: ['dbid:427079'], reason: 'Previous scope', actorId: 'admin',
          createdAt: '2026-10-20T00:00:00Z', scope: { ...state.context.scope, [key]: 'previous' } }] },
      } as unknown as ReturnType<typeof useProjectPreparation>);
      render(<ProjectPreparationPanel pf={pf} active />);
      expect(screen.getByText(/Stale saved resolution:/)).toBeVisible();
      expect(screen.queryByText('Saved resolution matches the current project scope.')).not.toBeInTheDocument();
    },
  );
  it('labels old frozen coverage historical rather than treating it as current candidate discovery', () => {
    const { state, pf } = setup();
    vi.mocked(useProjectPreparation).mockReturnValue({
      ...state,
      context: { ...state.context, scope: { ...state.context.scope, catalogRevision: '2' } },
    } as unknown as ReturnType<typeof useProjectPreparation>);
    render(<ProjectPreparationPanel pf={pf} active />);
    expect(screen.getByText(/Historical frozen plan: 1 selected roots/)).toBeVisible();
    expect(screen.queryByText(/Current frozen plan:/)).not.toBeInTheDocument();
    expect(screen.queryByText('One exact candidate')).not.toBeInTheDocument();
  });
  it('does not infer per-tray roots from an aggregate when its saved plan is unavailable', () => {
    const { state, pf } = setup();
    vi.mocked(useProjectPreparation).mockReturnValue({
      ...state,
      session: null,
      context: { ...state.context, currentAggregate: { id: 'aggregate', sessionId: state.session.id,
        geometryRevision: '1', orderedPlanSha256: state.session.plan.orderedPlanSha256 } },
    } as unknown as ReturnType<typeof useProjectPreparation>);
    render(<ProjectPreparationPanel pf={pf} active />);
    expect(screen.getByText(/A published network is retained, but its per-tray roots are not loaded/)).toBeVisible();
    expect(screen.queryByText(/selected roots/)).not.toBeInTheDocument();
    expect(screen.queryByText(/global model root/)).not.toBeInTheDocument();
  });
  it('identifies selected roots from the published saved plan without presenting a new candidate search', () => {
    const { state, pf } = setup();
    vi.mocked(useProjectPreparation).mockReturnValue({
      ...state,
      context: { ...state.context, currentAggregate: { id: 'aggregate', sessionId: state.session.id,
        geometryRevision: '1', orderedPlanSha256: state.session.plan.orderedPlanSha256 },
      scope: { ...state.context.scope, locationRegistryRevision: '2' } },
    } as unknown as ReturnType<typeof useProjectPreparation>);
    render(<ProjectPreparationPanel pf={pf} active />);
    expect(screen.getByText(/Published saved plan: 1 selected roots · dbid:1/)).toBeVisible();
    expect(screen.queryByText('One exact candidate')).not.toBeInTheDocument();
  });
  it('identifies the actual model root from evidence instead of assuming a dbId', () => {
    const { state, pf } = setup(), tray = state.context.trays[0];
    vi.mocked(useProjectPreparation).mockReturnValue({
      ...state,
      session: null,
      discovery: { modelVersionId: state.context.scope.modelVersionId,
        contentFingerprint: state.context.scope.contentFingerprint,
        selectionRevision: state.context.scope.selectionRevision,
        trays: [{ projectTrayId: tray.projectTrayId, candidateRootObjectIds: ['dbid:427079'] }],
        objects: [{ objectId: 'dbid:427079', parentId: null, name: 'Actual root' }],
        complete: true, propertyScan: null },
    } as unknown as ReturnType<typeof useProjectPreparation>);
    render(<ProjectPreparationPanel pf={pf} active />);
    expect(screen.getByText(/Current model evidence identifies.*global model root/)).toBeVisible();
  });
  it('does not identify a root from evidence for a previous model', () => {
    const { state, pf } = setup(), tray = state.context.trays[0];
    vi.mocked(useProjectPreparation).mockReturnValue({
      ...state,
      session: null,
      discovery: { modelVersionId: 'previous-model',
        contentFingerprint: state.context.scope.contentFingerprint,
        selectionRevision: state.context.scope.selectionRevision,
        trays: [{ projectTrayId: tray.projectTrayId, candidateRootObjectIds: ['dbid:1'] }],
        objects: [{ objectId: 'dbid:1', parentId: null, name: 'Old root' }], complete: true,
        propertyScan: null },
    } as unknown as ReturnType<typeof useProjectPreparation>);
    render(<ProjectPreparationPanel pf={pf} active />);
    expect(screen.queryByText(/global model root/)).not.toBeInTheDocument();
    expect(screen.queryByText('One exact candidate')).not.toBeInTheDocument();
    expect(screen.getByText(/Discovery results are not loaded/)).toBeVisible();
  });
  it('shows the named missing trays and why two unresolved roots block the whole plan', () => {
    const { state, pf } = setup(), tray = state.context.trays[0];
    const absent = ['A120', 'A105'].map((rawName, index) => ({ ...tray, rawName,
      projectTrayId: `88888888-8888-4888-8888-${String(index + 1).padStart(12, '0')}` }));
    vi.mocked(useProjectPreparation).mockReturnValue({
      ...state,
      context: { ...state.context, trays: [tray, ...absent] },
      session: { ...state.session, plan: { ...state.session.plan,
        diagnostics: absent.map((item) => ({ code: 'TRAY_ROOT_MISSING',
          projectTrayIds: [item.projectTrayId], objectIds: [],
          message: 'Resolve this requested preparation scope before capture and publication.' })) } },
    } as unknown as ReturnType<typeof useProjectPreparation>);
    render(<ProjectPreparationPanel pf={pf} active />);
    const summary = screen.getByRole('region', { name: 'Preparation readiness summary' });
    expect(within(summary).getByText(/1 of 3 project trays have selected roots; 0 explicitly excluded; 2 blocking diagnostics/)).toBeVisible();
    const diagnostics = within(summary).getByRole('list', { name: 'Frozen plan diagnostics' });
    expect(within(diagnostics).getAllByText('TRAY_ROOT_MISSING')).toHaveLength(2);
    expect(within(diagnostics).getByText('Affected trays: A120.')).toBeVisible();
    expect(within(diagnostics).getByText('Affected trays: A105.')).toBeVisible();
    expect(within(diagnostics).getAllByText(/Verify the active model and revision, select and explicitly confirm the correct physical root, or explicitly exclude this tray/)).toHaveLength(2);
    expect(within(summary).getByText(/Missing trays are not excluded automatically/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Resume collection' })).toBeDisabled();
    expect(state.collect).not.toHaveBeenCalled();
    expect(state.resolve).not.toHaveBeenCalled();
  });
  it('summarizes unique, missing and ambiguous endpoint evidence without treating it as confirmed locations', () => {
    const { state, pf } = setup();
    vi.mocked(useProjectPreparation).mockReturnValue({
      ...state,
      session: { ...state.session, plan: { ...state.session.plan, requestedScope: {
        ...state.session.plan.requestedScope,
        endpointNames: ['Unique', 'Missing', 'Ambiguous'],
        endpointEvidence: [
          { name: 'Unique', status: 'unique_candidate', candidateObjectIds: ['dbid:2'] },
          { name: 'Missing', status: 'missing', candidateObjectIds: [] },
          { name: 'Ambiguous', status: 'ambiguous', candidateObjectIds: ['dbid:3', 'dbid:4'] },
        ],
      } } },
    } as unknown as ReturnType<typeof useProjectPreparation>);
    render(<ProjectPreparationPanel pf={pf} active />);
    const summary = screen.getByRole('region', { name: 'Preparation readiness summary' });
    expect(within(summary).getByText(/Endpoint candidates: 1 unique; 1 missing; 1 ambiguous/)).toBeVisible();
    expect(within(summary).getByText(/not confirmed shared locations or calculated cables/)).toBeVisible();
  });
  it('describes v2 model-only slash handling for equipment while retaining exact tray matching', () => {
    const { state, pf } = setup();
    vi.mocked(useProjectPreparation).mockReturnValue({
      ...state,
      session: { ...state.session, plan: { ...state.session.plan,
        matchingPolicyVersion: 'wfc.pf.project-exact-candidates.v2' } },
    } as unknown as ReturnType<typeof useProjectPreparation>);
    render(<ProjectPreparationPanel pf={pf} active />);
    expect(screen.getByText(/Matching policy v2: equipment identifiers allow one leading slash present only in the model\. Tray names retain exact matching/)).toBeVisible();
    expect(screen.queryByText(/Historical matching policy v1:/)).not.toBeInTheDocument();
  });
  it('requires rediscovery to obtain new matching evidence for a historical v1 plan', () => {
    const { state, pf } = setup();
    vi.mocked(useProjectPreparation).mockReturnValue(
      state as unknown as ReturnType<typeof useProjectPreparation>,
    );
    render(<ProjectPreparationPanel pf={pf} active />);
    expect(screen.getByText(/Historical matching policy v1: discover again and freeze a new plan to use model-only leading-slash matching/)).toBeVisible();
    expect(screen.getByText(/Opening this saved plan does not rerun discovery/)).toBeVisible();
    expect(state.discover).not.toHaveBeenCalled();
    expect(state.freezePlan).not.toHaveBeenCalled();
  });
  it('does not substitute the current catalog total into coverage of a different frozen catalog', () => {
    const { state, pf } = setup();
    vi.mocked(useProjectPreparation).mockReturnValue({
      ...state,
      context: { ...state.context, scope: { ...state.context.scope, catalogRevision: '2' } },
    } as unknown as ReturnType<typeof useProjectPreparation>);
    render(<ProjectPreparationPanel pf={pf} active />);
    const summary = screen.getByRole('region', { name: 'Preparation readiness summary' });
    expect(within(summary).getByText(/Tray network coverage: 1 project trays have selected roots/)).toBeVisible();
    expect(within(summary).queryByText(/1 of 1 project trays/)).not.toBeInTheDocument();
  });
  it('shows ambiguity codes, exact model IDs and a manual resolution action', () => {
    const { state, pf } = setup(), tray = state.context.trays[0];
    vi.mocked(useProjectPreparation).mockReturnValue({
      ...state,
      session: { ...state.session, plan: { ...state.session.plan, diagnostics: [{
        code: 'TRAY_ROOT_AMBIGUOUS', projectTrayIds: [tray.projectTrayId],
        objectIds: ['dbid:426510', 'dbid:426511', 'dbid:426512'], message: 'Resolve scope.',
      }] } },
    } as unknown as ReturnType<typeof useProjectPreparation>);
    render(<ProjectPreparationPanel pf={pf} active />);
    const diagnostics = screen.getByRole('list', { name: 'Frozen plan diagnostics' });
    expect(within(diagnostics).getByText('TRAY_ROOT_AMBIGUOUS')).toBeVisible();
    expect(within(diagnostics).getByText('Affected trays: Tray 01.')).toBeVisible();
    expect(within(diagnostics).getByText('Model objects: dbid:426510, dbid:426511, dbid:426512.')).toBeVisible();
    expect(within(diagnostics).getByText(/Select and explicitly confirm the intended physical roots/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Resume collection' })).toBeDisabled();
  });
});
