import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { Materials } from './Materials';

vi.mock('@/api/client', async (importOriginal) => {
  const pagination = { page: 1, pageSize: 20, totalPages: 1, totalItems: 0 };
  return {
    ...(await importOriginal<typeof import('@/api/client')>()),
    fetchMaterialTrays: vi.fn().mockResolvedValue({ trays: [], pagination }),
    fetchMaterialSupports: vi.fn().mockResolvedValue({ supports: [], pagination }),
    fetchMaterialLoadCurves: vi.fn().mockResolvedValue({ loadCurves: [], pagination }),
    fetchMaterialCableTypes: vi.fn().mockResolvedValue({ cableTypes: [] }),
    fetchMaterialCableInstallationMaterials: vi
      .fn()
      .mockResolvedValue({ cableInstallationMaterials: [] }),
    fetchMaterialTrayInstallationMaterials: vi
      .fn()
      .mockResolvedValue({ trayInstallationMaterials: [] }),
    fetchMaterialInstruments: vi.fn().mockResolvedValue({ instruments: [] }),
    fetchMaterialInstrumentInstallationMaterials: vi
      .fn()
      .mockResolvedValue({ instrumentInstallationMaterials: [] }),
  };
});

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null, token: null }) }));
const showToast = vi.hoisted(() => vi.fn());
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ showToast }) }));

const Navigation = () => {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <>
      <button onClick={() => navigate('/materials?tab=loadCurves&filter=kept')}>
        Navigate to curves
      </button>
      <button onClick={() => navigate(-1)}>History back</button>
      <output aria-label="Current query">{location.search}</output>
    </>
  );
};

describe('Materials category navigation', () => {
  it('keeps the selected tab in sync with navigation and preserves other query parameters', async () => {
    render(
      <FluentProvider theme={webLightTheme}>
        <MemoryRouter initialEntries={['/materials?tab=trays&filter=kept']}>
          <Navigation />
          <Materials />
        </MemoryRouter>
      </FluentProvider>,
    );
    expect(screen.getByRole('tab', { name: 'Trays' })).toHaveAttribute('aria-selected', 'true');
    await screen.findByText('No trays found');

    fireEvent.click(screen.getByRole('button', { name: 'Navigate to curves' }));
    expect(screen.getByRole('tab', { name: 'Load curves' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tabpanel', { name: 'Load curves' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'History back' }));
    expect(screen.getByRole('tab', { name: 'Trays' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('tab', { name: 'Supports' }));
    expect(screen.getByRole('status', { name: 'Current query' })).toHaveTextContent(
      'tab=supports&filter=kept',
    );
  });
});
