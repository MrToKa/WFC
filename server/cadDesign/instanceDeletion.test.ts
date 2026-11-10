// @vitest-environment node
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
const client = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }));
vi.mock('../db.js', () => ({ pool: db }));
vi.mock('../config.js', () => ({ config: { jwtSecret: 'test-only', bcryptRounds: 4 } }));
vi.mock('../services/objectStorageService.js', () => ({ getObjectStream: vi.fn(), getProjectBucket: vi.fn() }));
import { cadDesignRouter } from './routes.js';

const projectId = '00000000-0000-4000-8000-000000000001';
const designId = '00000000-0000-4000-8000-000000000002';
const instanceId = '00000000-0000-4000-8000-000000000003';
let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.canEditProject = req.header('x-test-editor') === 'true'; next(); });
  app.use('/api/projects/:projectId/cad-design', cadDesignRouter);
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ code: 'TEST_FAILURE' });
  });
  await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

const defaultQuery = async (sql: string) => {
  if (sql.includes('SELECT d.id FROM cad_designs')) return { rows: [{ id: designId }] };
  if (sql.startsWith('SELECT id,revision FROM cad_design_instances')) return { rows: [{ id: instanceId, revision: 4 }] };
  if (sql.startsWith('DELETE FROM cad_design_instances')) return { rows: [{ id: instanceId }] };
  return { rows: [] };
};
beforeEach(() => {
  vi.clearAllMocks();
  db.connect.mockResolvedValue(client);
  client.query.mockImplementation(defaultQuery);
});
const remove = (body: unknown = { expectedRevision: 4 }, options: { editor?: boolean; project?: string; design?: string; instance?: string } = {}) =>
  fetch(`${base}/api/projects/${options.project ?? projectId}/cad-design/designs/${options.design ?? designId}/instances/${options.instance ?? instanceId}`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json', 'x-test-editor': String(options.editor ?? true) }, body: JSON.stringify(body),
  });
const deletions = () => client.query.mock.calls.filter(([sql]) => String(sql).startsWith('DELETE'));

describe('proposed CAD instance deletion', () => {
  it('requires project editing permission before opening a transaction', async () => {
    expect((await remove(undefined, { editor: false })).status).toBe(403);
    expect(db.connect).not.toHaveBeenCalled();
  });
  it.each([{ project: 'invalid' }, { design: 'invalid' }, { instance: 'invalid' }])('rejects invalid scoped UUIDs: %j', async options => {
    expect((await remove(undefined, options)).status).toBe(400);
    expect(db.connect).not.toHaveBeenCalled();
  });
  it.each([{}, { expectedRevision: 0 }, { expectedRevision: 1.5 }, { expectedRevision: 4, catalogItemId: instanceId }])(
    'rejects missing, invalid or substituted revision metadata: %j', async body => {
      expect((await remove(body)).status).toBe(400);
      expect(db.connect).not.toHaveBeenCalled();
    },
  );
  it('deletes only the selected project/design/instance revision and commits its cascades atomically', async () => {
    expect((await remove()).status).toBe(204);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("d.status='proposed'"), [projectId, designId]);
    const lock = String(client.query.mock.calls[1][0]);
    expect(lock).toContain('s.active_model_version_id=d.model_version_id');
    expect(lock).toContain("v.state='ready' AND v.health='healthy'");
    expect(lock).toContain('FOR UPDATE OF d FOR SHARE OF s,v');
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('SELECT id,revision FROM cad_design_instances'), [projectId, designId, instanceId]);
    expect(deletions()).toEqual([[
      'DELETE FROM cad_design_instances WHERE project_id=$1 AND design_id=$2 AND id=$3 AND revision=$4 RETURNING id',
      [projectId, designId, instanceId, 4],
    ]]);
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
    expect(db.query).not.toHaveBeenCalled();
  });
  it('refuses archived/approved/inactive/unhealthy designs without deleting anything', async () => {
    client.query.mockImplementation(async sql => sql.includes('SELECT d.id FROM cad_designs') ? { rows: [] } : defaultQuery(sql));
    const response = await remove();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: 'INACTIVE_DESIGN' });
    expect(deletions()).toEqual([]);
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
  });
  it('returns 404 for a missing instance in this exact project/design, without probing another scope', async () => {
    client.query.mockImplementation(async sql => sql.startsWith('SELECT id,revision') ? { rows: [] } : defaultQuery(sql));
    const response = await remove();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: 'INSTANCE_NOT_FOUND' });
    expect(deletions()).toEqual([]);
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
  });
  it('refuses a stale instance revision and preserves the current position and connections', async () => {
    const response = await remove({ expectedRevision: 3 });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: 'STALE_INSTANCE' });
    expect(deletions()).toEqual([]);
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
  });
  it.each(['40P01', '40001'])('rolls back concurrent edit conflict %s and returns a retryable response', async code => {
    client.query.mockImplementation(async sql => {
      if (sql.startsWith('DELETE FROM cad_design_instances')) throw Object.assign(new Error('database conflict'), { code });
      return defaultQuery(sql);
    });
    const response = await remove();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: 'CAD_DESIGN_CONFLICT' });
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
  });
  it('rolls back an unexpected storage/database failure without reporting deletion success', async () => {
    client.query.mockImplementation(async sql => {
      if (sql.startsWith('DELETE FROM cad_design_instances')) throw new Error('database unavailable');
      return defaultQuery(sql);
    });
    expect((await remove()).status).toBe(500);
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
  });
});
