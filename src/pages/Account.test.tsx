import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { Account } from './Account';

const mocks = vi.hoisted(() => ({
  updateProfile: vi.fn(),
  deleteAccount: vi.fn(),
  user: {
    id: 'user-1',
    email: 'user@example.com',
    firstName: 'First',
    lastName: 'Last',
    isAdmin: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
}));

vi.mock('@/context/AuthContext', () => ({ useAuth: () => mocks }));

describe('Account validation', () => {
  it('does not silently ignore a cleared email while saving another field', () => {
    render(
      <FluentProvider theme={webLightTheme}>
        <MemoryRouter>
          <Account />
        </MemoryRouter>
      </FluentProvider>,
    );
    const email = screen.getByRole('textbox', { name: 'Email' });
    fireEvent.change(email, { target: { value: ' ' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'First name' }), {
      target: { value: 'Changed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(mocks.updateProfile).not.toHaveBeenCalled();
    expect(email).toHaveAccessibleDescription('Email is required.');
    expect(email).toHaveAttribute('aria-invalid', 'true');
  });
});
