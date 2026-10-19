import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectPreparationPanel } from './ProjectPreparationPanel';
import { useProjectPreparation } from './hooks/useProjectPreparation';
import { preparationFixture } from '@/test/preparationFixtures';
import type { usePathFinder } from './hooks/usePathFinder';
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
});
