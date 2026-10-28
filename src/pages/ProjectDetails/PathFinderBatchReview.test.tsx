import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PathFinderBatchReview, type BatchReviewController } from './PathFinderBatchReview';
const candidate = { proposalId: '10000000-0000-4000-8000-000000000001', proposalHash: 'a'.repeat(64), revisionResultHash: 'b'.repeat(64),
  cableId: '10000000-0000-4000-8000-000000000002', cableWriteRevision: '2', tag: 'C-TEST', routeText: '/BC1/SECONDARY', designLength: '12' };
function controller() {
  return { entries: [{ ...candidate, status: 'selected', reviewId: null, message: null }], busy: false, error: null, message: null,
    counts: { selected: 1, reviewed: 0, applied: 0, blocked: 0, total: 1 }, canReview: true, canApply: false,
    select: vi.fn(), clearSelection: vi.fn(), confirmReview: vi.fn(), applyReviewed: vi.fn(), cancel: vi.fn() } as unknown as BatchReviewController;
}
describe('explicit batch review controls', () => {
  it('keeps the empty toolbar discoverable with disabled actions and selection instructions', () => {
    const batch = { ...controller(), entries: [], counts: { selected: 0, reviewed: 0, applied: 0, blocked: 0, total: 0 }, canReview: false, canApply: false };
    render(<PathFinderBatchReview batch={batch} disabled={false} />);
    expect(screen.getByRole('region', { name: 'Batch review and Apply' })).toBeVisible();
    expect(screen.getByText(/No cables selected/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Confirm review for selected cables' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Apply reviewed selection' })).toBeDisabled();
    expect(batch.confirmReview).not.toHaveBeenCalled(); expect(batch.applyReviewed).not.toHaveBeenCalled();
  });
  it('shows why a cancelled or incomplete scope cannot be applied even before any selection', () => {
    const batch = { ...controller(), entries: [], counts: { selected: 0, reviewed: 0, applied: 0, blocked: 0, total: 0 }, canReview: false, canApply: false };
    render(<PathFinderBatchReview batch={batch} disabled disabledReason="This calculation was cancelled. Choose a completed calculation below." />);
    expect(screen.getByRole('status')).toHaveTextContent('This calculation was cancelled. Choose a completed calculation below.');
    expect(screen.getByRole('button', { name: 'Apply reviewed selection' })).toBeDisabled(); expect(batch.applyReviewed).not.toHaveBeenCalled();
  });
  it('requires separate review and Apply actions; removing passes the exact candidate without UI status fields', () => {
    const batch = controller(); render(<PathFinderBatchReview batch={batch} disabled={false} />);
    expect(batch.confirmReview).not.toHaveBeenCalled(); expect(batch.applyReviewed).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Apply reviewed selection' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove C-TEST' })); expect(batch.select).toHaveBeenCalledWith(candidate, false);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm review for selected cables' })); expect(batch.confirmReview).toHaveBeenCalledOnce();
    expect(batch.applyReviewed).not.toHaveBeenCalled();
  });
  it('keeps Stop available during its own busy state and reports per-cable partial success', () => {
    const batch = { ...controller(), busy: true, counts: { selected: 1, reviewed: 0, applied: 2, blocked: 0, total: 3 } };
    render(<PathFinderBatchReview batch={batch} disabled />);
    expect(screen.getByText(/2 applied/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Confirm review for selected cables' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Stop after current cable' })); expect(batch.cancel).toHaveBeenCalledOnce();
    expect(batch.applyReviewed).not.toHaveBeenCalled();
  });
  it('permits clearing reviewed selections and keeps confirmed applied history closed to clearing', () => {
    const reviewed = { ...controller(), entries: [{ ...candidate, status: 'reviewed' as const, reviewId: candidate.proposalId, message: null }],
      counts: { selected: 0, reviewed: 1, applied: 0, blocked: 0, total: 1 } };
    const view = render(<PathFinderBatchReview batch={reviewed} disabled={false} />);
    expect(screen.getByRole('button', { name: 'Clear selection' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' })); expect(reviewed.clearSelection).toHaveBeenCalledOnce();
    view.rerender(<PathFinderBatchReview batch={{ ...reviewed, entries: [{ ...reviewed.entries[0], status: 'applied' }],
      counts: { selected: 0, reviewed: 0, applied: 1, blocked: 0, total: 1 } }} disabled={false} />);
    expect(screen.getByRole('button', { name: 'Clear selection' })).toBeDisabled();
  });
});
