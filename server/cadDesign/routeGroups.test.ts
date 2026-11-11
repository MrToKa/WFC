// @vitest-environment node
import express from 'express';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cadRouteGroupInputSchema } from '../../shared/cadRouteGroups.js';
import { cadRouteGroupsRouter } from './routeGroupsRoutes.js';

const mocks = vi.hoisted(() => ({ connect: vi.fn(), query: vi.fn(), release: vi.fn() }));
vi.mock('../db.js', () => ({ pool: { connect: mocks.connect } }));
vi.mock('../middleware.js', () => ({ requireProjectEdit: (req: express.Request,res: express.Response,next: express.NextFunction) => {
  if (req.header('x-test-edit') === 'yes') next(); else res.status(403).json({ code: 'EDIT_REQUIRED' });
} }));
const projectId = '00000000-0000-4000-8000-000000000001';
const designId = '00000000-0000-4000-8000-000000000002';
const instanceId = '00000000-0000-4000-8000-000000000003';
const groupId = '00000000-0000-4000-8000-000000000004';
const body = { name: 'New route', tag: 'r-101', color: '#aabbcc', purpose: 'LV cable tray', instanceIds: [instanceId] };
const route = { id: groupId, ...body,tag: 'R-101',color: '#AABBCC',revision: 1,status: 'draft',projectTrayId: null };
let server: Server | undefined;
const start = async () => {
  const app = express();
  app.use(express.json());
  app.use('/projects/:projectId/cad',cadRouteGroupsRouter);
  app.use((_error: unknown,_req: express.Request,res: express.Response,_next: express.NextFunction) => { res.status(500).json({ code: 'TEST_FAILURE' }); });
  server = app.listen(0,'127.0.0.1');
  await new Promise<void>(resolve => server!.once('listening',resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test address');
  return `http://127.0.0.1:${address.port}/projects/${projectId}/cad/designs/${designId}/routes`;
};
const mutate = (base: string, method: string, payload: unknown, suffix = '') => fetch(base + suffix, {
  method,headers: { 'Content-Type': 'application/json','x-test-edit': 'yes' },body: JSON.stringify(payload),
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.connect.mockResolvedValue({ query: mocks.query,release: mocks.release });
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.startsWith('SELECT d.id')) return { rows: [{ id: designId }] };
    if (sql.startsWith('SELECT id FROM cad_design_instances')) return { rows: [{ id: instanceId }] };
    if (sql.startsWith('SELECT revision,status')) return { rows: [{ revision: 1,status: 'draft',project_tray_id: null }] };
    if (sql.startsWith('UPDATE cad_route_groups') || sql.startsWith('DELETE FROM cad_route_groups')) return { rows: [{ id: groupId }] };
    if (sql.startsWith('SELECT g.id')) return { rows: [route] };
    return { rows: [] };
  });
});
afterEach(async () => {
  if (server) { server.closeAllConnections(); await new Promise<void>((resolve,reject) => server!.close(error => error ? reject(error) : resolve())); server = undefined; }
});
const normalQuery = async (sql: string) => {
  if (sql.startsWith('SELECT d.id')) return { rows: [{ id: designId }] };
  return { rows: [] };
};
const configurePublished = (instanceIds = [instanceId]) => {
  let saved = { ...route,status: 'published',projectTrayId: projectId,instanceIds };
  const fallback = mocks.query.getMockImplementation()!;
  mocks.query.mockImplementation(async (sql: string,values?: unknown[]) => {
    if (sql.startsWith('SELECT revision,status')) return {rows:[{revision:saved.revision,status:'published',project_tray_id:projectId}]};
    if (sql.startsWith('SELECT g.id')) return {rows:[saved]};
    if (sql.startsWith('UPDATE cad_route_groups SET color=')) {
      saved = {...saved,color: values![4] as string,revision:saved.revision+1};
      return {rows:[{id:groupId}]};
    }
    return fallback(sql,values);
  });
};
describe('CAD route authoring contract', () => {
  it('normalizes tag and color while bounding distinct scoped members', () => {
    expect(cadRouteGroupInputSchema.parse(body)).toMatchObject({ tag: 'R-101',color: '#AABBCC' });
    for (const invalid of [
      { ...body,tag: '/R101' },{ ...body,tag: 'SECONDARY' },{ ...body,tag: 'With spaces' },
      { ...body,color: 'red' },{ ...body,purpose: '' },{ ...body,name: 'Bad\nname' },
      { ...body,instanceIds: [] },{ ...body,instanceIds: [instanceId,instanceId] },
      { ...body,instanceIds: Array.from({length:201},() => instanceId) },{ ...body,projectTrayId: projectId },
    ]) expect(cadRouteGroupInputSchema.safeParse(invalid).success).toBe(false);
  });
  it('allows scoped project readers to list while requiring edit authorization for writes', async () => {
    const base = await start();
    expect((await fetch(base)).status).toBe(200);
    expect((await fetch(base,{method: 'POST',headers: {'Content-Type':'application/json'},body: JSON.stringify(body)})).status).toBe(403);
    expect(mocks.connect).toHaveBeenCalledOnce();
  });
  it('validates project/design IDs before opening a transaction', async () => {
    const base = await start();
    const response = await mutate(base.replace(designId,'not-a-uuid'),'POST',body);
    expect(response.status).toBe(400);
    expect(mocks.connect).not.toHaveBeenCalled();
  });
  it('lists scoped groups without caching and locks the active healthy proposed design', async () => {
    const base = await start();
    const response = await fetch(base,{headers:{'x-test-edit':'yes'}});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({routes:[route]});
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.query.mock.calls[0][0]).toBe('BEGIN');
    const lock = mocks.query.mock.calls[1];
    expect(lock[0]).toContain('FOR UPDATE OF d FOR SHARE OF s,v');
    expect(lock[0]).toContain("d.status='proposed'");
    expect(lock[0]).toContain("v.health='healthy'");
    expect(lock[1]).toEqual([projectId,designId]);
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });
});
describe('CAD route membership and transaction fencing', () => {
  it('creates a normalized draft group and its members in one transaction', async () => {
    const base = await start();
    const response = await mutate(base,'POST',body);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({route});
    const insertion = mocks.query.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO cad_route_groups'));
    expect(insertion?.[1].slice(1,7)).toEqual([projectId,designId,'New route','R-101','#AABBCC','LV cable tray']);
    const member = mocks.query.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO cad_route_group_members'));
    expect(member?.[1].slice(0,2)).toEqual([projectId,designId]);
    expect(member?.[1][3]).toEqual([instanceId]);
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it('rejects foreign-project or foreign-design instances before writing any group', async () => {
    const base = await start();
    mocks.query.mockImplementation(normalQuery);
    const response = await mutate(base,'POST',body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({code:'CAD_ROUTE_MEMBERS_NOT_IN_DESIGN'});
    expect(mocks.query.mock.calls.find(([sql]) => sql.startsWith('INSERT'))).toBeUndefined();
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
  it('rejects an instance assigned to another group', async () => {
    const base = await start();
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT instance_id FROM')) return {rows:[{instance_id:instanceId}]};
      if (sql.startsWith('SELECT id FROM cad_design_instances')) return {rows:[{id:instanceId}]};
      return normalQuery(sql);
    });
    const response = await mutate(base,'POST',body);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({code:'CAD_INSTANCE_ALREADY_GROUPED'});
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
  it('rolls back when the design is no longer active, healthy or proposed', async () => {
    const base = await start();
    mocks.query.mockResolvedValue({rows:[]});
    const response = await mutate(base,'POST',body);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({code:'INACTIVE_DESIGN'});
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
  it('protects optimistic revision updates under the design lock', async () => {
    const base = await start();
    const response = await mutate(base,'PATCH',{...body,expectedRevision:1},`/${groupId}`);
    expect(response.status).toBe(200);
    const current = mocks.query.mock.calls.findIndex(([sql]) => sql.startsWith('SELECT revision,status'));
    expect(current).toBeGreaterThan(1);
    expect(mocks.query.mock.calls[current][0]).toContain('FOR UPDATE');
    const update = mocks.query.mock.calls.find(([sql]) => sql.startsWith('UPDATE cad_route_groups'));
    expect(update?.[0]).toContain('revision=$4');
    expect(update?.[1].slice(0,4)).toEqual([projectId,designId,groupId,1]);
  });
  it('preserves membership anchors and their cascading transition links when saving draft metadata', async () => {
    const base = await start();
    const response = await mutate(base,'PATCH',{
      ...body,name:'Updated display name',color:'#102030',purpose:'Updated purpose',expectedRevision:1,
    },`/${groupId}`);
    expect(response.status).toBe(200);
    // PostgreSQL must not DELETE then recreate retained memberships: even a
    // transactionally identical final set would have lost their transition FKs.
    const deletion = mocks.query.mock.calls.find(([sql]) => sql.startsWith('DELETE FROM cad_route_group_members'));
    expect(deletion?.[0]).toContain('AND NOT (instance_id=ANY($4::uuid[]))');
    expect(deletion?.[1]).toEqual([projectId,designId,groupId,[instanceId]]);
    const insertion = mocks.query.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO cad_route_group_members'));
    expect(insertion?.[0]).toContain('ON CONFLICT (route_group_id,instance_id) DO NOTHING');
    expect(insertion?.[1]).toEqual([projectId,designId,groupId,[instanceId]]);
    // The explicit conflict target must not mask a cross-group assignment race
    // on the separate UNIQUE(project_id,instance_id) ownership constraint.
    expect(insertion?.[0]).not.toMatch(/ON CONFLICT\s+DO NOTHING/);
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });
  it('rejects a stale revision before modifying metadata or membership', async () => {
    const base = await start();
    const response = await mutate(base,'PATCH',{...body,expectedRevision:2},`/${groupId}`);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({code:'STALE_CAD_ROUTE'});
    expect(mocks.query.mock.calls.find(([sql]) => sql.startsWith('UPDATE') || sql.startsWith('DELETE'))).toBeUndefined();
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
  it('allows published presentation recoloring without rewriting topology, publication or the project tray', async () => {
    const base = await start();
    const secondMember = '00000000-0000-4000-8000-000000000005';
    configurePublished([instanceId,secondMember]);
    const response = await mutate(base,'PATCH',{...body,color:'#102030',instanceIds:[secondMember,instanceId],expectedRevision:1},`/${groupId}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({route:{...route,status:'published',projectTrayId:projectId,color:'#102030',revision:2,instanceIds:[instanceId,secondMember]}});
    const update = mocks.query.mock.calls.find(([sql]) => sql.startsWith('UPDATE cad_route_groups'));
    expect(update?.[0]).toContain("revision=$4 AND status='published'");
    expect(update?.[1]).toEqual([projectId,designId,groupId,1,'#102030']);
    expect(update?.[0]).not.toMatch(/SET (?:name|tag|purpose|publication|project_tray_id)/);
    expect(mocks.query.mock.calls.find(([sql]) => /(?:INSERT INTO|DELETE FROM) cad_route_group_members|UPDATE trays|UPDATE cad_route_groups SET (?:name|publication)/.test(sql))).toBeUndefined();
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });
  it.each([
    {name:'Renamed published route'},
    {tag:'R-OTHER'},
    {purpose:'Different purpose'},
    {instanceIds:['00000000-0000-4000-8000-000000000005']},
  ])('rejects published structural or identity edits %j', async change => {
    const base = await start();
    configurePublished();
    const response = await mutate(base,'PATCH',{...body,...change,color:'#102030',expectedRevision:1},`/${groupId}`);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({code:'CAD_ROUTE_PUBLISHED'});
    expect(mocks.query.mock.calls.find(([sql]) => sql.startsWith('UPDATE') || sql.startsWith('DELETE'))).toBeUndefined();
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
  it('rejects published color changes with a stale expected revision', async () => {
    const base = await start();
    configurePublished();
    const response = await mutate(base,'PATCH',{...body,color:'#102030',expectedRevision:2},`/${groupId}`);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({code:'STALE_CAD_ROUTE'});
    expect(mocks.query.mock.calls.find(([sql]) => sql.startsWith('UPDATE'))).toBeUndefined();
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
  it('rejects deletion of published groups until withdrawal', async () => {
    const base = await start();
    configurePublished();
    const response = await mutate(base,'DELETE',{expectedRevision:1},`/${groupId}`);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({code:'CAD_ROUTE_PUBLISHED'});
    expect(mocks.query.mock.calls.find(([sql]) => sql.startsWith('UPDATE') || sql.startsWith('DELETE'))).toBeUndefined();
  });
  it('maps concurrent unique-tag/member and deadlock races to retryable conflicts', async () => {
    const base = await start();
    for (const [code,expected] of [['23505','CAD_ROUTE_TAG_OR_MEMBER_CONFLICT'],['40P01','CAD_DESIGN_CONFLICT'],['40001','CAD_DESIGN_CONFLICT']]) {
      mocks.query.mockImplementation(async (sql: string) => {
        if (sql.startsWith('SELECT d.id')) throw Object.assign(new Error('race'),{code});
        return {rows:[]};
      });
      const response = await mutate(base,'POST',body);
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({code:expected});
      expect(mocks.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    }
  });
  it('deletes only an expected-revision draft group', async () => {
    const base = await start();
    const response = await mutate(base,'DELETE',{expectedRevision:1},`/${groupId}`);
    expect(response.status).toBe(204);
    const deletion = mocks.query.mock.calls.find(([sql]) => sql.startsWith('DELETE FROM cad_route_groups'));
    expect(deletion?.[1]).toEqual([projectId,designId,groupId,1]);
    expect(deletion?.[0]).toContain("status='draft'");
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });
});

