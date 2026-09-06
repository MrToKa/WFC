import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaterialLoadCurve } from '@/api/client';
import { LoadCurveDetails } from './LoadCurveDetails';

const mocks = vi.hoisted(() => ({
  fetchCurve: vi.fn(),
  updateCurve: vi.fn(),
  importPoints: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  fetchMaterialLoadCurve: mocks.fetchCurve,
  updateMaterialLoadCurve: mocks.updateCurve,
  importMaterialLoadCurvePoints: mocks.importPoints,
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { isAdmin: true }, token: 'token' }),
}));
vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}));

const curve: MaterialLoadCurve = {
  id: 'curve-1',
  name: 'Original curve',
  description: 'Original description',
  trayId: null,
  trayType: null,
  assignedTrayCount: 0,
  assignedTrayTypes: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  points: [1, 2].map((spanM, index) => ({
    id: `point-${index}`,
    order: index,
    spanM,
    loadKnPerM: 3 - index,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })),
};

const renderDetails = async () => {
  const result = render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={['/materials/load-curves/curve-1']}>
        <Routes>
          <Route path="/materials/load-curves/:loadCurveId" element={<LoadCurveDetails />} />
        </Routes>
      </MemoryRouter>
    </FluentProvider>,
  );
  await screen.findByRole('textbox', { name: 'Name' });
  return result;
};

describe('LoadCurveDetails independent editing sections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchCurve.mockResolvedValue({ loadCurve: curve });
    mocks.updateCurve.mockResolvedValue({ loadCurve: curve });
    mocks.importPoints.mockResolvedValue({
      loadCurve: curve,
      summary: { importedPoints: 2 },
    });
  });

  it('preserves unsaved point edits when saving general information', async () => {
    await renderDetails();
    const pointInput = screen.getByRole('textbox', { name: 'Support spacing for point 1' });
    fireEvent.change(pointInput, { target: { value: '1.25' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Updated curve' },
    });
    mocks.updateCurve.mockResolvedValue({ loadCurve: { ...curve, name: 'Updated curve' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save details' }));
    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith({
        intent: 'success',
        title: 'Load curve updated',
      }),
    );
    expect(pointInput).toHaveValue('1.25');
    expect(mocks.updateCurve).toHaveBeenCalledWith('token', curve.id, {
      name: 'Updated curve',
      description: curve.description,
    });
  });

  it('preserves unsaved general information when saving points', async () => {
    await renderDetails();
    const name = screen.getByRole('textbox', { name: 'Name' });
    fireEvent.change(name, { target: { value: 'Unsaved name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save points' }));

    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith({
        intent: 'success',
        title: 'Curve points updated',
      }),
    );
    expect(name).toHaveValue('Unsaved name');
  });

  it('resets only general information without fetching or discarding point edits', async () => {
    await renderDetails();
    const pointInput = screen.getByRole('textbox', { name: 'Load for point 1' });
    fireEvent.change(pointInput, { target: { value: '9' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Unsaved name' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Reset$/ }));

    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue(curve.name);
    expect(pointInput).toHaveValue('9');
    expect(mocks.fetchCurve).toHaveBeenCalledOnce();
  });

  it('preserves general information during point import and prevents overlapping writes', async () => {
    const { container } = await renderDetails();
    const name = screen.getByRole('textbox', { name: 'Name' });
    fireEvent.change(name, { target: { value: 'Unsaved name' } });
    let finishImport!: (value: unknown) => void;
    mocks.importPoints.mockReturnValue(
      new Promise((resolve) => {
        finishImport = resolve;
      }),
    );
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [new File(['points'], 'curve.xlsx')] },
    });
    expect(screen.getByRole('button', { name: 'Save details' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save points' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();

    finishImport({ loadCurve: curve, summary: { importedPoints: 2 } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save details' })).toBeEnabled());
    expect(name).toHaveValue('Unsaved name');
  });
});
