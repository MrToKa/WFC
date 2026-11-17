// @vitest-environment node
import express from 'express';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cadAnchorTranslationRouter, cadAnchorTranslationSchema, translateCadAnchor } from './anchorTranslation.js';

const mocks = vi.hoisted(() => ({ connect: vi.fn(), query: vi.fn(), release: vi.fn(), network: vi.fn() }));
vi.mock('../db.js', () => ({ pool: { connect: mocks.connect } }));
vi.mock('./routePublication.js', () => ({ networkOptions: mocks.network }));
vi.mock('../middleware.js', () => ({ requireProjectEdit: (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.header('x-test-edit') === 'yes') next(); else res.status(403).json({ code: 'EDIT_REQUIRED' });
} }));
const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const projectId = id(1), designId = id(2), groupId = id(3);
const first = { id: id(10), revision: 2, x_mm: 100, y_mm: 200, z_mm: 300, qx: 0, qy: 0, qz: Math.SQRT1_2, qw: Math.SQRT1_2, cut_length_mm: 1300 };
const second = { ...first, id: id(11), revision: 4, x_mm: 1100 };
const connection = { id: id(30), source_instance_id: first.id, target_instance_id: second.id,
  source_catalog_item_id: id(31), source_port_id: id(32), target_catalog_item_id: id(33), target_port_id: id(34), created_at: '2026-11-17T00:00:00Z' };
const body = { anchor: { instanceId: first.id, localPointMm: { x: 10, y: 0, z: 0 } }, targetPointMm: { x: 1000, y: 2000, z: 3000 },
  instances: [{ id: first.id, expectedRevision: 2 }, { id: second.id, expectedRevision: 4 }], route: { id: groupId, expectedRevision: 6 } };
let state: { instances: typeof first[]; links: typeof connection[]; transitions: { id: string; source_instance_id: string; target_instance_id: string }[]; groups: { id: string; revision: number; status: string }[] };
let active: boolean, failUpdate: boolean, failRestore: boolean;
let server: Server | undefined;
let base: string;
beforeEach(async () => {
  vi.resetAllMocks(); active = true; failUpdate = false; failRestore = false;
  state = { instances: structuredClone([first, second]), links: [structuredClone(connection)], transitions: [], groups: [{ id: groupId, revision: 6, status: 'draft' }] };
  let snapshot = structuredClone(state);
  mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release });
  mocks.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
    if (sql === 'BEGIN') snapshot = structuredClone(state);
    if (sql === 'ROLLBACK') state = structuredClone(snapshot);
    if (sql.startsWith('SELECT d.id')) return { rows: active && values[0] === projectId && values[1] === designId ? [{ id: designId }] : [] };
    if (sql.startsWith('SELECT model_version_id')) return { rows: [{ model_version_id: id(99) }] };
    if (sql.startsWith('SELECT id,revision,x_mm')) return { rows: structuredClone(state.instances.filter(row => (values[2] as string[]).includes(row.id))) };
    if (sql.startsWith('SELECT g.id,g.revision')) return { rows: structuredClone(state.groups) };
    if (sql.startsWith('SELECT instance_id FROM')) return { rows: state.instances.map(row => ({ instance_id: row.id })) };
    if (sql.startsWith('SELECT * FROM cad_design_connections')) return { rows: structuredClone(state.links) };
    if (sql.startsWith('SELECT id,source_instance_id')) return { rows: structuredClone(state.transitions) };
    if (sql.startsWith('DELETE FROM cad_design_connections')) { const removed = state.links; state.links = []; return { rows: removed }; }
    if (sql.startsWith('UPDATE cad_design_instances')) {
      if (state.links.length) throw new Error('Physical connection movement guard');
      const row = state.instances.find(row => row.id === values[2] && row.revision === values[3]);
      if (!row || (failUpdate && row.id === second.id)) return { rows: [] };
      row.x_mm = values[4] as number; row.y_mm = values[5] as number; row.z_mm = values[6] as number; row.revision++;
      return { rows: [{ id: row.id, revision: row.revision }] };
    }
    if (sql.startsWith('INSERT INTO cad_design_connections')) {
      if (failRestore) throw new Error('Restoration failed');
      state.links.push({ id: values[0] as string, source_instance_id: values[3] as string, source_catalog_item_id: values[4] as string,
        source_port_id: values[5] as string, target_instance_id: values[6] as string, target_catalog_item_id: values[7] as string,
        target_port_id: values[8] as string, created_at: values[9] as string });
    }
    if (sql.startsWith('UPDATE cad_route_groups')) {
      const row = state.groups.find(row => row.id === values[2] && row.revision === values[3]);
      if (!row) return { rows: [] }; row.revision++; return { rows: [{ id: row.id }] };
    }
    return { rows: [] };
  });
  const app = express(); app.use(express.json());
  app.use('/projects/:projectId/cad', cadAnchorTranslationRouter);
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(500).json({ code: 'TEST_FAILURE' }));
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server!.once('listening', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test address');
  base = `http://127.0.0.1:${address.port}/projects/${projectId}/cad/designs/${designId}`;
});
afterEach(async () => {
  if (server) { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve())); server = undefined; }
});
const move = (payload: unknown = body, edit = 'yes') => fetch(`${base}/translate-selection`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-edit': edit }, body: JSON.stringify(payload) });

describe('manual anchor translation', () => {
  it('moves a rotated local anchor to world coordinates without manufacturer metadata or rotation changes', () => {
    const before = structuredClone([first, second]);
    const moved = translateCadAnchor(before, body.anchor, body.targetPointMm);
    expect(moved[0].positionMm).toEqual({ x: 1000, y: 1990, z: 3000 });
    expect(moved[1].positionMm).toEqual({ x: 2000, y: 1990, z: 3000 });
    expect(before).toEqual([first, second]);
  });
  it('atomically moves all selected members and retains physical and logical link identities', async () => {
    state.transitions = [{ id: id(40), source_instance_id: first.id, target_instance_id: second.id }];
    const transitions = structuredClone(state.transitions);
    const response = await move(); expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ instances: [
      { id: first.id, revision: 3, positionMm: { x: 1000, y: 1990, z: 3000 } },
      { id: second.id, revision: 5, positionMm: { x: 2000, y: 1990, z: 3000 } },
    ], route: { id: groupId, revision: 7 } });
    expect(state.links).toEqual([connection]); expect(state.transitions).toEqual(transitions);
    expect(state.instances.map(row => [row.qx, row.qy, row.qz, row.qw, row.cut_length_mm])).toEqual([first, second].map(row => [row.qx, row.qy, row.qz, row.qw, row.cut_length_mm]));
    expect(mocks.query).toHaveBeenCalledWith('COMMIT');
  });
  it.each(['instance', 'route', 'published', 'inactive', 'missing', 'membership', 'physical', 'logical'])("refuses %s conflict before mutation", async reason => {
    const payload = structuredClone(body);
    if (reason === 'instance') payload.instances[0].expectedRevision++;
    if (reason === 'route') payload.route.expectedRevision++;
    if (reason === 'published') state.groups[0].status = 'published';
    if (reason === 'inactive') active = false;
    if (reason === 'missing') state.instances.pop();
    if (reason === 'membership') payload.instances.pop();
    if (reason === 'physical') state.links[0].target_instance_id = id(90);
    if (reason === 'logical') state.transitions.push({ id: id(40), source_instance_id: first.id, target_instance_id: id(90) });
    const before = structuredClone(state); expect((await move(payload)).status).toBe(409); expect(state).toEqual(before);
    expect(mocks.query.mock.calls.some(call => (call[0] as string).startsWith('UPDATE cad_design_instances'))).toBe(false);
  });
  it.each(['update', 'restore'])('rolls back every move and connection when %s fails', async reason => {
    failUpdate = reason === 'update'; failRestore = reason === 'restore'; const before = structuredClone(state);
    expect((await move()).status).toBe(reason === 'update' ? 409 : 500); expect(state).toEqual(before);
    expect(mocks.query).toHaveBeenCalledWith('ROLLBACK');
  });
  it('checks resulting member bounds before removing any connections', async () => {
    state.instances[1].x_mm = 1e9;
    expect((await move()).status).toBe(422);
    expect(state.links).toEqual([connection]);
    expect(mocks.query.mock.calls.some(call => (call[0] as string).startsWith('DELETE FROM'))).toBe(false);
  });
  it('supports an ungrouped unknown geometry section and preserves its orientation', async () => {
    state.instances = [structuredClone(first)]; state.groups = []; state.links = [];
    const { route: _route, ...payload } = body; payload.instances = [body.instances[0]];
    expect((await move(payload)).status).toBe(200); expect(state.instances[0].qz).toBe(first.qz);
  });
  it('rejects duplicates, unselected anchors, extra fields and nonfinite coordinates', async () => {
    expect(cadAnchorTranslationSchema.safeParse({ ...body, instances: [body.instances[0], body.instances[0]] }).success).toBe(false);
    expect(cadAnchorTranslationSchema.safeParse({ ...body, anchor: { ...body.anchor, instanceId: id(90) } }).success).toBe(false);
    expect(cadAnchorTranslationSchema.safeParse({ ...body, targetPointMm: { x: Infinity, y: 0, z: 0 } }).success).toBe(false);
    expect((await move({ ...body, rotation: {} })).status).toBe(400);
    expect(mocks.connect).not.toHaveBeenCalled();
  });
  it('requires project edit access', async () => {
    expect((await move(body, 'no')).status).toBe(403); expect(mocks.connect).not.toHaveBeenCalled();
    expect((await fetch(`${base}/placement-targets`)).status).toBe(403);
  });
  it('exposes prepared endpoint coordinates with exact object identity in world millimetres', async () => {
    mocks.network.mockResolvedValue({ options: [{ objectId: '77', objectRevisionId: id(80), portIndex: 1, pointMetres: [1.2, 3.4, 5.6], routeCode: '/BC001' }] });
    const response = await fetch(`${base}/placement-targets`, { headers: { 'x-test-edit': 'yes' } });
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toEqual({ targets: [{ objectId: '77', objectRevisionId: id(80), portIndex: 1, pointMm: { x: 1200, y: 3400, z: 5600 }, label: '/BC001 · object 77 · end 2' }] });
    expect(mocks.query.mock.calls.some(call => /^(UPDATE|DELETE|INSERT)/.test(call[0] as string))).toBe(false);
  });
});
