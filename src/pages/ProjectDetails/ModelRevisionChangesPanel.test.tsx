import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelRevisionChangesPanel } from './ModelRevisionChangesPanel';
import {
  useModelRevisionChanges,
  type ModelRevisionChangesAccess,
} from './hooks/useModelRevisionChanges';
import { revisionComparisonFixture, revisionIds as ids } from '@/test/revisionComparisonFixtures';
vi.mock('./hooks/useModelRevisionChanges', () => ({ useModelRevisionChanges: vi.fn() }));
const props: ModelRevisionChangesAccess = {
  projectId: ids.project,
  loadedProjectId: ids.project,
  token: 'token',
  isAdmin: true,
  active: true,
  contextKey: 'current-model',
};
function setup() {
  const f = revisionComparisonFixture(),
    state = {
      ...f,
      enabled: true,
      busy: false,
      unknown: false,
      recoveryPending: false,
      conflict: false,
      error: null,
      pending: null,
      headQueryKey: null,
      objectDetail: null,
      create: vi.fn(),
      decide: vi.fn(),
      retry: vi.fn(),
      open: vi.fn(),
      refresh: vi.fn(),
      changesPage: vi.fn(),
      historyPage: vi.fn(),
      listPage: vi.fn(),
      loadHead: vi.fn(),
      inspectObject: vi.fn(),
    };
  vi.mocked(useModelRevisionChanges).mockReturnValue(
    state as unknown as ReturnType<typeof useModelRevisionChanges>,
  );
  return { ...f, state };
}
beforeEach(() => vi.clearAllMocks());
describe('stacked model revision comparison', () => {
  it('distinguishes unavailable exclusion counts from observed zero', () => {
    const { state } = setup(); state.context.choices[0].coverage.excludedObjects = null;
    render(<ModelRevisionChangesPanel {...props} />);
    fireEvent.change(screen.getByLabelText('Old saved revision'), { target: { value: ids.sourceTrace } });
    fireEvent.change(screen.getByLabelText('New saved revision'), { target: { value: ids.targetTrace } });
    expect(screen.getByText(/1 included objects · Unavailable exclusions/)).toBeInTheDocument();
    expect(screen.getByText(/1 included objects · 0 exclusions/)).toBeInTheDocument();
  });
  it('chooses historical authoritative pairs without active model selection and retains multiple independent change flags', () => {
    const { state } = setup();
    render(
      <div style={{ width: 300 }}>
        <ModelRevisionChangesPanel {...props} />
      </div>,
    );
    fireEvent.change(screen.getByLabelText('Old saved revision'), {
      target: { value: ids.sourceTrace },
    });
    fireEvent.change(screen.getByLabelText('New saved revision'), {
      target: { value: ids.targetTrace },
    });
    fireEvent.change(screen.getByLabelText('Comparison reason'), {
      target: { value: 'Review both saved scopes' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Compare saved revisions' }));
    expect(state.create).toHaveBeenCalledWith(
      expect.objectContaining({
        source: expect.objectContaining({ aggregateId: ids.sourceAggregate }),
        target: expect.objectContaining({ aggregateId: ids.targetAggregate }),
        expectedComparisonRevision: '1',
      }),
    );
    const card = screen.getByRole('article', { name: 'Revision change 1' });
    expect(card).toHaveStyle({ minWidth: '0', wordBreak: 'normal' });
    expect(within(card).getByText('representation changed')).toBeInTheDocument();
    expect(within(card).getByText('observed fitted length changed')).toBeInTheDocument();
    expect(within(card).getByText('coordinate frame unverified')).toBeInTheDocument();
    expect(within(card).getByText('1000.000 → 9999.00')).toBeInTheDocument();
    expect(within(card).getByText(/Unavailable; comparable frame/)).toBeInTheDocument();
    fireEvent.click(
      within(card).getByRole('button', { name: `Inspect old object ${ids.sourceObject}` }),
    );
    expect(state.inspectObject).toHaveBeenCalledWith('source', ids.sourceObject);
  });
  it('locks pair changes and all new writes until the exact unknown command is reconciled', () => {
    const { state, create } = setup();
    state.unknown = true;
    state.pending = { kind: 'create', body: create } as never;
    render(<ModelRevisionChangesPanel {...props} />);
    expect(screen.getByLabelText('Old saved revision')).toBeDisabled();
    expect(screen.getByLabelText('New saved revision')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Compare saved revisions' })).toBeDisabled();
    expect(screen.getByLabelText('Old saved revision')).toHaveValue(ids.sourceTrace);
    fireEvent.click(screen.getByRole('button', { name: 'Reconcile same comparison command' }));
    expect(state.retry).toHaveBeenCalledOnce();
  });
  it('never mounts comparison state or controls for nonadministrators', () => {
    setup();
    vi.mocked(useModelRevisionChanges).mockClear();
    render(<ModelRevisionChangesPanel {...props} isAdmin={false} />);
    expect(useModelRevisionChanges).not.toHaveBeenCalled();
    expect(screen.queryByRole('region')).toBeNull();
  });
});
