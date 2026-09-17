import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ChangeLogTable, type ChangeLogEntry } from './ChangeLogTable';
import { exportChangeLog } from '@/utils/exportChangeLog';

vi.mock('@/utils/exportChangeLog', () => ({ exportChangeLog: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

const entries: ChangeLogEntry[] = Array.from({ length: 23 }, (_, i) => ({
  id: String(i),
  userId: 'u',
  userName: 'Editor',
  changedAt: new Date(Date.UTC(2026, 8, i + 1)).toISOString(),
  changes: [`Change ${i}`],
  name: `Cable ${i}`,
  revision: `R${i}`,
}));
const view = (items = entries, props = {}) => (
  <FluentProvider theme={webLightTheme}>
    <ChangeLogTable entries={items} fileName="test-history" showItem showRevision {...props} />
  </FluentProvider>
);

it('paginates newest first, supports direct page selection, and clamps after deletions', () => {
  const { rerender } = render(view());
  const table = screen.getByRole('table', { name: 'Change log' });
  expect(within(table).getAllByRole('row')).toHaveLength(11);
  expect(within(table).getAllByRole('row')[1]).toHaveTextContent('Change 22');
  expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByText('Change 12')).toBeVisible();
  expect(screen.queryByText('Change 22')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('combobox', { name: 'Select change log page' }));
  fireEvent.click(screen.getByRole('option', { name: 'Page 3' }));
  expect(within(table).getAllByRole('row')).toHaveLength(4);
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
  expect(screen.getByText('Change 12')).toBeVisible();
  rerender(view(entries.slice(0, 2)));
  expect(screen.queryByRole('combobox', { name: 'Select change log page' })).not.toBeInTheDocument();
  expect(within(table).getAllByRole('row')).toHaveLength(3);
});

it('exports every entry even from the last page, retaining item and revision columns', async () => {
  render(view());
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  fireEvent.click(screen.getByRole('button', { name: 'Export change log to Excel' }));
  await waitFor(() =>
    expect(exportChangeLog).toHaveBeenCalledWith([...entries].reverse(), {
      fileName: 'test-history',
      showItem: true,
      showRevision: true,
    }),
  );
  expect(entries[0].id).toBe('0');
});

it('disables empty or incomplete exports and respects export permissions', () => {
  const { rerender } = render(view([]));
  expect(screen.getByRole('button', { name: 'Export change log to Excel' })).toBeDisabled();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  rerender(view(entries, { loading: true }));
  expect(screen.getByRole('button', { name: 'Export change log to Excel' })).toBeDisabled();
  rerender(view(entries, { error: 'History unavailable' }));
  expect(screen.getByRole('button', { name: 'Export change log to Excel' })).toBeDisabled();
  rerender(view(entries, { canExport: false }));
  expect(
    screen.queryByRole('button', { name: 'Export change log to Excel' }),
  ).not.toBeInTheDocument();
});

it('allows retrying a failed export', async () => {
  vi.mocked(exportChangeLog).mockImplementationOnce(() => {
    throw new Error('Download failed');
  });
  render(view());
  fireEvent.click(screen.getByRole('button', { name: 'Export change log to Excel' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Failed to export change log');
  fireEvent.click(screen.getByRole('button', { name: 'Export change log to Excel' }));
  await waitFor(() => expect(exportChangeLog).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
