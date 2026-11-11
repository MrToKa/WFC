// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initializeCadDesignSchema } from './schema.js';
import { initializeCadRouteGroupsSchema } from './routeGroupsSchema.js';
import { initializeCadRouteTransitionsSchema } from './routeTransitionsSchema.js';

// Opt in explicitly: this creates only a new, isolated, disposable PostgreSQL
// container. It never reads an application connection string or mounts data.
const postgres = process.env.WFC_CAD_TRANSITIONS_POSTGRES_TESTS === '1' ? describe : describe.skip;
const container = `wfc-cad-transition-pg-${randomUUID()}`;
let started = false;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const docker = (args: string[], input?: string) =>
  execFileSync('docker', args, {
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 30000,
  });
const psql = (input: string) =>
  docker(
    ['exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'],
    input,
  );
const link = (
  n = 31,
  source = 11,
  sourcePort = 'end',
  target = 12,
  targetPort = 'start',
  group = 4,
  project = 1,
  design = 3,
) =>
  `INSERT INTO cad_route_transition_links(id,project_id,design_id,route_group_id,source_instance_id,source_port_name,target_instance_id,target_port_name)
   VALUES('${id(n)}','${id(project)}','${id(design)}','${id(group)}','${id(source)}','${sourcePort}','${id(target)}','${targetPort}');`;
const physical = (
  n = 50,
  source = 11,
  target = 12,
) => `INSERT INTO cad_design_connections(id,project_id,design_id,source_instance_id,source_catalog_item_id,source_port_id,target_instance_id,target_catalog_item_id,target_port_id)
  VALUES('${id(n)}','${id(1)}','${id(3)}','${id(source)}','${id(10)}','${id(22)}','${id(target)}','${id(10)}','${id(21)}');`;
const fixture = `
  INSERT INTO projects(id) VALUES('${id(1)}'),('${id(99)}');
  INSERT INTO model_versions(project_id,id) VALUES('${id(1)}','${id(2)}'),('${id(1)}','${id(96)}');
  INSERT INTO cad_designs(id,project_id,model_version_id,name) VALUES('${id(3)}','${id(1)}','${id(2)}','Test'),('${id(97)}','${id(1)}','${id(96)}','Other');
  INSERT INTO cad_catalog_items(id,project_id,manufacturer,part_number,family,original_filename,source_sha256,source_object_key,source_bytes)
    VALUES('${id(10)}','${id(1)}','Test','KL','Test','test.step','${'a'.repeat(64)}','test-only',1);
  INSERT INTO cad_design_instances(id,project_id,design_id,catalog_item_id,x_mm,y_mm,z_mm,qx,qy,qz,qw)
    SELECT value::uuid,'${id(1)}','${id(3)}','${id(10)}',0,0,0,0,0,0,1 FROM unnest(ARRAY['${id(11)}','${id(12)}','${id(13)}','${id(14)}']) AS value;
  INSERT INTO cad_route_groups(id,project_id,design_id,name,tag,color,purpose) VALUES('${id(4)}','${id(1)}','${id(3)}','Test','TEST','#16A34A','Control');
  INSERT INTO cad_route_group_members(project_id,design_id,route_group_id,instance_id)
    SELECT '${id(1)}','${id(3)}','${id(4)}',value::uuid FROM unnest(ARRAY['${id(11)}','${id(12)}','${id(13)}','${id(14)}']) AS value;
  INSERT INTO cad_catalog_ports(id,project_id,catalog_item_id,name,port_type,local_transform)
    VALUES('${id(21)}','${id(1)}','${id(10)}','start','60x300','{}'),('${id(22)}','${id(1)}','${id(10)}','end','60x300','{}');
  ${link()}
`;
const published = `INSERT INTO trays(id,project_id,name) VALUES('${id(40)}','${id(1)}','Test');
  UPDATE cad_route_groups SET status='published',project_tray_id='${id(40)}',publication='{}' WHERE id='${id(4)}';`;
const assertSql = (condition: string) =>
  `DO $assert$ BEGIN IF NOT (${condition}) THEN RAISE EXCEPTION 'Transition lifecycle assertion failed'; END IF; END; $assert$;`;
const rejected = (
  statement: string,
  condition = 'check_violation',
) => `DO $reject$ BEGIN BEGIN ${statement}
  RAISE EXCEPTION 'Expected transition operation to be refused'; EXCEPTION WHEN ${condition} THEN NULL; END; END; $reject$;`;
const run = (sql: string) => psql(`BEGIN; ${fixture} ${sql} ROLLBACK;`);

postgres('installation transition migration and lifecycle in isolated PostgreSQL', () => {
  beforeAll(async () => {
    docker([
      'run',
      '--pull',
      'never',
      '--rm',
      '-d',
      '--name',
      container,
      '--network',
      'none',
      '--tmpfs',
      '/var/lib/postgresql/data:rw,size=256m',
      '-e',
      'POSTGRES_HOST_AUTH_METHOD=trust',
      'postgres:16-alpine',
    ]);
    started = true;
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']);
        ready = true;
        break;
      } catch {
        await delay(100);
      }
    }
    if (!ready) throw new Error('Disposable PostgreSQL did not start');
    psql(`CREATE TABLE projects(id UUID PRIMARY KEY); CREATE TABLE users(id UUID PRIMARY KEY);
      CREATE TABLE model_versions(project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,id UUID NOT NULL,UNIQUE(project_id,id));
      CREATE TABLE material_components(id UUID PRIMARY KEY,component_kind TEXT);
      CREATE TABLE material_component_cad_assets(id UUID PRIMARY KEY,component_id UUID REFERENCES material_components(id));
      CREATE TABLE material_tray_cad_assets(id UUID PRIMARY KEY);
      CREATE TABLE trays(id UUID PRIMARY KEY,project_id UUID REFERENCES projects(id) ON DELETE CASCADE,name TEXT);`);
    const statements: string[] = [];
    const query = async (text: string) => {
      statements.push(text);
      return { rows: [] };
    };
    const pool = { query, connect: async () => ({ query, release() {} }) } as unknown as Pool;
    await initializeCadDesignSchema(pool);
    await initializeCadRouteGroupsSchema(pool);
    await initializeCadRouteTransitionsSchema(pool);
    await initializeCadRouteTransitionsSchema(pool);
    psql(statements.join('\n;\n'));
  }, 30000);
  afterAll(() => {
    if (started && /^wfc-cad-transition-pg-[0-9a-f-]+$/.test(container))
      docker(['rm', '-f', container]);
  });

  it('initializes idempotently and stores endpoint topology without any fabricated geometry', () => {
    const columns = psql(
      "SELECT column_name FROM information_schema.columns WHERE table_name='cad_route_transition_links' ORDER BY ordinal_position;",
    )
      .trim()
      .split('\n');
    expect(columns).toEqual([
      'id',
      'project_id',
      'design_id',
      'route_group_id',
      'source_instance_id',
      'source_port_name',
      'target_instance_id',
      'target_port_name',
      'kind',
      'created_at',
    ]);
    run(
      assertSql(
        "(SELECT count(*) FROM cad_route_transition_links WHERE kind='routing-transition')=1",
      ),
    );
  });
  it('retains saved transitions when unchanged group membership is inserted again', () => {
    run(`INSERT INTO cad_route_group_members SELECT * FROM cad_route_group_members WHERE route_group_id='${id(4)}' ON CONFLICT DO NOTHING;
      ${assertSql(`(SELECT count(*) FROM cad_route_transition_links WHERE id='${id(31)}')=1`)}`);
  });
  it.each([11, 12])(
    'cascades deletion of endpoint membership %s while preserving the other placed parts',
    (member) => {
      run(`DELETE FROM cad_route_group_members WHERE route_group_id='${id(4)}' AND instance_id='${id(member)}';
      ${assertSql('(SELECT count(*) FROM cad_route_transition_links)=0')}
      ${assertSql('(SELECT count(*) FROM cad_design_instances)=4')}`);
    },
  );
  it('keeps the existing direct grouped-instance delete boundary, then allows removal after membership cleanup', () => {
    run(`${rejected(`DELETE FROM cad_design_instances WHERE id='${id(11)}';`, 'foreign_key_violation')}
      DELETE FROM cad_route_group_members WHERE instance_id='${id(11)}'; DELETE FROM cad_design_instances WHERE id='${id(11)}';
      ${assertSql('(SELECT count(*) FROM cad_route_transition_links)=0')}
      ${assertSql('(SELECT count(*) FROM cad_design_instances)=3')}`);
  });
  it('still rejects a standalone pinned catalogue deletion after making the FK deferrable', () => {
    psql(`BEGIN; ${fixture} COMMIT;`);
    try {
      expect(() => psql(`DELETE FROM cad_catalog_items WHERE id='${id(10)}';`)).toThrow(
        /foreign key constraint/,
      );
      psql(`${assertSql('(SELECT count(*) FROM cad_catalog_items)=1')}
        ${assertSql('(SELECT count(*) FROM cad_design_instances)=4')}`);
    } finally {
      psql(`DELETE FROM projects WHERE id IN ('${id(1)}','${id(99)}');`);
    }
  });
  it('deletes draft grouping and its transitions while preserving all component instances', () => {
    run(`DELETE FROM cad_route_groups WHERE id='${id(4)}'; ${assertSql('(SELECT count(*) FROM cad_route_transition_links)=0')}
      ${assertSql('(SELECT count(*) FROM cad_design_instances)=4')}`);
  });
  it('rejects foreign project, design and membership references', () => {
    run(`INSERT INTO cad_route_groups(id,project_id,design_id,name,tag,color,purpose) VALUES('${id(51)}','${id(1)}','${id(3)}','Other','OTHER','#16A34A','Control');
      ${rejected(link(32, 11, 'start', 12, 'end', 51), 'foreign_key_violation')}
      ${rejected(link(33, 11, 'start', 12, 'end', 4, 99), 'foreign_key_violation')}
      ${rejected(link(34, 11, 'start', 12, 'end', 4, 1, 97), 'foreign_key_violation')}
      ${assertSql('(SELECT count(*) FROM cad_route_transition_links)=1')}`);
  });
  it('prevents a logical port from being reused in either role', () => {
    run(`${rejected(link(32, 13, 'end', 11, 'end'))} ${rejected(link(33, 12, 'start', 14, 'end'))}
      ${assertSql('(SELECT count(*) FROM cad_route_transition_links)=1')}`);
  });
  it('rejects logical occupancy of a physical port and physical occupancy of a logical port', () => {
    run(`${rejected(physical(50, 11, 13))} ${rejected(physical(51, 13, 12))}
      DELETE FROM cad_route_transition_links; ${physical(52)} ${rejected(link(32, 11, 'end', 13, 'start'))}
      ${assertSql('(SELECT count(*) FROM cad_design_connections)=1')}
      ${assertSql('(SELECT count(*) FROM cad_route_transition_links)=0')}`);
  });
  it('rejects retargeting an existing physical connection into a logical occupied port', () => {
    run(`${physical(50, 13, 14)} ${rejected(`UPDATE cad_design_connections SET source_instance_id='${id(11)}' WHERE id='${id(50)}';`)}
      ${assertSql(`(SELECT source_instance_id FROM cad_design_connections WHERE id='${id(50)}')='${id(13)}'::uuid`)}`);
  });
  it('freezes published transitions, endpoint membership and group deletion until withdrawal', () => {
    run(`${published} ${rejected(`UPDATE cad_route_transition_links SET target_port_name='end' WHERE id='${id(31)}';`)}
      ${rejected(`DELETE FROM cad_route_transition_links WHERE id='${id(31)}';`)} ${rejected(link(32, 13, 'end', 14, 'start'))}
      ${rejected(`DELETE FROM cad_route_group_members WHERE instance_id='${id(11)}';`)}
      ${rejected(`DELETE FROM cad_route_groups WHERE id='${id(4)}';`)}
      ${assertSql('(SELECT count(*) FROM cad_route_transition_links)=1')}
      UPDATE cad_route_groups SET status='draft',project_tray_id=NULL WHERE id='${id(4)}';
      DELETE FROM cad_route_groups WHERE id='${id(4)}'; ${assertSql('(SELECT count(*) FROM cad_route_transition_links)=0')}`);
  });
  it('allows an existing parent-project cascade to remove even published topology without touching another project', () => {
    run(`${physical(50, 13, 14)} ${published} DELETE FROM projects WHERE id='${id(1)}'; SET CONSTRAINTS ALL IMMEDIATE;
      ${assertSql('(SELECT count(*) FROM cad_route_transition_links)=0')}
      ${assertSql('(SELECT count(*) FROM cad_design_instances)=0')}
      ${assertSql(`(SELECT count(*) FROM projects WHERE id='${id(99)}')=1`)}`);
  });
});
