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
let role: 'basic' | 'technician' = 'basic';
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
  role = 'basic';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, options?: RequestInit) => {
      const path = new URL(input).pathname;
      requests.push(path);
      if (path === '/api/auth/register')
        return json({ user: basicUser, token: 'basic-token', expiresInSeconds: 3600 });
      expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer basic-token');
      if (path === '/api/users/me') return json({ user: { ...basicUser, role } });
      if (path === '/api/projects') return json({ projects: [] });
      if (path === `/api/projects/${projectId}`) return json({ project });
      if (path.endsWith('/cables/cable-id/details')) return json({
        cable: { id: 'cable-id', projectId, cableId: 1, cableTypeId: 'type-id', typeName: 'Type A',
          tag: 'CABLE-1', routing: 'TRAY-1', updatedAt: '2026-01-01' },
        materialCableType: null, cableMaterials: [], cableTypeDefaultMaterials: [],
      });
      if (path.endsWith('/cables/cable-id/versions')) return json({ versions: [] });
      if (path.endsWith('/cable-types/type-id/details')) return json({
        cableType: { id: 'type-id', projectId, name: 'Type A', updatedAt: '2026-01-01' },
        materialCableType: null, defaultMaterials: [], cableCount: 0,
      });
      if (path.endsWith('/trays/tray-id')) return json({ tray: {
        id: 'tray-id', projectId, name: 'TRAY-1', type: null, purpose: null,
        widthMm: 300, heightMm: 60, lengthMm: 1000, includeGroundingCable: false,
        createdAt: '2026-01-01', updatedAt: '2026-01-01',
      } });
      if (path.endsWith('/files')) return json({ files: [] });
      if (path.endsWith('/export')) return new Response('excel');
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


describe('Technician navigation and export controls', () => {
  beforeEach(() => { role = 'technician'; });

  it.each(['cable-list', 'cables', 'trays'])('can export %s without edit, import or template controls', async (tab) => {
    const createObjectURL = vi.fn(() => 'blob:export');
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = vi.fn();
    });
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    mount('/projects/' + projectId + '?tab=' + tab);
    const button = await screen.findByRole('button', { name: 'Export to Excel' });
    for (const candidate of screen.queryAllByRole('button')) {
      expect(candidate.textContent).not.toMatch(/Add cable|Add tray|Import|Get upload template|Delete|Edit|Save/);
    }
    expect(screen.queryByRole('switch', { name: 'Inline edit' })).not.toBeInTheDocument();
    await userEvent.setup().click(button);
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    expect(download).toHaveBeenCalled();
    expect(requests.some((path) => path.endsWith('/export'))).toBe(true);
    expect(requests.some((path) => path.startsWith('/api/materials'))).toBe(false);
    download.mockRestore();
  });

  it.each(['cable-report', 'change-orders', 'internal-ncrs', 'variables-api'])(
    'rejects a direct URL to the %s tab', async (tab) => {
      mount('/projects/' + projectId + '?tab=' + tab);
      await screen.findByText(/P-001/);
      expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');
      for (const name of ['Cables report', 'Change Orders', 'Internal NCRs', 'Variables API']) {
        expect(screen.queryByRole('tab', { name })).not.toBeInTheDocument();
      }
      expect(requests.some((path) => /report-summary|change-orders|internal-ncrs/.test(path))).toBe(false);
    },
  );

  it.each(['/materials', '/templates', '/admin'])('denies global page %s', async (path) => {
    const router = mount(path);
    await waitFor(() => expect(router.state.location.pathname).toBe('/account'));
    expect(await screen.findByText('Technician')).toBeInTheDocument();
    const nav = within(screen.getByRole('navigation', { name: 'Primary' }));
    for (const name of ['Materials', 'Templates', 'Admin']) expect(nav.queryByRole('link', { name })).not.toBeInTheDocument();
  });

  it.each([
    ['/cables/cable-id', 'Cable 1 - CABLE-1'],
    ['/cable-types/type-id', 'Cable type - Type A'],
    ['/trays/tray-id', 'TRAY-1'],
  ])('opens %s details without editing or catalog requests', async (suffix, title) => {
    mount('/projects/' + projectId + suffix);
    expect((await screen.findAllByText(title)).length).toBeGreaterThan(0);
    for (const button of screen.queryAllByRole('button')) {
      expect(button.textContent).not.toMatch(/Edit cable|Edit tray|Delete|Add material|Add default material|Import|Save changes/);
    }
    expect(requests.some((path) => path.startsWith('/api/materials'))).toBe(false);
  });

  it('shows Files without upload, replace or delete actions', async () => {
    mount('/projects/' + projectId + '?tab=files');
    await screen.findByText(/P-001/);
    expect(screen.getByRole('tab', { name: 'Files' })).toHaveAttribute('aria-selected', 'true');
    expect(requests.some((path) => path.endsWith('/files'))).toBe(true);
    for (const button of screen.queryAllByRole('button')) expect(button.textContent).not.toMatch(/Upload|Delete|Replace/);
  });
});
