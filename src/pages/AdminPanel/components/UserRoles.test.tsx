import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn() }));
vi.mock('@/api/client', async (original) => ({
  ...(await original<typeof import('@/api/client')>()),
  fetchAllUsers: mocks.list,
  updateUserRoleAsAdmin: mocks.save,
}));
import { useAdminPanelStyles } from '../AdminPanel.styles';
import { useAdminUsersSection } from '../hooks/useAdminUsersSection';
import { UserManagementSection } from './UserManagementSection';

const user = {
  id: 'basic-id', email: 'basic@example.com', firstName: null, lastName: null,
  isAdmin: false, role: 'basic', createdAt: '2026-01-01', updatedAt: '2026-01-01',
};
const Harness = () => {
  const state = useAdminUsersSection({ token: 'admin-token' });
  return <UserManagementSection styles={useAdminPanelStyles()} currentUserId="admin-id" state={state} />;
};
const mount = () => render(<FluentProvider theme={webLightTheme}><Harness /></FluentProvider>);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.list.mockResolvedValue({ users: [user] });
  mocks.save.mockImplementation(async (_token, _id, role) => ({ user: { ...user, role } }));
});

describe('user roles in the administrator panel', () => {
  it('assigns Technician, filters by the new role, and restores Basic', async () => {
    mount();
    const actor = userEvent.setup();
    await actor.click(await screen.findByRole('button', { name: 'Set as Technician' }));
    expect(mocks.save).toHaveBeenCalledWith('admin-token', 'basic-id', 'technician');
    expect(await screen.findByRole('cell', { name: 'Technician' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Project access' })).toBeInTheDocument();
    const filter = screen.getByPlaceholderText('Filter users...');
    await actor.type(filter, 'technician');
    expect(screen.getByText(user.email)).toBeInTheDocument();
    await actor.clear(filter);
    await actor.click(screen.getByRole('button', { name: 'Set as Basic' }));
    await screen.findByRole('cell', { name: 'Basic' });
    expect(mocks.save).toHaveBeenLastCalledWith('admin-token', 'basic-id', 'basic');
  });

  it('keeps the original role when saving fails and allows retry', async () => {
    mocks.save.mockRejectedValueOnce(new Error('Unavailable'));
    mount();
    const actor = userEvent.setup();
    await actor.click(await screen.findByRole('button', { name: 'Set as Technician' }));
    expect(await screen.findByText('Failed to update user role.')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Basic' })).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Set as Technician' });
    await waitFor(() => expect(retry).toBeEnabled());
    await actor.click(retry);
    expect(await screen.findByRole('cell', { name: 'Technician' })).toBeInTheDocument();
  });
});
