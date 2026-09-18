import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { fetchMaterialChangeLog, type MaterialDetailsCategory } from '@/api/client';
import { MaterialChangeLogSection } from './MaterialChangeLogSection';

vi.mock('@/api/client', () => ({ fetchMaterialChangeLog: vi.fn() }));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { isAdmin: true }, token: 'token' }),
}));
const entry = {
  id: '1',
  userId: 'user',
  userName: 'Jane Doe',
  changedAt: '2026-09-18T10:00:00Z',
  changes: ['Price: 2 → 3'],
};
const view = (category: MaterialDetailsCategory, refreshKey = 1, materialId = 'material-1') => (
  <FluentProvider theme={webLightTheme}>
    <MaterialChangeLogSection category={category} materialId={materialId} refreshKey={refreshKey} />
  </FluentProvider>
);
beforeEach(() => {
  vi.mocked(fetchMaterialChangeLog)
    .mockReset()
    .mockResolvedValue({ changeLog: [entry] });
});

it.each<MaterialDetailsCategory>([
  'cable-type',
  'cable-installation-material',
  'tray-installation-material',
  'instrument',
  'instrument-installation-material',
  'tray',
  'support',
  'load-curve',
])('starts collapsed and shows paginated history when expanded for %s', async (category) => {
  render(view(category));
  const toggle = screen.getByRole('button', { name: 'Change log' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  fireEvent.click(toggle);
  expect(await screen.findByRole('table', { name: 'Change log' })).toBeVisible();
  expect(screen.getByText('Jane Doe')).toBeVisible();
  expect(screen.getByText('Price: 2 → 3')).toBeVisible();
  expect(screen.getByText(new Date(entry.changedAt).toLocaleString())).toBeVisible();
  expect(fetchMaterialChangeLog).toHaveBeenCalledWith(category, 'material-1');
  expect(screen.getByRole('combobox', { name: 'Select change log page' })).toHaveTextContent(
    'Page 1',
  );
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

it('refreshes the history after an edit', async () => {
  const { rerender } = render(view('tray'));
  fireEvent.click(screen.getByRole('button', { name: 'Change log' }));
  await screen.findByText('Price: 2 → 3');
  vi.mocked(fetchMaterialChangeLog).mockResolvedValue({
    changeLog: [{ ...entry, changes: ['Price: 3 → 4'] }],
  });
  rerender(view('tray', 2));
  expect(await screen.findByText('Price: 3 → 4')).toBeVisible();
  expect(screen.queryByText('Price: 2 → 3')).not.toBeInTheDocument();
});

it('shows an error with a working retry instead of an empty history', async () => {
  vi.mocked(fetchMaterialChangeLog).mockRejectedValueOnce(new Error('Offline'));
  render(view('support'));
  fireEvent.click(screen.getByRole('button', { name: 'Change log' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load material change log.');
  fireEvent.click(screen.getByRole('button', { name: 'Retry history' }));
  expect(await screen.findByText('Jane Doe')).toBeVisible();
});

it('does not show a late response for the previously selected material', async () => {
  let finish: ((value: { changeLog: (typeof entry)[] }) => void) | undefined;
  vi.mocked(fetchMaterialChangeLog).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { rerender } = render(view('cable-type'));
  fireEvent.click(screen.getByRole('button', { name: 'Change log' }));
  vi.mocked(fetchMaterialChangeLog).mockResolvedValue({ changeLog: [] });
  rerender(view('cable-type', 1, 'material-2'));
  expect(screen.getByRole('button', { name: 'Change log' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Change log' }));
  await waitFor(() => expect(fetchMaterialChangeLog).toHaveBeenCalledTimes(2));
  finish?.({ changeLog: [entry] });
  await waitFor(() => expect(screen.queryByText('Loading change log...')).not.toBeInTheDocument());
  expect(screen.queryByText('Jane Doe')).not.toBeInTheDocument();
});

it('limits expanded history to ten entries and allows switching pages', async () => {
  vi.mocked(fetchMaterialChangeLog).mockResolvedValue({
    changeLog: Array.from({ length: 12 }, (_, index) => ({
      ...entry,
      id: String(index),
      changedAt: new Date(Date.UTC(2026, 8, index + 1)).toISOString(),
      changes: [`Change ${index}`],
    })),
  });
  render(view('instrument'));
  fireEvent.click(screen.getByRole('button', { name: 'Change log' }));
  const table = await screen.findByRole('table', { name: 'Change log' });
  expect(within(table).getAllByRole('row')).toHaveLength(11);
  expect(screen.getByText('Change 11')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(within(table).getAllByRole('row')).toHaveLength(3);
  expect(screen.getByText('Change 1')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
});
