import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { fetchCableListHistory, type Cable, type CableVersion } from '@/api/client';
import { useProjectDetailsStyles } from '../ProjectDetails.styles';
import { CableListChangeLog, SectionChangeLog, type ChangeLogSource } from './SectionChangeLog';

vi.mock('@/api/client', () => ({ fetchCableListHistory: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

const Harness = ({ items = [], cables }: { items?: ChangeLogSource[]; cables?: Cable[] }) => {
  const styles = useProjectDetailsStyles();
  return (
    <FluentProvider theme={webLightTheme}>
      {cables ? (
        <CableListChangeLog styles={styles} projectId="project" cables={cables} />
      ) : (
        <SectionChangeLog styles={styles} items={items} />
      )}
    </FluentProvider>
  );
};

it('shows all item histories newest first and identifies the item and author', () => {
  render(
    <Harness
      items={[
        {
          id: 'a',
          name: 'First tray',
          changeLog: [
            {
              id: '1',
              userId: 'u',
              userName: 'Editor',
              changedAt: '2026-09-16T10:00:00Z',
              changes: ['Old change'],
            },
          ],
        },
        {
          id: 'b',
          name: 'Second tray',
          changeLog: [
            {
              id: '2',
              userId: 'u',
              userName: 'Editor',
              changedAt: '2026-09-17T10:00:00Z',
              changes: ['New change'],
            },
          ],
        },
      ]}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Change log' }));
  const rows = within(screen.getByRole('table', { name: 'Change log' })).getAllByRole('row');
  expect(rows[1]).toHaveTextContent('Second tray');
  expect(rows[1]).toHaveTextContent('Editor');
  expect(rows[1]).toHaveTextContent('New change');
  expect(rows[2]).toHaveTextContent('Old change');
});

it('shows an empty state when no history has been recorded', () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Change log' }));
  expect(screen.getByText(/No recorded changes yet/)).toBeVisible();
});

it('merges material history and per-cable revisions and reloads after cable changes', async () => {
  const version = (
    id: string,
    cableRecordId: string,
    versionNumber: number,
    routing: string,
  ): CableVersion => ({
    id,
    cableRecordId,
    versionNumber,
    routing,
    changeType: versionNumber === 1 ? 'create' : 'update',
    changeSource: 'manual',
    cableId: 1,
    revision: null,
    mto: null,
    tag: null,
    cableTypeId: 'type',
    typeName: 'Power',
    fromLocation: null,
    toLocation: null,
    delivery: null,
    designLength: null,
    installLength: null,
    pullDate: null,
    connectedFrom: null,
    connectedTo: null,
    tested: null,
    changedAt: `2026-09-1${versionNumber}T10:00:00Z`,
    changedBy: { id: 'u', firstName: 'Original', lastName: 'Author', email: 'a@example.com' },
  });
  vi.mocked(fetchCableListHistory).mockResolvedValue({
    cables: [
      {
        id: 'a',
        cableId: 1,
        tag: 'Cable A',
        changeLog: [
          {
            id: 'material',
            userId: 'u',
            userName: 'Editor',
            changedAt: '2026-09-17T10:00:00Z',
            changes: ['Added material'],
          },
        ],
      },
      { id: 'b', cableId: 2, tag: 'Cable B', changeLog: [] },
    ],
    versions: [
      version('a2', 'a', 2, 'New route'),
      version('b1', 'b', 1, 'Other route'),
      version('a1', 'a', 1, 'Old route'),
    ],
  });
  const { rerender } = render(<Harness cables={[]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Change log' }));
  expect(await screen.findByText('Routing: Old route → New route')).toBeVisible();
  expect(screen.getByText('Added material')).toBeVisible();
  expect(screen.queryByText(/Other route → New route/)).not.toBeInTheDocument();
  expect(screen.getAllByText('Original Author')).toHaveLength(3);
  rerender(<Harness cables={[]} />);
  await waitFor(() => expect(fetchCableListHistory).toHaveBeenCalledTimes(2));
});

it('shows fetch failures instead of claiming the history is empty', async () => {
  vi.mocked(fetchCableListHistory).mockRejectedValue(new Error('Offline'));
  render(<Harness cables={[]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Change log' }));
  expect(await screen.findByText(/Failed to load change log/)).toBeVisible();
  expect(screen.queryByText(/No recorded changes yet/)).not.toBeInTheDocument();
});
