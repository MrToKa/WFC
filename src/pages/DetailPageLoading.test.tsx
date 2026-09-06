import { act, fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchCableDetails, fetchCableTypeDetails, type Cable, type CableType } from '@/api/client';
import { CableDetails } from './CableDetails';
import { CableTypeDetails } from './CableTypeDetails';

vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  fetchCableDetails: vi.fn(),
  fetchCableTypeDetails: vi.fn(),
  fetchCableVersions: vi.fn().mockResolvedValue({ versions: [] }),
  fetchCables: vi.fn().mockResolvedValue({ cables: [] }),
  fetchCableTypes: vi.fn().mockResolvedValue({ cableTypes: [] }),
  fetchTrays: vi.fn().mockResolvedValue({ trays: [] }),
  fetchMaterialCableInstallationMaterials: vi
    .fn()
    .mockResolvedValue({ cableInstallationMaterials: [] }),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null, token: null }) }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('./ProjectDetails/hooks/useProjectDetailsData', () => ({
  useProjectDetailsData: () => ({ project: null, projectLoading: false, projectError: null }),
}));

const timestamp = '2026-09-01T12:00:00Z';
const cable = (id: string): Cable => ({
  id,
  projectId: 'project',
  cableId: 1,
  tag: id,
  cableTypeId: 'type',
  typeName: 'Cable type',
  revision: null,
  mto: null,
  purpose: null,
  diameterMm: null,
  weightKgPerM: null,
  fromLocation: null,
  toLocation: null,
  routing: null,
  delivery: null,
  designLength: null,
  installLength: null,
  pullDate: null,
  connectedFrom: null,
  connectedTo: null,
  tested: null,
  createdAt: timestamp,
  updatedAt: timestamp,
});
const cableType = (id: string): CableType => ({
  id,
  projectId: 'project',
  name: id,
  tag: null,
  purpose: null,
  diameterMm: null,
  weightKgPerM: null,
  fromLocation: null,
  toLocation: null,
  routing: null,
  createdAt: timestamp,
  updatedAt: timestamp,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe.each([
  {
    name: 'Cable details',
    path: 'cables/:cableId',
    url: 'cables',
    element: <CableDetails />,
    fetch: vi.mocked(fetchCableDetails),
    response: (id: string) => ({
      cable: cable(id),
      materialCableType: null,
      cableTypeDefaultMaterials: [],
      cableMaterials: [],
    }),
    heading: 'Cable 1 - current',
  },
  {
    name: 'Cable type details',
    path: 'cable-types/:cableTypeId',
    url: 'cable-types',
    element: <CableTypeDetails />,
    fetch: vi.mocked(fetchCableTypeDetails),
    response: (id: string) => ({
      cableType: cableType(id),
      materialCableType: null,
      defaultMaterials: [],
      cableCount: 0,
    }),
    heading: 'Cable type - current',
  },
])('$name route changes', (page) => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps the current record when the previous request finishes late', async () => {
    const previous = deferred<ReturnType<typeof page.response>>();
    const current = deferred<ReturnType<typeof page.response>>();
    page.fetch.mockImplementation(((_projectId: string, id: string) =>
      id === 'previous' ? previous.promise : current.promise) as typeof fetchCableDetails &
      typeof fetchCableTypeDetails);
    render(
      <MemoryRouter initialEntries={[`/projects/project/${page.url}/previous`]}>
        <Link to={`/projects/project/${page.url}/current`}>Next record</Link>
        <Routes>
          <Route path={`/projects/:projectId/${page.path}`} element={page.element} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('link', { name: 'Next record' }));
    await act(async () => {
      current.resolve(page.response('current'));
    });
    expect(screen.getByText(page.heading)).toBeInTheDocument();

    await act(async () => {
      previous.resolve(page.response('previous'));
    });
    expect(screen.getByText(page.heading)).toBeInTheDocument();
  });

  it('ignores an old failure without clearing the current loading state', async () => {
    const previous = deferred<ReturnType<typeof page.response>>();
    const current = deferred<ReturnType<typeof page.response>>();
    page.fetch.mockImplementation(((_projectId: string, id: string) =>
      id === 'previous' ? previous.promise : current.promise) as typeof fetchCableDetails &
      typeof fetchCableTypeDetails);
    render(
      <MemoryRouter initialEntries={[`/projects/project/${page.url}/previous`]}>
        <Link to={`/projects/project/${page.url}/current`}>Next record</Link>
        <Routes>
          <Route path={`/projects/:projectId/${page.path}`} element={page.element} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('link', { name: 'Next record' }));
    await act(async () => {
      previous.reject(new Error('Old request failed'));
    });
    expect(screen.getByRole('progressbar')).toBeInTheDocument();

    await act(async () => {
      current.resolve(page.response('current'));
    });
    expect(screen.getByText(page.heading)).toBeInTheDocument();
  });
});
