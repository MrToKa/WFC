import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchCableTypeDetails } from '@/api/client';
import { CableTypeDetails } from './CableTypeDetails';

vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  fetchCableTypeDetails: vi.fn(),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null, token: null }) }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('./ProjectDetails/hooks/useProjectDetailsData', () => ({
  useProjectDetailsData: () => ({
    project: { id: 'project', projectNumber: 'P1', name: 'Project' },
    projectLoading: false,
    projectError: null,
  }),
}));

const renderDetails = () =>
  render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={['/projects/project/cable-types/type']}>
        <Routes>
          <Route
            path="/projects/:projectId/cable-types/:cableTypeId"
            element={<CableTypeDetails />}
          />
        </Routes>
      </MemoryRouter>
    </FluentProvider>,
  );

beforeEach(() => {
  vi.mocked(fetchCableTypeDetails).mockResolvedValue({
    cableType: {
      id: 'type',
      projectId: 'project',
      tag: null,
      purpose: 'Power',
      diameterMm: 12,
      weightKgPerM: 2,
      fromLocation: null,
      toLocation: null,
      routing: null,
      createdAt: '2026-01-01',
      name: 'Cable',
      updatedAt: '2026-01-01',
      changeLog: [
        {
          id: 'first',
          userId: 'actor',
          userName: 'First editor',
          changedAt: '2026-01-01T10:00:00Z',
          changes: ['Type: Old → Cable'],
        },
        {
          id: 'second',
          userId: 'actor',
          userName: 'Latest editor',
          changedAt: '2026-01-02T10:00:00Z',
          changes: ['Diameter [mm]: 12 → 14'],
        },
      ],
    },
    defaultMaterials: [],
    materialCableType: null,
    cableCount: 0,
  });
});

describe('cable type change tracker', () => {
  it('lets read-only viewers expand history with newest changes first', async () => {
    renderDetails();
    fireEvent.click(await screen.findByRole('button', { name: 'Change tracker' }));
    const table = screen.getByRole('table', { name: 'Change tracker' });
    const rows = within(table).getAllByRole('row');
    expect(rows[0]).toHaveTextContent('WhoWhenChanges');
    expect(rows[1]).toHaveTextContent('Latest editor');
    expect(rows[1]).toHaveTextContent('Diameter [mm]: 12 → 14');
    expect(rows[2]).toHaveTextContent('First editor');
  });
  it('explains the empty history of existing cable types', async () => {
    const details = await fetchCableTypeDetails('project', 'type');
    vi.mocked(fetchCableTypeDetails).mockResolvedValue({
      ...details,
      cableType: { ...details.cableType, changeLog: [] },
    });
    renderDetails();
    fireEvent.click(await screen.findByRole('button', { name: 'Change tracker' }));
    expect(
      screen.getByText('No recorded changes yet. Future saved changes will appear here.'),
    ).toBeInTheDocument();
  });
});
