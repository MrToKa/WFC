// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { STRAIGHT_SOURCES } from '../../shared/cadStraightSources.js';
import { FITTING_SOURCES } from '../../shared/cadFittingSources.js';
import { initializeCadDesignSchema } from './schema.js';

async function initializationSql() {
  const query = vi.fn(async (sql: string) => ({ rows: [], sql }));
  await initializeCadDesignSchema({ query } as unknown as Pool);
  return query.mock.calls.map(call => String(call[0])).join('\n;\n');
}

describe('verified straight source schema', () => {
  it('uses paired source identities and preserves existing connector IDs', async () => {
    const sql = await initializationSql();
    expect(sql).toContain('(upper(trim(c.original_filename)),c.source_sha256) IN (VALUES');
    for (const source of STRAIGHT_SOURCES)
      expect(sql).toContain(`('${source.filename.toUpperCase()}','${source.sha256}')`);
    expect(sql).toContain("p.component_kind='straight'");
    expect(sql).toContain('ON CONFLICT (catalog_item_id,name) DO NOTHING');
    for (const source of FITTING_SOURCES) {
      expect(sql).toContain(source.sha256);
      expect(sql).toContain(source.filename.toUpperCase());
    }
    expect(sql).toContain("AND (p.component_kind='straight' OR s.fitting)");
    expect(sql).not.toMatch(/ON CONFLICT \(catalog_item_id,name\) DO UPDATE/);
  });
});

// Explicit opt-in; creates a disposable database without application data,
// credentials, networking or mounted volumes.
const postgres = process.env.WFC_CAD_STRAIGHT_POSTGRES_TESTS === '1' ? describe : describe.skip;
const container = `wfc-cad-straight-pg-${randomUUID()}`;
let started = false;
let schemaSql = '';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const docker = (args: string[], input?: string) => execFileSync('docker', args, {
  input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000,
});
const psql = (input: string) => docker(
  ['exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'], input,
);
const catalog = (n: number, filename: string, sha256: string, kind = 'straight') => `
  INSERT INTO material_components(id,component_kind) VALUES('${id(n + 1000)}',${literal(kind)});
  INSERT INTO material_component_cad_assets(id,component_id) VALUES('${id(n + 2000)}','${id(n + 1000)}');
  INSERT INTO cad_catalog_items(id,project_id,manufacturer,part_number,family,original_filename,source_sha256,source_object_key,source_bytes,material_component_cad_asset_id)
    VALUES('${id(n + 3000)}','${id(1)}','Niedax','SKU-${n}','KL',${literal(filename)},${literal(sha256)},'source-${n}',1,'${id(n + 2000)}');`;
const instance = (n: number, length = 1250) => `
  INSERT INTO cad_design_instances(id,project_id,design_id,catalog_item_id,x_mm,y_mm,z_mm,qx,qy,qz,qw,cut_length_mm)
    VALUES('${id(n + 4000)}','${id(1)}','${id(3)}','${id(n + 3000)}',0,0,0,0,0,0,1,${length});`;
const reject = (sql: string) => `DO $reject$ BEGIN BEGIN ${sql}
  RAISE EXCEPTION 'Expected unsupported source rejection'; EXCEPTION WHEN check_violation THEN NULL; END; END; $reject$;`;

postgres('straight source migration in isolated PostgreSQL', () => {
  beforeAll(async () => {
    docker(['run', '--pull', 'never', '--rm', '-d', '--name', container, '--network', 'none',
      '--tmpfs', '/var/lib/postgresql/data:rw,size=256m', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:16-alpine']);
    started = true;
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']);
        ready = true;
        break;
      } catch { await delay(100); }
    }
    if (!ready) throw new Error('Disposable PostgreSQL did not start');
    schemaSql = await initializationSql();
    psql(`CREATE TABLE projects(id UUID PRIMARY KEY); CREATE TABLE users(id UUID PRIMARY KEY);
      CREATE TABLE model_versions(project_id UUID NOT NULL REFERENCES projects(id),id UUID NOT NULL,UNIQUE(project_id,id));
      CREATE TABLE material_components(id UUID PRIMARY KEY,component_kind TEXT);
      CREATE TABLE material_component_cad_assets(id UUID PRIMARY KEY,component_id UUID REFERENCES material_components(id));
      CREATE TABLE material_tray_cad_assets(id UUID PRIMARY KEY);
      ${schemaSql}
      INSERT INTO projects(id) VALUES('${id(1)}');
      INSERT INTO model_versions(project_id,id) VALUES('${id(1)}','${id(2)}');
      INSERT INTO cad_designs(id,project_id,model_version_id,name) VALUES('${id(3)}','${id(1)}','${id(2)}','Test');
      ${STRAIGHT_SOURCES.map((source, index) => catalog(index + 10, source.filename, source.sha256)).join('\n')}
      ${schemaSql}`);
  }, 30000);
  afterAll(() => {
    if (started && /^wfc-cad-straight-pg-[0-9a-f-]+$/.test(container)) docker(['rm', '-f', container]);
  });

  it('accepts cuts for every verified file and backfills measured profile anchors', () => {
    psql(STRAIGHT_SOURCES.map((_source, index) => instance(index + 10)).join('\n'));
    expect(Number(psql('SELECT count(*) FROM cad_design_instances WHERE cut_length_mm=1250;').trim())).toBe(STRAIGHT_SOURCES.length);
    expect(Number(psql('SELECT count(*) FROM cad_catalog_ports;').trim())).toBe(STRAIGHT_SOURCES.length * 2);
    for (const [index, source] of STRAIGHT_SOURCES.entries()) {
      const port = JSON.parse(psql(`SELECT json_build_object('type',port_type,'transform',local_transform) FROM cad_catalog_ports
        WHERE catalog_item_id='${id(index + 3010)}' AND name='end';`).trim());
      expect(port.type).toBe(`cable-ladder-${source.heightMm}x${source.widthMm}`);
      expect(port.transform.position).toEqual({ x: source.centerXmm, y: source.centerYmm, z: source.lengthMm });
    }
  });

  it('reruns without replacing connector IDs, existing lengths or connections', () => {
    const before = psql('SELECT id FROM cad_catalog_ports ORDER BY id;');
    psql(`INSERT INTO cad_design_connections(id,project_id,design_id,source_instance_id,source_catalog_item_id,source_port_id,target_instance_id,target_catalog_item_id,target_port_id)
      SELECT '${id(9000)}','${id(1)}','${id(3)}','${id(4010)}','${id(3010)}',s.id,'${id(4011)}','${id(3011)}',t.id
      FROM cad_catalog_ports s,cad_catalog_ports t WHERE s.catalog_item_id='${id(3010)}' AND s.name='end' AND t.catalog_item_id='${id(3011)}' AND t.name='start';
      ${schemaSql}
      ${schemaSql}`);
    expect(psql('SELECT id FROM cad_catalog_ports ORDER BY id;')).toBe(before);
    expect(psql('SELECT count(*) FROM cad_design_connections;').trim()).toBe('1');
    expect(Number(psql('SELECT count(*) FROM cad_design_instances WHERE cut_length_mm=1250;').trim())).toBe(STRAIGHT_SOURCES.length);
  });

  it('rejects altered bytes, crossed filename/hash pairs and fittings', () => {
    const first = STRAIGHT_SOURCES[0];
    psql(`BEGIN;
      ${catalog(100, first.filename, '0'.repeat(64))}
      ${catalog(101, first.filename, STRAIGHT_SOURCES[1].sha256)}
      ${catalog(102, first.filename, first.sha256, 'bend')}
      ${schemaSql}
      ${reject(instance(100))}${reject(instance(101))}${reject(instance(102))}
      DO $assert$ BEGIN IF EXISTS(SELECT 1 FROM cad_catalog_ports WHERE catalog_item_id IN ('${id(3100)}','${id(3101)}','${id(3102)}'))
        THEN RAISE EXCEPTION 'Unsupported source received connector anchors'; END IF; END; $assert$;
      ROLLBACK;`);
  });

  it('backfills measured tee and bend ports for existing references without allowing cuts', () => {
    psql(`BEGIN;
      ${FITTING_SOURCES.map((source, index) => catalog(200 + index, source.filename, source.sha256)).join('\n')}
      ${schemaSql}
      CREATE TEMP TABLE fitting_port_snapshot AS SELECT * FROM cad_catalog_ports;
      ${FITTING_SOURCES.map((source, index) => `
        DO $assert$ BEGIN IF (SELECT count(*) FROM cad_catalog_ports WHERE catalog_item_id='${id(3200 + index)}')<>${source.ports.length}
          THEN RAISE EXCEPTION 'Missing measured fitting ports'; END IF; END; $assert$;
        ${source.ports.map(port => `DO $assert$ BEGIN IF NOT EXISTS(SELECT 1 FROM cad_catalog_ports
          WHERE catalog_item_id='${id(3200 + index)}' AND name=${literal(port.id)}
          AND local_transform=${literal(JSON.stringify(port.local))}::jsonb)
          THEN RAISE EXCEPTION 'Fitting frame changed'; END IF; END; $assert$;`).join('\n')}
        ${reject(instance(200 + index))}`).join('\n')}
      ${schemaSql}
      DO $assert$ BEGIN IF EXISTS(SELECT * FROM fitting_port_snapshot EXCEPT SELECT * FROM cad_catalog_ports)
        THEN RAISE EXCEPTION 'Existing port IDs changed'; END IF; END; $assert$;
      ROLLBACK;`);
  });
});
