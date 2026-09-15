// @vitest-environment node
import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock('../db.js', () => ({ pool: database }));
vi.mock('../services/projectService.js', () => ({
  ensureProjectExists: vi.fn().mockResolvedValue({ id: 'project' }),
}));
import { cableTypesRouter } from './cableTypesRoutes.js';
import { ensureProjectExists } from '../services/projectService.js';

type Handler = (req: Request, res: Response) => Promise<void>;
type Layer = {
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: Handler }[] };
};
const deleteMaterial = (cableTypesRouter as unknown as { stack: Layer[] }).stack
  .find(
    (layer) =>
      layer.route?.path === '/:cableTypeId/default-materials/:defaultMaterialId' &&
      layer.route.methods.delete,
  )!
  .route!.stack.at(-1)!.handle;

const client = { query: vi.fn(), release: vi.fn() };
const request = {
  params: { projectId: 'project', cableTypeId: 'type', defaultMaterialId: 'material' },
  userId: 'actor',
} as unknown as Request;
const response = () => {
  const res = { status: vi.fn(), json: vi.fn(), send: vi.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as Response;
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(ensureProjectExists).mockResolvedValue({ id: 'project' } as Awaited<
    ReturnType<typeof ensureProjectExists>
  >);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  database.connect.mockResolvedValue(client);
  let deleted = false;
  client.query.mockImplementation(async (sql: string) => {
    if (sql.includes('SELECT * FROM cable_types')) return { rows: [{ id: 'type', name: 'Cable' }] };
    if (sql.includes('SELECT * FROM cable_type_default_materials'))
      return { rows: deleted ? [] : [{ name: 'Cleat', quantity: 2, unit: 'pcs' }] };
    if (sql.includes('DELETE FROM cable_type_default_materials')) deleted = true;
    if (sql.includes('FROM users')) return { rows: [{ name: 'Editor' }] };
    return { rows: [], rowCount: 1 };
  });
});
afterEach(() => vi.restoreAllMocks());

describe('cable type material history transactions', () => {
  it('commits the deletion and its authenticated history together', async () => {
    const res = response();
    await deleteMaterial(request, res);
    expect(res.json).toHaveBeenCalledWith({
      changeLogEntry: expect.objectContaining({
        changes: [expect.stringContaining('Removed default material "Cleat"')],
      }),
    });
    const calls = client.query.mock.calls;
    expect(calls[0][0]).toBe('BEGIN');
    expect(calls[1][0]).toContain('FOR UPDATE');
    const log = calls.find(([sql]) => String(sql).includes('change_log = change_log ||'));
    expect(JSON.parse(log![1][1])[0]).toMatchObject({
      userId: 'actor',
      userName: 'Editor',
      changes: [expect.stringContaining('Removed default material "Cleat"')],
    });
    expect(calls.at(-1)![0]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });
  it('rolls back the deletion when writing history fails', async () => {
    const query = client.query.getMockImplementation()!;
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('change_log = change_log ||')) throw new Error('History write failed');
      return query(sql);
    });
    const res = response();
    await deleteMaterial(request, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(client.query).not.toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });
  it('rolls back without history when the cable type belongs to another project', async () => {
    client.query.mockResolvedValue({ rows: [], rowCount: 0 });
    const res = response();
    await deleteMaterial(request, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('project_id = $1 AND id = $2'),
      ['project', 'type'],
    );
    expect(client.query.mock.calls.some(([sql]) => /DELETE|UPDATE cable_types/.test(sql))).toBe(
      false,
    );
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
  });
});

const addMaterial = (cableTypesRouter as unknown as { stack: Layer[] }).stack
  .find(
    (layer) => layer.route?.path === '/:cableTypeId/default-materials' && layer.route.methods.post,
  )!
  .route!.stack.at(-1)!.handle;
const sourceMaterialId = '00000000-0000-4000-8000-000000000001';

describe('catalog-only cable type default materials', () => {
  it('has no Excel import endpoint', () => {
    expect(
      (cableTypesRouter as unknown as { stack: Layer[] }).stack.some(
        (layer) => layer.route?.path === '/:cableTypeId/default-materials/import',
      ),
    ).toBe(false);
  });
  it('rejects free-form material names', async () => {
    const res = response();
    await addMaterial({ ...request, body: { name: 'Invented material' } } as Request, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.connect).not.toHaveBeenCalled();
  });
  it('rejects a missing or deleted catalog ID without saving', async () => {
    const res = response();
    await addMaterial({ ...request, body: { sourceMaterialId } } as Request, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM material_cable_installation_materials WHERE id = $1'),
      [sourceMaterialId],
    );
    expect(client.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO'))).toBe(false);
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
  });
  it('uses the catalog name, unit and ID and saves history in the same transaction', async () => {
    const query = client.query.getMockImplementation()!;
    const material = {
      id: 'new',
      cable_type_id: 'type',
      name: 'Database cleat',
      quantity: 1,
      unit: 'meters',
      remarks: null,
      source_master_material_id: sourceMaterialId,
      source_kind: 'manual',
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    };
    let inserted = false;
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM material_cable_installation_materials'))
        return {
          rows: [{ id: sourceMaterialId, type: 'Database cleat', order_measurement: 'meters' }],
        };
      if (sql.includes('INSERT INTO cable_type_default_materials')) {
        inserted = true;
        return { rows: [material] };
      }
      if (sql.includes('SELECT * FROM cable_type_default_materials'))
        return { rows: inserted ? [material] : [] };
      return query(sql);
    });
    const res = response();
    await addMaterial({ ...request, body: { sourceMaterialId } } as Request, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      changeLogEntry: expect.objectContaining({ userId: 'actor' }),
      defaultMaterial: expect.objectContaining({
        name: 'Database cleat',
        quantity: 1,
        unit: 'meters',
        sourceMasterMaterialId: sourceMaterialId,
      }),
    });
    const insert = client.query.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO cable_type_default_materials'),
    )!;
    expect(insert[1].slice(1)).toEqual([
      'type',
      'Database cleat',
      1,
      'meters',
      null,
      sourceMaterialId,
    ]);
    expect(
      client.query.mock.calls.some(([sql]) => sql.includes('change_log = change_log ||')),
    ).toBe(true);
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
  });
});

it.each([1, 2])(
  'returns an in-place quantity edit and its history for quantity %s',
  async (quantity) => {
    const editMaterial = (cableTypesRouter as unknown as { stack: Layer[] }).stack
      .find(
        (layer) =>
          layer.route?.path === '/:cableTypeId/default-materials/:defaultMaterialId' &&
          layer.route.methods.patch,
      )!
      .route!.stack.at(-1)!.handle;
    let material = {
      id: 'material',
      cable_type_id: 'type',
      name: 'Cleat',
      quantity: 1,
      unit: 'pcs',
      remarks: null,
      source_kind: 'manual',
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    };
    const query = client.query.getMockImplementation()!;
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM cable_type_default_materials')) return { rows: [material] };
      if (sql.includes('UPDATE cable_type_default_materials')) {
        material = { ...material, quantity };
        return { rows: [material] };
      }
      return query(sql);
    });
    const res = response();
    await editMaterial({ ...request, body: { quantity } } as Request, res);
    expect(res.json).toHaveBeenCalledWith({
      defaultMaterial: expect.objectContaining({ id: 'material', quantity }),
      changeLogEntry:
        quantity === 1
          ? null
          : expect.objectContaining({
              userId: 'actor',
              changes: ['Default material "Cleat" / Quantity: 1 → 2'],
            }),
    });
    expect(client.query.mock.calls.some(([sql]) => /INSERT|DELETE/.test(sql))).toBe(false);
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
  },
);
