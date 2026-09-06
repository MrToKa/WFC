// @vitest-environment node

import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock('../db.js', () => ({ pool: database }));
vi.mock('../services/objectStorageService.js', () => ({}));

import { projectsRouter } from './projectsRoutes.js';

const projectId = '00000000-0000-4000-8000-000000000001';
const fileId = '00000000-0000-4000-8000-000000000002';
const projectRow = {
  id: projectId,
  project_number: 'P-001',
  name: 'Updated project',
  customer: 'Customer',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

type Handler = (req: Request, res: Response) => Promise<void>;
type Layer = {
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: Handler }[] };
};

const handlerFor = (method: string, path: string): Handler => {
  const layers = (projectsRouter as unknown as { stack: Layer[] }).stack;
  const route = layers.find(
    (layer) => layer.route?.path === path && layer.route.methods[method],
  )?.route;
  const handler = route?.stack.at(-1)?.handle;
  if (!handler) throw new Error(`Missing ${method} ${path}`);
  return handler;
};

const responseStub = () => {
  const response = { status: vi.fn(), json: vi.fn() };
  response.status.mockReturnValue(response);
  return response as unknown as Response;
};

const client = { query: vi.fn(), release: vi.fn() };
let statements: string[];

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  statements = [];
  database.connect.mockResolvedValue(client);
  client.query.mockImplementation(async (sqlValue: string) => {
    const sql = sqlValue.trim();
    statements.push(sql);
    if (/SELECT\s+id\s+FROM project_files/.test(sql)) {
      return { rowCount: 0, rows: [] };
    }
    return { rowCount: 1, rows: [projectRow] };
  });
});

afterEach(() => vi.restoreAllMocks());

describe('project mutations', () => {
  it('rolls back all project edits and support settings when a template belongs to another project', async () => {
    const response = responseStub();
    await handlerFor('patch', '/:projectId')(
      {
        params: { projectId },
        body: {
          name: 'Updated project',
          supportDistances: { Ladder: 2 },
          trayPurposeTemplates: { Power: { fileId } },
        },
      } as unknown as Request,
      response,
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      error: 'Tray report template must reference a file attached to this project.',
    });
    expect(statements[0]).toBe('BEGIN');
    expect(statements.some((sql) => sql.startsWith('UPDATE projects'))).toBe(true);
    expect(statements.some((sql) => sql.startsWith('INSERT INTO project_support_distances'))).toBe(
      true,
    );
    expect(statements.at(-1)).toBe('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
    expect(database.query).not.toHaveBeenCalled();
    expect(database.connect).toHaveBeenCalledOnce();
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('commits a project update and reads its response on the same connection', async () => {
    const response = responseStub();
    await handlerFor('patch', '/:projectId')(
      { params: { projectId }, body: { name: 'Updated project' } } as unknown as Request,
      response,
    );

    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith({
      project: expect.objectContaining({ id: projectId, name: 'Updated project' }),
    });
    expect(statements[0]).toBe('BEGIN');
    expect(statements.at(-2)).toContain('FROM projects p');
    expect(statements.at(-1)).toBe('COMMIT');
    expect(database.query).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rolls back a new project when its support settings cannot be saved', async () => {
    client.query.mockImplementation(async (sqlValue: string) => {
      const sql = sqlValue.trim();
      statements.push(sql);
      if (sql.startsWith('INSERT INTO project_support_distances')) {
        throw new Error('Invalid support reference');
      }
      return { rowCount: 1, rows: [projectRow] };
    });
    const response = responseStub();

    await handlerFor('post', '/')(
      {
        body: {
          projectNumber: 'P-001',
          name: 'New project',
          customer: 'Customer',
          supportDistances: { Ladder: 2 },
        },
      } as Request,
      response,
    );

    expect(response.status).toHaveBeenCalledWith(500);
    expect(statements.some((sql) => sql.startsWith('INSERT INTO projects'))).toBe(true);
    expect(statements.at(-1)).toBe('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
    expect(database.query).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('returns 404 without changing settings when the project is absent', async () => {
    client.query.mockResolvedValue({ rowCount: 0, rows: [] });
    const response = responseStub();
    await handlerFor('patch', '/:projectId')(
      { params: { projectId }, body: { supportDistances: {} } } as unknown as Request,
      response,
    );

    expect(response.status).toHaveBeenCalledWith(404);
    expect(client.query).not.toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM project_support_distances'),
      expect.anything(),
    );
    expect(client.release).toHaveBeenCalledOnce();
  });

  it.each([
    {
      method: 'post',
      path: '/',
      body: { projectNumber: 'P-001', name: 'Project', customer: 'Customer' },
    },
    { method: 'patch', path: '/:projectId', body: { name: 'Project' } },
  ])(
    'returns a JSON error if $method cannot acquire a connection',
    async ({ method, path, body }) => {
      database.connect.mockRejectedValue(new Error('Database unavailable'));
      const response = responseStub();
      await handlerFor(method, path)(
        { params: { projectId }, body } as unknown as Request,
        response,
      );
      expect(response.status).toHaveBeenCalledWith(500);
      expect(response.json).toHaveBeenCalledWith({ error: expect.any(String) });
    },
  );
});
