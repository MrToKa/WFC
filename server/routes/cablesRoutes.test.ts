// @vitest-environment node
import type { Request, Response } from 'express';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock('../db.js', () => ({ pool: database }));
vi.mock('../services/projectService.js', () => ({
  ensureProjectExists: vi.fn().mockResolvedValue({ id: 'project' }),
}));
import { cablesRouter } from './cablesRoutes.js';
import { ensureProjectExists } from '../services/projectService.js';

type Handler = (req: Request, res: Response) => Promise<void>;
type Layer = {
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: Handler }[] };
};
const addMaterial = (cablesRouter as unknown as { stack: Layer[] }).stack
  .find((layer) => layer.route?.path === '/:cableId/materials' && layer.route.methods.post)!
  .route!.stack.at(-1)!.handle;

const client = { query: vi.fn(), release: vi.fn() };

it('returns the saved revision author after their account has been deleted', async () => {
  const listVersions = (cablesRouter as unknown as { stack: Layer[] }).stack
    .find((layer) => layer.route?.path === '/:cableId/versions' && layer.route.methods.get)!
    .route!.stack.at(-1)!.handle;
  const author = {
    id: 'deleted-user',
    firstName: 'Original',
    lastName: 'Author',
    email: 'author@example.com',
  };
  database.query.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM cable_versions v')) {
      expect(sql).toContain('v.changed_by_snapshot');
      return {
        rows: [
          {
            id: 'version',
            cable_id: 'cable',
            cable_number: 10,
            version_number: 2,
            revision: 'B',
            created_at: '2026-09-17T00:00:00.000Z',
            changed_by: null,
            changed_by_snapshot: author,
            changed_by_first_name: null,
            changed_by_last_name: null,
            changed_by_email: null,
          },
        ],
      };
    }
    return { rows: [{ id: 'cable' }] };
  });
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);

  await listVersions(
    { params: { projectId: 'project', cableId: 'cable' } } as unknown as Request,
    res as unknown as Response,
  );

  expect(res.status).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith({
    versions: [
      expect.objectContaining({
        revision: 'B',
        changedBy: author,
      }),
    ],
  });
});

let catalogUnit: 'pcs' | 'meters' | 'pack';
let existingMaterials: { name: string; source: 'manual' | 'default'; quantity: number }[];
let failHistory: boolean;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ensureProjectExists).mockResolvedValue({ id: 'project' } as Awaited<
    ReturnType<typeof ensureProjectExists>
  >);
  catalogUnit = 'pcs';
  existingMaterials = [];
  failHistory = false;
  database.connect.mockResolvedValue(client);
  client.query.mockImplementation(async (sql: string, values?: unknown[]) => {
    if (sql.includes('FROM users')) {
      expect(values).toEqual(['actor']);
      return { rows: [{ name: 'Editor' }] };
    }
    if (sql.includes('change_log = change_log ||') && failHistory)
      throw new Error('History unavailable');
    if (sql.includes('FROM cables c')) {
      expect(sql).toContain('FOR UPDATE OF c');
      return {
        rows: [{ id: 'cable', materials_initialized: true, materials_customized: true }],
      };
    }
    if (sql.includes('FROM cable_materials')) {
      expect(values).toEqual(['cable']);
      return { rows: existingMaterials };
    }
    if (sql.includes('FROM material_cable_installation_materials')) {
      expect(sql).toContain('order_measurement');
      return { rows: [{ type: 'Material', order_measurement: catalogUnit }] };
    }
    if (sql.includes('INSERT INTO cable_materials')) {
      return {
        rows: [
          {
            id: values![0],
            cable_id: values![1],
            name: values![2],
            quantity: values![3],
            unit: values![4],
            remarks: values![5],
            source: values![6],
            created_at: '2026-01-01',
            updated_at: '2026-01-01',
          },
        ],
      };
    }
    return { rows: [], rowCount: 1 };
  });
});
afterEach(() => vi.restoreAllMocks());

const createMaterial = async (body: Record<string, unknown>) => {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  await addMaterial(
    {
      params: { projectId: 'project', cableId: 'cable' },
      body,
      userId: 'actor',
    } as unknown as Request,
    res as unknown as Response,
  );
  expect(res.status).toHaveBeenCalledWith(201);
  expect(client.query).toHaveBeenCalledWith('COMMIT');
  return res;
};

it.each([
  ['meters', 'meters'],
  ['pcs', 'pcs'],
  ['pack', 'pcs'],
] as const)('inherits %s from the catalog as %s when adding a material', async (source, unit) => {
  catalogUnit = source;
  const res = await createMaterial({ name: 'Material' });
  expect(res.json).toHaveBeenCalledWith({
    changeLogEntry: expect.objectContaining({ userId: 'actor', userName: 'Editor' }),
    cableMaterial: expect.objectContaining({ name: 'Material', quantity: 1, unit }),
  });
});

it.each([
  { quantity: 2, unit: 'pcs/m' },
  { quantity: null, unit: null },
])('preserves explicitly supplied quantity and unit: %j', async (values) => {
  catalogUnit = 'meters';
  const res = await createMaterial({ name: 'Material', ...values });
  expect(res.json).toHaveBeenCalledWith({
    changeLogEntry: expect.objectContaining({ userId: 'actor', userName: 'Editor' }),
    cableMaterial: expect.objectContaining(values),
  });
});

it.each(['manual', 'default'] as const)(
  'rejects a duplicate of a %s material even with a different quantity',
  async (source) => {
    existingMaterials = [{ name: '  MATERIAL  ', source, quantity: 3 }];
    const res = { status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    await addMaterial(
      {
        params: { projectId: 'project', cableId: 'cable' },
        body: { name: 'Material', quantity: 7, unit: 'pcs' },
      } as unknown as Request,
      res as unknown as Response,
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: 'This material is already added to this cable.',
    });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(
      client.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO cable_materials')),
    ).toBe(false);
    expect(client.query).not.toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalled();
  },
);

it('allows a different material on the same cable', async () => {
  existingMaterials = [{ name: 'Other material', source: 'manual', quantity: 2 }];
  await createMaterial({ name: 'Material' });
});

it('commits the material and its authenticated history in the same transaction', async () => {
  const res = await createMaterial({ name: 'Material' });
  const entry = res.json.mock.calls[0][0].changeLogEntry;
  expect(entry.changes).toEqual([expect.stringContaining('Added material "Material"')]);
  const statements = client.query.mock.calls.map(([sql]) => sql);
  const historyIndex = statements.findIndex((sql) => sql.includes('change_log = change_log ||'));
  expect(historyIndex).toBeGreaterThan(
    statements.findIndex((sql) => sql.includes('INSERT INTO cable_materials')),
  );
  expect(historyIndex).toBeLessThan(statements.indexOf('COMMIT'));
  expect(client.query.mock.calls[historyIndex][1]).toEqual(['cable', JSON.stringify([entry])]);
});

it('rolls back the addition if its history cannot be saved', async () => {
  failHistory = true;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  await addMaterial(
    {
      params: { projectId: 'project', cableId: 'cable' },
      body: { name: 'Material' },
      userId: 'actor',
    } as unknown as Request,
    res as unknown as Response,
  );
  expect(res.status).toHaveBeenCalledWith(500);
  expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  expect(client.query).not.toHaveBeenCalledWith('COMMIT');
});
