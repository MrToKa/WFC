import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { ThemeProvider } from '@/app/ThemeProvider';
import { AuthProvider } from '@/context/AuthContext';
import { ToastProvider } from '@/context/ToastContext';
import { routes } from '@/routes/router';

const renderApp = (initialEntries: string[] = ['/']) => {
  const router = createMemoryRouter(routes, { initialEntries });
  return render(
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  );
};

describe('AppShell', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders the header and navigation links', () => {
    renderApp();

    expect(screen.getByRole('heading', { level: 1, name: /acs app/i })).toBeInTheDocument();

    const primaryNav = screen.getByRole('navigation', { name: /primary/i });
    expect(primaryNav).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /projects/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /materials/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /log in/i })).toBeInTheDocument();
  });

  it('toggles between light and dark themes', async () => {
    const user = userEvent.setup();
    renderApp();

    const toggle = screen.getByRole('switch', { name: /toggle dark mode/i });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(window.localStorage.getItem('theme')).toBeNull();

    await user.click(toggle);

    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    await waitFor(() => expect(window.localStorage.getItem('theme')).toBe('dark'));

    await user.click(toggle);

    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
    await waitFor(() => expect(window.localStorage.getItem('theme')).toBe('light'));
  });
});
