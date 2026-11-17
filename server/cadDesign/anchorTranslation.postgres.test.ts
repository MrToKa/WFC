// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import express from 'express';
import type { Server } from 'node:http';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeCadDesignSchema } from './schema.js';
import { initializeCadRouteGroupsSchema } from './routeGroupsSchema.js';
import { initializeCadRouteTransitionsSchema } from './routeTransitionsSchema.js';
import { cadAnchorTranslationRouter } from './anchorTranslation.js';

// Opt-in integration proof uses a fresh container with no application mounts,
// credentials or connection strings. Every fixture belongs to this container.
const enabled = process.env.WFC_CAD_ANCHOR_POSTGRES_TESTS === '1';
const postgres = enabled ? describe : describe.skip;
const harness = vi.hoisted(() => ({ connect: vi.fn(), network: vi.fn() }));
vi.mock('../db.js', () => ({ pool: { connect: harness.connect } }));
vi.mock('./routePublication.js', () => ({ networkOptions: harness.network }));
vi.mock('../middleware.js', () => ({ requireProjectEdit: (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.header('x-test-edit') === 'yes') next(); else res.status(403).json({ code: 'EDIT_REQUIRED' });
} }));
const container = `wfc-cad-anchor-pg-${randomUUID()}`;
const docker = (args: string[]) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const projectId = id(1), designId = id(3), groupId = id(4);
let pool: Pool, server: Server | undefined, base: string, started = false;
let observe = false, observed: number[][] = [];
const fixture = `
  INSERT INTO projects(id) VALUES('${projectId}');
  INSERT INTO model_versions(project_id,id) VALUES('${projectId}','${id(2)}');
  INSERT INTO project_model_selections VALUES('${projectId}','${id(2)}');
  INSERT INTO cad_designs(id,project_id,model_version_id,name) VALUES('${designId}','${projectId}','${id(2)}','Isolated anchor fixture');
  INSERT INTO cad_catalog_items(id,project_id,manufacturer,part_number,family,original_filename,source_sha256,source_object_key,source_bytes)
    VALUES('${id(10)}','${projectId}','Unknown CAD','UNRECOGNISED','Fixture','unknown.step','${'a'.repeat(64)}','isolated-only',1);
  INSERT INTO cad_design_instances(id,project_id,design_id,catalog_item_id,x_mm,y_mm,z_mm,qx,qy,qz,qw)
    SELECT value::uuid,'${projectId}','${designId}','${id(10)}',index*1000,200,300,0,0,0.7071067811865476,0.7071067811865476
    FROM unnest(ARRAY['${id(11)}','${id(12)}','${id(13)}']) WITH ORDINALITY AS t(value,index);
  INSERT INTO cad_route_groups(id,project_id,design_id,name,tag,color,purpose) VALUES('${groupId}','${projectId}','${designId}','TEST','TEST','#16A34A','Fixture');
  INSERT INTO cad_route_group_members(project_id,design_id,route_group_id,instance_id)
    SELECT '${projectId}','${designId}','${groupId}',value::uuid FROM unnest(ARRAY['${id(11)}','${id(12)}','${id(13)}']) AS value;
  INSERT INTO cad_catalog_ports(id,project_id,catalog_item_id,name,port_type,local_transform)
    VALUES('${id(21)}','${projectId}','${id(10)}','start','60x300','{}'),('${id(22)}','${projectId}','${id(10)}','end','60x300','{}');
  INSERT INTO cad_design_connections(id,project_id,design_id,source_instance_id,source_catalog_item_id,source_port_id,target_instance_id,target_catalog_item_id,target_port_id)
    VALUES('${id(50)}','${projectId}','${designId}','${id(11)}','${id(10)}','${id(22)}','${id(12)}','${id(10)}','${id(21)}');
  INSERT INTO cad_route_transition_links(id,project_id,design_id,route_group_id,source_instance_id,source_port_name,target_instance_id,target_port_name)
    VALUES('${id(31)}','${projectId}','${designId}','${groupId}','${id(12)}','end','${id(13)}','start');
`;
const snapshot = async () => ({
  instances: (await pool.query('SELECT * FROM cad_design_instances ORDER BY id')).rows,
  links: (await pool.query('SELECT * FROM cad_design_connections ORDER BY id')).rows,
  transitions: (await pool.query('SELECT * FROM cad_route_transition_links ORDER BY id')).rows,
  groups: (await pool.query('SELECT * FROM cad_route_groups ORDER BY id')).rows,
  designs: (await pool.query('SELECT * FROM cad_designs ORDER BY id')).rows,
});
const body = () => ({ anchor: { instanceId: id(11), localPointMm: { x: 10, y: 0, z: 0 } }, targetPointMm: { x: 10000, y: 20000, z: 30000 },
  instances: [11, 12, 13].map(n => ({ id: id(n), expectedRevision: 1 })), route: { id: groupId, expectedRevision: 1 } });
const move = (payload = body()) => fetch(`${base}/translate-selection`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-edit': 'yes' }, body: JSON.stringify(payload) });

postgres('manual anchor translation with actual PostgreSQL guards', () => {
  beforeAll(async () => {
    docker(['run', '--pull', 'never', '--rm', '-d', '--name', container, '--publish', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data:rw,size=256m', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:16-alpine']);
    started = true;
    const port = Number(docker(['port', container, '5432/tcp']).trim().split(':').at(-1));
    pool = new Pool({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres', max: 5, connectionTimeoutMillis: 2000 });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { await pool.query('SELECT 1'); ready = true; break; } catch { await delay(100); }
    }
    if (!ready) throw new Error('Isolated PostgreSQL did not start');
    await pool.query(`CREATE TABLE projects(id UUID PRIMARY KEY); CREATE TABLE users(id UUID PRIMARY KEY);
      CREATE TABLE model_versions(project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,id UUID NOT NULL,state TEXT DEFAULT 'ready',health TEXT DEFAULT 'healthy',UNIQUE(project_id,id));
      CREATE TABLE project_model_selections(project_id UUID REFERENCES projects(id) ON DELETE CASCADE,active_model_version_id UUID);
      CREATE TABLE material_components(id UUID PRIMARY KEY,component_kind TEXT);
      CREATE TABLE material_component_cad_assets(id UUID PRIMARY KEY,component_id UUID REFERENCES material_components(id));
      CREATE TABLE material_tray_cad_assets(id UUID PRIMARY KEY);
      CREATE TABLE trays(id UUID PRIMARY KEY,project_id UUID REFERENCES projects(id) ON DELETE CASCADE,name TEXT);`);
    await initializeCadDesignSchema(pool); await initializeCadRouteGroupsSchema(pool); await initializeCadRouteTransitionsSchema(pool);
    await pool.query(`CREATE TABLE test_anchor_failure(enabled BOOLEAN); INSERT INTO test_anchor_failure VALUES(false);
      CREATE FUNCTION test_anchor_fail_second() RETURNS TRIGGER LANGUAGE plpgsql AS $guard$ BEGIN
        IF NEW.id='${id(12)}'::uuid AND (SELECT enabled FROM test_anchor_failure) THEN RAISE EXCEPTION 'Injected second member failure'; END IF; RETURN NEW; END; $guard$;
      CREATE TRIGGER test_anchor_fail_second BEFORE UPDATE ON cad_design_instances FOR EACH ROW EXECUTE FUNCTION test_anchor_fail_second();`);
    harness.connect.mockImplementation(async () => {
      const client = await pool.connect();
      return { release: () => client.release(), query: async (sql: string, values?: unknown[]) => {
        const result = await client.query(sql, values);
        if (observe && sql.startsWith('UPDATE cad_design_instances')) observed.push((await pool.query('SELECT x_mm FROM cad_design_instances ORDER BY id')).rows.map(row => row.x_mm));
        return result;
      } };
    });
    const app = express(); app.use(express.json()); app.use('/projects/:projectId/cad', cadAnchorTranslationRouter);
    app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(500).json({ code: 'TEST_FAILURE' }));
    server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server!.once('listening', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test server');
    base = `http://127.0.0.1:${address.port}/projects/${projectId}/cad/designs/${designId}`;
  }, 30000);
  beforeEach(async () => {
    observed = []; observe = false;
    await pool.query('TRUNCATE projects CASCADE; UPDATE test_anchor_failure SET enabled=false;');
    await pool.query(fixture);
  });
  afterAll(async () => {
    if (server) { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve())); }
    if (pool) await pool.end();
    if (started && /^wfc-cad-anchor-pg-[0-9a-f-]+$/.test(container)) docker(['rm', '-f', container]);
  });
  it('enforces the existing connected-component guard for direct edits', async () => {
    const before = await snapshot();
    await expect(pool.query(`UPDATE cad_design_instances SET x_mm=x_mm+1 WHERE id=$1`, [id(11)])).rejects.toMatchObject({ code: '23514' });
    expect(await snapshot()).toEqual(before);
  });
  it('moves unknown CAD sections atomically while observers see no partial movement and links retain every field', async () => {
    const before = await snapshot(); observe = true;
    const response = await move(); expect(response.status).toBe(200);
    const after = await snapshot();
    expect(observed).toEqual([[1000, 2000, 3000], [1000, 2000, 3000], [1000, 2000, 3000]]);
    expect(after.links).toEqual(before.links); expect(after.transitions).toEqual(before.transitions);
    expect(after.instances.map(row => [row.x_mm, row.y_mm, row.z_mm, row.revision])).toEqual([[10000, 19990, 30000, 2], [11000, 19990, 30000, 2], [12000, 19990, 30000, 2]]);
    expect(after.instances.map(row => [row.qx, row.qy, row.qz, row.qw, row.cut_length_mm])).toEqual(before.instances.map(row => [row.qx, row.qy, row.qz, row.qw, row.cut_length_mm]));
    expect(after.groups[0].revision).toBe(2); expect(after.designs[0].revision).toBeGreaterThan(before.designs[0].revision);
  });
  it('rolls back all saved geometry, links, group and design revisions when an actual trigger fails halfway', async () => {
    const before = await snapshot(); await pool.query('UPDATE test_anchor_failure SET enabled=true');
    expect((await move()).status).toBe(500); expect(await snapshot()).toEqual(before);
  });
  it('rejects a partial physical or logical connection selection without changing rows', async () => {
    const before = await snapshot();
    for (const selected of [[11], [11, 12]]) {
      const { route: _route, ...payload } = body(); payload.instances = selected.map(n => ({ id: id(n), expectedRevision: 1 }));
      expect((await move(payload as ReturnType<typeof body>)).status).toBe(409);
      expect(await snapshot()).toEqual(before);
    }
  });
  it('refuses stale revisions and published membership under real group guards', async () => {
    const stale = body(); stale.instances[0].expectedRevision = 2; expect((await move(stale)).status).toBe(409);
    await pool.query(`INSERT INTO trays(id,project_id,name) VALUES($1,$2,'Published fixture')`, [id(40), projectId]);
    await pool.query(`UPDATE cad_route_groups SET status='published',project_tray_id=$1,publication='{}' WHERE id=$2`, [id(40), groupId]);
    const before = await snapshot(); expect((await move()).status).toBe(409); expect(await snapshot()).toEqual(before);
    await expect(pool.query('UPDATE cad_design_instances SET x_mm=x_mm+1 WHERE id=$1', [id(13)])).rejects.toMatchObject({ code: '23514' });
  });
});
