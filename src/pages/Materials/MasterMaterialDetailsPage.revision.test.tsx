import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ details: vi.fn(), create: vi.fn(), toast: vi.fn() }));
vi.mock('@/api/client', async (original) => ({
  ...(await original<typeof import('@/api/client')>()),
  fetchMaterialDetails: mocks.details,
  fetchMaterialCableInstallationMaterials: async () => ({ cableInstallationMaterials: [] }),
  createStandardMaterial: mocks.create,
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { isAdmin: true }, token: 'token' }) }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ showToast: mocks.toast }) }));
vi.mock('./components/MaterialDetailsLayout', () => ({
  MaterialDetailsLoading: () => <p>Loading</p>,
  MaterialDetailsError: () => <p>Failed</p>,
  MaterialDetailsLayout: ({ children, onRefresh }: { children: ReactNode; onRefresh: () => void }) =>
    <><button onClick={onRefresh}>Refresh</button>{children}</>,
}));
vi.mock('./components/StandardMaterialsSection', () => ({
  StandardMaterialsSection: ({ onAdd }: { onAdd: () => void }) => <button onClick={onAdd}>Add</button>,
}));
vi.mock('./components/StandardMaterialDialog', () => ({
  StandardMaterialDialog: ({ open, onSave }: { open: boolean; onSave: (input: unknown) => void }) => open
    ? <button onClick={() => onSave({ referencedMaterialId: 'part', quantity: 2, unit: 'pcs' })}>Save</button> : null,
}));
vi.mock('./components/MaterialEditDialog', () => ({ MaterialEditDialog: () => null }));
import { MasterMaterialDetailsPage } from './MasterMaterialDetailsPage';

describe('standard composition editor revision', () => {
  it('keeps the revision opened for editing even if the page refreshes in the background', async () => {
    const details = { category: { label: 'Cable' }, material: { id: 'owner' }, standardMaterials: [], mutationRevision: 4 };
    mocks.details.mockResolvedValueOnce(details).mockResolvedValue({ ...details, mutationRevision: 5 });
    mocks.create.mockResolvedValue({});
    render(<MemoryRouter initialEntries={['/material/owner']}><Routes><Route path="/material/:id"
      element={<MasterMaterialDetailsPage category="cable-type" idParam="id" getTitle={() => 'Cable'} getProperties={() => []} />} />
    </Routes></MemoryRouter>);
    fireEvent.click(await screen.findByText('Add'));
    fireEvent.click(screen.getByText('Refresh'));
    await waitFor(() => expect(mocks.details).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith('token', 'cable-type', 'owner',
      { referencedMaterialId: 'part', quantity: 2, unit: 'pcs' }, 4));
  });
});
