import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ projects: vi.fn(), access: vi.fn(), save: vi.fn() }));
vi.mock('@/api/client', () => ({
  fetchProjects: mocks.projects,
  fetchUserProjectAccess: mocks.access,
  updateUserProjectAccess: mocks.save,
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ token: 'admin-token' }) }));
import { ProjectAccessDialog } from './ProjectAccessDialog';

const user = {
  id: 'basic-id',
  email: 'basic@example.com',
  firstName: null,
  lastName: null,
  isAdmin: false,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};
const mount = (onClose = vi.fn()) => {
  render(
    <FluentProvider theme={webLightTheme}>
      <ProjectAccessDialog user={user} onClose={onClose} />
    </FluentProvider>,
  );
  return onClose;
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.projects.mockResolvedValue({
    projects: [
      { id: 'p1', projectNumber: 'P-001', name: 'First' },
      { id: 'p2', projectNumber: 'P-002', name: 'Second' },
    ],
  });
  mocks.access.mockResolvedValue({ projectIds: ['p1'] });
  mocks.save.mockResolvedValue({ projectIds: ['p2'] });
});

describe('project access management', () => {
  it('loads current assignments and saves selected projects, including removals', async () => {
    const onClose = mount();
    const actor = userEvent.setup();
    const first = await screen.findByRole('checkbox', { name: 'P-001 — First' });
    const second = screen.getByRole('checkbox', { name: 'P-002 — Second' });
    expect(first).toBeChecked();
    expect(second).not.toBeChecked();
    await actor.click(first);
    await actor.click(second);
    await actor.click(screen.getByRole('button', { name: 'Save access' }));
    expect(mocks.save).toHaveBeenCalledWith('admin-token', 'basic-id', ['p2']);
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('disables saving when permissions could not be loaded', async () => {
    mocks.access.mockRejectedValue(new Error('Unavailable'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load project access');
    expect(screen.getByRole('button', { name: 'Save access' })).toBeDisabled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('keeps the selection available for retry if saving fails', async () => {
    mocks.save.mockRejectedValue(new Error('Unavailable'));
    const onClose = mount();
    const actor = userEvent.setup();
    await screen.findByRole('checkbox', { name: 'P-001 — First' });
    await actor.click(screen.getByRole('button', { name: 'Save access' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to save project access');
    expect(screen.getByRole('checkbox', { name: 'P-001 — First' })).toBeChecked();
    expect(onClose).not.toHaveBeenCalled();
  });
});
