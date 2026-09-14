// @vitest-environment node
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
const auth = vi.hoisted(() => ({ verifyAccessToken: vi.fn() }));
vi.mock('../db.js', () => ({ pool: database }));
vi.mock('../auth.js', async (original) => ({
  ...(await original<typeof import('../auth.js')>()),
  ...auth,
}));
vi.mock('../services/objectStorageService.js', async () => ({
  getProjectBucket: () => 'test-project-files',
  getObjectStream: async () => (await import('node:stream')).Readable.from(['test']),
}));

import ExcelJS from 'exceljs';
import { createApp } from '../app.js';

const adminId = '00000000-0000-4000-8000-000000000001';
const basicId = '00000000-0000-4000-8000-000000000002';
const allowedId = '00000000-0000-4000-8000-000000000003';
const otherId = '00000000-0000-4000-8000-000000000004';
const itemId = '00000000-0000-4000-8000-000000000005';
const projectRow = (id: string) => ({
  id,
  project_number: id === allowedId ? 'Allowed' : 'Other',
  name: 'Project',
  customer: 'Customer',
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
  tray_purpose_templates: { Power: { fileId: itemId, fileName: 'private.docx' } },
});
let server: Server;
let baseUrl: string;
let grants: Set<string>;
let basicIsAdmin: boolean;
let basicRole: 'basic' | 'technician' | 'engineer';
let basicExists: boolean;

beforeAll(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(
  () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
);
beforeEach(() => {
  vi.clearAllMocks();
  grants = new Set([allowedId]);
  basicIsAdmin = false;
  basicRole = 'basic';
  basicExists = true;
  auth.verifyAccessToken.mockImplementation((token: string) => ({
    sub: token === 'admin' ? adminId : basicId,
    email: 'user@example.com',
    isAdmin: token === 'admin' || token === 'stale-admin',
  }));
  database.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
    if (/SELECT is_admin(?:, role)? FROM users/.test(sql)) {
      return {
        rows:
          values[0] === adminId
            ? [{ is_admin: true }]
            : basicExists
              ? [{ is_admin: basicIsAdmin, role: basicRole }]
              : [],
      };
    }
    if (sql.includes('UPDATE users SET role = $2')) {
      if (values[0] !== basicId || basicIsAdmin || !basicExists) return { rows: [] };
      expect(sql).toContain('AND is_admin = FALSE');
      basicRole = values[1] as typeof basicRole;
      return { rows: [{ id: basicId, email: 'basic@example.com', is_admin: false, role: basicRole,
        created_at: '2026-01-01', updated_at: '2026-01-01' }] };
    }
    if (sql.includes('SELECT id FROM users')) return { rows: [{ id: values[0] }] };
    if (sql.trim().startsWith('SELECT 1 FROM user_project_access')) {
      return { rows: grants.has(String(values[1])) ? [{ exists: 1 }] : [] };
    }
    if (sql.includes('SELECT project_id FROM user_project_access')) {
      return { rows: [...grants].map((id) => ({ project_id: id })) };
    }
    if (sql.includes('SELECT id FROM projects WHERE id = ANY')) {
      return {
        rows: (values[0] as string[])
          .filter((id) => [allowedId, otherId].includes(id))
          .map((id) => ({ id })),
      };
    }
    if (sql.includes('DELETE FROM user_project_access')) {
      grants.clear();
      return { rows: [] };
    }
    if (sql.includes('INSERT INTO user_project_access')) {
      grants = new Set(values[1] as string[]);
      return { rows: [] };
    }
    if (sql.includes('FROM projects p')) {
      if (sql.includes('ORDER BY p.created_at')) {
        expect(sql).toContain('WHERE $1::boolean OR $3::boolean OR EXISTS');
        expect(sql).toContain('access.user_id = $2');
        return {
          rows: [allowedId, otherId].filter((id) => values[0] || values[2] || grants.has(id)).map((id) => ({ ...projectRow(id), can_edit: Boolean(values[0] || (values[2] && grants.has(id))) })),
        };
      }
      return { rows: [projectRow(String(values[0]))] };
    }
    return { rows: [], rowCount: 0 };
  });
  database.connect.mockResolvedValue({ query: database.query, release: vi.fn() });
});

const call = (path: string, token: string | null = 'basic', method = 'GET', body?: unknown) =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

describe('project access through the complete API middleware stack', () => {
  it.each([
    '/api/projects',
    `/api/projects/${allowedId}`,
    '/api/materials/trays',
    '/api/templates',
  ])('requires authentication: %s', async (path) => {
    expect((await call(path, null)).status).toBe(401);
    expect(database.query).not.toHaveBeenCalled();
  });

  it('lists only assigned projects and no projects before access is granted', async () => {
    const response = await call('/api/projects');
    expect(response.status).toBe(200);
    expect((await response.json()).projects.map((project: { id: string }) => project.id)).toEqual([
      allowedId,
    ]);
    expect(database.query).toHaveBeenCalledWith(expect.stringContaining('access.user_id = $2'), [
      false,
      basicId,
      false,
    ]);
    grants.clear();
    expect((await (await call('/api/projects')).json()).projects).toEqual([]);
  });

  it('allows project reading without exposing attached report templates', async () => {
    const response = await call(`/api/projects/${allowedId}`);
    expect(response.status).toBe(200);
    expect((await response.json()).project.trayPurposeTemplates).toEqual({});
  });

  it.each(['basic', 'technician', 'engineer'] as const)('does not initialize or modify materials when %s reads cable details', async (role) => {
    basicRole = role;
    if (role === 'engineer') grants.clear();
    const baseQuery = database.query.getMockImplementation()!;
    database.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql.includes('FROM cables c')) {
        expect(values).toEqual([allowedId, itemId]);
        return {
          rows: [
            {
              id: itemId,
              project_id: allowedId,
              cable_id: 1,
              cable_type_id: itemId,
              type_name: 'Cable type',
              materials_initialized: false,
              materials_customized: false,
              created_at: '2026-01-01',
              updated_at: '2026-01-01',
            },
          ],
        };
      }
      return baseQuery(sql, values);
    });
    const response = await call(`/api/projects/${allowedId}/cables/${itemId}/details`);
    expect(response.status).toBe(200);
    expect((await response.json()).cable.id).toBe(itemId);
    const statements = database.query.mock.calls.map(([sql]) => String(sql).trim());
    expect(statements).toContain('BEGIN READ ONLY');
    expect(statements.some((sql) => /^(INSERT|UPDATE|DELETE|ALTER|CREATE)\b/.test(sql))).toBe(
      false,
    );
  });

  it.each([
    '',
    '/cables',
    '/cable-types',
    '/trays',
    '/roxtec',
    '/tray-data',
    `/cables/${itemId}/versions`,
    `/cables/${itemId}/details`,
    `/cable-types/${itemId}/details`,
    `/trays/${itemId}`,
    '/roxtec/1',
  ])('rejects direct access to an unassigned project: %s', async (suffix) => {
    expect((await call(`/api/projects/${otherId}${suffix}`)).status).toBe(403);
    expect(database.query).toHaveBeenCalledTimes(2);
  });

  it.each(['/cables', '/cable-types', '/trays', '/roxtec', '/tray-data'])(
    'allows assigned project lists: %s',
    async (suffix) => {
      expect((await call(`/api/projects/${allowedId}${suffix}`)).status).toBe(200);
    },
  );

  it.each([
    '/cables/report-summary',
    '/cables/export',
    '/cables/template',
    '/trays/export',
    '/trays/template',
    '/cable-types/export',
    '/cable-types/template',
    `/cable-types/${itemId}/default-materials/export`,
    '/files',
    `/files/${itemId}/download`,
    `/files/${itemId}/versions`,
    '/change-orders',
    `/change-orders/${itemId}`,
    '/internal-ncrs',
    '/future-section',
  ])('blocks forbidden reads within an assigned project: %s', async (suffix) => {
    expect((await call(`/api/projects/${allowedId}${suffix}`)).status).toBe(403);
    expect(database.query).toHaveBeenCalledTimes(1);
  });

  it.each([
    '/api/materials',
    '/api/materials/trays',
    '/api/materials/cable-types',
    '/api/materials/cable-installation-materials',
    '/api/materials/tray-installation-materials',
    '/api/materials/instruments',
    '/api/materials/instrument-installation-materials',
    '/api/templates',
    '/api/admin/users',
  ])('blocks global sections: %s', async (path) => {
    expect((await call(path)).status).toBe(403);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'rejects all %s operations on project data',
    async (method) => {
      for (const suffix of [
        '',
        '/cables',
        `/cables/${itemId}`,
        '/cables/import',
        '/trays/import',
        '/cable-types/import',
        '/roxtec/1',
        '/clear-data',
        '/files',
        '/change-orders',
        '/internal-ncrs',
      ]) {
        expect(
          (await call(`/api/projects/${allowedId}${suffix}`, 'basic', method, {})).status,
        ).toBe(403);
      }
      expect((await call('/api/projects', 'basic', method, {})).status).toBe(403);
    },
  );

  it('checks current account permissions instead of trusting stale admin claims', async () => {
    expect((await call(`/api/projects/${allowedId}/cables/export`, 'stale-admin')).status).toBe(
      403,
    );
    expect((await call('/api/materials/trays', 'stale-admin')).status).toBe(403);
    basicExists = false;
    expect((await call(`/api/projects/${allowedId}`)).status).toBe(401);
  });

  it('keeps all project and catalog access for administrators', async () => {
    const response = await call('/api/projects', 'admin');
    expect((await response.json()).projects).toHaveLength(2);
    expect((await call(`/api/projects/${otherId}`, 'admin')).status).toBe(200);
    expect((await call('/api/materials/cable-types', 'admin')).status).toBe(200);
    basicIsAdmin = true;
    expect((await call(`/api/projects/${otherId}`)).status).toBe(200);
  });

  it('rejects invalid project identifiers and HEAD requests to reports', async () => {
    expect((await call('/api/projects/not-a-uuid')).status).toBe(400);
    expect((await call(`/api/projects/${allowedId}/cables/export`, 'basic', 'HEAD')).status).toBe(
      403,
    );
  });
});

describe('administrator project assignments', () => {
  const path = `/api/admin/users/${basicId}/projects`;
  it('grants and revokes access immediately without requiring a new login', async () => {
    const saved = await call(path, 'admin', 'PUT', { projectIds: [otherId, otherId] });
    expect(saved.status).toBe(200);
    expect((await saved.json()).projectIds).toEqual([otherId]);
    expect((await call(`/api/projects/${allowedId}`)).status).toBe(403);
    expect((await call(`/api/projects/${otherId}`)).status).toBe(200);
    expect((await (await call(path, 'admin')).json()).projectIds).toEqual([otherId]);
    expect((await call(path, 'admin', 'PUT', { projectIds: [] })).status).toBe(200);
    expect((await call(`/api/projects/${otherId}`)).status).toBe(403);
  });

  it('prevents basic users from viewing or changing assignments', async () => {
    expect((await call(path)).status).toBe(403);
    expect((await call(path, 'basic', 'PUT', { projectIds: [otherId] })).status).toBe(403);
    expect(grants).toEqual(new Set([allowedId]));
  });

  it.each([
    { projectIds: ['bad-id'] },
    { projectIds: [itemId] },
    { projectIds: [], isAdmin: true },
  ])('preserves existing access when assignment validation fails: %j', async (body) => {
    expect((await call(path, 'admin', 'PUT', body)).status).toBe(400);
    expect(grants).toEqual(new Set([allowedId]));
  });
});


describe('Technician permissions', () => {
  beforeEach(() => { basicRole = 'technician'; });

  it('lists only assigned projects and immediately honors revoked access', async () => {
    expect((await (await call('/api/projects')).json()).projects.map((p: { id: string }) => p.id)).toEqual([allowedId]);
    expect((await call('/api/projects/' + otherId)).status).toBe(403);
    grants.clear();
    expect((await (await call('/api/projects')).json()).projects).toEqual([]);
    expect((await call('/api/projects/' + allowedId + '/cables/export')).status).toBe(403);
  });

  it.each([
    ['/cables/export', 'GET'], ['/cables/export?view=list', 'GET'],
    ['/cables/export?view=change-tracker', 'GET'], ['/cable-types/export', 'GET'],
    ['/trays/export', 'POST'],
  ])('exports table data without writes: %s %s', async (suffix, method) => {
    const response = await call('/api/projects/' + allowedId + suffix, 'basic', method, method === 'POST' ? {} : undefined);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('spreadsheetml');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await response.arrayBuffer());
    expect(workbook.worksheets.length).toBeGreaterThan(0);
    expect(database.query.mock.calls.some(([sql]) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql))).toBe(false);
    expect((await call('/api/projects/' + otherId + suffix, 'basic', method, method === 'POST' ? {} : undefined)).status).toBe(403);
  });

  it.each([
    '/cables/report-summary', '/cables/export?view=report', '/cables/export?view=REPORT',
    '/cables/export?view[]=report', '/cables/export?view[toString]=report',
    '/cables/template', '/cable-types/template', '/trays/template',
    '/change-orders', '/internal-ncrs', '/variables-api', '/future-section',
  ])('blocks restricted sections and report exports: %s', async (suffix) => {
    for (const method of ['GET', 'HEAD']) {
      expect((await call('/api/projects/' + allowedId + suffix, 'basic', method)).status).toBe(403);
    }
  });

  it.each(['/api/materials/trays', '/api/materials/cable-types', '/api/templates', '/api/admin/users'])(
    'blocks global access: %s', async (path) => {
      expect((await call(path)).status).toBe(403);
    },
  );

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('blocks %s mutations and imports', async (method) => {
    for (const suffix of ['', '/cables', '/cables/' + itemId, '/cables/import', '/cables/export',
      '/cables/' + itemId + '/materials', '/cable-types/import', '/trays/import', '/trays/' + itemId,
      '/roxtec/1', '/files', '/files/' + itemId, '/files/' + itemId + '/versions/' + itemId,
      '/change-orders', '/internal-ncrs', '/clear-data']) {
      expect((await call('/api/projects/' + allowedId + suffix, 'basic', method, {})).status).toBe(403);
    }
    expect((await call('/api/projects', 'basic', method, {})).status).toBe(403);
  });

  it('allows file reading but denies deletion even for the original uploader with a stale admin token', async () => {
    const baseQuery = database.query.getMockImplementation()!;
    database.query.mockImplementation(async (sql: string, values: unknown[]) => {
      if (sql.includes('FROM project_files pf')) {
        expect(values).toEqual([allowedId]);
        return { rows: [{ id: itemId, project_id: allowedId, file_name: 'drawing.pdf',
          content_type: 'application/pdf', size_bytes: 4, uploaded_by: basicId, uploaded_at: '2026-01-01' }] };
      }
      return baseQuery(sql, values);
    });
    const response = await call('/api/projects/' + allowedId + '/files', 'stale-admin');
    expect(response.status).toBe(200);
    expect((await response.json()).files[0].canDelete).toBe(false);
    expect((await call('/api/projects/' + allowedId + '/files/' + itemId, 'stale-admin', 'DELETE')).status).toBe(403);
    expect((await call('/api/projects/' + otherId + '/files')).status).toBe(403);
  });

  it('exports cable type default materials only after checking the project and item', async () => {
    const baseQuery = database.query.getMockImplementation()!;
    database.query.mockImplementation(async (sql: string, values: unknown[]) => {
      if (sql.includes('FROM cable_types') && sql.includes('AND id = $2')) {
        expect(values).toEqual([allowedId, itemId]);
        return { rows: [{ id: itemId, project_id: allowedId, name: 'Type A',
          created_at: '2026-01-01', updated_at: '2026-01-01' }] };
      }
      return baseQuery(sql, values);
    });
    const suffix = '/cable-types/' + itemId + '/default-materials/export';
    const response = await call('/api/projects/' + allowedId + suffix);
    expect(response.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await response.arrayBuffer());
    expect(workbook.worksheets[0].name).toBe('Default Materials');
    expect((await call('/api/projects/' + otherId + suffix)).status).toBe(403);
    expect(database.query.mock.calls.some(([sql]) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql))).toBe(false);
  });

  it('downloads files only from an assigned project with project-scoped item queries', async () => {
    const baseQuery = database.query.getMockImplementation()!;
    database.query.mockImplementation(async (sql: string, values: unknown[]) => {
      if (sql.includes('FROM project_files pf')) {
        expect(sql).toContain('pf.project_id = $2');
        expect(values).toEqual([itemId, allowedId]);
        return { rows: [{ id: itemId, project_id: allowedId, file_name: 'drawing.pdf',
          object_key: 'test-file', content_type: 'application/pdf', size_bytes: 4 }] };
      }
      return baseQuery(sql, values);
    });
    const suffix = '/files/' + itemId + '/download';
    const response = await call('/api/projects/' + allowedId + suffix);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('test');
    expect((await call('/api/projects/' + otherId + suffix)).status).toBe(403);
  });

  it('only permits administrators to assign or revoke Technician, preserving project grants', async () => {
    const path = '/api/admin/users/' + basicId + '/role';
    expect((await call(path, 'basic', 'PUT', { role: 'technician' })).status).toBe(403);
    let response = await call(path, 'admin', 'PUT', { role: 'basic' });
    expect(response.status).toBe(200);
    expect((await response.json()).user.role).toBe('basic');
    expect((await call('/api/projects/' + allowedId + '/cables/export')).status).toBe(403);
    response = await call(path, 'admin', 'PUT', { role: 'technician' });
    expect(response.status).toBe(200);
    expect((await response.json()).user).toMatchObject({ role: 'technician', isAdmin: false });
    expect((await call('/api/projects/' + allowedId + '/cables/export')).status).toBe(200);
    expect(grants).toEqual(new Set([allowedId]));
  });

  it.each([{ role: 'admin' }, { role: 'unknown' }, { role: 'technician', isAdmin: true }, {}])(
    'rejects invalid role changes: %j', async (body) => {
      expect((await call('/api/admin/users/' + basicId + '/role', 'admin', 'PUT', body)).status).toBe(400);
      expect(basicRole).toBe('technician');
    },
  );

  it('does not use the role endpoint to demote administrators', async () => {
    expect((await call('/api/admin/users/' + adminId + '/role', 'admin', 'PUT', { role: 'basic' })).status).toBe(404);
  });
});


describe('Engineer permissions', () => {
  beforeEach(() => { basicRole = 'engineer'; });

  it('lists every project with editing enabled only for assignments', async () => {
    const response = await call('/api/projects');
    expect(response.status).toBe(200);
    const projects = (await response.json()).projects;
    expect(projects.map((p: { id: string; canEdit: boolean }) => [p.id, p.canEdit])).toEqual([
      [allowedId, true], [otherId, false],
    ]);
    for (const [id, canEdit] of [[allowedId, true], [otherId, false]] as const) {
      const project = (await (await call('/api/projects/' + id)).json()).project;
      expect(project.canEdit).toBe(canEdit);
      expect(project.trayPurposeTemplates.Power.fileId).toBe(itemId);
    }
    grants.clear();
    const noGrants = (await (await call('/api/projects')).json()).projects;
    expect(noGrants).toHaveLength(2);
    expect(noGrants.every((p: { canEdit: boolean }) => !p.canEdit)).toBe(true);
  });

  it.each(['/api/materials/trays', '/api/materials/supports', '/api/materials/cable-types',
    '/api/materials/load-curves', '/api/materials/cable-installation-materials', '/api/templates'])(
    'reads global catalog %s', async (path) => {
      expect((await call(path)).status).toBe(200);
    },
  );

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('denies %s catalog changes even with a stale admin token', async (method) => {
    for (const path of ['/api/materials/trays', '/api/materials/trays/' + itemId,
      '/api/materials/trays/' + itemId + '/standard-materials', '/api/materials/trays/import',
      '/api/materials/cable-types', '/api/materials/cable-types/import',
      '/api/templates', '/api/templates/' + itemId, '/api/templates/' + itemId + '/versions/' + itemId]) {
      expect((await call(path, 'stale-admin', method, {})).status).toBe(403);
    }
    expect(database.query.mock.calls.some(([sql]) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql))).toBe(false);
  });

  it('denies the admin panel API, role changes, assignments and project creation', async () => {
    for (const [path, method] of [['/api/admin/users', 'GET'], ['/api/admin/users/' + basicId + '/role', 'PUT'],
      ['/api/admin/users/' + basicId + '/projects', 'PUT'], ['/api/admin/users/' + basicId + '/promote', 'POST'],
      ['/api/projects', 'POST']]) {
      expect((await call(path, 'basic', method, method === 'GET' ? undefined : {})).status).toBe(403);
    }
  });

  it.each(['/cables', '/cable-types', '/trays', '/roxtec', '/tray-data', '/files',
    '/cables/report-summary', '/change-orders', '/internal-ncrs'])(
    'reads %s in other projects', async (suffix) => {
      expect((await call('/api/projects/' + otherId + suffix)).status).toBe(200);
    },
  );

  it.each([['/cables/export', 'GET'], ['/cables/export?view=report', 'GET'],
    ['/cables/export?view=change-tracker', 'GET'], ['/cable-types/export', 'GET'], ['/trays/export', 'POST']])(
    'exports %s from other projects without writes', async (suffix, method) => {
      const response = await call('/api/projects/' + otherId + suffix, 'basic', method, method === 'POST' ? {} : undefined);
      expect(response.status).toBe(200);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await response.arrayBuffer());
      expect(workbook.worksheets.length).toBeGreaterThan(0);
      expect(database.query.mock.calls.some(([sql]) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql))).toBe(false);
    },
  );

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('denies %s changes in other projects', async (method) => {
    for (const suffix of ['', '/clear-data', '/cables', '/cables/' + itemId, '/cables/import',
      '/cables/' + itemId + '/materials', '/cable-types', '/cable-types/import', '/trays', '/trays/import',
      '/roxtec', '/roxtec/1', '/files', '/files/' + itemId, '/files/' + itemId + '/versions/' + itemId,
      '/change-orders', '/change-orders/' + itemId + '/materials', '/internal-ncrs']) {
      expect((await call('/api/projects/' + otherId + suffix, 'stale-admin', method, {})).status).toBe(403);
    }
    expect(database.query.mock.calls.some(([sql]) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql))).toBe(false);
  });

  it.each([['', 'PATCH'], ['/clear-data', 'POST'], ['/cables', 'POST'], ['/cable-types', 'POST'],
    ['/trays', 'POST'], ['/roxtec', 'POST'], ['/change-orders', 'POST'], ['/internal-ncrs', 'POST']])(
    'allows editing assigned projects through nested middleware: %s %s', async (suffix, method) => {
      // An empty payload reaches the route validation only if every permission gate passes.
      expect((await call('/api/projects/' + allowedId + suffix, 'basic', method, {})).status).toBe(400);
    },
  );

  it('cannot update a foreign cable by placing its ID under an assigned project URL', async () => {
    const baseQuery = database.query.getMockImplementation()!;
    database.query.mockImplementation(async (sql: string, values: unknown[]) => {
      if (sql.includes('FROM cables c')) {
        expect(sql).toContain('c.project_id = $1');
        expect(sql).toContain('c.id = $2');
        expect(values).toEqual([allowedId, itemId]);
        return { rows: [] };
      }
      return baseQuery(sql, values);
    });
    expect((await call('/api/projects/' + allowedId + '/cables/' + itemId, 'basic', 'PATCH', { tag: 'Foreign' })).status).toBe(404);
    expect(database.query.mock.calls.some(([sql]) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql))).toBe(false);
  });

  it('saves assigned project metadata, immediately blocks revoked edits, and retains read/export access', async () => {
    const baseQuery = database.query.getMockImplementation()!;
    database.query.mockImplementation(async (sql: string, values: unknown[]) => {
      if (sql.includes('UPDATE projects')) {
        expect(values).toContain(allowedId);
        expect(sql).toContain('WHERE id =');
        return { rows: [{ id: allowedId }], rowCount: 1 };
      }
      return baseQuery(sql, values);
    });
    const path = '/api/projects/' + allowedId;
    const response = await call(path, 'basic', 'PATCH', { name: 'Updated' });
    expect(response.status).toBe(200);
    expect((await response.json()).project.canEdit).toBe(true);
    expect(database.query.mock.calls.some(([sql]) => sql.includes('UPDATE projects'))).toBe(true);
    grants.clear();
    expect((await call(path, 'basic', 'PATCH', { name: 'Forbidden' })).status).toBe(403);
    expect((await (await call(path)).json()).project.canEdit).toBe(false);
    expect((await call(path + '/cables/export')).status).toBe(200);
  });

  it('assigns Engineer through the admin endpoint and revokes broad reads on downgrade', async () => {
    basicRole = 'basic';
    const path = '/api/admin/users/' + basicId + '/role';
    const response = await call(path, 'admin', 'PUT', { role: 'engineer' });
    expect(response.status).toBe(200);
    expect((await response.json()).user).toMatchObject({ role: 'engineer', isAdmin: false });
    expect((await call('/api/projects/' + otherId)).status).toBe(200);
    expect((await call('/api/materials/trays')).status).toBe(200);
    await call(path, 'admin', 'PUT', { role: 'basic' });
    expect((await call('/api/projects/' + otherId)).status).toBe(403);
    expect((await call('/api/materials/trays')).status).toBe(403);
  });
});
