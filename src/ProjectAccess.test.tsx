import { configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@/app/ThemeProvider';
import { AuthProvider } from '@/context/AuthContext';
import { ToastProvider } from '@/context/ToastContext';
import { routes } from '@/routes/router';

const projectId = '00000000-0000-4000-8000-000000000003';
configure({ asyncUtilTimeout: 10000 });
const basicUser = {
  id: '00000000-0000-4000-8000-000000000002',
  email: 'basic@example.com',
  firstName: 'Basic',
  lastName: 'User',
  isAdmin: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const project = {
  id: projectId,
  projectNumber: 'P-001',
  name: 'Assigned project',
  customer: 'Customer',
  manager: null,
  description: '',
  secondaryTrayLength: null,
  supportDistance: null,
  supportWeight: null,
  trayLoadSafetyFactor: null,
  supportDistances: {},
  supportDistanceOverrides: {},
  trayPurposeTemplates: {},
  cableLayout: {},
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};
const requests: string[] = [];
const json = (payload: unknown) =>
  new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } });
const mount = (path: string) => {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>,
  );
  return router;
};
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('wfc_auth_token', 'basic-token');
  requests.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, options?: RequestInit) => {
      const path = new URL(input).pathname;
      requests.push(path);
      if (path === '/api/auth/register')
        return json({ user: basicUser, token: 'basic-token', expiresInSeconds: 3600 });
      expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer basic-token');
      if (path === '/api/users/me') return json({ user: basicUser });
      if (path === '/api/projects') return json({ projects: [] });
      if (path === `/api/projects/${projectId}`) return json({ project });
      if (path.endsWith('/cables')) return json({ cables: [] });
      if (path.endsWith('/cable-types')) return json({ cableTypes: [] });
      if (path.endsWith('/trays')) return json({ trays: [] });
      if (path.endsWith('/roxtec')) return json({ entries: [] });
      if (path.endsWith('/roxtec/1'))
        return json({
          entry: {
            id: 1,
            projectId,
            revision: 'A',
            tag: 'ROX-1',
            type: 'Frame',
            description: '',
            createdAt: '2026-01-01',
            updatedAt: '2026-01-01',
          },
        });
      if (path.endsWith('/tray-data')) return json({ trays: [], supports: [], loadCurves: [] });
      throw new Error(`Unexpected API access: ${path}`);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('basic user navigation and project controls', () => {
  it('shows only Projects in the navigation and explains how to request access', async () => {
    mount('/');
    expect(await screen.findByText('No projects found')).toBeInTheDocument();
    const nav = within(screen.getByRole('navigation', { name: 'Primary' }));
    expect(nav.getByRole('link', { name: 'Projects' })).toBeInTheDocument();
    for (const name of ['Materials', 'Templates', 'Admin'])
      expect(nav.queryByRole('link', { name })).not.toBeInTheDocument();
    expect(
      screen.getByText('Contact an administrator to receive access to projects.'),
    ).toBeInTheDocument();
  });

  it.each([
    '/materials',
    '/materials/trays/private-id',
    '/materials/supports/private-id',
    '/materials/cable-types/private-id',
    '/materials/load-curves/private-id',
    '/templates',
    '/admin',
  ])('blocks opening %s directly', async (path) => {
    const router = mount(path);
    await waitFor(() => expect(router.state.location.pathname).toBe('/account'));
    expect(await screen.findByRole('status')).toHaveTextContent('Contact an administrator');
    expect(requests.every((request) => request === '/api/users/me')).toBe(true);
  });

  it.each(['cable-report', 'change-orders', 'internal-ncrs', 'files', 'variables-api'])(
    'blocks the %s tab even when requested in the URL',
    async (tab) => {
      mount(`/projects/${projectId}?tab=${tab}`);
      expect(await screen.findByText(/P-001/)).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');
      for (const name of [
        'Cables report',
        'Change Orders',
        'Internal NCRs',
        'Files',
        'Variables API',
      ]) {
        expect(screen.queryByRole('tab', { name })).not.toBeInTheDocument();
      }
      expect(screen.queryByText('Tray report templates')).not.toBeInTheDocument();
      expect(
        requests.some((path) =>
          /materials|templates|files|report-summary|change-orders|internal-ncrs/.test(path),
        ),
      ).toBe(false);
    },
  );

  it.each(['cable-list', 'cables', 'trays', 'roxtec'])(
    'keeps the %s tab available for reading without edit or transfer actions',
    async (tab) => {
      mount(`/projects/${projectId}?tab=${tab}`);
      await screen.findByText(/P-001/);
      await waitFor(() =>
        expect(
          screen.queryByText(/Loading (cables|cable types|trays|Roxtec)/),
        ).not.toBeInTheDocument(),
      );
      for (const button of screen.queryAllByRole('button')) {
        expect(button.textContent).not.toMatch(
          /Add cable|Add tray|Add Roxtec|Import|Export|Change tracker|Get template|Delete|Edit|Save/,
        );
      }
      expect(requests.some((path) => path.startsWith('/api/materials'))).toBe(false);
    },
  );

  it('keeps Roxtec details and saved routings read-only, without export', async () => {
    localStorage.setItem(`wfc:roxtec-routings:${projectId}:1`, JSON.stringify(['A001']));
    mount(`/projects/${projectId}/roxtec/1`);
    expect(await screen.findByText('ROX-1')).toBeInTheDocument();
    expect(await screen.findByText('A001')).toBeInTheDocument();
    for (const name of ['Edit Roxtec', 'Add routing', 'Remove routing A001', 'Export to Excel']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(localStorage.getItem(`wfc:roxtec-routings:${projectId}:1`)).toBe(
      JSON.stringify(['A001']),
    );
  });

  it('shows the administrator contact message after successful registration', async () => {
    localStorage.clear();
    const router = mount('/register');
    const user = userEvent.setup();
    await screen.findByText('Create your account');
    await user.type(screen.getByRole('textbox', { name: 'Email' }), basicUser.email);
    await user.type(screen.getByLabelText(/Password/), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign up' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/account'));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Contact an administrator to receive access to projects.',
    );
  });
});
