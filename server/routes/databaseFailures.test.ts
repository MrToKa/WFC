// @vitest-environment node

import type { Request, Response, Router } from 'express';
import * as XLSX from 'xlsx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(),
  ensureProjectExists: vi.fn(),
}));
vi.mock('../db.js', () => ({ pool: { query: mocks.query, connect: mocks.connect } }));
vi.mock('../services/projectService.js', () => ({
  ensureProjectExists: mocks.ensureProjectExists,
}));
vi.mock('../services/objectStorageService.js', () => ({}));

import { cablesRouter } from './cablesRoutes.js';
import { cableTypesRouter } from './cableTypesRoutes.js';
import { materialsRouter } from './materialsRoutes.js';
import { projectsRouter } from './projectsRoutes.js';
import { roxtecEntriesRouter } from './roxtecEntriesRoutes.js';
import { traysRouter } from './traysRoutes.js';

type Handler = (req: Request, res: Response) => Promise<void>;
type Layer = {
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: Handler }[] };
};
const handlerFor = (router: Router, method: string, path: string): Handler => {
  const layers = (router as unknown as { stack: Layer[] }).stack;
  const handler = layers
    .find((layer) => layer.route?.path === path && layer.route.methods[method])
    ?.route?.stack.at(-1)?.handle;
  if (!handler) throw new Error(`Missing ${method} ${path}`);
  return handler;
};

const responseStub = () => {
  const response = { status: vi.fn(), json: vi.fn() };
  response.status.mockReturnValue(response);
  return response as unknown as Response;
};
const id = '00000000-0000-4000-8000-000000000001';
const workbookFile = (row: Record<string, string | number>) => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([row]), 'Import');
  return {
    buffer: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
    originalname: 'import.xlsx',
  };
};
const request = (body: unknown, row?: Record<string, string | number>): Request =>
  ({
    userId: id,
    params: { projectId: id, cableTypeId: id, loadCurveId: id, roxtecId: '1' },
    body,
    ...(row ? { file: workbookFile(row) } : {}),
  }) as unknown as Request;

const mutationCases = [
  {
    name: 'clear project data',
    router: projectsRouter,
    method: 'post',
    path: '/:projectId/clear-data',
    request: () => request({ cables: true }),
  },
  {
    name: 'create cable type',
    router: cableTypesRouter,
    method: 'post',
    path: '/',
    request: () => request({ name: 'Cable type' }),
  },
  {
    name: 'update cable type',
    router: cableTypesRouter,
    method: 'patch',
    path: '/:cableTypeId',
    request: () => request({ name: 'Cable type' }),
  },
  {
    name: 'import cable types',
    router: cableTypesRouter,
    method: 'post',
    path: '/import',
    request: () => request({}, { Type: 'Cable type' }),
  },
  {
    name: 'import cable type materials',
    router: cableTypesRouter,
    method: 'post',
    path: '/:cableTypeId/default-materials/import',
    request: () => request({}, { Material: 'Connector', Quantity: 2, Unit: 'pcs' }),
  },
  {
    name: 'import cables',
    router: cablesRouter,
    method: 'post',
    path: '/import',
    request: () =>
      request(
        {},
        {
          'Cable Id': 1,
          Type: 'Cable type',
          Tag: 'C1',
          'From Location': 'A',
          'To Location': 'B',
          'Design Length [m]': 10,
        },
      ),
  },
  {
    name: 'import trays',
    router: traysRouter,
    method: 'post',
    path: '/import',
    request: () => request({}, { Name: 'Tray 1' }),
  },
  {
    name: 'create load curve',
    router: materialsRouter,
    method: 'post',
    path: '/load-curves',
    request: () => request({ name: 'Load curve' }),
  },
  {
    name: 'update load curve',
    router: materialsRouter,
    method: 'patch',
    path: '/load-curves/:loadCurveId',
    request: () => request({ name: 'Load curve' }),
  },
  {
    name: 'create Roxtec entry',
    router: roxtecEntriesRouter,
    method: 'post',
    path: '/',
    request: () => request({ revision: 'A', tag: 'R1', type: 'Roxtec' }),
  },
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.ensureProjectExists.mockResolvedValue({ id });
  mocks.query.mockResolvedValue({
    rowCount: 1,
    rows: [{ id, name: 'Connector', type: 'Connector' }],
  });
});

afterEach(() => vi.restoreAllMocks());

describe('database connection failures', () => {
  it.each(mutationCases)(
    'returns JSON when $name cannot acquire a connection',
    async (testCase) => {
      mocks.connect.mockRejectedValue(new Error('Database unavailable'));
      const response = responseStub();

      await handlerFor(
        testCase.router,
        testCase.method,
        testCase.path,
      )(testCase.request(), response);

      expect(mocks.connect).toHaveBeenCalledOnce();
      expect(response.status).toHaveBeenCalledWith(500);
      expect(response.json).toHaveBeenCalledWith({ error: expect.any(String) });
    },
  );

  it.each(mutationCases)(
    'releases the connection when $name and its rollback both fail',
    async (testCase) => {
      const client = {
        query: vi.fn().mockRejectedValue(new Error('Connection closed')),
        release: vi.fn(),
      };
      mocks.connect.mockResolvedValue(client);
      const response = responseStub();

      await handlerFor(
        testCase.router,
        testCase.method,
        testCase.path,
      )(testCase.request(), response);

      expect(response.status).toHaveBeenCalledWith(500);
      expect(client.query).toHaveBeenCalledWith('BEGIN');
      expect(client.query).toHaveBeenCalledWith('ROLLBACK');
      expect(client.release).toHaveBeenCalledOnce();
    },
  );
});

describe('Roxtec project lookup failures', () => {
  it.each([
    { method: 'get', path: '/' },
    { method: 'get', path: '/:roxtecId' },
    { method: 'post', path: '/' },
    { method: 'patch', path: '/:roxtecId' },
    { method: 'delete', path: '/:roxtecId' },
  ])('returns JSON for $method $path', async ({ method, path }) => {
    mocks.ensureProjectExists.mockRejectedValue(new Error('Database unavailable'));
    const response = responseStub();

    await handlerFor(
      roxtecEntriesRouter,
      method,
      path,
    )(request({ revision: 'A', tag: 'R1', type: 'Roxtec' }), response);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({ error: expect.any(String) });
    expect(mocks.connect).not.toHaveBeenCalled();
  });
});
