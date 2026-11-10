// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { initializeMaterialTrayCadSchema } from './schema.js';
import { initializeCadDesignSchema } from '../cadDesign/schema.js';

const testUrl = process.env.WFC_MATERIAL_CAD_TEST_DATABASE_URL;

describe.skipIf(!testUrl)('Materials CAD migrations on disposable PostgreSQL', () => {
  it('upgrades existing tables, retains material data, pins revisions and isolates SKU identity', async () => {
    const url = new URL(testUrl!);
    if (url.pathname !== '/wfc_material_cad_test') throw new Error('Only the dedicated wfc_material_cad_test database is permitted.');
    const schema = 'material_cad_' + randomUUID().replaceAll('-', '');
    const admin = new Pool({ connectionString: testUrl, max: 1, connectionTimeoutMillis: 5000 });
    const pool = new Pool({ connectionString: testUrl, max: 1, options: `-c search_path=${schema}`, connectionTimeoutMillis: 5000 });
    const tray = randomUUID(), familyBend = randomUUID(), bend = randomUUID();
    const asset = randomUUID(), project = randomUUID(), model = randomUUID(), catalog = randomUUID();
    const legacySql = `
      CREATE TABLE users(id uuid PRIMARY KEY);
      CREATE TABLE projects(id uuid PRIMARY KEY);
      CREATE TABLE model_versions(id uuid PRIMARY KEY,project_id uuid,UNIQUE(project_id,id));
      CREATE TABLE project_model_selections(project_id uuid,active_model_version_id uuid);
      CREATE TABLE material_trays(id uuid PRIMARY KEY,tray_type text,manufacturer text,width_mm numeric,height_mm numeric,
        load_curve_id uuid,image_template_id uuid,unit_price numeric);
      -- Reproduce the pre-Materials project table: the two reference columns did not exist.
      CREATE TABLE cad_catalog_items (
        id uuid PRIMARY KEY,project_id uuid REFERENCES projects(id),manufacturer text,part_number text,family text,
        original_filename text,source_sha256 text,source_object_key text UNIQUE,source_bytes bigint,
        mesh_object_key text,mesh_metadata jsonb,conversion_status text,created_by uuid,created_at timestamptz DEFAULT now(),
        UNIQUE(project_id,source_sha256),UNIQUE(project_id,id)
      );`;
    try {
      await admin.query(`CREATE SCHEMA ${schema}`);
      await pool.query(legacySql);
      const curve = randomUUID(), image = randomUUID();
      await pool.query('INSERT INTO material_trays VALUES($1,$2,$3,300,60,$4,$5,45.67)', [tray, 'STRAIGHT-300', 'Niedax', curve, image]);
      const longTray = randomUUID();
      // Existing Materials accepts 200-character identifiers/manufacturers.
      // Backfill must preserve them and allow room for the imported-family label.
      await pool.query('INSERT INTO material_trays VALUES($1,$2,$3,300,60,NULL,NULL,0)', [longTray, 'S'.repeat(200), 'M'.repeat(200)]);
      await pool.query('INSERT INTO projects VALUES($1)', [project]);
      await pool.query('INSERT INTO model_versions VALUES($1,$2)', [model, project]);
      await initializeMaterialTrayCadSchema(pool);
      expect((await pool.query('SELECT part_number FROM material_components WHERE id=$1', [longTray])).rows[0].part_number).toHaveLength(200);
      const before = (await pool.query('SELECT * FROM material_trays WHERE id=$1', [tray])).rows[0];
      expect((await pool.query('SELECT component_kind,part_number,material_tray_id FROM material_components WHERE id=$1', [tray])).rows[0])
        .toEqual({ component_kind: 'straight', part_number: 'STRAIGHT-300', material_tray_id: tray });

      // A legacy fitting attachment retains its own SKU and historical asset UUID.
      await pool.query(`INSERT INTO material_tray_cad_assets
        (id,material_tray_id,part_number,component_kind,revision,original_filename,source_sha256,source_bytes,source_object_key,mesh_object_key,mesh_metadata)
        VALUES($1,$2,'BEND-300','bend',1,'bend.step',$3,100,'old/source','old/mesh','{}')`, [asset, tray, 'a'.repeat(64)]);
      await initializeMaterialTrayCadSchema(pool);
      expect((await pool.query(`SELECT c.part_number,c.component_kind,c.material_tray_id FROM material_components c
        JOIN material_component_cad_assets a ON a.component_id=c.id WHERE a.id=$1`, [asset])).rows[0])
        .toEqual({ part_number: 'BEND-300', component_kind: 'bend', material_tray_id: null });
      await initializeCadDesignSchema(pool);
      await pool.query(`INSERT INTO cad_catalog_items
        (id,project_id,manufacturer,part_number,family,original_filename,source_sha256,source_object_key,source_bytes,
         mesh_object_key,mesh_metadata,conversion_status,material_tray_cad_asset_id)
        VALUES($1,$2,'Niedax','BEND-300','Ladder','bend.step',$3,'old/source',100,'old/mesh','{}','ready',$4)`,
      [catalog, project, 'a'.repeat(64), asset]);
      await initializeCadDesignSchema(pool);
      expect((await pool.query('SELECT material_component_cad_asset_id FROM cad_catalog_items WHERE id=$1', [catalog])).rows[0].material_component_cad_asset_id).toBe(asset);
      await initializeMaterialTrayCadSchema(pool);
      await initializeCadDesignSchema(pool);
      expect((await pool.query('SELECT * FROM material_trays WHERE id=$1', [tray])).rows[0]).toEqual(before);

      await pool.query('INSERT INTO material_product_families(id,manufacturer,name) VALUES($1,$2,$3)', [familyBend, 'Niedax', 'Ladder 300x60']);
      await pool.query(`INSERT INTO material_components(id,family_id,manufacturer,part_number,component_kind,name)
        VALUES($1,$2,'Niedax','TEE-300','tee','Independent tee')`, [bend, familyBend]);
      await expect(pool.query(`INSERT INTO material_components(id,family_id,manufacturer,part_number,component_kind,name,material_tray_id)
        VALUES($1,$2,'Niedax','WRONG-TEE','tee','Invalid straight link',$3)`, [randomUUID(), familyBend, tray])).rejects.toMatchObject({ code: '23514' });
      await expect(pool.query(`INSERT INTO material_components(id,family_id,manufacturer,part_number,component_kind,name)
        VALUES($1,$2,'Niedax',' bend-300 ','tee','Duplicate SKU')`, [randomUUID(), familyBend])).rejects.toMatchObject({ code: '23505' });

      // The same bytes can represent two SKUs; neither hash nor source key owns identity.
      const teeAsset = randomUUID(), nextAsset = randomUUID();
      await pool.query(`INSERT INTO material_component_cad_assets
        (id,component_id,revision,original_filename,source_sha256,source_bytes,source_object_key,mesh_object_key,mesh_metadata)
        VALUES($1,$2,1,'tee.step',$3,100,'tee/source','tee/mesh','{}')`, [teeAsset, bend, 'a'.repeat(64)]);
      await pool.query(`INSERT INTO cad_catalog_items
        (id,project_id,manufacturer,part_number,family,original_filename,source_sha256,source_object_key,source_bytes,
         mesh_object_key,mesh_metadata,conversion_status,material_component_cad_asset_id)
        VALUES($1,$2,'Niedax','TEE-300','Ladder','tee.step',$3,'tee/source',100,'tee/mesh','{}','ready',$4)`,
      [randomUUID(), project, 'a'.repeat(64), teeAsset]);
      await pool.query('UPDATE material_component_cad_assets SET active=false WHERE id=$1', [asset]);
      await pool.query(`INSERT INTO material_component_cad_assets
        (id,component_id,revision,original_filename,source_sha256,source_bytes,source_object_key,mesh_object_key,mesh_metadata)
        SELECT $1,component_id,2,'bend-v2.step',$2,120,'bend/v2/source','bend/v2/mesh','{}' FROM material_component_cad_assets WHERE id=$3`,
      [nextAsset, 'b'.repeat(64), asset]);
      await expect(pool.query('UPDATE cad_catalog_items SET material_component_cad_asset_id=$1 WHERE id=$2', [nextAsset, catalog]))
        .rejects.toMatchObject({ code: '23514' });
      await expect(pool.query("UPDATE material_component_cad_assets SET source_object_key='overwrite' WHERE id=$1", [asset]))
        .rejects.toMatchObject({ code: '23514' });
      await expect(pool.query('DELETE FROM material_component_cad_assets WHERE id=$1', [asset])).rejects.toMatchObject({ code: '23514' });
      expect((await pool.query('SELECT material_component_cad_asset_id FROM cad_catalog_items WHERE id=$1', [catalog])).rows[0].material_component_cad_asset_id).toBe(asset);
      // Edits through the existing Materials tray API keep the one straight entry in sync.
      await pool.query("UPDATE material_trays SET manufacturer='Niedax updated',width_mm=400 WHERE id=$1", [tray]);
      expect((await pool.query('SELECT manufacturer,width_mm FROM material_components WHERE id=$1', [tray])).rows[0])
        .toEqual({ manufacturer: 'Niedax updated', width_mm: 400 });
    } finally {
      await pool.end();
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  }, 30000);
});
