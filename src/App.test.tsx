import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { ThemeProvider } from '@/app/ThemeProvider';
import { routes } from '@/routes/router';

const renderApp = (initialEntries: string[] = ['/']) => {
  const router = createMemoryRouter(routes, { initialEntries });
  return render(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  );
};

describe('AppShell', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders the header and navigation links', () => {
    renderApp();

    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();

    const primaryNav = screen.getByRole('navigation', { name: /primary/i });
    expect(primaryNav).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /home/i })[0]).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /about/i })[0]).toBeInTheDocument();
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
