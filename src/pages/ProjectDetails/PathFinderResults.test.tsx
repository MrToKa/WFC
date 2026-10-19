import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PathFinderResults } from './PathFinderResults';
import type { usePathFinder } from './hooks/usePathFinder';
vi.mock('./PathFinderRecalculationPanel', () => ({ PathFinderRecalculationPanel: () => <div>Server recalculation status</div> }));
vi.mock('./PathFinderRevisionResults', () => ({ PathFinderRevisionResults: ({ onOpenProposal }: { onOpenProposal: (id: string) => void }) =>
  <button onClick={() => onOpenProposal('50000000-0000-4000-8000-000000000003')}>Open exact proposal in Viewer</button> }));
beforeEach(() => { sessionStorage.clear(); });
afterEach(() => { sessionStorage.clear(); });
describe('calculation production boundary', () => {
  it('does not create jobs from ready data or dependency changes; manual actions remain explicit', () => {
    const calculate = vi.fn(), options = { secondaryDistanceMeters: 2, preferVerticalApproach: true };
    const pf = { data: { registryRevision: '1', activeModel: { modelVersionId: 'model', selectionRevision: '1' }, settings: {}, artifacts: [{ id: 'artifact' }], cables: [{ id: 'cable', cableWriteRevision: '1', mto: 'Control', fromMatch: { status: 'matched' }, toMatch: { status: 'matched' } }], jobs: [], proposals: [] }, busy: false, calculate, preparationAccess: { projectId: null, loadedProjectId: null, token: null, isAdmin: false } } as unknown as ReturnType<typeof usePathFinder>;
    const view = render(<PathFinderResults pf={pf} selectedCableId="cable" options={options} />);
    expect(calculate).not.toHaveBeenCalled(); expect(screen.getByText('Server recalculation status')).toBeVisible();
    view.rerender(<PathFinderResults pf={{ ...pf, data: { ...pf.data!, registryRevision: '2' } }} selectedCableId="cable" options={options} />);
    expect(calculate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Calculate all cables' })); expect(calculate).toHaveBeenLastCalledWith(undefined, true, options);
    fireEvent.click(screen.getByRole('button', { name: 'Calculate selected cable' })); expect(calculate).toHaveBeenLastCalledWith(['cable'], true, options);
  });
});

const id = (value: number) => `50000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const options = { secondaryDistanceMeters: 2, preferVerticalApproach: true };
function recoveryFixture() {
  const proposal = { id: id(3), projectId: id(1), jobId: id(7), cableId: id(4), status: 'calculated', proposalHash: 'a'.repeat(64),
    revisionResultHash: 'b'.repeat(64), cableWriteRevision: '9', stale: false, synthetic: true, canApply: true,
    engineeringAccepted: true, acceptanceScope: 'local-synthetic-fixture', compatibilityIssue: null, message: 'Calculated fixture.',
    engineeringMessage: 'Controlled local fixture.', routingPreferences: options, createdAt: '2026-10-19T14:00:00Z',
    design: { lengthBeforePercentageMeters: '6', unroundedLengthMeters: '6.6', designLengthMeters: '7' },
    route: { success: true, points: [[1, 2, 3]], objectIds: ['dbid:23'], lengthMeters: 1, fromDistanceMeters: 0, toDistanceMeters: 0,
      fromRequiresSecondary: false, toRequiresSecondary: false, connectionGapCount: 0, connectionGapLengthMeters: 0, routeText: '/BC1' } };
  const action = vi.fn(async (): Promise<Record<string, unknown> | null> => null);
  const pf = { data: { projectId: id(1), registryRevision: '1', activeModel: { modelVersionId: id(8), selectionRevision: '1' }, settings: {},
    artifacts: [{ id: id(9) }], cables: [{ id: id(4), tag: 'Fixture cable', cableWriteRevision: '9' }], jobs: [], proposals: [proposal] },
    preparationAccess: { projectId: id(1), loadedProjectId: id(1), token: 'current-private-token', isAdmin: true },
    busy: false, calculate: vi.fn(), clear: vi.fn(), action, cancelOperation: vi.fn(), refresh: vi.fn(),
    readProposal: vi.fn(async () => proposal), showPath: vi.fn(async () => true), reviewProposal: vi.fn(async () => ({ reviewId: id(5), proposal })) };
  const receipt = { duplicate: true, receipt: { id: id(6), projectId: id(1), proposalId: id(3), cableId: id(4), appliedAt: '2026-10-19T14:00:00Z',
    before: { id: id(4), project_id: id(1), cable_write_revision: '9', install_length: '123' },
    after: { id: id(4), project_id: id(1), cable_write_revision: '10', install_length: '123' },
    provenance: { schemaVersion: 'pathfinder.apply.v2', proposalId: id(3), proposalHash: 'a'.repeat(64), reviewId: id(5),
      review: { id: id(5), actorId: id(2) },
      revisionResult: { revisionResultSha256: 'b'.repeat(64) } } } };
  return { pf, receipt };
}
type Fixture = ReturnType<typeof recoveryFixture>;
const asPf = (pf: Fixture['pf']) => pf as unknown as ReturnType<typeof usePathFinder>;
async function submitFirstApply(fixture: Fixture) {
  fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Confirm proposal review' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Apply reviewed result' }));
  await waitFor(() => expect(fixture.pf.action).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Retry pending Apply' })).toBeEnabled());
}

describe('exact pending Apply through result display resets', () => {
  it('reconciles a committed-but-unacknowledged Apply after polling changes the cable revision', async () => {
    const f = recoveryFixture(), view = render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    await submitFirstApply(f); const first = f.pf.action.mock.calls[0];
    const updated = { ...f.pf, data: { ...f.pf.data, cables: [{ ...f.pf.data.cables[0], cableWriteRevision: '10' }],
      proposals: [{ ...f.pf.data.proposals[0], stale: true, canApply: false }] } };
    view.rerender(<PathFinderResults pf={asPf(updated)} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeDisabled();
    f.pf.action.mockResolvedValueOnce(f.receipt);
    fireEvent.click(screen.getByRole('button', { name: 'Retry pending Apply' }));
    await waitFor(() => expect(f.pf.action).toHaveBeenCalledTimes(2)); expect(f.pf.action.mock.calls[1]).toEqual(first);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry pending Apply' })).toBeNull());
    expect(screen.getByText(/matching Apply receipt is confirmed/)).toBeVisible(); expect(f.pf.reviewProposal).toHaveBeenCalledTimes(1);
  });

  it('retains one command across changed model, options, inactive tool and Viewer ownership', async () => {
    const f = recoveryFixture(), view = render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    await submitFirstApply(f); const first = f.pf.action.mock.calls[0];
    const changed = { ...f.pf, data: { ...f.pf.data, registryRevision: '2', activeModel: { modelVersionId: id(20), selectionRevision: '2' } } };
    view.rerender(<PathFinderResults pf={asPf(changed)} selectedCableId={null} accountId={id(2)} options={{ ...options, secondaryDistanceMeters: 3 }} active={false} displayOwned={false} />);
    expect(screen.getByRole('button', { name: 'Retry pending Apply' })).toBeDisabled(); expect(f.pf.action).toHaveBeenCalledTimes(1);
    view.rerender(<PathFinderResults pf={asPf(changed)} selectedCableId={null} accountId={id(2)} options={null} active displayOwned={false} />);
    expect(screen.getByRole('button', { name: 'Retry pending Apply' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled());
    expect(f.pf.reviewProposal).toHaveBeenCalledTimes(1); expect(f.pf.action).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry pending Apply' }));
    await waitFor(() => expect(f.pf.action).toHaveBeenCalledTimes(2)); expect(f.pf.action.mock.calls[1]).toEqual(first);
  });

  it('restores after mounted reload without transmitting until explicit retry, and fences another account', async () => {
    const f = recoveryFixture(), firstView = render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    await submitFirstApply(f); const first = f.pf.action.mock.calls[0]; firstView.unmount();
    const view = render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(21)} options={options} />);
    expect(screen.queryByRole('button', { name: 'Retry pending Apply' })).toBeNull(); expect(f.pf.action).toHaveBeenCalledTimes(1);
    view.rerender(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry pending Apply' })).toBeEnabled());
    expect(f.pf.action).toHaveBeenCalledTimes(1);
    f.pf.action.mockResolvedValueOnce(f.receipt); fireEvent.click(screen.getByRole('button', { name: 'Retry pending Apply' }));
    await waitFor(() => expect(f.pf.action).toHaveBeenCalledTimes(2)); expect(f.pf.action.mock.calls[1]).toEqual(first);
  });

  it('requires an explicit close and a matching server tombstone before enabling a fresh review', async () => {
    const f = recoveryFixture(); render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    await submitFirstApply(f); const original = f.pf.action.mock.calls[0] as unknown as [string, { idempotencyKey: string; reviewId: string; expectedCableWriteRevision: string }];
    expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled();
    expect(f.pf.action).toHaveBeenCalledTimes(1);
    f.pf.action.mockResolvedValueOnce({ schemaVersion: 'wfc.pf.apply-recovery.v1', projectId: id(1), proposalId: id(3),
      ...original[1], status: 'closed-without-apply', duplicate: false, receipt: null });
    fireEvent.click(screen.getByRole('button', { name: 'Close pending request' }));
    await waitFor(() => expect(f.pf.action).toHaveBeenCalledTimes(2));
    expect(f.pf.action.mock.calls[1]).toEqual([`/proposals/${id(3)}/close-pending-apply`, original[1]]);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Close pending request' })).toBeNull());
    expect(screen.getByText(/closed without applying cable values/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeEnabled();
    expect(f.pf.reviewProposal).toHaveBeenCalledTimes(1);
  });
});
