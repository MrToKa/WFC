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
    expect(res.status).toHaveBeenCalledWith(204);
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
