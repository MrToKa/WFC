import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CableImportDialog, type CableImportDialogState } from './CableImportDialog';
const state = (): CableImportDialogState => ({ open: true, fileName: 'cables.xlsx', protectRouting: false, loading: false, committing: false,
  completed: false, error: null, summary: { inserted: 1, updated: 2, skipped: 0, unchanged: 3, blockedRouting: [] } });
describe('reviewed cable workbook import', () => {
  it('defaults protection off and requires an explicit commit after the preview', () => {
    const onCommit = vi.fn(), onProtectChange = vi.fn();
    render(<CableImportDialog state={state()} onCommit={onCommit} onProtectChange={onProtectChange} onClose={vi.fn()} />);
    expect(screen.getByRole('checkbox')).not.toBeChecked(); expect(onCommit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox')); expect(onProtectChange).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Import reviewed changes' })); expect(onCommit).toHaveBeenCalledOnce();
  });
  it.each(['loading', 'committing', 'error', 'missing-preview'] as const)('prevents stale or unverified commit for %s', cause => {
    const value = state(); if (cause === 'error') value.error = 'The project changed. Review the workbook again.';
    else if (cause === 'missing-preview') value.summary = null; else value[cause] = true;
    render(<CableImportDialog state={value} onCommit={vi.fn()} onProtectChange={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Import reviewed changes' })).toBeDisabled();
  });
  it('shows every retained cable and all execution reasons without blocking other changes', () => {
    const value = state(); value.summary!.blockedRouting = [{ cableId: 1, tag: '-WG-1', reasons: ['PULL_DATE_RECORDED', 'CONNECTED_FROM_RECORDED'] },
      { cableId: 2, tag: '-WG-2', reasons: ['INSTALL_LENGTH_RECORDED', 'TESTED_DATE_RECORDED'] }];
    render(<CableImportDialog state={value} onCommit={vi.fn()} onProtectChange={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/-WG-1: Pull date is recorded; Connected From is recorded/)).toBeVisible();
    expect(screen.getByText(/-WG-2: Install length is recorded; Cable tested date is recorded/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Import reviewed changes' })).toBeEnabled();
  });
  it('retains the completed report but offers no second implicit import', () => {
    render(<CableImportDialog state={{ ...state(), completed: true }} onCommit={vi.fn()} onProtectChange={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog')).toHaveTextContent('Cable import results');
    expect(screen.queryByRole('button', { name: 'Import reviewed changes' })).not.toBeInTheDocument();
  });
});
