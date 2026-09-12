// @vitest-environment node
import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({ connect: vi.fn(), query: vi.fn() }));
vi.mock('../db.js', () => ({ pool: database }));
vi.mock('../services/objectStorageService.js', () => ({}));
import { projectsRouter } from './projectsRoutes.js';

const id = '00000000-0000-4000-8000-000000000001';
type Handler = (request: Request, response: Response) => Promise<void>;
type Layer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: Handler }[] } };
const handler = (method: string, path: string) => {
  const found = (projectsRouter as unknown as { stack: Layer[] }).stack
    .find((layer) => layer.route?.methods[method] && layer.route.path === path)?.route?.stack.at(-1)?.handle;
  if (!found) throw new Error('Route not found');
  return found;
};
const responseStub = () => {
  const response = { status: vi.fn(), json: vi.fn() };
  response.status.mockReturnValue(response);
  return response;
};
const request = (body: unknown, method = 'POST') => ({
  params: { projectId: id }, userId: id, method, body,
  header: (name: string) => name === 'If-Match' ? '"0"' : 'clear-operation',
}) as unknown as Request;
const client = { query: vi.fn(), release: vi.fn() };

beforeEach(() => {
  vi.resetAllMocks();
  database.connect.mockResolvedValue(client);
  client.query.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM mutation_receipts')) return { rows: [], rowCount: 0 };
    if (sql.startsWith('SELECT revision')) return { rows: [{ revision: 0 }], rowCount: 1 };
    return { rows: [{ id }], rowCount: 1 };
  });
});

describe('explicit project clearing', () => {
  it('rejects clearing in-use cable types alone and rolls back the entire operation', async () => {
    const response = responseStub();
    await handler('post', '/:projectId/clear-data')(request({ cableTypes: true }), response as unknown as Response);
    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'CABLE_TYPE_IN_USE' }));
    const statements = client.query.mock.calls.map(([sql]) => String(sql));
    expect(statements).not.toContain('DELETE FROM cables WHERE project_id = $1');
    expect(statements).not.toContain('DELETE FROM cable_types WHERE project_id = $1');
    expect(statements.at(-1)).toBe('ROLLBACK');
  });

  it('clears explicitly selected cables before their types in the same receipt transaction', async () => {
    const response = responseStub();
    await handler('post', '/:projectId/clear-data')(request({ cableTypes: true, cables: true }), response as unknown as Response);
    const statements = client.query.mock.calls.map(([sql]) => String(sql));
    expect(statements.indexOf('DELETE FROM cables WHERE project_id = $1')).toBeLessThan(statements.indexOf('DELETE FROM cable_types WHERE project_id = $1'));
    expect(statements.some((sql) => sql.includes('INSERT INTO mutation_receipts'))).toBe(true);
    expect(statements.at(-1)).toBe('COMMIT');
    expect(response.json).toHaveBeenCalledWith({ deleted: { cables: 1, cableTypes: 1, trays: 0 }, mutationRevision: 1 });
  });

  it('removes cables before whole-project deletion so the type restriction remains effective', async () => {
    const response = responseStub();
    await handler('delete', '/:projectId')(request(undefined, 'DELETE'), response as unknown as Response);
    const statements = client.query.mock.calls.map(([sql]) => String(sql));
    expect(statements.indexOf('DELETE FROM cables WHERE project_id = $1')).toBeLessThan(statements.indexOf('DELETE FROM projects WHERE id = $1 RETURNING id'));
    expect(statements.at(-1)).toBe('COMMIT');
    expect(response.json).toHaveBeenCalledWith({ deleted: true, mutationRevision: 1 });
  });
});
