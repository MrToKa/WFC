// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { initializeMaterialTrayCadSchema } from './schema.js';
import { initializeCadDesignSchema } from '../cadDesign/schema.js';
import { initializeCadRouteGroupsSchema } from '../cadDesign/routeGroupsSchema.js';

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
      CREATE TABLE model_versions(id uuid PRIMARY KEY,project_id uuid REFERENCES projects(id) ON DELETE CASCADE,state text NOT NULL DEFAULT 'ready',health text NOT NULL DEFAULT 'healthy',UNIQUE(project_id,id));
      CREATE TABLE trays(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE);
      CREATE TABLE project_model_selections(project_id uuid REFERENCES projects(id) ON DELETE CASCADE,active_model_version_id uuid);
      CREATE TABLE material_trays(id uuid PRIMARY KEY,tray_type text,manufacturer text,width_mm numeric,height_mm numeric,
        load_curve_id uuid,image_template_id uuid,unit_price numeric);
      -- Reproduce the pre-Materials project table: the two reference columns did not exist.
      CREATE TABLE cad_catalog_items (
        id uuid PRIMARY KEY,project_id uuid REFERENCES projects(id) ON DELETE CASCADE,manufacturer text,part_number text,family text,
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
      await pool.query('INSERT INTO model_versions(id,project_id) VALUES($1,$2)', [model, project]);
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

      // Route groups contain genuine CAD instance UUIDs. They never invent SVF
      // dbIds or a new model version merely to register a route in the project.
      await initializeCadRouteGroupsSchema(pool);
      await initializeCadRouteGroupsSchema(pool);
      expect((await pool.query(`SELECT conname,condeferrable,condeferred,confdeltype FROM pg_constraint
        WHERE conname IN ('cad_route_groups_project_tray_fk','cad_route_group_members_instance_fk') ORDER BY conname`)).rows)
        .toEqual([
          { conname: 'cad_route_group_members_instance_fk', condeferrable: true, condeferred: false, confdeltype: 'a' },
          { conname: 'cad_route_groups_project_tray_fk', condeferrable: true, condeferred: false, confdeltype: 'a' },
        ]);
      const design = randomUUID(), otherDesign = randomUUID(), otherModel = randomUUID();
      const foreignProject = randomUUID(), foreignModel = randomUUID(), foreignDesign = randomUUID(), foreignCatalog = randomUUID();
      const ownInstance = randomUUID(), otherDesignInstance = randomUUID(), foreignInstance = randomUUID(), raceInstance = randomUUID();
      const group = randomUUID(), alternateGroup = randomUUID(), thirdGroup = randomUUID();
      const generatedTray = randomUUID(), foreignTray = randomUUID();
      await pool.query('INSERT INTO projects VALUES($1)', [foreignProject]);
      await pool.query('INSERT INTO model_versions(id,project_id) VALUES($1,$2),($3,$4)', [otherModel, project, foreignModel, foreignProject]);
      await pool.query('INSERT INTO project_model_selections VALUES($1,$2),($3,$4)', [project, model, foreignProject, foreignModel]);
      await pool.query(`INSERT INTO cad_designs(id,project_id,model_version_id,name)
        VALUES($1,$2,$3,'Current CAD proposal'),($4,$2,$5,'Other selected model proposal'),($6,$7,$8,'Other project proposal')`,
      [design, project, model, otherDesign, otherModel, foreignDesign, foreignProject, foreignModel]);
      await pool.query(`INSERT INTO cad_catalog_items
        (id,project_id,manufacturer,part_number,family,original_filename,source_sha256,source_object_key,source_bytes,
         mesh_object_key,mesh_metadata,conversion_status,material_component_cad_asset_id)
        VALUES($1,$2,'Niedax','BEND-300','Ladder','bend.step',$3,'foreign/source',100,'foreign/mesh','{}','ready',$4)`,
      [foreignCatalog, foreignProject, 'a'.repeat(64), asset]);
      await pool.query(`INSERT INTO cad_design_instances
        (id,project_id,design_id,catalog_item_id,x_mm,y_mm,z_mm,qx,qy,qz,qw)
        VALUES($1,$2,$3,$4,0,0,0,0,0,0,1),($5,$2,$6,$4,0,0,0,0,0,0,1),
              ($7,$8,$9,$10,0,0,0,0,0,0,1),($11,$2,$3,$4,0,0,0,0,0,0,1)`,
      [ownInstance, project, design, catalog, otherDesignInstance, otherDesign, foreignInstance,
        foreignProject, foreignDesign, foreignCatalog, raceInstance]);
      await pool.query(`INSERT INTO cad_route_groups(id,project_id,design_id,name,tag,color,purpose)
        VALUES($1,$2,$3,'Route 101','R101','#AABBCC','LV cable tray'),
              ($4,$2,$3,'Route 102','R102','#102030','LV cable tray'),
              ($5,$2,$3,'Route 103','R103','#ABCDEF','Control cable tray')`,
      [group, project, design, alternateGroup, thirdGroup]);
      await pool.query(`INSERT INTO cad_route_group_members(project_id,design_id,route_group_id,instance_id)
        VALUES($1,$2,$3,$4)`, [project, design, group, ownInstance]);
      // Both a foreign project and a different design in this project fail the
      // scoped instance FK, independently of application preflight checks.
      for (const invalidInstance of [foreignInstance, otherDesignInstance]) {
        await expect(pool.query(`INSERT INTO cad_route_group_members(project_id,design_id,route_group_id,instance_id)
          VALUES($1,$2,$3,$4)`, [project, design, group, invalidInstance]))
          .rejects.toMatchObject({ code: '23503' });
      }
      await expect(pool.query(`INSERT INTO cad_route_group_members(project_id,design_id,route_group_id,instance_id)
        VALUES($1,$2,$3,$4)`, [project, design, alternateGroup, ownInstance])).rejects.toMatchObject({ code: '23505' });
      await expect(pool.query(`INSERT INTO cad_route_groups(id,project_id,design_id,name,tag,color,purpose)
        VALUES($1,$2,$3,'Duplicate across designs','R101','#AABBCC','LV')`, [randomUUID(), project, otherDesign]))
        .rejects.toMatchObject({ code: '23505' });
      await expect(pool.query("UPDATE cad_route_groups SET tag='r101' WHERE id=$1", [group]))
        .rejects.toMatchObject({ code: '23514' });
      await expect(pool.query("UPDATE cad_route_groups SET color='red' WHERE id=$1", [group]))
        .rejects.toMatchObject({ code: '23514' });
      await expect(pool.query("UPDATE cad_route_groups SET status='published' WHERE id=$1", [group]))
        .rejects.toMatchObject({ code: '23514' });
      await pool.query('INSERT INTO trays(id,project_id) VALUES($1,$2),($3,$4)', [generatedTray, project, foreignTray, foreignProject]);
      await expect(pool.query(`UPDATE cad_route_groups SET status='published',project_tray_id=$2,publication='{}' WHERE id=$1`, [group, foreignTray]))
        .rejects.toMatchObject({ code: '23503' });

      // Real concurrent connections must not assign one physical CAD instance
      // to two routes even when both requests pass their initial reads.
      const concurrent = new Pool({ connectionString: testUrl, max: 2, options: `-c search_path=${schema}`, connectionTimeoutMillis: 5000 });
      try {
        const results = await Promise.allSettled([alternateGroup, thirdGroup].map(routeId => concurrent.query(
          'INSERT INTO cad_route_group_members(project_id,design_id,route_group_id,instance_id) VALUES($1,$2,$3,$4)',
          [project, design, routeId, raceInstance],
        )));
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        const rejected = results.find(result => result.status === 'rejected');
        expect(rejected?.status === 'rejected' ? rejected.reason : undefined).toMatchObject({ code: '23505' });
        expect((await pool.query('SELECT count(*)::int AS total FROM cad_route_group_members WHERE project_id=$1 AND instance_id=$2', [project, raceInstance])).rows[0].total).toBe(1);
      } finally { await concurrent.end(); }

      // Editing a draft is allowed; published geometry remains fixed until the
      // publication endpoint explicitly withdraws the generated project tray.
      await pool.query('UPDATE cad_design_instances SET x_mm=10 WHERE id=$1', [ownInstance]);
      const sourcePort = randomUUID(), targetPort = randomUUID(), connection = randomUUID();
      await pool.query(`INSERT INTO cad_catalog_ports(id,project_id,catalog_item_id,name,port_type,local_transform)
        VALUES($1,$2,$3,'Fixture source','ladder','{}'),($4,$2,$3,'Fixture target','ladder','{}')`,
      [sourcePort, project, catalog, targetPort]);
      await pool.query(`INSERT INTO cad_design_connections
        (id,project_id,design_id,source_instance_id,source_catalog_item_id,source_port_id,target_instance_id,target_catalog_item_id,target_port_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$5,$8)`,
      [connection, project, design, ownInstance, catalog, sourcePort, raceInstance, targetPort]);
      await pool.query(`UPDATE cad_route_groups SET status='published',project_tray_id=$2,publication='{"source":"cad-route-group"}' WHERE id=$1`, [group, generatedTray]);
      await expect(pool.query('UPDATE cad_design_instances SET x_mm=20 WHERE id=$1', [ownInstance]))
        .rejects.toMatchObject({ code: '23514' });
      await expect(pool.query('DELETE FROM cad_design_instances WHERE id=$1', [ownInstance]))
        .rejects.toMatchObject({ code: '23514' });
      await expect(pool.query('DELETE FROM cad_design_connections WHERE id=$1', [connection]))
        .rejects.toMatchObject({ code: '23514' });
      await expect(pool.query('UPDATE cad_design_connections SET source_instance_id=source_instance_id WHERE id=$1', [connection]))
        .rejects.toMatchObject({ code: '23514' });
      await expect(pool.query(`INSERT INTO cad_design_connections
        (id,project_id,design_id,source_instance_id,source_catalog_item_id,source_port_id,target_instance_id,target_catalog_item_id,target_port_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$5,$8)`,
      [randomUUID(), project, design, raceInstance, catalog, sourcePort, ownInstance, targetPort]))
        .rejects.toMatchObject({ code: '23514' });
      expect((await pool.query('SELECT id FROM cad_design_connections WHERE id=$1', [connection])).rows).toHaveLength(1);
      expect((await pool.query('SELECT x_mm FROM cad_design_instances WHERE id=$1', [ownInstance])).rows[0].x_mm).toBe(10);
      await expect(pool.query('DELETE FROM trays WHERE id=$1', [generatedTray])).rejects.toMatchObject({ code: '23503' });
      await pool.query(`UPDATE cad_route_groups SET status='draft',project_tray_id=NULL,publication='{"source":"cad-route-group","withdrawn":true}' WHERE id=$1`, [group]);
      expect((await pool.query('SELECT publication FROM cad_route_groups WHERE id=$1', [group])).rows[0].publication.withdrawn).toBe(true);
      await expect(pool.query("UPDATE cad_route_groups SET publication='[]' WHERE id=$1", [group]))
        .rejects.toMatchObject({ code: '23514' });
      await pool.query('DELETE FROM cad_design_connections WHERE id=$1', [connection]);
      await pool.query('UPDATE cad_design_instances SET x_mm=20 WHERE id=$1', [ownInstance]);
      expect((await pool.query('SELECT x_mm FROM cad_design_instances WHERE id=$1', [ownInstance])).rows[0].x_mm).toBe(20);
      // A grouped draft cannot lose an instance through an unrelated delete.
      await expect(pool.query('DELETE FROM cad_design_instances WHERE id=$1', [ownInstance]))
        .rejects.toMatchObject({ code: '23503' });
      await pool.query('DELETE FROM trays WHERE id=$1', [generatedTray]);
      await initializeCadRouteGroupsSchema(pool);

      // Whole-project deletion retains the original cascade semantics even when
      // the project contains both a draft and a published CAD route. The same
      // guards above still reject individual instance/connection/tray deletes.
      const foreignPublishedInstance = randomUUID(), foreignDraftGroup = randomUUID(), foreignPublishedGroup = randomUUID();
      const foreignSourcePort = randomUUID(), foreignTargetPort = randomUUID(), foreignConnection = randomUUID();
      await pool.query(`INSERT INTO cad_design_instances
        (id,project_id,design_id,catalog_item_id,x_mm,y_mm,z_mm,qx,qy,qz,qw)
        VALUES($1,$2,$3,$4,0,0,0,0,0,0,1)`, [foreignPublishedInstance, foreignProject, foreignDesign, foreignCatalog]);
      await pool.query(`INSERT INTO cad_route_groups(id,project_id,design_id,name,tag,color,purpose)
        VALUES($1,$2,$3,'Draft route','FDRAFT','#112233','LV'),($4,$2,$3,'Published route','FPUBLISHED','#445566','LV')`,
      [foreignDraftGroup, foreignProject, foreignDesign, foreignPublishedGroup]);
      await pool.query(`INSERT INTO cad_route_group_members(project_id,design_id,route_group_id,instance_id)
        VALUES($1,$2,$3,$4),($1,$2,$5,$6)`,
      [foreignProject, foreignDesign, foreignDraftGroup, foreignInstance, foreignPublishedGroup, foreignPublishedInstance]);
      await pool.query(`INSERT INTO cad_catalog_ports(id,project_id,catalog_item_id,name,port_type,local_transform)
        VALUES($1,$2,$3,'Cascade source','ladder','{}'),($4,$2,$3,'Cascade target','ladder','{}')`,
      [foreignSourcePort, foreignProject, foreignCatalog, foreignTargetPort]);
      await pool.query(`INSERT INTO cad_design_connections
        (id,project_id,design_id,source_instance_id,source_catalog_item_id,source_port_id,target_instance_id,target_catalog_item_id,target_port_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$5,$8)`,
      [foreignConnection, foreignProject, foreignDesign, foreignInstance, foreignCatalog, foreignSourcePort, foreignPublishedInstance, foreignTargetPort]);
      await pool.query(`UPDATE cad_route_groups SET status='published',project_tray_id=$2,publication='{"source":"cad-route-group"}' WHERE id=$1`,
      [foreignPublishedGroup, foreignTray]);
      // Existing PoC CAD catalog/model/port NO ACTION FKs are not deferrable and
      // already block project deletion before route groups participate. Defer
      // those legacy fixture constraints ONLY HERE to isolate the new guards'
      // cascade behavior. The production route-group migration does not alter
      // any pre-existing CAD constraint outside its own two new foreign keys.
      await pool.query(`DO $fixture$
        DECLARE reference RECORD;
        BEGIN
          FOR reference IN SELECT conrelid::regclass AS table_name,conname FROM pg_constraint
            WHERE contype='f' AND confdeltype='a' AND NOT condeferrable
              AND conrelid IN ('cad_designs'::regclass,'cad_design_instances'::regclass,'cad_design_connections'::regclass)
          LOOP
            EXECUTE format('ALTER TABLE %s ALTER CONSTRAINT %I DEFERRABLE INITIALLY IMMEDIATE',reference.table_name,reference.conname);
          END LOOP;
        END; $fixture$;`);
      await pool.query('BEGIN');
      await pool.query(`DO $fixture$
        DECLARE reference RECORD;
        BEGIN
          FOR reference IN SELECT conname FROM pg_constraint
            WHERE contype='f' AND confdeltype='a' AND condeferrable
              AND conrelid IN ('cad_designs'::regclass,'cad_design_instances'::regclass,'cad_design_connections'::regclass)
          LOOP EXECUTE format('SET CONSTRAINTS %I DEFERRED',reference.conname); END LOOP;
        END; $fixture$;`);
      await pool.query('DELETE FROM projects WHERE id=$1', [foreignProject]);
      await pool.query('COMMIT');
      for (const table of ['model_versions', 'project_model_selections', 'trays', 'cad_catalog_items', 'cad_catalog_ports',
        'cad_designs', 'cad_design_instances', 'cad_design_connections', 'cad_route_groups', 'cad_route_group_members']) {
        expect((await pool.query(`SELECT count(*)::int AS total FROM ${table} WHERE project_id=$1`, [foreignProject])).rows[0].total).toBe(0);
      }
      expect((await pool.query('SELECT id FROM projects WHERE id=$1', [foreignProject])).rows).toHaveLength(0);
      expect((await pool.query('SELECT id FROM material_component_cad_assets WHERE id=$1', [asset])).rows).toHaveLength(1);
    } finally {
      await pool.end();
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  }, 30000);
});
